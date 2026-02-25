import { SemanticSearchService } from './SemanticSearchService';
import { logger } from './utils/logger';
import './styles.css';
import contentStyles from './content.css?inline';
import contentHtml from './content.html?raw';

// Prevent double injection in the SAME context
if (window.hasTabWindRun) {

} else {
  try {
    console.log("Tab Wind: Content script starting...");
    window.hasTabWindRun = true;

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initContentScript);
    } else {
      initContentScript();
    }
  } catch (e) {
    console.error("Tab Wind: Critical error starting content script", e);
  }
}

function initContentScript() {
  // Check for stale DOM from PREVIOUS context (extension reload case)
  const existingHost = document.getElementById('tab-wind-search-host');
  if (existingHost) {
    logger.log("Tab Wind: Removing stale Search host from DOM.");
    existingHost.remove();
  }

  logger.log("Tab Wind: Initializing content script...");

  // Semantic Service initialized later to bind with UI
  let semanticService: SemanticSearchService;

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
  style.textContent = contentStyles;
  shadow.appendChild(style);

  // --- Inject HTML ---
  const template = document.createElement('template');
  template.innerHTML = contentHtml;
  shadow.appendChild(template.content.cloneNode(true));

  const overlay = shadow.getElementById('overlay') as HTMLDivElement;
  const aiIndicator = shadow.getElementById('ai-indicator') as HTMLDivElement;

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
    console.log("Tab Wind: Message received in content script:", request);
    if (request.action === "toggle-modal") {
      if (overlay.classList.contains('visible')) {
        closeModal();
      } else {
        openTabs = request.tabs || [];
        openModal();
      }
      sendResponse({ status: "ok" });
    }
    return true; // Keep channel open for async if needed
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
    logger.log("Tab Wind: Opening modal...");
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
      // console.log("Tab Wind: Input focused (timeout)");
    }, 100);
  }

  function closeModal() {
    overlay.classList.remove('visible');
    host.style.pointerEvents = 'none';
  }

  // --- UI Updates for AI ---
  // The aiIndicator is now part of the HTML template and referenced above.

  // Initialize Semantic Service with UI Callback
  semanticService = new SemanticSearchService((available) => {
    logger.log("Tab Wind: AI Availability Changed:", available);
    if (available) {
      aiIndicator.style.display = 'block';
    } else {
      aiIndicator.style.display = 'none';
    }
  });
  logger.log("Tab Wind: AI Service initialized", semanticService);

  if (semanticService.isAvailable) {
    aiIndicator.style.display = 'block';
  }

  let debounceTimer: any;

  function handleSearch() {
    const query = input.value.toLowerCase();

    // 1. Immediate Keyword Search
    const keywordResults = openTabs.filter(tab => {
      const title = (tab.title || '').toLowerCase();
      const url = (tab.url || '').toLowerCase();
      return title.includes(query) || url.includes(query);
    });

    renderList(keywordResults);

    // 2. Trigger Semantic Search (Debounced)
    if (semanticService.isAvailable && query.length > 2) {
      clearTimeout(debounceTimer);
      aiIndicator.style.color = '#3b82f6'; // Blue when "thinking"
      aiIndicator.textContent = '✨ AI Thinking...';

      debounceTimer = setTimeout(async () => {
        try {
          const rankedIds = await semanticService.rankTabs(query, openTabs);
          if (rankedIds.length > 0) {
            // Re-order openTabs based on rank, or merge?
            // Let's create a new sorted list: Ranked items first, then the rest.
            const rankedTabs = rankedIds.map(id => openTabs.find(t => t.id === id)).filter(Boolean) as TabData[];

            // Deduping isn't strictly needed if we just show ranked, 
            // but if we want mixed, we need to be careful.
            // For now: Just show the Semantic Results if decent score?
            // Simpler: Just render the ranked list (it contains the top matches).
            // If rankTabs returns ALL tabs sorted, we just use that.
            // If it returns subset, we might want to fallback.
            // Assumption: rankTabs returns sorted IDs of RELEVANT tabs.

            renderList(rankedTabs);
          }
        } catch (err) {
          console.error("Tab Wind: Semantic search error", err);
        } finally {
          aiIndicator.style.color = '#10b981'; // Green when done
          aiIndicator.textContent = '✨ AI Results';
          setTimeout(() => {
            aiIndicator.textContent = '✨ AI Ready';
            aiIndicator.style.color = '#666';
          }, 2000);
        }
      }, 300); // 300ms debounce
    }
  }

  function renderResults() {
    handleSearch();
  }

  function renderList(tabs: TabData[]) {
    // Dedup and limit
    // const unique = Array.from(new Set(tabs)); // Tabs are objects, ref check ok?
    const top10 = tabs.slice(0, 10);

    resultsList.innerHTML = '';

    // ... rest of render logic ...
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

