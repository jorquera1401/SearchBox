// Lifecycle of the offscreen document, which hosts the embedding model.

import { logger } from '../shared/logger';
import {
    OFFSCREEN_TARGET,
    type OffscreenRequest,
    type OffscreenResponses,
    type OffscreenType,
} from '../shared/messages';

const OFFSCREEN_URL = 'offscreen.html';
const SEND_ATTEMPTS = 4;

let creating: Promise<void> | null = null;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function hasOffscreenDocument(): Promise<boolean> {
    const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
    });
    return contexts.length > 0;
}

async function ensureOffscreen(): Promise<void> {
    if (await hasOffscreenDocument()) return;

    // Concurrent createDocument calls throw, so share one in-flight promise.
    if (creating) return creating;

    creating = chrome.offscreen
        .createDocument({
            url: OFFSCREEN_URL,
            reasons: ['WORKERS' as chrome.offscreen.Reason],
            justification: 'Run the local embedding model for semantic tab search',
        })
        .catch((err) => {
            // A parallel caller may have won the race between check and create.
            if (!String(err).includes('Only a single offscreen')) throw err;
        })
        .finally(() => {
            creating = null;
        });

    return creating;
}

/**
 * Retries briefly: createDocument resolves before the document's module
 * registers its listener, so the first send can hit "Receiving end does not
 * exist" even though the document exists.
 */
export async function sendToOffscreen<T extends OffscreenType>(
    message: Extract<OffscreenRequest, { type: T }>
): Promise<OffscreenResponses[T] | null> {
    for (let attempt = 0; attempt < SEND_ATTEMPTS; attempt++) {
        try {
            await ensureOffscreen();
            return await chrome.runtime.sendMessage({ ...message, target: OFFSCREEN_TARGET });
        } catch (e) {
            const notReady = String(e).includes('Receiving end does not exist');
            if (!notReady || attempt === SEND_ATTEMPTS - 1) {
                logger.warn('Tab Wind: Offscreen message failed', message.type, e);
                return null;
            }
            await delay(100 * (attempt + 1));
        }
    }
    return null;
}
