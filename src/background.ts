import { logger } from './utils/logger';

// src/background.ts

// Helper to check for restricted URLs
function isRestrictedUrl(url: string | undefined): boolean {
    if (!url) return true;
    return url.startsWith("chrome://") || url.startsWith("edge://") || url.startsWith("about:") || url.includes("chrome.google.com/webstore");
}

// --- Offscreen document: the single host for the embedding model ---

const OFFSCREEN_URL = "offscreen.html";
const AI_ENABLED_KEY = "tabwind-ai-enabled";
const WARM_DEBOUNCE_MS = 2000;

let offscreenPromise: Promise<void> | null = null;

async function hasOffscreenDocument(): Promise<boolean> {
    const contexts = await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
    });
    return contexts.length > 0;
}

async function ensureOffscreen(): Promise<void> {
    if (await hasOffscreenDocument()) return;

    // Concurrent createDocument calls throw, so share one in-flight promise.
    if (offscreenPromise) return offscreenPromise;

    offscreenPromise = chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: ["WORKERS" as chrome.offscreen.Reason],
        justification: "Run the local embedding model for semantic tab search"
    }).catch((err) => {
        // A parallel caller may have created it between our check and this call.
        if (!String(err).includes("Only a single offscreen")) throw err;
    }).finally(() => {
        offscreenPromise = null;
    });

    return offscreenPromise;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sendToOffscreen<T = any>(message: any): Promise<T | null> {
    // createDocument resolves before the document's module registers its
    // listener, so early sends fail with "Receiving end does not exist".
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            await ensureOffscreen();
            return await chrome.runtime.sendMessage({ ...message, target: "offscreen" });
        } catch (e) {
            const isNotReady = String(e).includes("Receiving end does not exist");
            if (!isNotReady || attempt === 3) {
                logger.warn("Tab Wind: Offscreen message failed", message?.type, e);
                return null;
            }
            await delay(100 * (attempt + 1));
        }
    }
    return null;
}

async function isAiEnabled(): Promise<boolean> {
    const stored = await chrome.storage.local.get(AI_ENABLED_KEY);
    return stored[AI_ENABLED_KEY] !== false;
}

function toTabInput(tabs: chrome.tabs.Tab[]) {
    return tabs
        .filter((t) => t.id !== undefined && !isRestrictedUrl(t.url))
        .map((t) => ({ id: t.id as number, title: t.title, url: t.url }));
}

// --- Proactive warming ---
// Embeds tabs as they appear, so vectors are cached before the palette opens.

let warmTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleWarm(): void {
    clearTimeout(warmTimer);
    warmTimer = setTimeout(() => { void warmTabs(); }, WARM_DEBOUNCE_MS);
}

async function warmTabs(): Promise<void> {
    if (!(await isAiEnabled())) return;

    // Never start a 129 MB download because a tab event fired: warming only
    // piggybacks on a model the user already opted into.
    if (!(await hasOffscreenDocument())) return;

    const status = await sendToOffscreen<{ state: string }>({ type: "STATUS" });
    if (status?.state !== "ready") return;

    const tabs = await chrome.tabs.query({});
    await sendToOffscreen({ type: "EMBED_TABS", tabs: toTabInput(tabs) });
}

chrome.tabs.onCreated.addListener(() => scheduleWarm());
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.status === "complete" || changeInfo.title) scheduleWarm();
});

chrome.runtime.onInstalled.addListener((details) => {
    logger.log("Extension installed/updated. Reason:", details.reason);

    if (details.reason === "install") {
        chrome.tabs.create({ url: "welcome.html" });
    }

    logger.log("Injecting content scripts...");
    const manifest = chrome.runtime.getManifest();
    const contentScriptJs = manifest.content_scripts?.[0]?.js?.[0];

    if (!contentScriptJs) {
        console.error("No content script found in manifest.");
        return;
    }

    chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
            if (tab.id && !isRestrictedUrl(tab.url)) {
                chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: [contentScriptJs]
                }).catch(err => {
                    // Ignore expected permission errors on restricted pages
                    const msg = err.message || "";
                    if (!msg.includes("Extension manifest must request permission") &&
                        !msg.includes("The extensions gallery cannot be scripted")) {
                        console.warn("Failed to inject content script into tab", tab.id, err);
                    }
                });
            }
        });
    });
});

chrome.commands.onCommand.addListener((command) => {
    logger.log(`Tab Wind: Command received: "${command}"`);

    if (command === "toggle-search") {
        openModalInActiveTab();
    } else {
        logger.log(`Tab Wind: Unknown command: "${command}"`);
    }
});

