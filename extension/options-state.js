/* global escHtml, renderClients, renderCategories, syncAddClientFormFromPattern */
/* exported catEditorsEl, btnExport, btnImportHT, btnImportJSON, importFileEl,
   btnAddCat, newCatName, newCatColor, clientCountEl, clientSearchEl,
   clientShowingEl, clientListBodyEl, btnAddClient, newClientPattern,
   newClientReview, newClientImage, newClientProfile, newClientQuestion,
   newClientComment, newClientMentionCategory, newClientAliases,
   newClientIncludePatternInContent, newClientNote, currentDict, importMode,
   openClientKey, addBoxOpen, _selectOptionsHtml, NO_HL_BG, NO_HL_FG,
   CLIENT_SEARCH_DEBOUNCE_MS, showMsg, showConfirmDialog, safeStr,
   safeHexColor, normalizeAliasesFromTextarea, normalizePattern, patternKey,
   getClientKeyMap, findClientByKey, guessActiveCmsClientName,
   getCategoryNames, getCategoryStyleByName, getSelectOptionsHtml,
   makeCategorySelect, formatSummary, formatSummaryHtml,
   pickHeaderSwatchCategory, load, saveDictionary, debouncedSaveDictionary,
   invalidateCaches, invalidateClientCaches, renderIgnoreList, renderAliasChips,
   toggleAddBox, checkStorageQuota */
"use strict";

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------
const msgEl = document.getElementById("msg");
const storageWarnEl = document.getElementById("storageWarning");
const confirmDialog = document.getElementById("confirmDialog");
const confirmTitle = document.getElementById("confirmTitle");
const confirmBody = document.getElementById("confirmBody");
const confirmOk = document.getElementById("confirmOk");
const confirmCancel = document.getElementById("confirmCancel");
const catEditorsEl = document.getElementById("catEditors");
const btnExport = document.getElementById("btnExport");
const btnImportHT = document.getElementById("btnImportHT");
const btnImportJSON = document.getElementById("btnImportJSON");
const importFileEl = document.getElementById("importFile");
const btnAddCat = document.getElementById("btnAddCat");
const newCatName = document.getElementById("newCatName");
const newCatColor = document.getElementById("newCatColor");

// Clients UI
const clientCountEl = document.getElementById("clientCount");
const clientSearchEl = document.getElementById("clientSearch");
const clientShowingEl = document.getElementById("clientShowing");
const clientListBodyEl = document.getElementById("clientListBody");

const btnAddClient = document.getElementById("btnAddClient");
const newClientPattern = document.getElementById("newClientPattern");
const newClientReview = document.getElementById("newClientReview");
const newClientImage = document.getElementById("newClientImage");
const newClientProfile = document.getElementById("newClientProfile");
const newClientQuestion = document.getElementById("newClientQuestion");
const newClientComment = document.getElementById("newClientComment");

// Newer "Mentions" fields (must exist in options.html)
const newClientMentionCategory = document.getElementById("newClientMentionCategory");
const newClientAliases = document.getElementById("newClientAliases");
const newClientIncludePatternInContent = document.getElementById("newClientIncludePatternInContent");
const newClientNote = document.getElementById("newClientNote");

// Add Client collapsible toggle elements
const clientAddToggleEl = document.getElementById("clientAddToggle");
const clientAddArrowEl = document.getElementById("clientAddArrow");
const clientAddContentEl = document.getElementById("clientAddContent");

function toggleAddBox(forceOpen) {
  addBoxOpen = forceOpen !== undefined ? forceOpen : !addBoxOpen;
  if (addBoxOpen) {
    clientAddContentEl.classList.add("open");
    clientAddArrowEl.classList.add("open");
  } else {
    clientAddContentEl.classList.remove("open");
    clientAddArrowEl.classList.remove("open");
  }
}

if (clientAddToggleEl) {
  clientAddToggleEl.addEventListener("click", () => toggleAddBox());
}

// Form section collapsible toggles (Change 1)
document.querySelectorAll(".form-section-toggle").forEach(function (toggle) {
  toggle.addEventListener("click", function () {
    var section = toggle.getAttribute("data-section");
    var body = document.querySelector('.form-section-body[data-section="' + section + '"]');
    if (!body) return;
    var isCollapsed = toggle.classList.contains("collapsed");
    if (isCollapsed) {
      toggle.classList.remove("collapsed");
      body.style.display = "";
    } else {
      toggle.classList.add("collapsed");
      body.style.display = "none";
    }
  });
});

// Alias chips preview (Change 7)
const aliasChipsPreviewEl = document.getElementById("aliasChipsPreview");

