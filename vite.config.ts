import { defineConfig, type Plugin } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import manifest from './manifest.json';

const ORT_DIST = resolve(__dirname, 'node_modules/onnxruntime-web/dist');

// The WASM backend picks its binary at runtime from what the browser supports:
// the JSPI build where WebAssembly.Suspending exists, the asyncify build
// otherwise, and the plain build for sync paths. Which one it asks for is not
// knowable at build time, so all three ship. The jsep build is excluded --
// that one is only for the WebGPU backend, and we run on WASM.
const ORT_FILES = [
    'ort-wasm-simd-threaded.wasm',
    'ort-wasm-simd-threaded.mjs',
    'ort-wasm-simd-threaded.asyncify.wasm',
    'ort-wasm-simd-threaded.asyncify.mjs',
    'ort-wasm-simd-threaded.jspi.wasm',
    'ort-wasm-simd-threaded.jspi.mjs',
];

// The ONNX runtime resolves its binaries at runtime and falls back to the
// jsdelivr CDN when it cannot find them locally -- which the extension CSP
// blocks. Shipping them under a predictable path (paired with `wasmPaths` in
// src/offscreen.ts) is what keeps inference working, and offline.
function copyOrtRuntime(): Plugin {
    return {
        name: 'copy-ort-runtime',
        apply: 'build',

        // Vite also emits a hashed copy of the .wasm from the runtime's
        // `new URL(...)` reference. Since wasmPaths points at ort/ instead,
        // that copy is dead weight -- drop it rather than ship 25 MB twice.
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
            // We run inference on WASM (device: 'wasm'), so pull in the
            // WASM-only ORT build rather than the WebGPU one. Same binaries,
            // but it drops the unused WebGPU JS from the bundle. transformers
            // guards its WebGPU usage behind `if (ONNX_ENV.webgpu)`.
            'onnxruntime-web/webgpu': 'onnxruntime-web/wasm',
        },
    },
    build: {
        rollupOptions: {
            input: {
                // crxjs only picks up entry points named in the manifest, and
                // offscreen documents are created programmatically.
                offscreen: 'offscreen.html',
            },
        },
    },
});
