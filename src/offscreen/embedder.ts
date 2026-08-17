// Loads the embedding model and turns text into vectors.
//
// Runs only in the offscreen document: the content script is injected into
// <all_urls>, so hosting the model there would load a copy per open tab.

import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { logger } from '../shared/logger';
import type { ModelState, ModelStatus } from '../shared/messages';
import { MODEL } from './models';

const BATCH_SIZE = 32;

env.allowLocalModels = false;
env.useBrowserCache = true;

const wasmBackend = env.backends?.onnx?.wasm;
if (wasmBackend) {
    // Without a local path the runtime imports its loader from a CDN, which the
    // extension CSP blocks. vite.config.ts puts the binaries in ort/.
    wasmBackend.wasmPaths = chrome.runtime.getURL('ort/');
    wasmBackend.numThreads = 1;
}

let state: ModelState = 'idle';
let progress = 0;
let errorMessage = '';
let initPromise: Promise<FeatureExtractionPipeline> | null = null;

const fileProgress = new Map<string, { loaded: number; total: number }>();

/** Aggregates the per-file byte counters into one number for the UI. */
function recomputeProgress(): void {
    let loaded = 0;
    let total = 0;
    for (const file of fileProgress.values()) {
        loaded += file.loaded;
        total += file.total;
    }
    progress = total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : 0;
}

export function getStatus(): ModelStatus {
    return { state, progress, error: errorMessage || undefined };
}

/**
 * Starts loading if needed and returns the shared pipeline. Flips `state` to
 * 'downloading' synchronously, so a caller that reads the status immediately
 * after sees the real state rather than a stale 'idle'.
 */
export function loadModel(): Promise<FeatureExtractionPipeline> {
    if (initPromise) return initPromise;

    state = 'downloading';
    progress = 0;

    initPromise = pipeline('feature-extraction', MODEL.id, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (item: any) => {
            if (item?.status !== 'progress' || !item.file) return;
            fileProgress.set(item.file, { loaded: item.loaded || 0, total: item.total || 0 });
            recomputeProgress();
        },
    })
        .then((pipe) => {
            state = 'ready';
            progress = 100;
            logger.log('Tab Wind: Embedding model ready');
            return pipe as FeatureExtractionPipeline;
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

let queue: Promise<unknown> = Promise.resolve();

/** Serialises inference: concurrent sessions spike memory. */
export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = queue.then(fn, fn);
    queue = result.catch(() => undefined);
    return result;
}

/** Embeds in batches. Output is mean-pooled and L2-normalised. */
export async function embed(texts: string[]): Promise<Float32Array[]> {
    const model = await loadModel();
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
