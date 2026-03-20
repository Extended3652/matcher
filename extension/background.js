// =============================================================================
// CMS Highlighter — Background Service Worker
// =============================================================================
// Handles:
//   1. Context menu (right-click to add selected text to a category)
//   2. Initializing default storage on first install
//   3. Rebuilding context menu safely (no duplicate-id errors)
// =============================================================================

"use strict";

importScripts("utils.js");

const MENU_PARENT_ID = "cms-hl-parent";
const MENU_SEP1_ID   = "cms-hl-sep1";
const MENU_EXACT_ID  = "cms-hl-exact";
const MENU_CS_ID     = "cms-hl-cs";
const MENU_SEP2_ID   = "cms-hl-sep2";
const MENU_IGNORE_ID = "cms-hl-ignore";

let menuBuildInProgress = false;
let menuBuildQueued = false;
let menuRebuildTimer = null; // debounce handle for onChanged rebuilds

// In-memory dictionary cache — avoids redundant chrome.storage.local.get
// on every context menu click.  Populated on install and kept in sync via
// the storage.onChanged listener.
let _cachedDict = null;
let _cachedContextExact = false;
let _cachedContextCS = false;

// ---------------------------------------------------------------------------
// Small helpers to make contextMenus idempotent and avoid duplicate-id errors
// ---------------------------------------------------------------------------

function isDuplicateIdError(err) {
  if (!err || !err.message) return false;
  return err.message.toLowerCase().includes("duplicate id");
}

function safeRemoveAll(cb) {
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) {
      console.warn("CMS Highlighter: contextMenus.removeAll error:", chrome.runtime.lastError.message);
      // Still continue; we will handle duplicates per-item below.
    }
    cb();
  });
}

function safeCreate(item) {
  // Attempt create; if duplicate, remove existing id and re-create.
  chrome.contextMenus.create(item, () => {
    const err = chrome.runtime.lastError;
    if (!err) return;

    if (isDuplicateIdError(err)) {
      // Remove the existing item with same ID then retry create.
      chrome.contextMenus.remove(item.id, () => {
        // Ignore remove errors, then retry create.
        chrome.contextMenus.create(item, () => {
          if (chrome.runtime.lastError) {
            console.error(
              "CMS Highlighter: contextMenus.create failed after retry:",
              item.id,
              chrome.runtime.lastError.message
            );
          }
        });
      });
      return;
    }

    console.error("CMS Highlighter: contextMenus.create error:", item.id, err.message);
  });
}

