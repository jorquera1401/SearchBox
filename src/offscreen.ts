// src/offscreen.ts
//
// Owns the embedding model. This runs in the extension's single offscreen
// document, so there is exactly one copy of the model in memory no matter how
// many tabs are open.
//
// Ranking is cosine similarity between the query vector and cached tab
// vectors. Tab vectors are computed once and reused, so a warm query is a few
// hundred dot products over 384 floats — microseconds of work.

import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { vectorCache, cacheKey, embeddingText, dot } from './utils/vectorCache';
import { logger } from './utils/logger';

// Both models are 384-dim and ~129 MB, so switching is a like-for-like swap.
// They differ in training objective: e5 is trained for retrieval (a short
// query against documents), which is what this palette does, while the
// paraphrase model is trained for sentence-pair similarity. Flip ACTIVE_MODEL
// to compare them on real tabs -- the vector cache is namespaced per model,
// so no stale vectors carry over.
const MODELS = {
    'e5-small': {
        id: 'Xenova/multilingual-e5-small',
        // e5 was trained with these prefixes. Omitting them measurably
        // degrades results; they are not decorative.
        queryPrefix: 'query: ',
        passagePrefix: 'passage: ',
        // e5 packs its cosine scores into a narrow, high band (relevant ~0.85,
        // irrelevant ~0.75), so the cutoff lives with the model rather than as
        // one shared constant -- the paraphrase model's 0.25 would let
        // everything through here. Starting estimate; tune against the scores
        // logged in the page console.
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

// Weights are fetched from the HuggingFace CDN on first use and kept in the
// Cache API, so they survive both browser restarts and extension updates.
env.allowLocalModels = false;
env.useBrowserCache = true;
const wasmBackend = env.backends?.onnx?.wasm;
if (wasmBackend) {
    // Must point at the copy shipped inside the extension. Left unset, the
    // runtime dynamically imports its loader from the jsdelivr CDN, which the
    // extension CSP blocks -- surfacing as "no available backend found".
    // vite.config.ts places these files in ort/.
    wasmBackend.wasmPaths = chrome.runtime.getURL('ort/');
    // Multi-threaded WASM needs SharedArrayBuffer, which needs COOP/COEP
    // headers that extension pages don't have. Single-threaded it is.
    wasmBackend.numThreads = 1;
}

type ModelState = 'idle' | 'downloading' | 'ready' | 'failed';

let state: ModelState = 'idle';
let progress = 0;
let errorMessage = '';
let extractor: FeatureExtractionPipeline | null = null;
let initPromise: Promise<FeatureExtractionPipeline> | null = null;

// Per-file byte counters. transformers.js reports progress per file, so we
// aggregate them to get one meaningful number for the UI.
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
            // Drop the cached promise so a later attempt can retry rather than
            // replaying this rejection forever.
            initPromise = null;
            throw e;
        });

    return initPromise;
}

// ONNX sessions are not reentrant-friendly and batching large tensors spikes
// memory, so every inference call goes through this chain.
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
            // Called directly rather than through runExclusive: that defers to
            // a microtask, so `state` would still read 'idle' in the response
            // below and the caller would never start polling for progress.
            // getModel() flips state to 'downloading' synchronously.
            getModel().catch(() => undefined);
            sendResponse({ state, progress });
            return false;

        case 'EMBED_TABS':
            runExclusive(() => embedTabs(message.tabs || []))
                .then((embedded) => sendResponse({ ok: true, embedded }))
                .catch((e) => sendResponse({ ok: false, error: String(e) }));
            return true;

        case 'RANK':
            // All scores are returned, unfiltered, so the caller can log them
            // for tuning; `threshold` travels with them because only the model
            // knows the scale its scores live on.
            runExclusive(() => rank(message.query, message.tabs || []))
                .then((results) => sendResponse({ ok: true, results, threshold: MODEL.threshold }))
                .catch((e) => sendResponse({ ok: false, error: String(e) }));
            return true;

        default:
            return false;
    }
});

// Flush the cache on teardown; the debounced persist may still be pending.
self.addEventListener('beforeunload', () => {
    void vectorCache.persist();
});

logger.log('Tab Wind: Offscreen embedding worker started');
