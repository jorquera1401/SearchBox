// Service worker entry point: wiring only.

import { logger } from '../shared/logger';
import {
    isOffscreenMessage,
    type BackgroundRequest,
    type BackgroundResponses,
    type ModelStatus,
} from '../shared/messages';
import { sendToOffscreen } from './offscreenHost';
import { injectIntoExistingTabs, openPalette, openPaletteInActiveTab, switchToTab } from './palette';
import { isAiEnabled, setAiEnabled } from './settings';
import { registerWarmingListeners, scheduleWarm } from './warming';

const OFFSCREEN_UNAVAILABLE: ModelStatus = {
    state: 'failed',
    progress: 0,
    error: 'offscreen unavailable',
};

registerWarmingListeners();

chrome.runtime.onInstalled.addListener((details) => {
    logger.log('Tab Wind: Installed/updated. Reason:', details.reason);

    if (details.reason === 'install') {
        void chrome.tabs.create({ url: 'welcome.html' });
    }

    void injectIntoExistingTabs();
});

chrome.commands.onCommand.addListener((command) => {
    if (command === 'toggle-search') {
        void openPaletteInActiveTab();
    } else {
        logger.warn(`Tab Wind: Unknown command: "${command}"`);
    }
});

chrome.action.onClicked.addListener((tab) => {
    if (tab.id) {
        void openPalette(tab.id, tab.url);
    } else {
        void openPaletteInActiveTab();
    }
});

/**
 * Routes palette requests. Async handlers reply through `sendResponse`, so each
 * one returns true to hold the channel open.
 */
chrome.runtime.onMessage.addListener((message: BackgroundRequest, _sender, sendResponse) => {
    // Messages bound for the offscreen document also reach this listener.
    if (isOffscreenMessage(message)) return false;

    switch (message.action) {
        case 'switch-tab':
            void switchToTab(message.tabId, message.windowId).then(() =>
                sendResponse({ status: 'ok' } satisfies BackgroundResponses['switch-tab'])
            );
            return true;

        case 'semantic-init':
            void sendToOffscreen({ type: 'INIT' }).then((status) =>
                sendResponse(status ?? OFFSCREEN_UNAVAILABLE)
            );
            return true;

        case 'semantic-status':
            void sendToOffscreen({ type: 'STATUS' }).then((status) =>
                sendResponse(status ?? OFFSCREEN_UNAVAILABLE)
            );
            return true;

        case 'semantic-rank':
            void sendToOffscreen({ type: 'RANK', query: message.query, tabs: message.tabs }).then(
                (response) =>
                    sendResponse({
                        results: response?.ok ? response.results : [],
                        // Unreachable, so a failed rank admits nothing.
                        cutoff: response?.ok ? response.cutoff : Infinity,
                    } satisfies BackgroundResponses['semantic-rank'])
            );
            return true;

        case 'ai-enabled-get':
            void isAiEnabled().then((enabled) => sendResponse({ enabled }));
            return true;

        case 'ai-enabled-set':
            void setAiEnabled(message.enabled).then(() => {
                if (message.enabled) scheduleWarm();
                sendResponse({ status: 'ok' });
            });
            return true;
    }

    return false;
});
