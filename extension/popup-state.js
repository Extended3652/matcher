/* global clientGlobToRegex, log, saveDictionary */
/* exported SEARCH_DEBOUNCE_MS, ERROR_FLASH_MS, INVALID_RESET_MS,
   BUTTON_FEEDBACK_MS, masterToggle, statsEl, catListEl, btnOptions,
   popupSearch, clientBannerEl, bannerCatSelEl, bannerAddBtnEl,
   currentDict, detectedClientName, _lastWrittenClientName, openEditorKey,
   editing, normalizeTrim, buildRaw, includesCI, showConfirmDialog,
   confirmRemove, renderClientBanner, sameEditing, showMoveToCategoryDialog */
"use strict";

// Timing constants
const SEARCH_DEBOUNCE_MS = 150;
const ERROR_FLASH_MS = 1200;
const INVALID_RESET_MS = 1500;
const BUTTON_FEEDBACK_MS = 700;

const confirmDialog = document.getElementById("confirmDialog");
const confirmTitle = document.getElementById("confirmTitle");
const confirmBody = document.getElementById("confirmBody");
const confirmOk = document.getElementById("confirmOk");
const confirmCancel = document.getElementById("confirmCancel");

const masterToggle = document.getElementById("masterToggle");
const statsEl = document.getElementById("stats");
const catListEl = document.getElementById("catList");
const btnOptions = document.getElementById("btnOptions");
const popupSearch = document.getElementById("popupSearch");
const clientBannerEl = document.getElementById("clientBanner");
const bannerNameEl = document.getElementById("bannerClientName");
let bannerCatSelEl = document.getElementById("bannerCatSelect");
const bannerAddBtnEl = document.getElementById("bannerAddBtn");

let _bannerAbort = null; // AbortController for banner event listeners

let currentDict = null;
let detectedClientName = ""; // client name read from the active CMS tab
let _lastWrittenClientName = ""; // avoid redundant storage writes

// Use a string key so we can have "ignore" plus normal categories.
let openEditorKey = null;

// Track which entry is being edited
// shape: { scope: "ignore" | "cat", catIndex?: number, entryIndex: number }
let editing = null;

// sortKey, insertAlphabetically, and clientGlobToRegex are provided by
// utils.js (loaded before this script).

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function normalizeTrim(s) {
  return String(s || "").trim();
}

function buildRaw(text, exact, cs) {
  let out = String(text || "").trim();
  if (!out) return "";
  if (exact) out = "//" + out;
  if (cs) out = "CS:" + out;
  return out;
}