function buildContextMenu() {
  // Serialize rebuilds so they cannot overlap.
  if (menuBuildInProgress) {
    menuBuildQueued = true;
    return;
  }
  menuBuildInProgress = true;

  safeRemoveAll(() => {
    chrome.storage.local.get(["dictionary", "contextExact", "contextCaseSensitive"], (result) => {
      if (chrome.runtime.lastError) {
        console.error("CMS Highlighter: storage get error:", chrome.runtime.lastError.message);
        menuBuildInProgress = false;
        if (menuBuildQueued) { menuBuildQueued = false; buildContextMenu(); }
        return;
      }

      const dict = result.dictionary;
      // Keep cache in sync whenever we read from storage
      _cachedDict = dict || null;
      _cachedContextExact = !!result.contextExact;
      _cachedContextCS = !!result.contextCaseSensitive;

      if (!dict || !Array.isArray(dict.categories)) {
        // No dictionary yet, nothing to build.
        menuBuildInProgress = false;
        if (menuBuildQueued) { menuBuildQueued = false; buildContextMenu(); }
        return;
      }

      const isExact = _cachedContextExact;
      const isCS    = _cachedContextCS;

      // Parent menu
      safeCreate({
        id: MENU_PARENT_ID,
        title: "Add to Highlighter",
        contexts: ["selection"],
      });

      // One item per category
      dict.categories.forEach((cat, i) => {
        safeCreate({
          id: `cms-hl-cat-${i}`,
          parentId: MENU_PARENT_ID,
          title: cat.name,
          contexts: ["selection"],
        });
      });

      // Separator
      safeCreate({
        id: MENU_SEP1_ID,
        parentId: MENU_PARENT_ID,
        type: "separator",
        contexts: ["selection"],
      });

      // Exact toggle
      safeCreate({
        id: MENU_EXACT_ID,
        parentId: MENU_PARENT_ID,
        title: isExact ? "\u2611 Add as exact" : "\u2610 Add as exact",
        contexts: ["selection"],
      });

      // Case-sensitive toggle
      safeCreate({
        id: MENU_CS_ID,
        parentId: MENU_PARENT_ID,
        title: isCS ? "\u2611 Case-sensitive" : "\u2610 Case-sensitive",
        contexts: ["selection"],
      });

      // Separator
      safeCreate({
        id: MENU_SEP2_ID,
        parentId: MENU_PARENT_ID,
        type: "separator",
        contexts: ["selection"],
      });

      // Ignore list — use the callback of the LAST create to clear the
      // in-progress flag, so a queued rebuild cannot fire removeAll while
      // earlier safeCreate calls are still being processed.
      chrome.contextMenus.create({
        id: MENU_IGNORE_ID,
        parentId: MENU_PARENT_ID,
        title: "Add to Ignore List",
        contexts: ["selection"],
      }, () => {
        if (chrome.runtime.lastError) {
          console.debug("CMS Highlighter: last menu item create error:", chrome.runtime.lastError.message);
        }
        menuBuildInProgress = false;

        // If another rebuild request came in while we were building, run again once.
        if (menuBuildQueued) {
          menuBuildQueued = false;
          buildContextMenu();
        }
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Handle context menu clicks
// ---------------------------------------------------------------------------
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const menuId = info.menuItemId;
  const selectedText = info.selectionText;

  if (!selectedText || selectedText.trim().length === 0) return;

  // Toggle exact mode
  if (menuId === MENU_EXACT_ID) {
    const newVal = !_cachedContextExact;
    _cachedContextExact = newVal;
    chrome.storage.local.set({ contextExact: newVal });
    // storage.onChanged listener will debounce-rebuild the menu
    return;
  }

  // Toggle case-sensitive mode
  if (menuId === MENU_CS_ID) {
    const newVal = !_cachedContextCS;
    _cachedContextCS = newVal;
    chrome.storage.local.set({ contextCaseSensitive: newVal });
    // storage.onChanged listener will debounce-rebuild the menu
    return;
  }

  // Add to ignore list
  if (menuId === MENU_IGNORE_ID) {
    addWordToIgnoreList(selectedText.trim(), tab);
    return;
  }

  // Add to a category
  const catMatch = String(menuId).match(/^cms-hl-cat-(\d+)$/);
  if (catMatch) {
    const catIndex = parseInt(catMatch[1], 10);
    addWordToCategory(selectedText.trim(), catIndex, tab);
    return;
  }
});

// ---------------------------------------------------------------------------
// Add a word to a category
// ---------------------------------------------------------------------------
function addWordToCategory(text, catIndex, tab) {
  _addWordToCategoryImpl(text, catIndex, tab, _cachedDict);
}

function _addWordToCategoryImpl(text, catIndex, tab, dict) {
  if (!dict || !Array.isArray(dict.categories) || !dict.categories[catIndex]) {
    // Cache miss — fall back to storage read once
    if (dict === _cachedDict) {
      chrome.storage.local.get(["dictionary"], (r) => {
        _cachedDict = r.dictionary || null;
        _addWordToCategoryImpl(text, catIndex, tab, _cachedDict);
      });
    }
    return;
  }

  let word = text;
  const isExact = _cachedContextExact;
  const isCS = _cachedContextCS;

  // Apply prefixes
  if (isExact) word = "//" + word;
  if (isCS) word = "CS:" + word;

  // Check for duplicate. For case-insensitive adds, compare lowercased so
  // "Amazon" and "amazon" are not stored as separate redundant entries.
  const dupCheck = isCS ? word : word.toLowerCase();
  const existing = dict.categories[catIndex].words;
  const isDup = isCS
    ? existing.includes(word)
    : existing.some(w => w.toLowerCase() === dupCheck);
  if (isDup) {
    notifyTab(tab, `"${text}" already in ${dict.categories[catIndex].name}`);
    return;
  }

  // Insert alphabetically instead of appending
  insertAlphabetically(dict.categories[catIndex].words, word);

  chrome.storage.local.set({ dictionary: dict }, () => {
    if (chrome.runtime.lastError) {
      console.error("CMS Highlighter: failed to save word:", chrome.runtime.lastError.message);
      notifyTab(tab, `Failed to save "${text}" — storage error`);
      return;
    }
    notifyTab(
      tab,
      `Added "${text}" to ${dict.categories[catIndex].name}${isExact ? " (exact)" : ""}${isCS ? " (CS)" : ""}`
    );
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { action: "refresh" }, () => {
        void chrome.runtime.lastError; // swallow "no receiver" errors
      });
    }
    buildContextMenu();
  });
}

// ---------------------------------------------------------------------------
// Add a word to the ignore list
// ---------------------------------------------------------------------------
function addWordToIgnoreList(text, tab) {
  _addWordToIgnoreImpl(text, tab, _cachedDict);
}

function _addWordToIgnoreImpl(text, tab, dict) {
  if (!dict) {
    // Cache miss — fall back to storage read once
    if (dict === _cachedDict) {
      chrome.storage.local.get(["dictionary"], (r) => {
        _cachedDict = r.dictionary || null;
        _addWordToIgnoreImpl(text, tab, _cachedDict);
      });
    }
    return;
  }

  if (!dict.ignoreList) dict.ignoreList = [];

  if (dict.ignoreList.includes(text)) {
    notifyTab(tab, `"${text}" already in Ignore List`);
    return;
  }

  // Insert alphabetically instead of appending
  insertAlphabetically(dict.ignoreList, text);

  chrome.storage.local.set({ dictionary: dict }, () => {
    if (chrome.runtime.lastError) {
      console.error("CMS Highlighter: failed to save ignore word:", chrome.runtime.lastError.message);
      notifyTab(tab, `Failed to save "${text}" — storage error`);
      return;
    }
    notifyTab(tab, `Added "${text}" to Ignore List`);
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { action: "refresh" }, () => {
        void chrome.runtime.lastError; // swallow "no receiver" errors
      });
    }
    buildContextMenu();
  });
}

// ---------------------------------------------------------------------------
// Send a brief notification to the content script (shows in console)
// ---------------------------------------------------------------------------
function notifyTab(tab, message) {
  if (tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, { action: "notify", message: message }, () => {
      void chrome.runtime.lastError; // swallow "no receiver" errors
    });
  }
}

