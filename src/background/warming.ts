// Embeds tabs as they appear so vectors are already cached when the palette
// opens, which is what makes a query a handful of dot products.

import type { TabRef } from '../shared/messages';
import { hasOffscreenDocument, sendToOffscreen } from './offscreenHost';
import { isAiEnabled } from './settings';

const WARM_DEBOUNCE_MS = 2000;

let warmTimer: ReturnType<typeof setTimeout> | undefined;

export function isRestrictedUrl(url: string | undefined): boolean {
    if (!url) return true;
    return (
        url.startsWith('chrome://') ||
        url.startsWith('edge://') ||
        url.startsWith('about:') ||
        url.includes('chrome.google.com/webstore')
    );
}

export function toTabRefs(tabs: chrome.tabs.Tab[]): TabRef[] {
    return tabs
        .filter((t) => t.id !== undefined && !isRestrictedUrl(t.url))
        .map((t) => ({ id: t.id as number, title: t.title, url: t.url }));
}

/**
 * Only piggybacks on an already-loaded model: a tab event must never be what
 * kicks off the ~129 MB download.
 */
async function warmTabs(): Promise<void> {
    if (!(await isAiEnabled())) return;
    if (!(await hasOffscreenDocument())) return;

    const status = await sendToOffscreen({ type: 'STATUS' });
    if (status?.state !== 'ready') return;

    const tabs = await chrome.tabs.query({});
    await sendToOffscreen({ type: 'EMBED_TABS', tabs: toTabRefs(tabs) });
}

export function scheduleWarm(): void {
    clearTimeout(warmTimer);
    warmTimer = setTimeout(() => void warmTabs(), WARM_DEBOUNCE_MS);
}

export function registerWarmingListeners(): void {
    chrome.tabs.onCreated.addListener(() => scheduleWarm());
    chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
        if (changeInfo.status === 'complete' || changeInfo.title) scheduleWarm();
    });
}
