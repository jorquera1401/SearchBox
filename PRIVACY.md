# Privacy Policy for Tab Wind Command

**Effective Date:** 2024-02-06

## 1. Data Collection
Tab Wind Command ("the Extension") runs entirely locally on your device. We do not collect, store, or transmit your personal data, browsing history, or open tab information to any external servers.

## 2. Permissions Usage
- **Read Your Browsing History (`tabs`)**: Used solely to list and search your currently open tabs within the extension's interface. This data stays in your browser's memory.
- **Scripting**: Used to display the search modal (Command Palette) on top of the current page.
- **Host Permissions (`<all_urls>`)**: Required to inject the search interface into any web page you are currently viewing.

## 3. AI Features (Semantic Search)
If you enable Semantic Search:

- **Your tab titles and URLs never leave your device.** They are converted into numerical vectors by a model running locally inside the Extension, and those vectors are stored only in your browser's local storage.
- The first time you use the feature, the Extension downloads the model's weights (approximately 129 MB) from the HuggingFace CDN (`huggingface.co`). This download contains **no information about you, your tabs, or your browsing** — it is the same public model file for every user. The weights are cached locally, so the download happens only once.
- If the model cannot be loaded, the Extension falls back to Chrome's built-in on-device AI (`window.LanguageModel`), which also processes your tabs locally without sending them anywhere.
- You can turn Semantic Search off at any time using the toggle in the search palette. When it is off, no model runs and no download is started.

## 4. Third-Party Services
The Extension does not use any third-party analytics or tracking services. The only external connection it ever makes is the one-time model download described in Section 3.

## 5. Contact
If you have questions about this policy, please open an issue on our GitHub repository.
