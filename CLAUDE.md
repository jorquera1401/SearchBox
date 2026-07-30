# Tab Wind Command

Chrome extension (MV3). A command palette for searching and switching browser
tabs, with optional semantic search running on a local embedding model.

```
npm run build       # bundle into dist/, then load it unpacked
npm test            # vitest, unit tests on the pure logic
npm run typecheck   # tsc --noEmit
npm run assets      # regenerate icons and store art from SVG
```

There is no end-to-end coverage: anything touching chrome APIs, the DOM or the
model is verified by hand in Chrome.

## Layout

```
src/
  shared/     messages.ts   every cross-context message + typed send helpers
              logger.ts
  background/ index.ts      wiring only: listeners and the message router
              offscreenHost.ts  offscreen document lifecycle + retrying send
              warming.ts    pre-embeds tabs on tab events
              palette.ts    opening the palette, switching tabs, injection
              settings.ts   chrome.storage-backed settings
  offscreen/  index.ts      message handling
              embedder.ts   model load, state, embedding
              models.ts     model configs (id, prefixes, threshold)
              vectorCache.ts  LRU + int8 persistence + cosine
  content/    index.ts      bootstrap
              palette.ts    shadow DOM, keyboard, rendering
              search.ts     pure: keyword filter, rank merge (tested)
              semanticClient.ts  client + LanguageModel fallback
              aiStatus.ts   indicator, toggle, progress bar
```

Message flow: `content -> background -> offscreen`, and back. Every message
shape lives in `shared/messages.ts`; nothing should introduce a bare string
action, because that is precisely the bug class the file exists to prevent.

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
build otherwise. Both ship, which is most of the package size. Before trimming,
check the Network tab for what is actually fetched rather than reasoning about
it — two attempts were lost to guessing here.

**`numThreads = 1`.** Multi-threaded WASM needs `SharedArrayBuffer`, which
needs COOP/COEP headers that extension pages do not have.

**Embedding scores are not comparable across models.** e5 packs them into a
narrow, high band (relevant ~0.85, irrelevant ~0.75); the paraphrase model
spreads them much lower. The cutoff lives in `offscreen/models.ts` and travels
with the rank response. e5 also requires its `query: ` / `passage: ` prefixes —
omitting them measurably degrades results.

**The vector cache is namespaced per model and per text format.** Mixing
vectors from two embedding spaces does not fail loudly, it just ranks badly.
Bump `TEXT_VERSION` in `vectorCache.ts` whenever `embeddingText` changes: the
key is title+url, so stored vectors would otherwise stay "valid" while having
been computed from different text.

**Model weights (~129 MB) download from the HuggingFace CDN on first use** and
are cached by the Cache API. Nothing about the user's tabs is ever sent
anywhere. Only the ONNX runtime ships inside the package; the weights are
data, not remote code, which is what keeps the extension within the Web Store
remote-code policy. See `PUBLISHING.md`.

**`window.LanguageModel` is a fallback**, used only when the embedding model
fails to load. It ranks by prompting Chrome's on-device LLM via
`public/ai-bridge.js`, injected into the main world because content scripts
cannot see that API.

**`public/` is copied verbatim into the extension package.** Store marketing art
therefore lives in `store-assets/`, outside it. Shipping promo tiles to every
user was a real bug once.

## Gotchas already paid for

- A content script's `localStorage` belongs to the **host page**. Extension
  state goes in `chrome.storage`, or the setting becomes per-site.
- `chrome.offscreen.createDocument` throws if called concurrently, and
  resolves before the document's module registers its message listener — hence
  the promise lock and the send retry in `background/offscreenHost.ts`.
- `chrome.runtime.sendMessage` reaches every extension context, so the
  offscreen document also receives messages meant for the background. Both
  listeners filter on `target`.
- Anything that reads model state right after triggering a load must account for
  the state flipping synchronously; deferring it to a microtask once left the
  UI stuck on 'idle' forever with no visible error.
