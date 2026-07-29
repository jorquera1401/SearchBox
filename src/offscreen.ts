// Owns the embedding model. See CLAUDE.md for why it lives here.

import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { vectorCache, cacheKey, embeddingText, dot } from './utils/vectorCache';
import { logger } from './utils/logger';

// Both are 384-dim and ~129 MB. Flip ACTIVE_MODEL to compare them on real tabs.
const MODELS = {
    'e5-small': {
        id: 'Xenova/multilingual-e5-small',
        queryPrefix: 'query: ',
        passagePrefix: 'passage: ',
        threshold: 0.8,
    },
    'paraphrase': {
        id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
        queryPrefix: '',
        passagePrefix: '',
        threshold: 0.25,
    },
} as const;

const ACTIVE_MODEL: keyof typeof MODELS = 'e5-small';
const MODEL = MODELS[ACTIVE_MODEL];

const BATCH_SIZE = 32;

env.allowLocalModels = false;
env.useBrowserCache = true;
const wasmBackend = env.backends?.onnx?.wasm;
if (wasmBackend) {
    // Without a local path the runtime imports its loader from a CDN, which
    // the CSP blocks. vite.config.ts puts the binaries in ort/.
    wasmBackend.wasmPaths = chrome.runtime.getURL('ort/');
    wasmBackend.numThreads = 1;
}

type ModelState = 'idle' | 'downloading' | 'ready' | 'failed';

let state: ModelState = 'idle';
let progress = 0;
let errorMessage = '';
let extractor: FeatureExtractionPipeline | null = null;
let initPromise: Promise<FeatureExtractionPipeline> | null = null;

// Progress is reported per file, so aggregate into one number for the UI.
const fileProgress = new Map<string, { loaded: number; total: number }>();

function updateProgress(): void {
    let loaded = 0;
    let total = 0;
    for (const f of fileProgress.values()) {
        loaded += f.loaded;
        total += f.total;
    }
    progress = total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : 0;
}

function getModel(): Promise<FeatureExtractionPipeline> {
    if (initPromise) return initPromise;

    state = 'downloading';
    progress = 0;

    initPromise = pipeline('feature-extraction', MODEL.id, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (item: any) => {
            if (item?.status === 'progress' && item.file) {
                fileProgress.set(item.file, {
                    loaded: item.loaded || 0,
                    total: item.total || 0,
                });
                updateProgress();
            }
        },
    })
        .then((pipe) => {
            extractor = pipe as FeatureExtractionPipeline;
            state = 'ready';
            progress = 100;
            logger.log('Tab Wind: Embedding model ready');
            return extractor;
        })
        .catch((e) => {
            state = 'failed';
            errorMessage = e instanceof Error ? e.message : String(e);
            console.error('Tab Wind: Embedding model failed to load', e);
            initPromise = null; // let a later attempt retry
            throw e;
        });

    return initPromise;
}

// Serialises inference: concurrent sessions spike memory.
let queue: Promise<unknown> = Promise.resolve();

function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = queue.then(fn, fn);
    queue = result.catch(() => undefined);
    return result;
}

async function embed(texts: string[]): Promise<Float32Array[]> {
    const model = await getModel();
    const vectors: Float32Array[] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);
        const output: any = await model(batch, { pooling: 'mean', normalize: true });

        const dim = output.dims[output.dims.length - 1];
        const data = output.data as Float32Array;

        for (let j = 0; j < batch.length; j++) {
            vectors.push(new Float32Array(data.slice(j * dim, (j + 1) * dim)));
        }
    }

    return vectors;
}

interface TabInput {
    id: number;
    title?: string;
    url?: string;
}

/** Embeds any tabs missing from the cache. Returns how many were computed. */
async function embedTabs(tabs: TabInput[]): Promise<number> {
    await vectorCache.load(MODEL.id);

    const missing: { key: string; text: string }[] = [];
    const seen = new Set<string>();

    for (const tab of tabs) {
        const key = cacheKey(tab.title, tab.url);
        if (vectorCache.has(key) || seen.has(key)) continue;
        seen.add(key);
        missing.push({
            key,
            text: MODEL.passagePrefix + embeddingText(tab.title, tab.url),
        });
    }

    if (missing.length === 0) return 0;

    const vectors = await embed(missing.map((m) => m.text));
    missing.forEach((m, i) => vectorCache.set(m.key, vectors[i]));

    logger.log(`Tab Wind: Embedded ${missing.length} tabs (cache: ${vectorCache.size})`);
    return missing.length;
}

async function rank(query: string, tabs: TabInput[]): Promise<{ id: number; score: number }[]> {
    await embedTabs(tabs);

    const [queryVec] = await embed([MODEL.queryPrefix + query]);

    const scored: { id: number; score: number }[] = [];
    for (const tab of tabs) {
        const vec = vectorCache.get(cacheKey(tab.title, tab.url));
        if (!vec) continue;
        scored.push({ id: tab.id, score: dot(queryVec, vec) });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.target !== 'offscreen') return false;

    switch (message.type) {
        case 'STATUS':
            sendResponse({ state, progress, error: errorMessage, cacheSize: vectorCache.size });
            return false;

        case 'INIT':
            // Not via runExclusive: that defers to a microtask, so the response
            // below would still read 'idle' and the caller would never poll.
            getModel().catch(() => undefined);
            sendResponse({ state, progress });
            return false;

        case 'EMBED_TABS':
            runExclusive(() => embedTabs(message.tabs || []))
                .then((embedded) => sendResponse({ ok: true, embedded }))
                .catch((e) => sendResponse({ ok: false, error: String(e) }));
            return true;

        case 'RANK':
            // Unfiltered, so the caller can log scores for tuning.
            runExclusive(() => rank(message.query, message.tabs || []))
                .then((results) => sendResponse({ ok: true, results, threshold: MODEL.threshold }))
                .catch((e) => sendResponse({ ok: false, error: String(e) }));
            return true;

        default:
            return false;
    }
});

// The debounced persist may still be pending on teardown.
self.addEventListener('beforeunload', () => {
    void vectorCache.persist();
});

logger.log('Tab Wind: Offscreen embedding worker started');
