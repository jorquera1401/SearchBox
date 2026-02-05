// src/SemanticSearchService.ts

export class SemanticSearchService {
    private embeddingModel: any = null;
    private isEmbeddingAvailable: boolean = false;
    private tabEmbeddings: Map<number, { vector: number[]; textHash: string }> = new Map();

    constructor() {
        this.checkAvailability();
    }

    get isAvailable(): boolean {
        return this.isEmbeddingAvailable;
    }

    private async checkAvailability() {
        if (window.ai && window.ai.embedding) {
            try {
                // Check capabilities
                // Note: API details are experimental and may vary.
                // We attempt to see if we can create a model or check capabilities.
                // Assuming capabilities() exists or we just try create().
                this.isEmbeddingAvailable = true;
                console.log("Tab Wind: Chrome AI Embedding API found.");
            } catch (e) {
                console.warn("Tab Wind: Error checking Embedding capabilities", e);
            }
        } else {
            console.log("Tab Wind: Chrome AI Embedding API not found.");
        }
    }

    async initModel() {
        if (!this.isEmbeddingAvailable) return null;
        if (this.embeddingModel) return this.embeddingModel;

        try {
            this.embeddingModel = await window.ai!.embedding!.create();
            console.log("Tab Wind: Embedding model created.");
            return this.embeddingModel;
        } catch (e) {
            console.error("Tab Wind: Failed to create Embedding model", e);
            return null;
        }
    }

    /**
     * Compute cosine similarity between two vectors.
     */
    private cosineSimilarity(vecA: number[], vecB: number[]): number {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    /**
     * Embeds a string of text.
     */
    private async embed(text: string): Promise<number[] | null> {
        const model = await this.initModel();
        if (!model) return null;

        try {
            const result = await model.compute(text);
            return result; // Result is usually an array of numbers
        } catch (e) {
            console.error("Tab Wind: Embedding computation failed", e);
            return null;
        }
    }

    /**
     * Rank tabs based on semantic similarity to the query.
     */
    async rankTabs(query: string, tabs: { title?: string, url?: string, id: number }[]): Promise<number[]> {
        if (!this.isEmbeddingAvailable) {
            console.log("Tab Wind: Semantic search unavailable.");
            return [];
        }

        console.log(`Tab Wind: Semantic searching for "${query}" across ${tabs.length} tabs.`);

        // 1. Embed Query
        const queryVector = await this.embed(query);
        if (!queryVector) return [];

        // 2. Embed Tabs (uncached ones)
        // We use a simple hash (title+url) to check cache.
        const promises = tabs.map(async (tab) => {
            const text = `${tab.title || ''} ${tab.url || ''}`;
            const hash = text; // Simple key

            if (this.tabEmbeddings.has(tab.id)) {
                const cached = this.tabEmbeddings.get(tab.id);
                if (cached!.textHash === hash) {
                    return { id: tab.id, vector: cached!.vector };
                }
            }

            const vector = await this.embed(text);
            if (vector) {
                this.tabEmbeddings.set(tab.id, { vector, textHash: hash });
                return { id: tab.id, vector };
            }
            return null;
        });

        const tabVectors = await Promise.all(promises);

        // 3. Calculate Similarity & Sort
        const scores = tabVectors
            .filter(t => t !== null)
            .map(t => {
                const score = this.cosineSimilarity(queryVector, t!.vector);
                return { id: t!.id, score };
            });

        // Sort descending by score
        scores.sort((a, b) => b.score - a.score);

        // Return IDs of tabs with score > threshold (e.g., 0.3)
        // Or just return the top sorted IDs.
        return scores.map(s => s.id);
    }
}
