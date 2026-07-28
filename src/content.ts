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
  const aiLabel = shadow.getElementById('ai-label') as HTMLSpanElement;
  const aiToggle = shadow.getElementById('ai-toggle') as HTMLInputElement;
  const aiProgress = shadow.getElementById('ai-progress') as HTMLDivElement;
  const aiProgressBar = shadow.getElementById('ai-progress-bar') as HTMLDivElement;

  // The toggle lives in chrome.storage, not localStorage: a content script's
  // localStorage belongs to the host page, so the setting would be per-site
  // and would write into every site the user visits.
  let aiEnabled = true;
  aiToggle.checked = aiEnabled;

  chrome.runtime.sendMessage({ action: 'ai-enabled-get' })
    .then((response) => {
      aiEnabled = response?.enabled !== false;
      aiToggle.checked = aiEnabled;
      updateAiLabel();
    })
    .catch(() => { /* background asleep; the optimistic default stands */ });

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
  chrome.runtime.onMessage.addListener((request: any, _sender, sendResponse) => {
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

    // First real signal of intent. Loading the model on script load instead
    // would fire in every tab and start a large download unprompted.
    if (aiEnabled) void semanticService.init();

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

  // --- AI status UI ---

  let debounceTimer: any;

  function updateAiLabel(): void {
    if (!aiEnabled) {
      aiLabel.textContent = '✨ AI Off';
      aiLabel.style.color = '#555';
      return;
    }

    switch (semanticService?.currentState) {
      case 'downloading':
        aiLabel.textContent = `✨ Loading model ${semanticService.currentProgress}%`;
        aiLabel.style.color = '#3b82f6';
        break;
      case 'fallback':
        aiLabel.textContent = '✨ AI Ready (basic)';
        aiLabel.style.color = '#666';
        break;
      case 'ready':
        aiLabel.textContent = '✨ AI Ready';
        aiLabel.style.color = '#666';
        break;
      default:
        aiLabel.textContent = '✨ AI starting…';
        aiLabel.style.color = '#666';
    }
  }

  semanticService = new SemanticSearchService((state, progress) => {
    logger.log('Tab Wind: AI state changed:', state, progress);
    aiProgress.classList.toggle('visible', state === 'downloading');
    aiProgressBar.style.width = `${progress}%`;
    updateAiLabel();

    // The model usually becomes ready while the user is already staring at
    // keyword results. Refresh them instead of making them retype.
    if ((state === 'ready' || state === 'fallback') &&
        overlay.classList.contains('visible') &&
        input.value.trim().length > 2) {
      handleSearch();
    }
  });

  // Always visible: the toggle has to stay reachable even when AI is off or
  // unavailable. The label carries the state.
  aiIndicator.style.display = 'flex';
  updateAiLabel();

  aiToggle.addEventListener('change', () => {
    aiEnabled = aiToggle.checked;
    chrome.runtime.sendMessage({ action: 'ai-enabled-set', enabled: aiEnabled })
      .catch(() => { /* background asleep; it will re-read on next wake */ });

    if (aiEnabled) {
      void semanticService.init();
    } else {
      clearTimeout(debounceTimer);
      aiProgress.classList.remove('visible');
    }
    updateAiLabel();
  });

  function handleSearch() {
    const rawQuery = input.value.trim();
    const query = rawQuery.toLowerCase();

    // 1. Instant substring match. Rendered synchronously so there is always
    // something on screen; with AI on it is a placeholder that the model's
    // ranking replaces a moment later.
    const keywordResults = openTabs.filter(tab => {
      const title = (tab.title || '').toLowerCase();
      const url = (tab.url || '').toLowerCase();
      return title.includes(query) || url.includes(query);
    });

    renderList(keywordResults);

    // 2. Semantic pass, debounced.
    if (!aiEnabled || rawQuery.length <= 2 || !semanticService.isAvailable) return;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      // The query is now milliseconds of dot products, but the user can still
      // have typed on while it ran — drop stale responses.
      if (input.value.trim() !== rawQuery) return;

      try {
        // The cutoff comes from the model: each one scores on its own scale.
        const { ranked, threshold } = await semanticService.rankTabs(rawQuery, openTabs);
        if (input.value.trim() !== rawQuery) return;

        // Scores are logged so the threshold can be tuned against real tabs
        // instead of guessed: the useful cutoff is not obvious a priori.
        logger.log(
          `Tab Wind: scores for "${rawQuery}" (threshold ${threshold})`,
          ranked.slice(0, 10).map(r => {
            const tab = openTabs.find(t => t.id === r.id);
            return `${r.score.toFixed(3)}  ${(tab?.title || '?').slice(0, 60)}`;
          })
        );

        // With AI on, the model's ranking drives the whole list — ordering is
        // entirely its call, including for tabs that match literally.
        //
        // The one exception is inclusion: a tab whose title or URL literally
        // contains the query is never dropped for scoring below the
        // threshold. Typing a title verbatim and watching it vanish reads as
        // a broken search, not as a judgement call.
        const keywordIds = new Set(keywordResults.map(t => t.id));
        const rankedTabs: TabData[] = [];

        for (const { id, score } of ranked) {
          if (score < threshold && !keywordIds.has(id)) continue;
          const tab = openTabs.find(t => t.id === id);
          if (tab) rankedTabs.push(tab);
        }

        // Tabs the model could not score at all (no cached vector yet) are
        // absent from `ranked` entirely, so re-add any literal matches that
        // the loop above never saw.
        const rankedIds = new Set(rankedTabs.map(t => t.id));
        for (const tab of keywordResults) {
          if (!rankedIds.has(tab.id)) rankedTabs.push(tab);
        }

        if (rankedTabs.length > 0) {
          renderList(rankedTabs);
        }
      } catch (err) {
        console.error("Tab Wind: Semantic search error", err);
      }
    }, 150);
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