chrome.action.onClicked.addListener((tab) => {
    logger.log("Action clicked", tab);

    if (tab.id) {
        openModalInTab(tab.id, tab.url);
    } else {
        openModalInActiveTab();
    }
});

function openModalInActiveTab() {
    chrome.tabs.query({}, (tabs) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
            if (!activeTabs || activeTabs.length === 0) {
                console.warn("No active tab found.");
                return;
            }

            const activeTab = activeTabs[0];
            if (activeTab.id !== undefined) {
                openModalInTab(activeTab.id, activeTab.url, tabs);
            }
        });
    });
}

function openModalInTab(tabId: number, url?: string, allTabs?: chrome.tabs.Tab[]) {
    // If allTabs not provided, query them
    if (!allTabs) {
        chrome.tabs.query({}, (tabs) => {
            performOpen(tabId, url, tabs);
        });
    } else {
        performOpen(tabId, url, allTabs);
    }
}

function performOpen(tabId: number, url: string | undefined, tabs: chrome.tabs.Tab[]) {
    // Helper to send message
    const sendMessage = async () => {
        return chrome.tabs.sendMessage(tabId, {
            action: "toggle-modal",
            tabs: tabs
        });
    };

    sendMessage()
        .then(() => {
            logger.log("Tab Wind: Message sent successfully to tab", tabId);

        })
        .catch((error) => {
            console.warn("Message failed. Attempting injection...", error);

            if (!isRestrictedUrl(url)) {
                // Dynamically get the correct file path from manifest
                const manifest = chrome.runtime.getManifest();
                const contentScriptJs = manifest.content_scripts?.[0]?.js?.[0];

                if (contentScriptJs) {
                    chrome.scripting.executeScript({
                        target: { tabId: tabId },
                        files: [contentScriptJs]
                    }).then(() => {

                        setTimeout(() => {
                            sendMessage().catch(err => console.error("Final message attempt failed:", err));
                        }, 100);
                    }).catch(err => {
                        const msg = err.message || "";
                        if (!msg.includes("Extension manifest must request permission") &&
                            !msg.includes("The extensions gallery cannot be scripted")) {
                            console.error("Script injection failed:", err);
                        }
                    });
                } else {
                    console.error("Could not determine content script path from manifest.");
                }
            } else {
                console.warn("Cannot inject script into this tab URL:", url);
                // TODO: Open fallback popup logic here
            }
        });
}


interface SwitchTabMessage {
    action: "switch-tab";
    tabId: number;
    windowId: number;
}

chrome.runtime.onMessage.addListener((request: any, sender, sendResponse) => {
    // Messages addressed to the offscreen document also reach this listener.
    if (request?.target === "offscreen") return false;

    logger.log("Tab Wind: Background received message from", sender.tab?.id, request);

    if (request.action === "switch-tab") {
        const message = request as SwitchTabMessage;
        const tabId = message.tabId;
        const windowId = message.windowId;

        chrome.windows.update(windowId, { focused: true }, () => {
            chrome.tabs.update(tabId, { active: true });
        });
        sendResponse({ status: "ok" });
        return true;
    }

    if (request.action === "semantic-status") {
        (async () => {
            const status = await sendToOffscreen({ type: "STATUS" });
            sendResponse(status ?? { state: "failed", progress: 0, error: "offscreen unavailable" });
        })();
        return true;
    }

    if (request.action === "semantic-init") {
        (async () => {
            const status = await sendToOffscreen({ type: "INIT" });
            sendResponse(status ?? { state: "failed", progress: 0, error: "offscreen unavailable" });
        })();
        return true;
    }

    if (request.action === "semantic-rank") {
        (async () => {
            const response = await sendToOffscreen<{ ok: boolean; results?: any[]; threshold?: number }>({
                type: "RANK",
                query: request.query,
                tabs: request.tabs || []
            });
            sendResponse({
                results: response?.ok ? response.results : [],
                threshold: response?.threshold
            });
        })();
        return true;
    }

    if (request.action === "ai-enabled-get") {
        (async () => sendResponse({ enabled: await isAiEnabled() }))();
        return true;
    }

    if (request.action === "ai-enabled-set") {
        (async () => {
            await chrome.storage.local.set({ [AI_ENABLED_KEY]: !!request.enabled });
            if (request.enabled) scheduleWarm();
            sendResponse({ status: "ok" });
        })();
        return true;
    }

    return false;
});
