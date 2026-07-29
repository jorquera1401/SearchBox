# Tab Wind Command

Chrome extension (MV3). A command palette for searching and switching browser
tabs, with optional semantic search running on a local embedding model.

Build with `npm run build`, then load `dist/` unpacked. `npx tsc --noEmit`
typechecks. There are no tests; verification is manual in Chrome.

## Architecture

```
content.ts (injected into every tab, holds no model)
   │ chrome.runtime.sendMessage
   ▼
background.ts (service worker: offscreen lifecycle, cache warming, routing)
   │ chrome.runtime.sendMessage → { target: 'offscreen' }
   ▼
offscreen.ts (single shared context: model + vector cache)
```

Search runs in two passes. A substring filter renders instantly, then the
semantic pass replaces the list with the model's ranking. Ranking is cosine
similarity between the query vector and cached tab vectors; since vectors are
normalised, cosine is a plain dot product.

## Constraints worth knowing before editing

**The model must stay in the offscreen document.** The content script is
injected into `<all_urls>`, so it instantiates once per open tab — hosting the
model there would load a copy per tab. The offscreen document is the only
single shared context available in MV3.

**`env.backends.onnx.wasm.wasmPaths` must point inside the extension.** Left
unset, the ONNX runtime dynamically imports its loader from the jsdelivr CDN,
which the extension CSP blocks. It surfaces as the unhelpful
`no available backend found`. `vite.config.ts` copies the binaries to `ort/`.

**Which ORT binary gets used is decided by the browser at runtime**, not at
build time: the JSPI build where `WebAssembly.Suspending` exists, the asyncify
build otherwise. That is why all three WASM-backend variants ship. If the
package needs slimming, check the Network tab for what is actually fetched
rather than reasoning about it.

**`numThreads = 1`.** Multi-threaded WASM needs `SharedArrayBuffer`, which
needs COOP/COEP headers that extension pages do not have.

**Embedding scores are not comparable across models.** e5 packs them into a
narrow, high band (relevant ~0.85, irrelevant ~0.75); the paraphrase model
spreads them much lower. The cutoff therefore lives in the model config in
`offscreen.ts` and travels with the rank response, rather than sitting as a
constant in `content.ts`. e5 also requires its `query: ` / `passage: `
prefixes — omitting them measurably degrades results.

**The vector cache is namespaced per model.** Mixing vectors from two
embedding spaces does not fail loudly, it just ranks badly. Switching
`ACTIVE_MODEL` starts clean and prunes other namespaces.

**Model weights (~129 MB) download from the HuggingFace CDN on first use** and
are cached by the Cache API. Nothing about the user's tabs is ever sent
anywhere. Only the ONNX runtime ships inside the package; the weights are
data, not remote code, which is what keeps the extension within the Web Store
remote-code policy. See `PUBLISHING.md`.

**`window.LanguageModel` is a fallback**, used only when the embedding model
fails to load. It ranks by prompting Chrome's on-device LLM via
`public/ai-bridge.js`, injected into the main world because content scripts
cannot see that API.

## Gotchas already paid for

- A content script's `localStorage` belongs to the **host page**. Extension
  state goes in `chrome.storage`, or the setting becomes per-site.
- `chrome.offscreen.createDocument` throws if called concurrently, and
  resolves before the document's module registers its message listener — hence
  the promise lock and the send retry in `background.ts`.
- `chrome.runtime.sendMessage` reaches every extension context, so the
  offscreen document also receives messages meant for the background. Both
  listeners filter on `target`.