function renderAliasChips() {
  if (!aliasChipsPreviewEl || !newClientAliases) return;
  var aliases = normalizeAliasesFromTextarea(newClientAliases.value);
  if (aliases.length === 0) {
    aliasChipsPreviewEl.innerHTML = "";
    return;
  }
  aliasChipsPreviewEl.innerHTML = aliases
    .map(function (a) {
      return '<span class="alias-chip">' + escHtml(a) + "</span>";
    })
    .join("");
}

if (newClientAliases) {
  newClientAliases.addEventListener("input", renderAliasChips);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let currentDict = null;
let importMode = null; // "ht" or "json"
let openClientKey = null; // keeps one client expanded
let addFormAutofilled = false; // only auto-fill from CMS once per load
let addBoxOpen = false; // tracks collapsed state of Add Client form

// ---------------------------------------------------------------------------
// Per-render caches (invalidated on every dict mutation)
// ---------------------------------------------------------------------------
let _catStyleMap = null; // Map<catName, {color, fColor}>  — rebuilt on demand
let _clientKeyMap = null; // Map<normalizedPattern, client> — rebuilt on demand

// Full invalidation — use for structural changes (category add/delete/color,
// import, client add/delete/rename).
function invalidateCaches() {
  _catStyleMap = null;
  _clientKeyMap = null;
  _selectOptionsHtml = {}; // colour changes must not be served from stale cache
  // Clear per-client lowercase caches so filteredClients() stays accurate.
  const clients = currentDict && currentDict.clients;
  if (clients)
    clients.forEach((c) => {
      delete c._lower;
    });
}

// Light invalidation — use for client field edits (overrides, mentions, notes)
// that don't affect category styles or select options.
function invalidateClientCaches() {
  _clientKeyMap = null;
}

// Use the same "no highlight" grey concept you want
const NO_HL_BG = "#e0e0e0";
const NO_HL_FG = "#555555";

// Timing constants
const MSG_DISPLAY_MS = 4000;
const DICT_SAVE_DEBOUNCE_MS = 300;
const CLIENT_SEARCH_DEBOUNCE_MS = 80;

// Storage quota constants
const STORAGE_QUOTA_BYTES = 10 * 1024 * 1024; // 10 MB Chrome limit
const STORAGE_WARN_RATIO = 0.8;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function showMsg(text, type) {
  msgEl.textContent = text;
  msgEl.className = "msg " + type;
  setTimeout(() => {
    msgEl.className = "msg";
  }, MSG_DISPLAY_MS);
}

function checkStorageQuota() {
  if (!chrome.storage.local.getBytesInUse) return;
  chrome.storage.local.getBytesInUse(null, (bytes) => {
    const pct = ((bytes / STORAGE_QUOTA_BYTES) * 100).toFixed(1);
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    if (bytes >= STORAGE_QUOTA_BYTES * STORAGE_WARN_RATIO) {
      storageWarnEl.textContent =
        "Storage usage: " + mb + " MB / 10 MB (" + pct + "%). Consider removing unused categories or clients.";
      storageWarnEl.style.display = "";
    } else {
      storageWarnEl.style.display = "none";
    }
  });
}

function showConfirmDialog(title, body, okLabel) {
  return new Promise((resolve) => {
    confirmTitle.textContent = title;
    confirmBody.textContent = body;
    confirmOk.textContent = okLabel || "Remove";
    const trigger = document.activeElement;
    function cleanup(result) {
      confirmOk.removeEventListener("click", onOk);
      confirmCancel.removeEventListener("click", onCancel);
      confirmDialog.removeEventListener("cancel", onCancel);
      confirmDialog.close();
      if (trigger && trigger.focus) trigger.focus();
      resolve(result);
    }
    function onOk() {
      cleanup(true);
    }
    function onCancel() {
      cleanup(false);
    }
    confirmOk.addEventListener("click", onOk);
    confirmCancel.addEventListener("click", onCancel);
    confirmDialog.addEventListener("cancel", onCancel);
    confirmDialog.showModal();
    confirmCancel.focus();
  });
}

function safeStr(v) {
  return String(v || "");
}

// escHtml is now a global from utils.js (single-pass implementation)

function safeHexColor(v, fallback) {
  return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(v) ? v : fallback;
}

function normalizeAliasesFromTextarea(txt) {
  return String(txt || "")
    .split("\n")
    .map((s) => String(s).trim())
    .filter((s) => s.length > 0);
}

// sortKey and insertAlphabetically are provided by utils.js (loaded first).

function normalizePattern(p) {
  return safeStr(p).trim();
}

function patternKey(p) {
  return normalizePattern(p).toLowerCase();
}

function getClientKeyMap() {
  if (_clientKeyMap) return _clientKeyMap;
  const map = new Map();
  const clients = currentDict && Array.isArray(currentDict.clients) ? currentDict.clients : [];
  for (const c of clients) {
    map.set(patternKey(c && c.pattern), c);
  }
  _clientKeyMap = map;
  return map;
}

function findClientByKey(key) {
  return getClientKeyMap().get(key) || null;
}

function guessActiveCmsClientName(cb) {
  // Fallback: read the name cached by popup.js (popup stores it before opening
  // options, because the options tab becomes active and the CMS tab is no
  // longer queryable as the "active" tab).
  // cb(name, fromLive) — fromLive=true only when the active tab responded.
  function fallbackToStorage() {
    chrome.storage.local.get(["_lastCmsClientName"], (r) => {
      cb(normalizePattern((r && r._lastCmsClientName) || ""), false);
    });
  }

  if (!chrome.tabs || !chrome.tabs.query || !chrome.tabs.sendMessage) {
    fallbackToStorage();
    return;
  }
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || !tab.id) {
      fallbackToStorage();
      return;
    }
    chrome.tabs.sendMessage(tab.id, { action: "getClientName" }, (res) => {
      if (chrome.runtime.lastError || !res || !res.clientName) {
        fallbackToStorage();
        return;
      }
      cb(normalizePattern(res.clientName), true);
    });
  });
}

