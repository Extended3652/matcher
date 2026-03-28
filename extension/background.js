// =============================================================================
// CMS Highlighter — Background Service Worker
// =============================================================================
// Handles:
//   1. Context menu (right-click to add selected text to a category)
//   2. Initializing default storage on first install
//   3. Rebuilding context menu safely (no duplicate-id errors)
// =============================================================================

/* global importScripts, log, insertAlphabetically */
"use strict";

importScripts("utils.js");

const MENU_PARENT_ID = "cms-hl-parent";
const MENU_SEP1_ID = "cms-hl-sep1";
const MENU_REBUILD_DEBOUNCE_MS = 200;
const MENU_EXACT_ID = "cms-hl-exact";
const MENU_CS_ID = "cms-hl-cs";
const MENU_SEP2_ID = "cms-hl-sep2";
const MENU_IGNORE_ID = "cms-hl-ignore";

let menuBuildInProgress = false;
let menuBuildQueued = false;
let menuRebuildTimer = null; // debounce handle for onChanged rebuilds

// ---------------------------------------------------------------------------
// Small helpers to make contextMenus idempotent and avoid duplicate-id errors
// ---------------------------------------------------------------------------

function isDuplicateIdError(err) {
  if (!err || !err.message) return false;
  return err.message.toLowerCase().includes("duplicate id");
}

// Promisified contextMenus.create (this API does NOT return a Promise in MV3)
function createMenuItem(item) {
  return new Promise((resolve) => {
    chrome.contextMenus.create(item, () => {
      resolve(chrome.runtime.lastError || null);
    });
  });
}

// Promisified contextMenus.remove
function removeMenuItem(id) {
  return new Promise((resolve) => {
    chrome.contextMenus.remove(id, () => {
      resolve(chrome.runtime.lastError || null);
    });
  });
}

async function safeCreate(item) {
  const err = await createMenuItem(item);
  if (!err) return;

  if (isDuplicateIdError(err)) {
    await removeMenuItem(item.id);
    const retryErr = await createMenuItem(item);
    if (retryErr) {
      log.error("contextMenus.create failed after retry:", item.id, retryErr.message);
    }
    return;
  }

  log.error("contextMenus.create error:", item.id, err.message);
}

async function buildContextMenu() {
  // Serialize rebuilds so they cannot overlap.
  if (menuBuildInProgress) {
    menuBuildQueued = true;
    return;
  }
  menuBuildInProgress = true;

  try {
    await chrome.contextMenus.removeAll();
  } catch (e) {
    log.warn("contextMenus.removeAll error:", e.message);
    // Still continue; we will handle duplicates per-item below.
  }

  let result;
  try {
    result = await chrome.storage.local.get(["dictionary", "contextExact", "contextCaseSensitive"]);
  } catch (e) {
    log.error("storage get error:", e.message);
    menuBuildInProgress = false;
    if (menuBuildQueued) {
      menuBuildQueued = false;
      buildContextMenu();
    }
    return;
  }

  const dict = result.dictionary;
  if (!dict || !Array.isArray(dict.categories)) {
    // No dictionary yet, nothing to build.
    menuBuildInProgress = false;
    if (menuBuildQueued) {
      menuBuildQueued = false;
      buildContextMenu();
    }
    return;
  }

  const isExact = !!result.contextExact;
  const isCS = !!result.contextCaseSensitive;

  // Parent menu
  await safeCreate({
    id: MENU_PARENT_ID,
    title: "Add to Highlighter",
    contexts: ["selection"],
  });

  // One item per category
  for (let i = 0; i < dict.categories.length; i++) {
    await safeCreate({
      id: `cms-hl-cat-${i}`,
      parentId: MENU_PARENT_ID,
      title: dict.categories[i].name,
      contexts: ["selection"],
    });
  }

  // Separator
  await safeCreate({
    id: MENU_SEP1_ID,
    parentId: MENU_PARENT_ID,
    type: "separator",
    contexts: ["selection"],
  });

  // Exact toggle
  await safeCreate({
    id: MENU_EXACT_ID,
    parentId: MENU_PARENT_ID,
    title: isExact ? "\u2611 Add as exact" : "\u2610 Add as exact",
    contexts: ["selection"],
  });

  // Case-sensitive toggle
  await safeCreate({
    id: MENU_CS_ID,
    parentId: MENU_PARENT_ID,
    title: isCS ? "\u2611 Case-sensitive" : "\u2610 Case-sensitive",
    contexts: ["selection"],
  });

  // Separator
  await safeCreate({
    id: MENU_SEP2_ID,
    parentId: MENU_PARENT_ID,
    type: "separator",
    contexts: ["selection"],
  });

  // Ignore list — last item
  const lastErr = await createMenuItem({
    id: MENU_IGNORE_ID,
    parentId: MENU_PARENT_ID,
    title: "Add to Ignore List",
    contexts: ["selection"],
  });
  if (lastErr) {
    log.debug("last menu item create error:", lastErr.message);
  }

  menuBuildInProgress = false;

  // If another rebuild request came in while we were building, run again once.
  if (menuBuildQueued) {
    menuBuildQueued = false;
    buildContextMenu();
  }
}

