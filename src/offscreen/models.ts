// Embedding model configurations.
//
// Scores are not comparable across models, so the cutoff belongs here next to
// the model that produces it rather than in the UI that consumes it.

export interface ModelConfig {
    id: string;
    /** e5 was trained with these; omitting them measurably degrades results. */
    queryPrefix: string;
    passagePrefix: string;
    /** Cosine below this is noise, on this model's own scale. */
    threshold: number;
}

export const MODELS = {
    'e5-small': {
        id: 'Xenova/multilingual-e5-small',
        queryPrefix: 'query: ',
        passagePrefix: 'passage: ',
        threshold: 0.8,
    },
    paraphrase: {
        id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
        queryPrefix: '',
        passagePrefix: '',
        threshold: 0.25,
    },
} as const satisfies Record<string, ModelConfig>;

export type ModelName = keyof typeof MODELS;

/** Both options are 384-dim and ~129 MB, so this is a like-for-like swap. */
export const ACTIVE_MODEL: ModelName = 'e5-small';

export const MODEL: ModelConfig = MODELS[ACTIVE_MODEL];
