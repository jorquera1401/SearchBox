// Opening the palette and acting on its result.
//
// The content script may be missing from a tab (fresh install, extension
// reload), so every send falls back to injecting it and retrying once.

import { logger } from '../shared/logger';
import type { ContentRequest, TabData } from '../shared/messages';
import { isRestrictedUrl } from './warming';

const INJECT_SETTLE_MS = 100;

function contentScriptPath(): string | undefined {
    return chrome.runtime.getManifest().content_scripts?.[0]?.js?.[0];
}

function toTabData(tabs: chrome.tabs.Tab[]): TabData[] {
    return tabs
        .filter((t) => t.id !== undefined && t.windowId !== undefined)
        .map((t) => ({
            id: t.id as number,
            windowId: t.windowId as number,
            title: t.title,
            url: t.url,
            favIconUrl: t.favIconUrl,
        }));
}

async function injectContentScript(tabId: number): Promise<boolean> {
    const file = contentScriptPath();
    if (!file) {
        console.error('Tab Wind: No content script found in manifest.');
        return false;
    }

    try {
        await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
        return true;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Expected on pages extensions may not script.
        if (
            !msg.includes('Extension manifest must request permission') &&
            !msg.includes('The extensions gallery cannot be scripted')
        ) {
            console.error('Tab Wind: Script injection failed:', err);
        }
        return false;
    }
}

async function openInTab(tabId: number, url: string | undefined, allTabs: chrome.tabs.Tab[]): Promise<void> {
    const message: ContentRequest = { action: 'toggle-modal', tabs: toTabData(allTabs) };

    try {
        await chrome.tabs.sendMessage(tabId, message);
        return;
    } catch {
        logger.log('Tab Wind: Content script absent, injecting...');
    }

    if (isRestrictedUrl(url)) {
        console.warn('Tab Wind: Cannot inject into this tab URL:', url);
        return;
    }

    if (!(await injectContentScript(tabId))) return;

    await new Promise((resolve) => setTimeout(resolve, INJECT_SETTLE_MS));
    try {
        await chrome.tabs.sendMessage(tabId, message);
    } catch (err) {
        console.error('Tab Wind: Final message attempt failed:', err);
    }
}

export async function openPaletteInActiveTab(): Promise<void> {
    const allTabs = await chrome.tabs.query({});
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!active?.id) {
        console.warn('Tab Wind: No active tab found.');
        return;
    }

    await openInTab(active.id, active.url, allTabs);
}

export async function openPalette(tabId: number, url?: string): Promise<void> {
    const allTabs = await chrome.tabs.query({});
    await openInTab(tabId, url, allTabs);
}

export async function switchToTab(tabId: number, windowId: number): Promise<void> {
    await chrome.windows.update(windowId, { focused: true });
    await chrome.tabs.update(tabId, { active: true });
}

/** Injects into already-open tabs so the shortcut works without a reload. */
export async function injectIntoExistingTabs(): Promise<void> {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
        tabs.map((tab) =>
            tab.id && !isRestrictedUrl(tab.url) ? injectContentScript(tab.id) : Promise.resolve(false)
        )
    );
}
