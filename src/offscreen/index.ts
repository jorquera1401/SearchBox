// Offscreen document entry point: owns the model and answers ranking requests.

import { logger } from '../shared/logger';
import {
    isOffscreenMessage,
    type OffscreenResponses,
    type RankedTab,
    type TabRef,
} from '../shared/messages';
import { embed, getStatus, loadModel, runExclusive } from './embedder';
import { MODEL } from './models';
import { computeCutoff } from './relevance';
import { cacheKey, dot, embeddingText, vectorCache } from './vectorCache';

/** Embeds any tabs missing from the cache. Returns how many were computed. */
async function embedTabs(tabs: TabRef[]): Promise<number> {
    await vectorCache.load(MODEL.id);

    const missing: { key: string; text: string }[] = [];
    const seen = new Set<string>();

    for (const tab of tabs) {
        const key = cacheKey(tab.title, tab.url);
        if (vectorCache.has(key) || seen.has(key)) continue;
        seen.add(key);
        missing.push({ key, text: MODEL.passagePrefix + embeddingText(tab.title, tab.url) });
    }

    if (missing.length === 0) return 0;

    const vectors = await embed(missing.map((m) => m.text));
    missing.forEach((m, i) => vectorCache.set(m.key, vectors[i]));

    logger.log(`Tab Wind: Embedded ${missing.length} tabs (cache: ${vectorCache.size})`);
    return missing.length;
}

/** Scores every tab, best first. Unfiltered: the caller applies the threshold. */
async function rank(query: string, tabs: TabRef[]): Promise<RankedTab[]> {
    await embedTabs(tabs);

    const [queryVec] = await embed([MODEL.queryPrefix + query]);

    const scored: RankedTab[] = [];
    for (const tab of tabs) {
        const vec = vectorCache.get(cacheKey(tab.title, tab.url));
        if (!vec) continue;
        scored.push({ id: tab.id, score: dot(queryVec, vec) });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored;
}

function fail(e: unknown): { ok: false; error: string } {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isOffscreenMessage(message)) return false;

    switch (message.type) {
        case 'STATUS': {
            const status: OffscreenResponses['STATUS'] = {
                ...getStatus(),
                cacheSize: vectorCache.size,
            };
            sendResponse(status);
            return false;
        }

        case 'INIT':
            loadModel().catch(() => undefined);
            sendResponse(getStatus());
            return false;

        case 'EMBED_TABS':
            runExclusive(() => embedTabs(message.tabs))
                .then((embedded) => sendResponse({ ok: true, embedded }))
                .catch((e) => sendResponse(fail(e)));
            return true;

        case 'RANK':
            runExclusive(() => rank(message.query, message.tabs))
                .then((results) =>
                    sendResponse({
                        ok: true,
                        results,
                        cutoff: computeCutoff(results, MODEL.relevance),
                    })
                )
                .catch((e) => sendResponse(fail(e)));
            return true;
    }
});

self.addEventListener('beforeunload', () => {
    void vectorCache.persist();
});

logger.log('Tab Wind: Offscreen embedding worker started');
