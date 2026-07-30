// Content-script client for semantic search. Holds no model: requests go to the
// background worker, and fall back to public/ai-bridge.js if it cannot load.

import { logger } from '../shared/logger';
import { sendToBackground, type ModelState, type RankedTab, type TabRef } from '../shared/messages';

/** 'fallback' is client-side only: the LanguageModel bridge is driving. */
export type SemanticState = ModelState | 'fallback';

export interface RankResult {
    /** Every tab that could be scored, best first and unfiltered. */
    ranked: RankedTab[];
    /** Cutoff below which a score is noise, on the active model's scale. */
    threshold: number;
}

const POLL_INTERVAL_MS = 500;
const FALLBACK_TIMEOUT_MS = 15000;
const NOTHING: RankResult = { ranked: [], threshold: 1 };

export class SemanticClient {
    private state: SemanticState = 'idle';
    private progress = 0;
    private initStarted = false;
    private pollTimer: ReturnType<typeof setTimeout> | null = null;

    private bridgeInjected = false;
    private bridgeAvailable = false;
    private pending = new Map<string, (result: unknown) => void>();

    constructor(private readonly onChange?: (state: SemanticState, progress: number) => void) {}

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
     * Called when the palette first opens with AI enabled — never on script
     * load, which fires in every tab and would start the download unprompted.
     *
     * Polls from 'idle' as well as 'downloading': the model may not have
     * flipped state yet when the first response was sent.
     */
    async init(): Promise<void> {
        if (this.initStarted) return;
        this.initStarted = true;

        const status = await sendToBackground({ action: 'semantic-init' });
        if (!status) {
            this.startFallback();
            return;
        }

        this.apply(status.state, status.progress, status.error);
        if (this.state === 'idle' || this.state === 'downloading') this.poll();
    }

    private apply(state: ModelState, progress: number, error?: string): void {
        if (state === 'failed') {
            logger.warn('Tab Wind: Embedding model failed, using LanguageModel', error);
            this.startFallback();
            return;
        }
        this.setState(state, progress);
    }

    private poll(): void {
        if (this.pollTimer) return;

        const tick = async () => {
            this.pollTimer = null;

            const status = await sendToBackground({ action: 'semantic-status' });
            if (!status) {
                this.startFallback();
                return;
            }

            this.apply(status.state, status.progress, status.error);

            if (this.state === 'idle' || this.state === 'downloading') {
                this.pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
            }
        };

        this.pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
    }

    /** Unfiltered, plus the cutoff to apply — models score on different scales. */
    async rankTabs(query: string, tabs: TabRef[]): Promise<RankResult> {
        if (this.state === 'fallback') {
            // The LLM already filtered for relevance; its scores are synthetic.
            return { ranked: await this.rankViaLanguageModel(query, tabs), threshold: 0 };
        }
        if (this.state !== 'ready') return NOTHING;

        const response = await sendToBackground({
            action: 'semantic-rank',
            query,
            tabs: tabs.map((t) => ({ id: t.id, title: t.title, url: t.url })),
        });

        return response ? { ranked: response.results, threshold: response.threshold } : NOTHING;
    }

    // --- LanguageModel fallback ---

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
            } else if (data.requestId) {
                const resolve = this.pending.get(data.requestId);
                if (resolve) {
                    resolve(data.result);
                    this.pending.delete(data.requestId);
                }
            }
        });

        try {
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL('ai-bridge.js');
            script.onload = () => script.remove();
            (document.head || document.documentElement).appendChild(script);
        } catch (e) {
            console.error('Tab Wind: Failed to inject bridge script', e);
        }
    }

    private rankViaLanguageModel(query: string, tabs: TabRef[]): Promise<RankedTab[]> {
        if (!this.bridgeAvailable) return Promise.resolve([]);

        return new Promise((resolve) => {
            const requestId = Math.random().toString(36).slice(2);

            this.pending.set(requestId, (result) => {
                const ids = Array.isArray(result) ? (result as number[]) : [];
                resolve(ids.map((id) => ({ id, score: 1 })));
            });

            window.postMessage(
                {
                    type: 'TAB_WIND_AI_REQUEST',
                    action: 'rank',
                    query,
                    tabs: tabs.slice(0, 25).map((t) => ({ id: t.id, title: t.title, url: t.url })),
                    requestId,
                },
                '*'
            );

            setTimeout(() => {
                if (this.pending.delete(requestId)) {
                    logger.warn('Tab Wind: LanguageModel rank timed out');
                    resolve([]);
                }
            }, FALLBACK_TIMEOUT_MS);
        });
    }
}