// ---------------------------------------------------------------------------
// Handle context menu clicks
// ---------------------------------------------------------------------------
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const menuId = info.menuItemId;
  const selectedText = info.selectionText;

  if (!selectedText || selectedText.trim().length === 0) return;

  // Toggle exact mode
  if (menuId === MENU_EXACT_ID) {
    const result = await chrome.storage.local.get(["contextExact"]);
    const newVal = !(result.contextExact || false);
    await chrome.storage.local.set({ contextExact: newVal });
    // storage.onChanged listener will debounce-rebuild the menu
    return;
  }

  // Toggle case-sensitive mode
  if (menuId === MENU_CS_ID) {
    const result = await chrome.storage.local.get(["contextCaseSensitive"]);
    const newVal = !(result.contextCaseSensitive || false);
    await chrome.storage.local.set({ contextCaseSensitive: newVal });
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
// Serialized storage-write queue.  Each context-menu "add word" operation
// reads the dictionary, mutates it, and writes it back.  Without
// serialization two rapid adds can race (both read the same snapshot, the
// second write silently drops the first).  We chain operations through a
// promise queue so each read always sees the previous write.
// ---------------------------------------------------------------------------
let _storageWriteChain = Promise.resolve();

function enqueueStorageWrite(fn) {
  _storageWriteChain = _storageWriteChain.then(fn, fn);
}

// ---------------------------------------------------------------------------
// Add a word to a category
// ---------------------------------------------------------------------------
function addWordToCategory(text, catIndex, tab) {
  enqueueStorageWrite(async () => {
    const result = await chrome.storage.local.get(["dictionary", "contextExact", "contextCaseSensitive"]);
    const dict = result.dictionary;
    if (!dict || !Array.isArray(dict.categories) || !dict.categories[catIndex]) return;

    let word = text;
    const isExact = result.contextExact || false;
    const isCS = result.contextCaseSensitive || false;

    // Escape glob characters so selected text is treated literally
    word = word.replace(/([*?])/g, "\\$1");

    // Apply prefixes
    if (isExact) word = "//" + word;
    if (isCS) word = "CS:" + word;

    // Check for duplicate. For case-insensitive adds, compare lowercased so
    // "Amazon" and "amazon" are not stored as separate redundant entries.
    const dupCheck = isCS ? word : word.toLowerCase();
    const existing = dict.categories[catIndex].words;
    const isDup = isCS ? existing.includes(word) : existing.some((w) => w.toLowerCase() === dupCheck);
    if (isDup) {
      notifyTab(tab, `"${text}" already in ${dict.categories[catIndex].name}`);
      return;
    }

    // Insert alphabetically instead of appending
    insertAlphabetically(dict.categories[catIndex].words, word);

    try {
      await chrome.storage.local.set({ dictionary: dict });
    } catch (e) {
      log.error("failed to save word:", e.message);
      notifyTab(tab, `Failed to save "${text}" — storage error`);
      return;
    }

    notifyTab(
      tab,
      `Added "${text}" to ${dict.categories[catIndex].name}${isExact ? " (exact)" : ""}${isCS ? " (CS)" : ""}`
    );
    if (tab && tab.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: "refresh" });
      } catch (_) {
        /* swallow "no receiver" errors */
      }
    }
    buildContextMenu();
  });
}

// ---------------------------------------------------------------------------
// Add a word to the ignore list
// ---------------------------------------------------------------------------
function addWordToIgnoreList(text, tab) {
  enqueueStorageWrite(async () => {
    const result = await chrome.storage.local.get(["dictionary"]);
    const dict = result.dictionary;
    if (!dict) return;

    if (!dict.ignoreList) dict.ignoreList = [];

    if (dict.ignoreList.includes(text)) {
      notifyTab(tab, `"${text}" already in Ignore List`);
      return;
    }

    // Insert alphabetically instead of appending
    insertAlphabetically(dict.ignoreList, text);

    try {
      await chrome.storage.local.set({ dictionary: dict });
    } catch (e) {
      log.error("failed to save ignore word:", e.message);
      notifyTab(tab, `Failed to save "${text}" — storage error`);
      return;
    }

    notifyTab(tab, `Added "${text}" to Ignore List`);
    if (tab && tab.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: "refresh" });
      } catch (_) {
        /* swallow "no receiver" errors */
      }
    }
    buildContextMenu();
  });
}

// ---------------------------------------------------------------------------
// Send a brief notification to the content script (shows in console)
// ---------------------------------------------------------------------------
function notifyTab(tab, message) {
  if (tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, { action: "notify", message: message }).catch(() => {
      /* swallow "no receiver" errors */
    });
  }
}

// ---------------------------------------------------------------------------
// On install — set up defaults
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(async () => {
  const result = await chrome.storage.local.get(["dictionary", "enabled", "contextExact", "contextCaseSensitive"]);
  const existing = result.dictionary;
  const hasCats = !!(existing && Array.isArray(existing.categories) && existing.categories.length > 0);

  if (hasCats) {
    buildContextMenu();
    return;
  }

  // Seed from packaged default if available
  try {
    const url = chrome.runtime.getURL("default_dictionary.json");
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("Failed to load default_dictionary.json");
    const dict = await resp.json();

    await chrome.storage.local.set({
      enabled: result.enabled !== false,
      dictionary: dict,
      contextExact: !!result.contextExact,
      contextCaseSensitive: !!result.contextCaseSensitive,
    });
  } catch (_) {
    // Fallback: if fetch fails, at least ensure we have an empty structure
    if (!existing) {
      await chrome.storage.local.set({
        enabled: true,
        dictionary: { ignoreList: [], categories: [] },
        contextExact: false,
        contextCaseSensitive: false,
      });
    }
  }

  buildContextMenu();
});

// ---------------------------------------------------------------------------
// Rebuild context menu when dictionary or menu toggles change
// Debounced: rapid saves (e.g. options page auto-save) collapse into one rebuild.
// ---------------------------------------------------------------------------
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!changes.dictionary && !changes.contextExact && !changes.contextCaseSensitive) return;
  if (menuRebuildTimer) clearTimeout(menuRebuildTimer);
  menuRebuildTimer = setTimeout(() => {
    menuRebuildTimer = null;
    buildContextMenu();
  }, MENU_REBUILD_DEBOUNCE_MS);
});
