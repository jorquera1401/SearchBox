import { SemanticSearchService } from './SemanticSearchService';
import './styles.css';

// Prevent double injection in the SAME context
if (window.hasTabWindRun) {
  console.log("Tab Wind: Already running in this context.");
} else {
  window.hasTabWindRun = true;
  initContentScript();
}

function initContentScript() {
  // Check for stale DOM from PREVIOUS context (extension reload case)
  const existingHost = document.getElementById('tab-wind-search-host');
  if (existingHost) {
    console.log("Tab Wind: Removing stale Search host from DOM.");
    existingHost.remove();
  }

  console.log("Tab Wind: Initializing content script...");

  // Initialize Semantic Service
  const semanticService = new SemanticSearchService();
  console.log("Tab Wind: AI Service initialized", semanticService);

  // --- Create Host & Shadow DOM ---
  const host = document.createElement('div');
  host.id = 'tab-wind-search-host';
  host.style.position = 'fixed';
  host.style.top = '0';
  host.style.left = '0';
  host.style.zIndex = '2147483647';
  host.style.pointerEvents = 'none';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  // --- Inject Styles ---
  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial; /* Reset all inherited properties */
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    
    #overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding-top: 100px;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.1s ease-in-out;
      box-sizing: border-box;
    }

    #overlay.visible {
      opacity: 1;
      pointer-events: auto;
    }

    #modal {
      background: #1e1e1e;
      width: 600px;
      max-width: 90%;
      border-radius: 12px;
      box-shadow: 0 20px 50px rgba(0,0,0,0.5);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid #333;
      color: #fff;
    }

    input {
      width: 100%;
      padding: 16px;
      font-size: 18px;
      background: transparent;
      border: none;
      border-bottom: 1px solid #333;
      color: #fff;
      outline: none;
      box-sizing: border-box;
    }

    ul {
      max-height: 400px;
      overflow-y: auto;
      padding: 8px 0;
      margin: 0;
      list-style: none;
    }

    li {
      padding: 10px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      color: #ccc;
      border-left: 2px solid transparent;
      box-sizing: border-box;
    }

    li.selected {
      background: #2d2d2d;
      color: #fff;
      border-left-color: #3b82f6;
    }

    li:hover {
      background: #252525;
    }

    .favicon {
      width: 16px;
      height: 16px;
      border-radius: 2px;
      flex-shrink: 0;
    }

    .info {
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-width: 0;
    }

    .title {
      font-size: 14px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .url {
      font-size: 12px;
      color: #888;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    ul::-webkit-scrollbar {
      width: 8px;
    }
    ul::-webkit-scrollbar-track {
      background: #1e1e1e;
    }
    ul::-webkit-scrollbar-thumb {
      background: #333;
      border-radius: 4px;
    }
  `;
  shadow.appendChild(style);

  // --- Inject HTML ---
  const overlay = document.createElement('div');
  overlay.id = 'overlay';
  overlay.innerHTML = `
    <div id="modal">
      <input type="text" id="params-input" placeholder="Search tabs..." autocomplete="off">
      <ul id="results"></ul>
    </div>
  `;
  shadow.appendChild(overlay);

  // --- Element References ---
  const input = shadow.getElementById('params-input') as HTMLInputElement;
  const resultsList = shadow.getElementById('results') as HTMLUListElement;

  interface TabData {
    id: number;
    windowId: number;
    title?: string;
    url?: string;
    favIconUrl?: string;
  }

  let openTabs: TabData[] = [];
  let selectedIndex = 0;

  // --- Event Listeners ---
  chrome.runtime.onMessage.addListener((request: any, sender, sendResponse) => {
    console.log("Tab Wind: Message received", request);
    if (request.action === "toggle-modal") {
      if (overlay.classList.contains('visible')) {
        closeModal();
      } else {
        openTabs = request.tabs || [];
        openModal();
      }
      sendResponse({ status: "ok" });
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeModal();
    }
  });

  input.addEventListener('input', () => {
    selectedIndex = 0;
    renderResults();
  });

  input.addEventListener('keydown', (e: KeyboardEvent) => {
    const items = resultsList.querySelectorAll('li');

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % items.length;
      updateSelection();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + items.length) % items.length;
      updateSelection();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items.length > 0) {
        const selectedItem = items[selectedIndex] as HTMLElement;
        if (selectedItem && selectedItem.dataset.tabId && selectedItem.dataset.windowId) {
          activateTab(parseInt(selectedItem.dataset.tabId), parseInt(selectedItem.dataset.windowId));
        }
      }
    } else if (e.key === 'Escape') {
      closeModal();
    }
  });

  // --- Functions ---
  function openModal() {
    console.log("Tab Wind: Opening modal...");
    overlay.classList.add('visible');
    host.style.pointerEvents = 'auto';
    input.value = '';
    selectedIndex = 0;
    renderResults();

    requestAnimationFrame(() => {
      input.focus();
    });
    setTimeout(() => {
      input.focus();
      console.log("Tab Wind: Input focused (timeout)");
    }, 100);
  }

  function closeModal() {
    overlay.classList.remove('visible');
    host.style.pointerEvents = 'none';
  }

  function renderResults() {
    const query = input.value.toLowerCase();

    // Filter and score tabs
    const filtered = openTabs.filter(tab => {
      const title = (tab.title || '').toLowerCase();
      const url = (tab.url || '').toLowerCase();
      return title.includes(query) || url.includes(query);
    });

    const top10 = filtered.slice(0, 10);

    resultsList.innerHTML = '';

    if (top10.length === 0) {
      const li = document.createElement('li');
      li.style.padding = '16px';
      li.style.color = '#888';
      li.style.textAlign = 'center';
      li.textContent = 'No matching tabs found';
      resultsList.appendChild(li);
      return;
    }

    top10.forEach((tab, index) => {
      const li = document.createElement('li');
      li.className = index === selectedIndex ? 'selected' : '';
      li.dataset.tabId = tab.id.toString();
      li.dataset.windowId = tab.windowId.toString();

      const faviconUrl = tab.favIconUrl || '';
      const faviconImg = faviconUrl
        ? `<img src="${faviconUrl}" class="favicon" onerror="this.style.display='none'">`
        : '<span class="favicon" style="display:inline-block;width:16px;height:16px;background:#555;border-radius:2px;"></span>';

      li.innerHTML = `
        ${faviconImg}
        <div class="info">
          <div class="title">${escapeHtml(tab.title)}</div>
          <div class="url">${escapeHtml(tab.url)}</div>
        </div>
      `;

      li.addEventListener('click', () => {
        activateTab(tab.id, tab.windowId);
      });

      li.addEventListener('mouseenter', () => {
        selectedIndex = index;
        updateSelection();
      });

      resultsList.appendChild(li);
    });
  }

  function updateSelection() {
    const items = resultsList.querySelectorAll('li');
    items.forEach((item, index) => {
      if (index === selectedIndex) {
        item.classList.add('selected');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('selected');
      }
    });
  }

  function activateTab(tabId: number, windowId: number) {
    chrome.runtime.sendMessage({
      action: "switch-tab",
      tabId: tabId,
      windowId: windowId
    });
    closeModal();
  }

  function escapeHtml(text: string | undefined): string {
    if (!text) return '';
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

} // End initContentScript

