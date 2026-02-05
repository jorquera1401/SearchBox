# Tab Wind Command ⚡️

**Tab Wind Command** is a lightning-fast command palette for managing your Chrome tabs. Inspired by tools like Spotlight or Alfred, it allows you to search, switch, and manage tabs instantly explicitly using your keyboard.

> 🚀 **Experimental**: Includes **Semantic Search** powered by Chrome's Built-in AI (Gemini Nano).

## ✨ Features

- **⚡️ Instant Search**: Fuzzy search through open tabs by title or URL.
- **🧠 Semantic Search (AI)**: Don't remember the exact title? Type "news", "coding docs", or "video" and the built-in AI will find relevant tabs based on meaning, not just keywords.
- **⌨️ Keyboard First**:
    - Open: `Cmd + Shift + O` (Mac) or `Ctrl + Shift + O` (Windows/Linux).
    - Navigate: `Arrow Up` / `Arrow Down`.
    - Switch: `Enter`.
    - Close: `Esc`.
- **🌙 Dark Mode**: Sleek, modern interface that fits your system theme.

## 🛠 Installation (Developer Mode)

This project is built with **Vite** and **TypeScript**.

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/jorquera1401/SearchBox.git
    cd SearchBox
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Build the extension**:
    ```bash
    npm run build
    ```
    This will generate a `dist/` folder.

4.  **Load into Chrome**:
    - Open `chrome://extensions`.
    - Enable **Developer mode** (top right).
    - Click **Load unpacked**.
    - Select the `dist/` folder.

## 🧠 Enabling AI Features

To use the Semantic Search features, you must enable Chrome's experimental AI flags (requires Chrome 127+ or Canary).

1.  Go to `chrome://flags`.
2.  Enable the following:
    - **Enforce Optimization Guide On Device Model**: `Enabled BypassPrefRequirement`
    - **Prompt API for Gemini Nano**: `Enabled`
    - **Optimization Guide On Device Model**: `Enabled`
3.  Relaunch Chrome.

*Once enabled, you will see a "✨ AI Ready" indicator in the search bar.*

## 💻 Tech Stack

- **Typescript**: For type-safe robust code.
- **Vite**: Ultra-fast build tool.
- **CRXJS**: Vite plugin for Chrome Extensions.
- **Chrome Built-in AI**: accessing `window.ai` and `window.ai.embedding`.

## 📄 License

Private / Internal Use.
