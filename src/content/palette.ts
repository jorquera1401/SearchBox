// The command palette: shadow DOM, keyboard handling and result rendering.
//
// State that used to be loose closure variables (open tabs, selection, debounce
// handle) are instance fields here, so nothing outside can reach in and mutate.

import { logger } from '../shared/logger';
import { sendToBackground, type TabData } from '../shared/messages';
import { AiStatusUi } from './aiStatus';
import { formatScores, keywordFilter, mergeRanking } from './search';
import { SemanticClient } from './semanticClient';
import contentStyles from './content.css?inline';
import contentHtml from './content.html?raw';

const HOST_ID = 'tab-wind-search-host';
const MAX_RESULTS = 10;
const SEARCH_DEBOUNCE_MS = 150;
const MIN_SEMANTIC_QUERY = 3;

export class Palette {
    private readonly host: HTMLDivElement;
    private readonly overlay: HTMLDivElement;
    private readonly input: HTMLInputElement;
    private readonly resultsList: HTMLUListElement;

    private readonly semantic: SemanticClient;
    private readonly aiStatus: AiStatusUi;

    private openTabs: TabData[] = [];
    private selectedIndex = 0;
    private debounceTimer: ReturnType<typeof setTimeout> | undefined;

    constructor() {
        document.getElementById(HOST_ID)?.remove();

        this.host = document.createElement('div');
        this.host.id = HOST_ID;
        Object.assign(this.host.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            zIndex: '2147483647',
            pointerEvents: 'none',
        });
        document.body.appendChild(this.host);

        const shadow = this.host.attachShadow({ mode: 'open' });

        const style = document.createElement('style');
        style.textContent = contentStyles;
        shadow.appendChild(style);

        const template = document.createElement('template');
        template.innerHTML = contentHtml;
        shadow.appendChild(template.content.cloneNode(true));

        const byId = <T extends HTMLElement>(id: string) => shadow.getElementById(id) as T;

        this.overlay = byId('overlay');
        this.input = byId('params-input');
        this.resultsList = byId('results');

        this.semantic = new SemanticClient((state, progress) => {
            this.aiStatus.render(state, progress);

            // The model tends to become ready mid-search; refresh rather than
            // make the user retype.
            const query = this.input.value.trim();
            if ((state === 'ready' || state === 'fallback') && this.isOpen && query.length >= MIN_SEMANTIC_QUERY) {
                this.search();
            }
        });

        this.aiStatus = new AiStatusUi(
            {
                indicator: byId('ai-indicator'),
                label: byId('ai-label'),
                toggle: byId('ai-toggle'),
                progress: byId('ai-progress'),
                progressBar: byId('ai-progress-bar'),
            },
            (enabled) => {
                if (enabled) void this.semantic.init();
                else clearTimeout(this.debounceTimer);
                this.aiStatus.render(this.semantic.currentState, this.semantic.currentProgress);
            }
        );

        this.aiStatus.render(this.semantic.currentState, this.semantic.currentProgress);
        void this.aiStatus
            .loadSetting()
            .then(() => this.aiStatus.render(this.semantic.currentState, this.semantic.currentProgress));

