// Embedding model configurations.
//
// Scores are not comparable across models, so relevance tuning belongs here
// next to the model that produces it rather than in the UI that consumes it.

import type { RelevanceConfig } from './relevance';

export interface ModelConfig {
    id: string;
    /** e5 was trained with these; omitting them measurably degrades results. */
    queryPrefix: string;
    passagePrefix: string;
    relevance: RelevanceConfig;
}

export const MODELS = {
    'e5-small': {
        id: 'Xenova/multilingual-e5-small',
        queryPrefix: 'query: ',
        passagePrefix: 'passage: ',
        // Tuned against real tabs: matching queries showed a top-to-median
        // spread of 0.022+, non-matching ones 0.013 or less.
        relevance: { margin: 0.015, minSpread: 0.018 },
    },
    paraphrase: {
        id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
        queryPrefix: '',
        passagePrefix: '',
        // Untuned: this model spreads scores far wider, so these are scaled
        // guesses. Re-measure before switching to it.
        relevance: { margin: 0.06, minSpread: 0.05 },
    },
} as const satisfies Record<string, ModelConfig>;

export type ModelName = keyof typeof MODELS;

/** Both options are 384-dim and ~129 MB, so this is a like-for-like swap. */
export const ACTIVE_MODEL: ModelName = 'e5-small';

export const MODEL: ModelConfig = MODELS[ACTIVE_MODEL];