function getCategoryNames() {
  if (!currentDict || !Array.isArray(currentDict.categories)) return [];
  return currentDict.categories.map((c) => c && c.name).filter(Boolean);
}

function getCategoryStyleByName() {
  if (_catStyleMap) return _catStyleMap;
  const map = new Map();
  if (!currentDict || !Array.isArray(currentDict.categories)) {
    _catStyleMap = map;
    return map;
  }
  for (const c of currentDict.categories) {
    if (!c || !c.name) continue;
    map.set(c.name, { color: c.color || "#FFFF00", fColor: c.fColor || "#000000" });
  }
  _catStyleMap = map;
  return map;
}

// Cached option-list HTML for the two select modes, rebuilt once per render cycle.
// Keys: "review" and "override".
let _selectOptionsHtml = {};

function getSelectOptionsHtml(mode, stMap) {
  if (_selectOptionsHtml[mode]) return _selectOptionsHtml[mode];

  let html = mode === "override" ? '<option value="">-</option>' : '<option value="">(no highlight)</option>';

  for (const name of getCategoryNames()) {
    const st = stMap.get(name);
    const bg = st ? escHtml(st.color || "") : "";
    const fg = st ? escHtml(st.fColor || "") : "";
    const n = escHtml(name);
    html += `<option value="${n}" style="background:${bg};color:${fg}">${n}</option>`;
  }

  _selectOptionsHtml[mode] = html;
  return html;
}

function makeCategorySelect(opts, stMapArg) {
  // opts:
  // - mode: "review" or "override"
  // - value: current value (string or null)
  // review: includes "(no highlight)" + categories
  // override: includes "-" (inherit) + categories
  // stMapArg: optional pre-built style map to avoid redundant Map construction
  const sel = document.createElement("select");
  const stMap = stMapArg || getCategoryStyleByName();

  function resetSelectVisual() {
    sel.style.backgroundColor = "";
    sel.style.color = "";
    sel.style.borderColor = "";
  }

  function applySelectVisualForValue(v) {
    if (!v) {
      resetSelectVisual();
      return;
    }
    const st = stMap.get(v);
    if (!st) {
      resetSelectVisual();
      return;
    }
    sel.style.backgroundColor = st.color || "";
    sel.style.color = st.fColor || "";
    sel.style.borderColor = "rgba(0,0,0,0.25)";
  }

  // Stamp the pre-built option list HTML in one shot instead of building
  // individual DOM nodes for every select element.
  sel.innerHTML = getSelectOptionsHtml(opts.mode, stMap);

  sel.value = opts.value || "";
  applySelectVisualForValue(sel.value);
  sel.addEventListener("change", () => applySelectVisualForValue(sel.value));

  return sel;
}

function formatSummary(entry) {
  const def = entry.defaultCategory ? entry.defaultCategory : "-";
  const o = entry.overrides || {};
  const img = o.Image ? o.Image : "-";
  const pro = o.Profile ? o.Profile : "-";
  const q = o.Question ? o.Question : "-";
  const cmt = o.Comment ? o.Comment : "-";

  const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
  const mentionCat = entry.mentionCategory ? entry.mentionCategory : "-";
  const incPat = entry.includePatternInContent !== false; // default true
  const note = entry.note ? String(entry.note).trim() : "";

  let extra = "";
  if (mentionCat !== "-" || aliases.length > 0 || !incPat || note) {
    extra += " | Mentions: " + mentionCat + " (" + aliases.length + ")";
    if (!incPat) extra += " [no pattern]";
    if (note) extra += " [note]";
  }

  return "Review: " + def + " | Img: " + img + " | Pro: " + pro + " | Q: " + q + " | Cmt: " + cmt + extra;
}

