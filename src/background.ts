// src/background.ts

// Helper to check for restricted URLs
function isRestrictedUrl(url: string | undefined): boolean {
    if (!url) return true;
    return url.startsWith("chrome://") || url.startsWith("edge://") || url.startsWith("about:");
}

chrome.runtime.onInstalled.addListener(() => {
    console.log("Extension installed/updated. Injecting content scripts...");
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
                }).catch(err => console.log("Failed to inject content script into tab", tab.id, err));
            }
        });
    });
});

chrome.commands.onCommand.addListener((command) => {
    console.log("Command received:", command);
    if (command === "toggle-search") {
        openModalInActiveTab();
    }
});

chrome.action.onClicked.addListener((tab) => {
    console.log("Action clicked", tab);
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
            console.log("Message sent successfully to tab", tabId);
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
                        console.log("Content script injected. Retrying message...");
                        setTimeout(() => {
                            sendMessage().catch(err => console.error("Final message attempt failed:", err));
                        }, 100);
                    }).catch(err => console.error("Script injection failed:", err));
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
    if (request.action === "switch-tab") {
        const message = request as SwitchTabMessage;
        const tabId = message.tabId;
        const windowId = message.windowId;

        chrome.windows.update(windowId, { focused: true }, () => {
            chrome.tabs.update(tabId, { active: true });
        });
    }
});
