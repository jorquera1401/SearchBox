// src/SemanticSearchService.ts

import { logger } from './utils/logger';

export class SemanticSearchService {
    private isEmbeddingAvailable: boolean = false;
    private bridgeInitialized: boolean = false;
    private pendingRequests: Map<string, (result: any) => void> = new Map();

    private onAvailabilityChange?: (available: boolean) => void;

    constructor(onAvailabilityChange?: (available: boolean) => void) {
        this.onAvailabilityChange = onAvailabilityChange;
        this.initBridge();
    }

    get isAvailable(): boolean {
        return this.isEmbeddingAvailable;
    }

    private initBridge() {
        if (this.bridgeInitialized) return;

        // 1. Listen for messages from the Main World
        window.addEventListener("message", (event) => {
            if (event.source !== window) return;

            const data = event.data;
            if (data?.type === "TAB_WIND_AI_RESPONSE") {
                if (data.status === "READY") {
                    this.isEmbeddingAvailable = data.available;
                    logger.log("Tab Wind: AI Bridge Ready. Available:", this.isEmbeddingAvailable);
                    if (this.onAvailabilityChange) {
                        this.onAvailabilityChange(this.isEmbeddingAvailable);
                    }
                } else if (data.requestId && this.pendingRequests.has(data.requestId)) {
                    const resolve = this.pendingRequests.get(data.requestId);
                    resolve && resolve(data.result);
                    this.pendingRequests.delete(data.requestId);
                }
            }
        });

        // 2. Inject the script into Main World
        // 2. Inject the script into Main World via valid URL
        try {
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL('ai-bridge.js');
            script.onload = () => script.remove();
            (document.head || document.documentElement).appendChild(script);
            this.bridgeInitialized = true;
            logger.log("Tab Wind: Bridge script injected via src", script.src);

        } catch (e) {
            console.error("Tab Wind: Failed to inject bridge script", e);
        }
    }

    /**
     * Rank tabs based on semantic similarity to the query.
     */
    async rankTabs(query: string, tabs: { title?: string, url?: string, id: number }[]): Promise<number[]> {
        if (!this.isEmbeddingAvailable) return [];

        logger.log(`Tab Wind: Semantic searching for "${query}"...`);

        // Helper to request embedding via bridge
        const getEmbedding = (text: string): Promise<number[] | null> => {
            return new Promise((resolve) => {
                const requestId = Math.random().toString(36).substring(7);
                this.pendingRequests.set(requestId, resolve);
                window.postMessage({
                    type: "TAB_WIND_AI_REQUEST",
                    action: "embed",
                    text,
                    requestId
                }, "*");

                // Timeout fallback
                setTimeout(() => {
                    if (this.pendingRequests.has(requestId)) {
                        this.pendingRequests.delete(requestId);
                        resolve(null);
                    }
                }, 2000);
            });
        };

        // 1. Embed Query
        const queryVector = await getEmbedding(query);
        if (!queryVector) return [];

        // 2. Embed Tabs
        const promises = tabs.slice(0, 50).map(async (tab) => {
            const text = `${tab.title || ''} ${tab.url || ''}`;
            const vector = await getEmbedding(text);
            if (vector) return { id: tab.id, vector };
            return null;
        });

        const tabVectors = await Promise.all(promises);

        // 3. Cosine Similarity
        const scores = tabVectors
            .filter(t => t !== null)
            .map(t => {
                const score = this.cosineSimilarity(queryVector, t!.vector);
                return { id: t!.id, score };
            });

        scores.sort((a, b) => b.score - a.score);
        return scores.map(s => s.id);
    }

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
}