// ---------------------------------------------------------------------------
// On install — set up defaults
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  // On first install or update, ensure we have a real dictionary.
  // If storage is empty (no categories), seed from bundled default_dictionary.json.
  chrome.storage.local.get(["dictionary", "enabled", "contextExact", "contextCaseSensitive"], (result) => {
    const existing = result.dictionary;
    // Populate cache on startup
    _cachedDict = existing || null;
    _cachedContextExact = !!result.contextExact;
    _cachedContextCS = !!result.contextCaseSensitive;

    const hasCats = !!(existing && Array.isArray(existing.categories) && existing.categories.length > 0);

    if (hasCats) {
      buildContextMenu();
      return;
    }

    // Seed from packaged default if available
    const url = chrome.runtime.getURL("default_dictionary.json");
    fetch(url)
      .then(resp => resp.ok ? resp.json() : Promise.reject(new Error("Failed to load default_dictionary.json")))
      .then((dict) => {
        const payload = {
          enabled: result.enabled !== false,
          dictionary: dict,
          contextExact: !!result.contextExact,
          contextCaseSensitive: !!result.contextCaseSensitive,
        };
        chrome.storage.local.set(payload, () => {
          buildContextMenu();
        });
      })
      .catch(() => {
        // Fallback: if fetch fails, at least ensure we have an empty structure
        if (!existing) {
          chrome.storage.local.set({
            enabled: true,
            dictionary: { ignoreList: [], categories: [] },
            contextExact: false,
            contextCaseSensitive: false,
          }, () => {
            buildContextMenu();
          });
        } else {
          buildContextMenu();
        }
      });
  });
});

// ---------------------------------------------------------------------------
// Rebuild context menu when dictionary or menu toggles change
// Debounced: rapid saves (e.g. options page auto-save) collapse into one rebuild.
// ---------------------------------------------------------------------------
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  // Keep in-memory cache in sync immediately (before debounced rebuild)
  if (changes.dictionary && changes.dictionary.newValue) {
    _cachedDict = changes.dictionary.newValue;
  }
  if (changes.contextExact) {
    _cachedContextExact = !!changes.contextExact.newValue;
  }
  if (changes.contextCaseSensitive) {
    _cachedContextCS = !!changes.contextCaseSensitive.newValue;
  }

  if (!changes.dictionary && !changes.contextExact && !changes.contextCaseSensitive) return;
  if (menuRebuildTimer) clearTimeout(menuRebuildTimer);
  menuRebuildTimer = setTimeout(() => {
    menuRebuildTimer = null;
    buildContextMenu();
  }, 200);
});
