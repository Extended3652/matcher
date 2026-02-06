// =============================================================================
// CMS Highlighter — Background Service Worker
// =============================================================================
// Handles:
//   1. Context menu (right-click to add selected text to a category)
//   2. Initializing default storage on first install
//   3. Rebuilding context menu safely (no duplicate-id errors)
// =============================================================================

"use strict";

const MENU_PARENT_ID = "cms-hl-parent";
const MENU_SEP1_ID   = "cms-hl-sep1";
const MENU_EXACT_ID  = "cms-hl-exact";
const MENU_CS_ID     = "cms-hl-cs";
const MENU_SEP2_ID   = "cms-hl-sep2";
const MENU_IGNORE_ID = "cms-hl-ignore";

let menuBuildInProgress = false;
let menuBuildQueued = false;

// ---------------------------------------------------------------------------
// Alphabetical insert helper
// ---------------------------------------------------------------------------
// Strips CS: and // prefixes so that "CS://HP" sorts by "hp", not the prefix.
function sortKey(raw) {
  return String(raw || "").replace(/^(CS:)?(\/\/)?/, "").toLowerCase();
}

// Inserts word into arr at the correct alphabetical position (by bare word).
function insertAlphabetically(arr, word) {
  const key = sortKey(word);
  let i = 0;
  while (i < arr.length && sortKey(arr[i]) < key) i++;
  arr.splice(i, 0, word);
}

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
      if (!dict || !Array.isArray(dict.categories)) {
        // No dictionary yet, nothing to build.
        menuBuildInProgress = false;
        if (menuBuildQueued) { menuBuildQueued = false; buildContextMenu(); }
        return;
      }

      const isExact = !!result.contextExact;
      const isCS    = !!result.contextCaseSensitive;

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

      // Ignore list
      safeCreate({
        id: MENU_IGNORE_ID,
        parentId: MENU_PARENT_ID,
        title: "Add to Ignore List",
        contexts: ["selection"],
      });

      menuBuildInProgress = false;

      // If another rebuild request came in while we were building, run again once.
      if (menuBuildQueued) {
        menuBuildQueued = false;
        buildContextMenu();
      }
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
    chrome.storage.local.get(["contextExact"], (result) => {
      const newVal = !(result.contextExact || false);
      chrome.storage.local.set({ contextExact: newVal }, () => {
        buildContextMenu();
      });
    });
    return;
  }

  // Toggle case-sensitive mode
  if (menuId === MENU_CS_ID) {
    chrome.storage.local.get(["contextCaseSensitive"], (result) => {
      const newVal = !(result.contextCaseSensitive || false);
      chrome.storage.local.set({ contextCaseSensitive: newVal }, () => {
        buildContextMenu();
      });
    });
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
  chrome.storage.local.get(["dictionary", "contextExact", "contextCaseSensitive"], (result) => {
    const dict = result.dictionary;
    if (!dict || !Array.isArray(dict.categories) || !dict.categories[catIndex]) return;

    let word = text;
    const isExact = result.contextExact || false;
    const isCS = result.contextCaseSensitive || false;

    // Apply prefixes
    if (isExact) word = "//" + word;
    if (isCS) word = "CS:" + word;

    // Check for duplicate
    if (dict.categories[catIndex].words.includes(word)) {
      notifyTab(tab, `"${text}" already in ${dict.categories[catIndex].name}`);
      return;
    }

    // Insert alphabetically instead of appending
    insertAlphabetically(dict.categories[catIndex].words, word);

    chrome.storage.local.set({ dictionary: dict }, () => {
      notifyTab(
        tab,
        `Added "${text}" to ${dict.categories[catIndex].name}${isExact ? " (exact)" : ""}${isCS ? " (CS)" : ""}`
      );
      if (tab && tab.id) {
        chrome.tabs.sendMessage(tab.id, { action: "refresh" });
      }
      buildContextMenu();
    });
  });
}

// ---------------------------------------------------------------------------
// Add a word to the ignore list
// ---------------------------------------------------------------------------
function addWordToIgnoreList(text, tab) {
  chrome.storage.local.get(["dictionary"], (result) => {
    const dict = result.dictionary;
    if (!dict) return;

    if (!dict.ignoreList) dict.ignoreList = [];

    if (dict.ignoreList.includes(text)) {
      notifyTab(tab, `"${text}" already in Ignore List`);
      return;
    }

    // Insert alphabetically instead of appending
    insertAlphabetically(dict.ignoreList, text);

    chrome.storage.local.set({ dictionary: dict }, () => {
      notifyTab(tab, `Added "${text}" to Ignore List`);
      if (tab && tab.id) {
        chrome.tabs.sendMessage(tab.id, { action: "refresh" });
      }
      buildContextMenu();
    });
  });
}

// ---------------------------------------------------------------------------
// Send a brief notification to the content script (shows in console)
// ---------------------------------------------------------------------------
function notifyTab(tab, message) {
  if (tab && tab.id) {
    try {
      chrome.tabs.sendMessage(tab.id, { action: "notify", message: message });
    } catch (e) {
      // ignore
    }
  }
  console.log("CMS Highlighter:", message);
}

// ---------------------------------------------------------------------------
// On install — set up defaults
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.storage.local.get(["dictionary"], (result) => {
      if (!result.dictionary) {
        chrome.storage.local.set({
          enabled: true,
          dictionary: { ignoreList: [], categories: [], clients: [] },
          contextExact: false,
          contextCaseSensitive: false,
        });
      }
    });
  }

  buildContextMenu();
});

// ---------------------------------------------------------------------------
// Rebuild context menu when dictionary or menu toggles change
// ---------------------------------------------------------------------------
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.dictionary || changes.contextExact || changes.contextCaseSensitive) {
    buildContextMenu();
  }
});
