// Extension settings. Lives in chrome.storage because a content script's
// localStorage belongs to the host page, which would make settings per-site.

const AI_ENABLED_KEY = 'tabwind-ai-enabled';

export async function isAiEnabled(): Promise<boolean> {
    const stored = await chrome.storage.local.get(AI_ENABLED_KEY);
    return stored[AI_ENABLED_KEY] !== false;
}

export async function setAiEnabled(enabled: boolean): Promise<void> {
    await chrome.storage.local.set({ [AI_ENABLED_KEY]: enabled });
}