        this.wireEvents();
    }

    private get isOpen(): boolean {
        return this.overlay.classList.contains('visible');
    }

    private wireEvents(): void {
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) this.close();
        });

        this.input.addEventListener('input', () => {
            this.selectedIndex = 0;
            this.search();
        });

        this.input.addEventListener('keydown', (e) => this.onKeyDown(e));
    }

    private onKeyDown(e: KeyboardEvent): void {
        const count = this.resultsList.querySelectorAll('li[data-tab-id]').length;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                if (count) this.moveSelection((this.selectedIndex + 1) % count);
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (count) this.moveSelection((this.selectedIndex - 1 + count) % count);
                break;
            case 'Enter': {
                e.preventDefault();
                const item = this.resultsList.querySelectorAll<HTMLElement>('li[data-tab-id]')[this.selectedIndex];
                if (item?.dataset.tabId && item.dataset.windowId) {
                    this.activate(Number(item.dataset.tabId), Number(item.dataset.windowId));
                }
                break;
            }
            case 'Escape':
                this.close();
                break;
        }
    }

    toggle(tabs: TabData[]): void {
        if (this.isOpen) {
            this.close();
        } else {
            this.openTabs = tabs;
            this.open();
        }
    }

    private open(): void {
        // First signal of intent; on script load this would fire in every tab.
        if (this.aiStatus.isEnabled) void this.semantic.init();

        this.overlay.classList.add('visible');
        this.host.style.pointerEvents = 'auto';
        this.input.value = '';
        this.selectedIndex = 0;
        this.search();

        requestAnimationFrame(() => this.input.focus());
        setTimeout(() => this.input.focus(), 100);
    }

    private close(): void {
        this.overlay.classList.remove('visible');
        this.host.style.pointerEvents = 'none';
        clearTimeout(this.debounceTimer);
    }

    /**
     * Renders the instant substring match, then — when AI is on and ready —
     * replaces it with the model's ranking.
     */
    private search(): void {
        const query = this.input.value.trim();
        const keywordResults = keywordFilter(this.openTabs, query);
        this.render(keywordResults);

        if (!this.aiStatus.isEnabled || query.length < MIN_SEMANTIC_QUERY || !this.semantic.isAvailable) {
            return;
        }

        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => void this.semanticPass(query, keywordResults), SEARCH_DEBOUNCE_MS);
    }

    private async semanticPass(query: string, keywordResults: TabData[]): Promise<void> {
        // Drop stale responses: the user may have typed on.
        if (this.input.value.trim() !== query) return;

        try {
            const { ranked, cutoff } = await this.semantic.rankTabs(query, this.openTabs);
            if (this.input.value.trim() !== query) return;

            logger.log(
                `Tab Wind: scores for "${query}" — cutoff ${cutoff}, ${ranked.length} scored`,
                formatScores(this.openTabs, ranked, cutoff)
            );

            const merged = mergeRanking(this.openTabs, keywordResults, ranked, cutoff);
            if (merged.length > 0) this.render(merged);
        } catch (err) {
            console.error('Tab Wind: Semantic search error', err);
        }
    }

    private render(tabs: TabData[]): void {
        this.resultsList.innerHTML = '';

        if (tabs.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'empty';
            empty.textContent = 'No matching tabs found';
            this.resultsList.appendChild(empty);
            return;
        }

        for (const [index, tab] of tabs.slice(0, MAX_RESULTS).entries()) {
            this.resultsList.appendChild(this.renderRow(tab, index));
        }
    }

    private renderRow(tab: TabData, index: number): HTMLLIElement {
        const li = document.createElement('li');
        li.className = index === this.selectedIndex ? 'selected' : '';
        li.dataset.tabId = String(tab.id);
        li.dataset.windowId = String(tab.windowId);

        // Built as nodes rather than innerHTML: titles and URLs are attacker
        // controlled, and this removes the need to escape them by hand.
        const favicon = document.createElement(tab.favIconUrl ? 'img' : 'span');
        favicon.className = 'favicon';
        if (tab.favIconUrl && favicon instanceof HTMLImageElement) {
            favicon.src = tab.favIconUrl;
            favicon.addEventListener('error', () => {
                favicon.style.display = 'none';
            });
        }

        const info = document.createElement('div');
        info.className = 'info';

        const title = document.createElement('div');
        title.className = 'title';
        title.textContent = tab.title || '';

        const url = document.createElement('div');
        url.className = 'url';
        url.textContent = tab.url || '';

        info.append(title, url);
        li.append(favicon, info);

        li.addEventListener('click', () => this.activate(tab.id, tab.windowId));
        li.addEventListener('mouseenter', () => this.moveSelection(index));

        return li;
    }

    private moveSelection(index: number): void {
        this.selectedIndex = index;
        this.resultsList.querySelectorAll('li[data-tab-id]').forEach((item, i) => {
            item.classList.toggle('selected', i === index);
            if (i === index) item.scrollIntoView({ block: 'nearest' });
        });
    }

    private activate(tabId: number, windowId: number): void {
        void sendToBackground({ action: 'switch-tab', tabId, windowId });
        this.close();
    }
}
