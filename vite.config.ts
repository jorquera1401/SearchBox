import { defineConfig, type Plugin } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import manifest from './manifest.json';

const ORT_DIST = resolve(__dirname, 'node_modules/onnxruntime-web/dist');

// The runtime picks its binary from what the browser supports, so both async
// variants ship: JSPI where WebAssembly.Suspending exists, asyncify otherwise.
//
// Excluded: `jsep` (WebGPU backend only, and we run on WASM) and the plain
// non-async build, which transformers never requests because inference is
// always async. Confirm against the Network tab before trimming further —
// which file gets fetched is not knowable from the source.
const ORT_FILES = [
    'ort-wasm-simd-threaded.asyncify.wasm',
    'ort-wasm-simd-threaded.asyncify.mjs',
    'ort-wasm-simd-threaded.jspi.wasm',
    'ort-wasm-simd-threaded.jspi.mjs',
];

// Without these shipped locally the runtime falls back to a CDN, which the
// extension CSP blocks. Paired with `wasmPaths` in src/offscreen.ts.
function copyOrtRuntime(): Plugin {
    return {
        name: 'copy-ort-runtime',
        apply: 'build',

        // Vite emits its own hashed copy from the runtime's `new URL(...)`.
        // wasmPaths points at ort/, so that copy is 25 MB of dead weight.
        generateBundle(_options, bundle) {
            for (const fileName of Object.keys(bundle)) {
                if (/ort-wasm.*\.wasm$/.test(fileName)) delete bundle[fileName];
            }
        },

        writeBundle(options) {
            const target = join(options.dir ?? 'dist', 'ort');
            mkdirSync(target, { recursive: true });

            for (const file of ORT_FILES) {
                const from = join(ORT_DIST, file);
                if (!existsSync(from)) {
                    this.warn(`ORT runtime file missing: ${file}`);
                    continue;
                }
                copyFileSync(from, join(target, file));
            }
        },
    };
}

export default defineConfig({
    plugins: [crx({ manifest }), copyOrtRuntime()],
    resolve: {
        alias: {
            // We run on WASM, so drop the unused WebGPU JS. Safe because
            // transformers guards its usage behind `if (ONNX_ENV.webgpu)`.
            'onnxruntime-web/webgpu': 'onnxruntime-web/wasm',
        },
    },
    build: {
        rollupOptions: {
            input: {
                // crxjs only picks up entries named in the manifest; offscreen
                // documents are created programmatically.
                offscreen: 'offscreen.html',
            },
        },
    },
});
