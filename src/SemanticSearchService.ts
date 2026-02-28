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

        // Listen for messages from the Main World bridge
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

        // Inject the bridge script into Main World via valid extension URL
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
     * Rank tabs by relevance to the query using the on-device LanguageModel.
     * Returns an array of tab IDs sorted from most to least relevant.
     */
    async rankTabs(query: string, tabs: { title?: string, url?: string, id: number }[]): Promise<number[]> {
        if (!this.isEmbeddingAvailable) return [];

        logger.log(`Tab Wind: Semantic ranking for "${query}"...`);

        return new Promise((resolve) => {
            const requestId = Math.random().toString(36).substring(7);

            this.pendingRequests.set(requestId, (result) => {
                resolve(Array.isArray(result) ? result : []);
            });

            window.postMessage({
                type: "TAB_WIND_AI_REQUEST",
                action: "rank",
                query,
                tabs: tabs.slice(0, 25).map(t => ({ id: t.id, title: t.title, url: t.url })),
                requestId
            }, "*");

            // LLM is slower than embedding — use a generous timeout
            setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    logger.log("Tab Wind: Semantic rank timed out");
                    this.pendingRequests.delete(requestId);
                    resolve([]);
                }
            }, 15000);
        });
    }
}