function includesCI(hay, needle) {
  const h = String(hay || "").toLowerCase();
  const n = String(needle || "").toLowerCase();
  return n.length === 0 ? true : h.includes(n);
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

function confirmRemove(label, value) {
  return showConfirmDialog("Remove from " + label + "?", value);
}

// ---------------------------------------------------------------------------
// Client banner helpers
// ---------------------------------------------------------------------------
function findMatchedClient(name) {
  if (!name || !currentDict) return null;
  const clients = currentDict.clients || [];
  for (const c of clients) {
    // Compile once and cache on the object; avoids re-compiling on every call.
    if (!(c._rx instanceof RegExp)) c._rx = clientGlobToRegex(c.pattern);
    if (c._rx && c._rx.test(name)) return c;
  }
  return null;
}

function applyBannerSelectColor() {
  const val = bannerCatSelEl.value;
  const cat = (currentDict.categories || []).find((c) => c.name === val);
  if (cat) {
    bannerCatSelEl.style.backgroundColor = cat.color || "";
    bannerCatSelEl.style.color = cat.fColor || "#000";
  } else {
    bannerCatSelEl.style.backgroundColor = "";
    bannerCatSelEl.style.color = "";
  }
}

function populateBannerSelect(selectedValue) {
  bannerCatSelEl.innerHTML = "";
  const defOpt = document.createElement("option");
  defOpt.value = "";
  defOpt.textContent = "(no highlight)";
  bannerCatSelEl.appendChild(defOpt);

  for (const cat of currentDict.categories || []) {
    const opt = document.createElement("option");
    opt.value = cat.name;
    opt.textContent = cat.name;
    if (cat.color) {
      opt.style.backgroundColor = cat.color;
      opt.style.color = cat.fColor || "#000";
    }
    bannerCatSelEl.appendChild(opt);
  }
  bannerCatSelEl.value = selectedValue || "";
  applyBannerSelectColor();
}

function renderClientBanner() {
  if (!detectedClientName) {
    clientBannerEl.style.display = "none";
    return;
  }
  clientBannerEl.style.display = "block";
  const matched = findMatchedClient(detectedClientName);

  // Abort previous listeners cleanly instead of cloning DOM nodes
  if (_bannerAbort) _bannerAbort.abort();
  _bannerAbort = new AbortController();
  const sig = { signal: _bannerAbort.signal };

  const selEl = bannerCatSelEl;
  const addBtn = document.getElementById("bannerAddBtn");

  if (matched) {
    // Known client — show current defaultCategory, allow updating
    clientBannerEl.style.background = "#e8f4fd";
    clientBannerEl.style.borderBottom = "1px solid #bee3f8";
    bannerNameEl.textContent = detectedClientName;

    populateBannerSelect(matched.defaultCategory || "");
    selEl.addEventListener("change", () => applyBannerSelectColor(), sig);

    addBtn.textContent = "Update";
    addBtn.style.display = "";
    addBtn.addEventListener(
      "click",
      () => {
        matched.defaultCategory = selEl.value || null;
        saveDictionary();
        renderClientBanner();
      },
      sig
    );
  } else {
    // Unknown client — amber warning, show save button
    clientBannerEl.style.background = "#fff8e1";
    clientBannerEl.style.borderBottom = "1px solid #ffe082";
    bannerNameEl.textContent = "\u26a0 " + detectedClientName;

    const firstCat = (currentDict.categories || [])[0];
    populateBannerSelect(firstCat ? firstCat.name : "");
    selEl.addEventListener("change", () => applyBannerSelectColor(), sig);

    addBtn.textContent = "Save";
    addBtn.style.display = "";
    addBtn.addEventListener(
      "click",
      () => {
        if (!currentDict.clients) currentDict.clients = [];
        const entry = {
          pattern: detectedClientName,
          defaultCategory: selEl.value || null,
          mentionCategory: null,
          overrides: {},
          aliases: [],
          includePatternInContent: true,
          note: "",
        };
        currentDict.clients.push(entry);
        saveDictionary();
        renderClientBanner();
      },
      sig
    );
  }
}

function sameEditing(scope, catIndex, entryIndex) {
  if (!editing) return false;
  if (editing.scope !== scope) return false;
  if ((editing.catIndex ?? null) !== (catIndex ?? null)) return false;
  return editing.entryIndex === entryIndex;
}

function showMoveToCategoryDialog(excludeCatId) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,0.35)";
    overlay.style.zIndex = "9999";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.padding = "12px";

    const modal = document.createElement("div");
    modal.style.width = "min(420px, 95vw)";
    modal.style.maxHeight = "80vh";
    modal.style.overflow = "hidden";
    modal.style.background = "#fff";
    modal.style.borderRadius = "12px";
    modal.style.boxShadow = "0 10px 30px rgba(0,0,0,0.25)";
    modal.style.border = "1px solid #e5e7eb";
    modal.style.display = "flex";
    modal.style.flexDirection = "column";

    const header = document.createElement("div");
    header.style.padding = "12px 14px";
    header.style.borderBottom = "1px solid #e5e7eb";
    header.style.fontSize = "14px";
    header.style.fontWeight = "600";
    header.textContent = "Move entry to which category?";
    modal.appendChild(header);

    const listWrap = document.createElement("div");
    listWrap.style.padding = "8px";
    listWrap.style.overflow = "auto";

    const cats = (currentDict.categories || []).filter((c) => c && c.id && c.name && c.id !== excludeCatId);

    cats.forEach((c) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.style.width = "100%";
      btn.style.display = "flex";
      btn.style.alignItems = "center";
      btn.style.gap = "10px";
      btn.style.textAlign = "left";
      btn.style.border = "1px solid #e5e7eb";
      btn.style.borderRadius = "10px";
      btn.style.padding = "10px 12px";
      btn.style.margin = "6px 0";
      btn.style.background = "#fff";
      btn.style.cursor = "pointer";
      btn.style.fontSize = "13px";

      const sw = document.createElement("span");
      sw.style.width = "12px";
      sw.style.height = "12px";
      sw.style.borderRadius = "999px";
      sw.style.border = "1px solid rgba(0,0,0,0.15)";
      sw.style.background = c.color || "#FFFF00";
      btn.appendChild(sw);

      const label = document.createElement("span");
      label.textContent = c.name;
      btn.appendChild(label);

      btn.addEventListener("click", () => {
        cleanup();
        resolve(c);
      });

      listWrap.appendChild(btn);
    });

    if (cats.length === 0) {
      const empty = document.createElement("div");
      empty.style.padding = "10px 12px";
      empty.style.fontSize = "13px";
      empty.style.color = "#6b7280";
      empty.textContent = "No other categories available.";
      listWrap.appendChild(empty);
    }

    modal.appendChild(listWrap);

    const footer = document.createElement("div");
    footer.style.display = "flex";
    footer.style.justifyContent = "flex-end";
    footer.style.gap = "8px";
    footer.style.padding = "10px 14px";
    footer.style.borderTop = "1px solid #e5e7eb";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.style.border = "1px solid #e5e7eb";
    cancel.style.borderRadius = "10px";
    cancel.style.padding = "8px 12px";
    cancel.style.background = "#fff";
    cancel.style.cursor = "pointer";

    cancel.addEventListener("click", () => {
      cleanup();
      resolve(null);
    });

    footer.appendChild(cancel);
    modal.appendChild(footer);

    function cleanup() {
      document.removeEventListener("keydown", onKeyDown, true);
      overlay.remove();
    }

    function onKeyDown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        cleanup();
        resolve(null);
      }
    }

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve(null);
      }
    });

    document.addEventListener("keydown", onKeyDown, true);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  });
}
