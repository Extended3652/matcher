/* global log, includesCI, currentDict:writable, masterToggle, statsEl,
   clientBannerEl, popupSearch, btnOptions,
   detectedClientName:writable, _lastWrittenClientName:writable,
   renderClientBanner, renderAll, updateStats, SEARCH_DEBOUNCE_MS */
/* exported matchesGlobalSearchForIgnore, matchesGlobalSearchForCategory */
"use strict";

// ---------------------------------------------------------------------------
// Load state
// ---------------------------------------------------------------------------
function loadState() {
  chrome.storage.local.get(["dictionary", "enabled"], (result) => {
    const enabled = result.enabled !== false;
    masterToggle.checked = enabled;

    const dict = result.dictionary;
    const hasCats = !!(dict && Array.isArray(dict.categories) && dict.categories.length > 0);

    if (hasCats) {
      currentDict = dict;
      if (!currentDict.ignoreList) currentDict.ignoreList = [];
      if (!currentDict.clients) currentDict.clients = [];
      renderAll();
      updateStats();
      return;
    }

    // No categories in storage yet: seed from bundled default_dictionary.json
    const url = chrome.runtime.getURL("default_dictionary.json");
    fetch(url)
      .then((resp) => (resp.ok ? resp.json() : Promise.reject(new Error("Failed to load default_dictionary.json"))))
      .then((defaultDict) => {
        currentDict = defaultDict || { ignoreList: [], categories: [], clients: [] };
        if (!Array.isArray(currentDict.ignoreList)) currentDict.ignoreList = [];
        if (!Array.isArray(currentDict.categories)) currentDict.categories = [];
        if (!Array.isArray(currentDict.clients)) currentDict.clients = [];

        chrome.storage.local.set(
          {
            enabled: enabled,
            dictionary: currentDict,
          },
          () => {
            renderAll();
            updateStats();
          }
        );
      })
      .catch((e) => {
        log.debug(" failed to load default dictionary:", e.message);
        // Fallback: show empty structure so the UI still works
        currentDict = { ignoreList: [], categories: [], clients: [] };
        renderAll();
        updateStats();
      });
  });
}

// ---------------------------------------------------------------------------
// Master toggle
// ---------------------------------------------------------------------------
masterToggle.addEventListener("change", () => {
  const enabled = masterToggle.checked;
  chrome.storage.local.set({ enabled: enabled });

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs
        .sendMessage(tabs[0].id, {
          action: "toggle",
          enabled: enabled,
        })
        .catch((e) => {
          log.debug(" toggle message failed:", e.message);
        });
    }
  });

  updateStats();
});

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
btnOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
function updateStats() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) {
      statsEl.textContent = "No active tab";
      clientBannerEl.style.display = "none";
      return;
    }

    chrome.tabs.sendMessage(tabs[0].id, { action: "getStats" }, (response) => {
      if (chrome.runtime.lastError || !response) {
        statsEl.textContent = "Not running on this page";
        clientBannerEl.style.display = "none";
        return;
      }

      statsEl.textContent =
        `${response.highlights} highlights | ${response.cats || 0} categories | ` +
        `${response.enabled ? "ON" : "OFF"}`;

      // Query the client name separately so the banner can show the right state
      chrome.tabs.sendMessage(tabs[0].id, { action: "getClientName" }, (nameResp) => {
        detectedClientName = !chrome.runtime.lastError && nameResp && nameResp.clientName ? nameResp.clientName : "";
        // Store for options-page auto-fill (options tab becomes active, so
        // options.js cannot query the CMS tab directly).
        if (detectedClientName && detectedClientName !== _lastWrittenClientName) {
          _lastWrittenClientName = detectedClientName;
          chrome.storage.local.set({ _lastCmsClientName: detectedClientName });
        }
        renderClientBanner();
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Search filters (top)
// ---------------------------------------------------------------------------
let searchDebounce = null;
popupSearch.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(renderAll, SEARCH_DEBOUNCE_MS);
});

function matchesGlobalSearchForIgnore(q) {
  if (!q) return true;
  if (includesCI("Ignore List", q)) return true;
  const list = currentDict.ignoreList || [];
  for (const raw of list) {
    if (includesCI(raw, q)) return true;
  }
  return false;
}

function matchesGlobalSearchForCategory(cat, q) {
  if (!q) return true;
  if (includesCI(cat.name, q)) return true;
  const words = cat.words || [];
  for (const w of words) {
    if (includesCI(w, q)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
loadState();
