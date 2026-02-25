
(async function () {
    const send = (data) => window.postMessage({ type: "TAB_WIND_AI_RESPONSE", ...data }, "*");

    // Check Availability with polling
    let available = false;
    let attempts = 0;
    const maxAttempts = 20; // 10 seconds total

    const checkAvailability = () => {
        console.log(`Tab Wind Bridge: Checking window.ai (Attempt ${attempts + 1}/${maxAttempts})...`, window.ai);

        if (window.ai && window.ai.embedding) {
            console.log("Tab Wind Bridge: window.ai.embedding found!", window.ai.embedding);
            available = true;
            send({ status: "READY", available });
            return true;
        } else if (window.ai && !window.ai.embedding) {
            console.warn("Tab Wind Bridge: window.ai exists but embedding is missing.");
        }
        return false;
    };

    if (!checkAvailability()) {
        const interval = setInterval(() => {
            attempts++;
            if (checkAvailability()) {
                clearInterval(interval);
            } else if (attempts >= maxAttempts) {
                clearInterval(interval);
                console.warn("Tab Wind Bridge: window.ai not found after polling.");
                send({ status: "READY", available: false });
            }
        }, 500);
    }

    let model = null;

    window.addEventListener("message", async (event) => {
        if (event.source !== window) return;
        const data = event.data;

        if (data?.type === "TAB_WIND_AI_REQUEST") {
            if (data.action === "embed") {
                try {
                    if (!model) {
                        if (!window.ai || !window.ai.embedding) {
                            throw new Error("Embedding API lost");
                        }
                        model = await window.ai.embedding.create();
                    }
                    const result = await model.compute(data.text);
                    send({ requestId: data.requestId, result });
                } catch (e) {
                    // Fail silently or send null
                    send({ requestId: data.requestId, result: null });
                }
            }
        }
    });
})();
