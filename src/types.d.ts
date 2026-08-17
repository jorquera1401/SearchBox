// Global type definitions.

interface Window {
    /** Set by the content script to guard against double injection. */
    hasTabWindRun?: boolean;

    /**
     * Chrome's built-in on-device LLM, used as a fallback when the embedding
     * model cannot load. Only reachable from the main world, which is why
     * public/ai-bridge.js exists. Typed loosely: the API is still changing.
     */
    LanguageModel?: {
        availability(): Promise<string>;
        create(options?: any): Promise<any>;
    };
}
