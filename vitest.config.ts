import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts on purpose: the crxjs plugin builds an extension
// and has no business loading for unit tests.
export default defineConfig({
    test: {
        include: ['src/**/*.test.ts'],
    },
});
