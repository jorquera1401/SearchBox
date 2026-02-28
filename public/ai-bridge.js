
(async function () {
    const send = (data) => window.postMessage({ type: "TAB_WIND_AI_RESPONSE", ...data }, "*");

    let available = false;

    try {
        if (typeof window.LanguageModel !== 'undefined') {
            const avail = await window.LanguageModel.availability();
            available = avail === 'available';
            console.log("Tab Wind Bridge: LanguageModel availability:", avail);
        } else {
            console.warn("Tab Wind Bridge: window.LanguageModel not found.");
        }
    } catch (e) {
        console.warn("Tab Wind Bridge: Error checking LanguageModel availability", e);
    }

    send({ status: "READY", available });

    if (!available) return;

    let session = null;

    window.addEventListener("message", async (event) => {
        if (event.source !== window) return;
        const data = event.data;

        if (data?.type === "TAB_WIND_AI_REQUEST" && data.action === "rank") {
            try {
                if (!session) {
                    session = await window.LanguageModel.create({
                        initialPrompts: [{
                            role: "system",
                            content: "You are a browser tab relevance ranker. Given a search query and a list of browser tabs, return ONLY a JSON object with key 'ids' containing an array of tab IDs (integers) sorted by relevance to the query, most relevant first. Only include tabs that are genuinely relevant to the query."
                        }]
                    });
                }

                const tabs = (data.tabs || []).slice(0, 25);
                const tabsText = tabs
                    .map(t => `ID:${t.id} | "${(t.title || '').slice(0, 70)}" | ${(t.url || '').slice(0, 80)}`)
                    .join('\n');

                const result = await session.prompt(
                    `Query: "${data.query}"\n\nTabs:\n${tabsText}`,
                    {
                        responseConstraint: {
                            type: "object",
                            properties: {
                                ids: {
                                    type: "array",
                                    items: { type: "number" }
                                }
                            },
                            required: ["ids"]
                        }
                    }
                );

                const parsed = JSON.parse(result);
                send({ requestId: data.requestId, result: parsed.ids || [] });

            } catch (e) {
                console.error("Tab Wind Bridge: Rank error", e);

                // If session errored, reset it for next request
                if (session) {
                    try { session.destroy(); } catch (_) {}
                    session = null;
                }

                send({ requestId: data.requestId, result: null });
            }
        }
    });
})();
