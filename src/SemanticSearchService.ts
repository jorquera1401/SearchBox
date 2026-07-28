// src/SemanticSearchService.ts
//
// Content-script side of semantic search. Holds no model: it forwards queries
// to the background service worker, which relays them to the offscreen
// document where the embedding model lives.
//
// If the embedding model cannot load, this falls back to the original
// window.LanguageModel bridge (public/ai-bridge.js), which ranks tabs by
// prompting Chrome's on-device LLM.

import { logger } from './utils/logger';

export type SemanticState = 'idle' | 'downloading' | 'ready' | 'failed' | 'fallback';

export interface RankedTab {
    id: number;
    score: number;
}

export interface TabInput {
    id: number;
    title?: string;
    url?: string;
}

const POLL_INTERVAL_MS = 500;
const FALLBACK_TIMEOUT_MS = 15000;

export class SemanticSearchService {
    private state: SemanticState = 'idle';
    private progress = 0;
    private initStarted = false;
    private pollTimer: ReturnType<typeof setTimeout> | null = null;

    // LanguageModel fallback plumbing, only wired up if the model fails.
    private bridgeInjected = false;
    private bridgeAvailable = false;
    private pendingRequests = new Map<string, (result: any) => void>();

    private onChange?: (state: SemanticState, progress: number) => void;

    constructor(onChange?: (state: SemanticState, progress: number) => void) {
        this.onChange = onChange;
    }

    get isAvailable(): boolean {
        return this.state === 'ready' || (this.state === 'fallback' && this.bridgeAvailable);
    }

    get currentState(): SemanticState {
        return this.state;
    }

    get currentProgress(): number {
        return this.progress;
    }

    private setState(state: SemanticState, progress = this.progress): void {
        if (this.state === state && this.progress === progress) return;
        this.state = state;
        this.progress = progress;
        this.onChange?.(state, progress);
    }

    /**
     * Starts the model. Called when the user first opens the palette with AI
     * enabled — never on content script load, which would fire in every tab
     * and start a large download without intent.
     */
    async init(): Promise<void> {
        if (this.initStarted) return;
        this.initStarted = true;

        try {
            const status = await chrome.runtime.sendMessage({ action: 'semantic-init' });
            this.applyStatus(status);

            // Poll from 'idle' too: the model may not have flipped to
            // 'downloading' yet when this first response was sent.
            if (this.state === 'idle' || this.state === 'downloading') this.pollStatus();
        } catch (e) {
            logger.warn('Tab Wind: Could not reach background for init', e);
            this.startFallback();
        }
    }

    private applyStatus(status: any): void {
        if (!status?.state) {
            this.startFallback();
            return;
        }

        if (status.state === 'failed') {
            logger.warn('Tab Wind: Embedding model failed, falling back to LanguageModel', status.error);
            this.startFallback();
            return;
        }

        this.setState(status.state as SemanticState, status.progress ?? 0);
    }

    private pollStatus(): void {
        if (this.pollTimer) return;

        const tick = async () => {
            this.pollTimer = null;
            try {
                const status = await chrome.runtime.sendMessage({ action: 'semantic-status' });
                this.applyStatus(status);
            } catch (e) {
                logger.warn('Tab Wind: Status poll failed', e);
                this.startFallback();
                return;
            }

            if (this.state === 'idle' || this.state === 'downloading') {
                this.pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
            }
        };

        this.pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
    }

    async rankTabs(query: string, tabs: TabInput[]): Promise<RankedTab[]> {
        if (this.state === 'fallback') return this.rankViaLanguageModel(query, tabs);
        if (this.state !== 'ready') return [];

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'semantic-rank',
                query,
                tabs: tabs.map((t) => ({ id: t.id, title: t.title, url: t.url }))
            });
            return Array.isArray(response?.results) ? response.results : [];
        } catch (e) {
            logger.warn('Tab Wind: Rank request failed', e);
            return [];
        }
    }

    // --- LanguageModel fallback (original implementation) ---

    private startFallback(): void {
        this.setState('fallback', 0);
        if (this.bridgeInjected) return;
        this.bridgeInjected = true;

        window.addEventListener('message', (event) => {
            if (event.source !== window) return;
            const data = event.data;
            if (data?.type !== 'TAB_WIND_AI_RESPONSE') return;

            if (data.status === 'READY') {
                this.bridgeAvailable = data.available;
                logger.log('Tab Wind: LanguageModel fallback ready:', data.available);
                this.onChange?.(this.state, this.progress);
            } else if (data.requestId && this.pendingRequests.has(data.requestId)) {
                const resolve = this.pendingRequests.get(data.requestId);
                resolve?.(data.result);
                this.pendingRequests.delete(data.requestId);
            }
        });

        try {
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL('ai-bridge.js');
            script.onload = () => script.remove();
            (document.head || document.documentElement).appendChild(script);
            logger.log('Tab Wind: Injected LanguageModel bridge');
        } catch (e) {
            console.error('Tab Wind: Failed to inject bridge script', e);
        }
    }

    private rankViaLanguageModel(query: string, tabs: TabInput[]): Promise<RankedTab[]> {
        if (!this.bridgeAvailable) return Promise.resolve([]);

        return new Promise((resolve) => {
            const requestId = Math.random().toString(36).substring(7);

            this.pendingRequests.set(requestId, (result) => {
                // The LLM already filters for relevance, so anything it returns
                // is treated as a confident match by the caller's threshold.
                const ids: number[] = Array.isArray(result) ? result : [];
                resolve(ids.map((id) => ({ id, score: 1 })));
            });

            window.postMessage({
                type: 'TAB_WIND_AI_REQUEST',
                action: 'rank',
                query,
                tabs: tabs.slice(0, 25).map((t) => ({ id: t.id, title: t.title, url: t.url })),
                requestId
            }, '*');

            setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    logger.warn('Tab Wind: LanguageModel rank timed out');
                    this.pendingRequests.delete(requestId);
                    resolve([]);
                }
            }, FALLBACK_TIMEOUT_MS);
        });
    }
}
