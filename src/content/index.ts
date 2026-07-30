// Content script entry point: bootstrap only.

import { logger } from '../shared/logger';
import type { ContentRequest } from '../shared/messages';
import { Palette } from './palette';
import './styles.css';

function start(): void {
    const palette = new Palette();
    logger.log('Tab Wind: Palette ready');

    chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
        if (message?.action !== 'toggle-modal') return false;
        palette.toggle(message.tabs || []);
        sendResponse({ status: 'ok' });
        return false;
    });
}

// Guards against double injection in the same context; the Palette constructor
// separately clears a stale host left by a previous one.
if (!window.hasTabWindRun) {
    window.hasTabWindRun = true;
    try {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', start);
        } else {
            start();
        }
    } catch (e) {
        console.error('Tab Wind: Critical error starting content script', e);
    }
}
