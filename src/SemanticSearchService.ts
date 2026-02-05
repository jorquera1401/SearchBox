// src/SemanticSearchService.ts

export class SemanticSearchService {
    private session: any = null;
    private isAvailable: boolean = false;

    constructor() {
        this.checkAvailability();
    }

    private async checkAvailability() {
        if (window.ai && window.ai.languageModel) {
            try {
                // Check if we can create a session
                const capabilities = await window.ai.languageModel.capabilities();
                if (capabilities.available !== 'no') {
                    this.isAvailable = true;
                    console.log("Tab Wind: Chrome AI is available.");
                } else {
                    console.log("Tab Wind: Chrome AI is present but not available.");
                }
            } catch (e) {
                console.warn("Tab Wind: Error checking AI capabilities", e);
            }
        } else {
            console.log("Tab Wind: Chrome AI (window.ai) not found.");
        }
    }

    async getSession() {
        if (!this.isAvailable) return null;
        if (this.session) return this.session;

        try {
            if (window.ai?.languageModel) {
                this.session = await window.ai.languageModel.create({
                    systemPrompt: "You are a helpful assistant that finds the most relevant browser tab based on a user query. I will give you a list of tabs (Title and URL) and a search query. You should return the indices of the most relevant tabs.",
                });
                return this.session;
            }
        } catch (e) {
            console.error("Tab Wind: Failed to create AI session", e);
            return null;
        }
        return null;
    }

    /**
     * Calculates semantic similarity between a query and a list of tabs.
     * Note: Since the specialized Embedding API isn't always available,
     * we might use a Prompt approach or wait for 'window.ai.embedding'.
     * 
     * For this initial version, we will check if an embedding model is available,
     * otherwise we fallback to a keyword + lightweight LLM re-ranking approach if possible.
     */
    async rankTabs(query: string, tabs: { title?: string, url?: string, id: number }[]): Promise<number[]> {
        if (!this.isAvailable) return [];

        // Placeholder for true embedding search. 
        // Currently 'window.ai' is mostly 'languageModel'. Embedding API is 'text-embedding-004' usually.
        // If we only have languageModel, using it to "rank" 100+ tabs is too slow/expensive for a quick switch.
        // So we will stick to:
        // 1. Keyword filter (fast)
        // 2. If < 5 results, ask LLM if any other tabs match the "concept" (slow, might not be suitable for instant UI)

        // For now, let's just log that we would search here.
        // Implementing full RAG client-side needs the Embedding API specifically.
        console.log("Semantic search requested for:", query);
        return [];
    }
}
