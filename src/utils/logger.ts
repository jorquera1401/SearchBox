/// <reference types="vite/client" />

export const logger = {
    log: (...args: any[]) => {
        // Enforce logging for now to help with debugging
        console.log(...args);
    },
    warn: (...args: any[]) => {
        if (import.meta.env.DEV) {
            console.warn(...args);
        }
    },
    error: (...args: any[]) => {
        // Always log errors, or toggle if preferred. Keeping errors for now as they are critical.
        console.error(...args);
    }
};
