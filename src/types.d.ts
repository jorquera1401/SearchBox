// Global type definitions

interface Window {
    hasTabWindRun?: boolean;
    ai?: {
        languageModel?: {
            create(options?: any): Promise<any>;
            capabilities(): Promise<any>;
        };
        // Experimental Embedding API
        embedding?: {
            create(options?: any): Promise<any>;
            capabilities(): Promise<any>;
        }
    };
    model?: any; // Fallback for some experimental builds
}

// Add Chrome AI Prompt API types if they become standard/available
// For now, we use 'any' for the experimental API to avoid compilation blockers.
