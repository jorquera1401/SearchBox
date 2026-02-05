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

To unlock the Semantic Search powers, you need to enable Chrome's experimental built-in AI (Gemini Nano).

**⚠️ Requirements**: Chrome 127+ (Dev or Canary suggested).

### Step 1: Enable Flags
1.  Open `chrome://flags` in a new tab.
2.  Search for and enable these specific flags:
    *   **Enforce Optimization Guide On Device Model**: Set to `Enabled BypassPrefRequirement`. *(Crucial for bypassing hardware checks)*.
    *   **Prompt API for Gemini Nano**: Set to `Enabled`.
    *   **Optimization Guide On Device Model**: Set to `Enabled`.
3.  Click **Relaunch** to restart Chrome.

### Step 2: Verify Model Download
After restarting, Chrome needs to download the model (~40MB - 1GB depending on components).
1.  Go to `chrome://components`.
2.  Look for **Optimization Guide On Device Model**.
3.  Click **Check for update**.
4.  If version is `0.0.0.0`, it may take a few minutes to download.

### Step 3: Check Status
Open the Tab Wind search (`Ctrl + Shift + O`).
*   **"✨ AI Ready"**: The system is active. Searches will now understand meaning (e.g. "coding" finds GitHub).
*   **(Hidden)**: Use standard keyword search while the model loads.

## 💻 Tech Stack

- **Typescript**: For type-safe robust code.
- **Vite**: Ultra-fast build tool.
- **CRXJS**: Vite plugin for Chrome Extensions.
- **Chrome Built-in AI**: accessing `window.ai` and `window.ai.embedding`.

## 📄 License

Private / Internal Use.