function formatSummaryHtml(entry) {
  var stMap = getCategoryStyleByName();
  var pills = [];

  function pill(label, catName) {
    var st = catName ? stMap.get(catName) : null;
    var bg = safeHexColor(st ? st.color : null, st ? "#e0e0e0" : "#f0f0f0");
    var fg = safeHexColor(st ? st.fColor : null, st ? "#333" : "#777");
    var border = st ? "rgba(0,0,0,0.15)" : "#ddd";
    return (
      '<span class="summary-pill" style="background:' +
      bg +
      ";color:" +
      fg +
      ";border-color:" +
      border +
      '">' +
      escHtml(label) +
      "</span>"
    );
  }

  if (entry.defaultCategory) pills.push(pill("Review: " + entry.defaultCategory, entry.defaultCategory));
  var o = entry.overrides || {};
  if (o.Image) pills.push(pill("Img: " + o.Image, o.Image));
  if (o.Profile) pills.push(pill("Pro: " + o.Profile, o.Profile));
  if (o.Question) pills.push(pill("Q: " + o.Question, o.Question));
  if (o.Comment) pills.push(pill("Cmt: " + o.Comment, o.Comment));

  var aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
  var mCat = entry.mentionCategory || null;
  if (mCat || aliases.length > 0) {
    var mLabel = "Mentions: " + (mCat || "-") + " (" + aliases.length + ")";
    pills.push(pill(mLabel, mCat));
  }
  if (entry.includePatternInContent === false) {
    pills.push(pill("no pattern", null));
  }
  if (entry.note && String(entry.note).trim()) {
    pills.push(pill("note", null));
  }

  if (pills.length === 0) {
    return '<span class="summary-pill" style="background:#f0f0f0;color:#999;border-color:#ddd">no config</span>';
  }

  return pills.join(" ");
}

function pickHeaderSwatchCategory(entry) {
  const o = entry.overrides || {};
  if (o.Image) return o.Image;
  if (o.Profile) return o.Profile;
  if (o.Question) return o.Question;
  if (entry.defaultCategory) return entry.defaultCategory;
  return null;
}

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------
function load() {
  chrome.storage.local.get(["dictionary"], (result) => {
    currentDict = result.dictionary || { ignoreList: [], categories: [], clients: [] };
    if (!Array.isArray(currentDict.ignoreList)) currentDict.ignoreList = [];
    if (!Array.isArray(currentDict.categories)) currentDict.categories = [];
    if (!Array.isArray(currentDict.clients)) currentDict.clients = [];
    invalidateCaches();

    renderIgnoreList();
    renderClients();
    renderCategories();
    checkStorageQuota();

    // Auto-fill the Add Client form once from the active CMS tab, if available.
    if (!addFormAutofilled) {
      addFormAutofilled = true;
      guessActiveCmsClientName((name, fromLive) => {
        if (!name) return;
        newClientPattern.value = name;
        syncAddClientFormFromPattern();
        if (fromLive) toggleAddBox(true);

        // If the client is already known, expand its card in the list
        const key = patternKey(name);
        const existing = findClientByKey(key);
        if (existing) {
          openClientKey = key;
          renderClients();
          setTimeout(() => {
            const el = clientListBodyEl.querySelector(".client-body.open");
            if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }, 50);
        }
      });
    }
  });
}

function saveDictionary(msg) {
  invalidateCaches();
  chrome.storage.local.set({ dictionary: currentDict }, () => {
    if (msg) showMsg(msg, "success");
    checkStorageQuota();
  });
}

// Debounced variant for rapid field edits (dropdowns, text inputs) so we
// don't thrash storage on every keystroke / selection change.
let _saveDictTimer = null;
function debouncedSaveDictionary() {
  invalidateClientCaches();
  if (_saveDictTimer) clearTimeout(_saveDictTimer);
  _saveDictTimer = setTimeout(() => {
    _saveDictTimer = null;
    chrome.storage.local.set({ dictionary: currentDict }, checkStorageQuota);
  }, DICT_SAVE_DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// Ignore List
// ---------------------------------------------------------------------------
// Rendered as the first card inside renderCategories(); nothing to do here.
function renderIgnoreList() {}
