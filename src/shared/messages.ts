// The single definition of every message that crosses a context boundary.
//
// Previously each action was a bare string literal repeated in three files,
// where a typo compiled cleanly and failed silently at runtime. Response shapes
// are keyed off the request, so `sendToBackground` and `sendToOffscreen` return
// the right type without a cast at the call site.

export interface TabRef {
    id: number;
    title?: string;
    url?: string;
}

export interface TabData extends TabRef {
    windowId: number;
    favIconUrl?: string;
}

export interface RankedTab {
    id: number;
    score: number;
}

export type ModelState = 'idle' | 'downloading' | 'ready' | 'failed';

export interface ModelStatus {
    state: ModelState;
    progress: number;
    error?: string;
    cacheSize?: number;
}

// --- content -> background ---

export type BackgroundRequest =
    | { action: 'switch-tab'; tabId: number; windowId: number }
    | { action: 'semantic-status' }
    | { action: 'semantic-init' }
    | { action: 'semantic-rank'; query: string; tabs: TabRef[] }
    | { action: 'ai-enabled-get' }
    | { action: 'ai-enabled-set'; enabled: boolean };

export interface BackgroundResponses {
    'switch-tab': { status: 'ok' };
    'semantic-status': ModelStatus;
    'semantic-init': ModelStatus;
    /** `cutoff` is computed per query from the score distribution, not fixed. */
    'semantic-rank': { results: RankedTab[]; cutoff: number };
    'ai-enabled-get': { enabled: boolean };
    'ai-enabled-set': { status: 'ok' };
}

export type BackgroundAction = BackgroundRequest['action'];

// --- background -> content ---

export type ContentRequest = { action: 'toggle-modal'; tabs: TabData[] };

// --- background -> offscreen ---

export const OFFSCREEN_TARGET = 'offscreen' as const;

export type OffscreenRequest =
    | { type: 'STATUS' }
    | { type: 'INIT' }
    | { type: 'EMBED_TABS'; tabs: TabRef[] }
    | { type: 'RANK'; query: string; tabs: TabRef[] };

export type OffscreenType = OffscreenRequest['type'];

type Failure = { ok: false; error: string };

export interface OffscreenResponses {
    STATUS: ModelStatus;
    INIT: ModelStatus;
    EMBED_TABS: { ok: true; embedded: number } | Failure;
    RANK: { ok: true; results: RankedTab[]; cutoff: number } | Failure;
}

/** An offscreen message once tagged for delivery. */
export type TargetedOffscreenRequest = OffscreenRequest & { target: typeof OFFSCREEN_TARGET };

export function isOffscreenMessage(message: unknown): message is TargetedOffscreenRequest {
    return (message as { target?: unknown } | null)?.target === OFFSCREEN_TARGET;
}

/**
 * Resolves to null instead of throwing when no receiver is listening, which is
 * routine: the service worker sleeps and the palette may be gone.
 */
export async function sendToBackground<A extends BackgroundAction>(
    message: Extract<BackgroundRequest, { action: A }>
): Promise<BackgroundResponses[A] | null> {
    try {
        return await chrome.runtime.sendMessage(message);
    } catch {
        return null;
    }
}
