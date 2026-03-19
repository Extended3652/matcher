// =============================================================================
// CMS Highlighter - Options Page Script
// Full dictionary management: categories, words, ignore list, clients,
// import/export.
// =============================================================================

(function() {
  "use strict";

  // ---------------------------------------------------------------------------
  // Elements
  // ---------------------------------------------------------------------------
  const msgEl         = document.getElementById("msg");
  const catEditorsEl  = document.getElementById("catEditors");
  const btnExport     = document.getElementById("btnExport");
  const btnImportHT   = document.getElementById("btnImportHT");
  const btnImportJSON = document.getElementById("btnImportJSON");
  const importFileEl  = document.getElementById("importFile");
  const btnAddCat     = document.getElementById("btnAddCat");
  const newCatName    = document.getElementById("newCatName");
  const newCatColor   = document.getElementById("newCatColor");

  // Clients UI
  const clientCountEl    = document.getElementById("clientCount");
  const clientSearchEl   = document.getElementById("clientSearch");
  const clientShowingEl  = document.getElementById("clientShowing");
  const clientListBodyEl = document.getElementById("clientListBody");

  const btnAddClient      = document.getElementById("btnAddClient");
  const newClientPattern  = document.getElementById("newClientPattern");
  const newClientReview   = document.getElementById("newClientReview");
  const newClientImage    = document.getElementById("newClientImage");
  const newClientProfile  = document.getElementById("newClientProfile");
  const newClientQuestion = document.getElementById("newClientQuestion");
  const newClientComment  = document.getElementById("newClientComment");

  // Newer "Mentions" fields (must exist in options.html)
  const newClientMentionCategory = document.getElementById("newClientMentionCategory");
  const newClientAliases = document.getElementById("newClientAliases");
  const newClientIncludePatternInContent = document.getElementById("newClientIncludePatternInContent");
  const newClientNote = document.getElementById("newClientNote");

  // Add Client collapsible toggle elements
  const clientAddToggleEl  = document.getElementById("clientAddToggle");
  const clientAddArrowEl   = document.getElementById("clientAddArrow");
  const clientAddContentEl = document.getElementById("clientAddContent");

  function toggleAddBox(forceOpen) {
    addBoxOpen = (forceOpen !== undefined) ? forceOpen : !addBoxOpen;
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
  document.querySelectorAll(".form-section-toggle").forEach(function(toggle) {
    toggle.addEventListener("click", function() {
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
    aliasChipsPreviewEl.innerHTML = aliases.map(function(a) {
      return '<span class="alias-chip">' + escHtml(a) + '</span>';
    }).join("");
  }

  if (newClientAliases) {
    newClientAliases.addEventListener("input", renderAliasChips);
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let currentDict = null;
  let importMode  = null; // "ht" or "json"
  let openClientKey = null; // keeps one client expanded
  let addFormAutofilled = false; // only auto-fill from CMS once per load
  let addBoxOpen = false; // tracks collapsed state of Add Client form

  // ---------------------------------------------------------------------------
  // Per-render caches (invalidated on every dict mutation)
  // ---------------------------------------------------------------------------
  let _catStyleMap  = null; // Map<catName, {color, fColor}>  — rebuilt on demand
  let _clientKeyMap = null; // Map<normalizedPattern, client> — rebuilt on demand

  function invalidateCaches() {
    _catStyleMap        = null;
    _clientKeyMap       = null;
    _selectOptionsHtml  = {};  // colour changes must not be served from stale cache
    // Clear per-client lowercase caches so filteredClients() stays accurate.
    const clients = currentDict && currentDict.clients;
    if (clients) clients.forEach(c => { delete c._lower; });
  }

  // Use the same "no highlight" grey concept you want
  const NO_HL_BG = "#e0e0e0";
  const NO_HL_FG = "#555555";

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function showMsg(text, type) {
    msgEl.textContent = text;
    msgEl.className = "msg " + type;
    setTimeout(() => { msgEl.className = "msg"; }, 4000);
  }

  function safeStr(v) {
    return String(v || "");
  }

  function escHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function normalizeAliasesFromTextarea(txt) {
    return String(txt || "")
      .split("\n")
      .map(s => String(s).trim())
      .filter(s => s.length > 0);
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
    return currentDict.categories.map(c => c && c.name).filter(Boolean);
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

    function esc(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    let html = mode === "override"
      ? '<option value="">-</option>'
      : '<option value="">(no highlight)</option>';

    for (const name of getCategoryNames()) {
      const st = stMap.get(name);
      const bg = st ? esc(st.color || "") : "";
      const fg = st ? esc(st.fColor || "") : "";
      const n  = esc(name);
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
    const q   = o.Question ? o.Question : "-";
    const cmt = o.Comment  ? o.Comment  : "-";

    const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
    const mentionCat = entry.mentionCategory ? entry.mentionCategory : "-";
    const incPat = (entry.includePatternInContent !== false); // default true
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
      var bg = st ? (st.color || "#e0e0e0") : "#f0f0f0";
      var fg = st ? (st.fColor || "#333") : "#777";
      var border = st ? "rgba(0,0,0,0.15)" : "#ddd";
      return '<span class="summary-pill" style="background:' + bg + ";color:" + fg + ";border-color:" + border + '">' + escHtml(label) + "</span>";
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
    });
  }

  // ---------------------------------------------------------------------------
  // Ignore List
  // ---------------------------------------------------------------------------
  // Rendered as the first card inside renderCategories(); nothing to do here.
  function renderIgnoreList() {}

  // ---------------------------------------------------------------------------
  // Clients
  // ---------------------------------------------------------------------------
  function populateAddClientDropdowns(stMap) {
    // We build temp <select>s so we inherit the same options + styling logic
    // then move options into the real DOM selects.
    newClientReview.innerHTML = "";
    newClientImage.innerHTML = "";
    newClientProfile.innerHTML = "";
    newClientQuestion.innerHTML = "";
    if (newClientComment) newClientComment.innerHTML = "";

    const reviewSel = makeCategorySelect({ mode: "review", value: "" }, stMap);
    const imgSel = makeCategorySelect({ mode: "override", value: "" }, stMap);
    const proSel = makeCategorySelect({ mode: "override", value: "" }, stMap);
    const qSel = makeCategorySelect({ mode: "override", value: "" }, stMap);
    const cSel = makeCategorySelect({ mode: "override", value: "" }, stMap);

    while (reviewSel.firstChild) newClientReview.appendChild(reviewSel.firstChild);
    while (imgSel.firstChild) newClientImage.appendChild(imgSel.firstChild);
    while (proSel.firstChild) newClientProfile.appendChild(proSel.firstChild);
    while (qSel.firstChild) newClientQuestion.appendChild(qSel.firstChild);
    if (newClientComment) { while (cSel.firstChild) newClientComment.appendChild(cSel.firstChild); }

    newClientReview.value = "";
    newClientImage.value = "";
    newClientProfile.value = "";
    newClientQuestion.value = "";
    if (newClientComment) newClientComment.value = "";

    // Mentions category select, if present in HTML
    if (newClientMentionCategory) {
      newClientMentionCategory.innerHTML = "";
      const mentionSel = makeCategorySelect({ mode: "override", value: "" }, stMap);
      while (mentionSel.firstChild) newClientMentionCategory.appendChild(mentionSel.firstChild);
      newClientMentionCategory.value = "";
    }
  }

  function syncAddClientFormFromPattern() {
    const pattern = normalizePattern(newClientPattern.value);
    const key = patternKey(pattern);
    const existing = pattern ? findClientByKey(key) : null;

    if (!pattern) {
      newClientReview.value = "";
      newClientImage.value = "";
      newClientProfile.value = "";
      newClientQuestion.value = "";
      if (newClientComment) newClientComment.value = "";
      if (newClientMentionCategory) newClientMentionCategory.value = "";
      if (newClientAliases) newClientAliases.value = "";
      if (newClientIncludePatternInContent) newClientIncludePatternInContent.checked = true;
      if (newClientNote) newClientNote.value = "";
      btnAddClient.textContent = "Add Client";
      return;
    }

    if (existing) {
      // Load existing client into the add/edit form
      newClientReview.value = existing.defaultCategory || "";
      newClientImage.value = (existing.overrides && existing.overrides.Image) || "";
      newClientProfile.value = (existing.overrides && existing.overrides.Profile) || "";
      newClientQuestion.value = (existing.overrides && existing.overrides.Question) || "";
      if (newClientComment) {
        newClientComment.value = (existing.overrides && existing.overrides.Comment) || "";
      }
      if (newClientMentionCategory) {
        newClientMentionCategory.value = existing.mentionCategory || "";
      }
      if (newClientAliases) {
        newClientAliases.value = Array.isArray(existing.aliases) ? existing.aliases.join("\n") : "";
      }
      if (newClientIncludePatternInContent) {
        newClientIncludePatternInContent.checked = (existing.includePatternInContent !== false);
      }
      if (newClientNote) {
        newClientNote.value = existing.note ? String(existing.note) : "";
      }
      btnAddClient.textContent = "Update Client";
    } else {
      // New client: keep pattern, reset the rest
      newClientReview.value = "";
      newClientImage.value = "";
      newClientProfile.value = "";
      newClientQuestion.value = "";
      if (newClientComment) newClientComment.value = "";
      if (newClientMentionCategory) newClientMentionCategory.value = "";
      if (newClientAliases) newClientAliases.value = "";
      if (newClientIncludePatternInContent) newClientIncludePatternInContent.checked = true;
      if (newClientNote) newClientNote.value = "";
      btnAddClient.textContent = "Add Client";
    }

    renderAliasChips();
  }

  function getClientFilter() {
    return safeStr(clientSearchEl.value).trim().toLowerCase();
  }

  // Lazily build and cache the lowercased fields on each client object.
  // Cleared by invalidateCaches() whenever the dict is mutated.
  function getClientLower(c) {
    if (!c._lower) {
      c._lower = {
        pattern: safeStr(c.pattern).toLowerCase(),
        note:    safeStr(c.note).toLowerCase(),
        aliases: Array.isArray(c.aliases) ? c.aliases.map(a => safeStr(a).toLowerCase()) : [],
      };
    }
    return c._lower;
  }

  function filteredClients() {
    const all = currentDict.clients || [];
    const f = getClientFilter();
    if (!f) return all.slice();

    return all.filter(c => {
      const lc = getClientLower(c);
      if (lc.pattern.includes(f)) return true;
      if (lc.note.includes(f)) return true;
      for (const a of lc.aliases) {
        if (a.includes(f)) return true;
      }
      return false;
    });
  }

  function ensureClientsSorted() {
    const clients = currentDict.clients || [];
    clients.sort((a, b) => safeStr(a.pattern).toLowerCase().localeCompare(safeStr(b.pattern).toLowerCase()));
    currentDict.clients = clients;
  }

  function renderClients() {
    if (!currentDict) return;

    // Reset per-render option-HTML cache so selects reflect current categories.
    _selectOptionsHtml = {};

    ensureClientsSorted();

    const all = currentDict.clients || [];
    const list = filteredClients();

    clientCountEl.textContent = "(" + all.length + " entries)";
    clientShowingEl.textContent = (list.length === all.length)
      ? ("Showing " + list.length)
      : ("Showing " + list.length + " of " + all.length);

    const styleByName = getCategoryStyleByName();
    populateAddClientDropdowns(styleByName);

    // After dropdowns are repopulated, re-sync the add/edit form selection
    syncAddClientFormFromPattern();

    clientListBodyEl.innerHTML = "";

    if (all.length === 0) {
      const div = document.createElement("div");
      div.className = "empty-state";
      div.innerHTML =
        '<div class="empty-state-icon">&#128203;</div>' +
        '<div class="empty-state-text">No client entries yet</div>' +
        '<div class="empty-state-hint">Use the "Add / Edit Client" form above to create your first entry.</div>';
      clientListBodyEl.appendChild(div);
      return;
    }

    if (list.length === 0) {
      const div = document.createElement("div");
      div.className = "empty-state";
      div.innerHTML =
        '<div class="empty-state-icon">&#128270;</div>' +
        '<div class="empty-state-text">No matches found</div>' +
        '<div class="empty-state-hint">Clear the search box to see all clients.</div>';
      clientListBodyEl.appendChild(div);
      return;
    }

    list.forEach((entry) => {
      const pat = safeStr(entry.pattern);
      const key = patternKey(pat);

      const card = document.createElement("div");
      card.className = "client-card";

      const header = document.createElement("div");
      header.className = "client-header";

      const arrow = document.createElement("span");
      arrow.className = "client-arrow";
      arrow.textContent = "\u25b6";
      header.appendChild(arrow);

      const swatch = document.createElement("span");
      swatch.className = "client-swatch";
      header.appendChild(swatch);

      const patSpan = document.createElement("span");
      patSpan.className = "client-pattern";
      patSpan.textContent = pat || "(blank)";
      header.appendChild(patSpan);

      const summary = document.createElement("span");
      summary.className = "client-summary";
      summary.innerHTML = formatSummaryHtml(entry);
      header.appendChild(summary);

      const actions = document.createElement("div");
      actions.className = "client-actions";

      const delBtn = document.createElement("button");
      delBtn.className = "btn-del";
      delBtn.textContent = "X";
      delBtn.title = "Delete this client";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const p = safeStr(entry.pattern);
        if (confirm('Remove client "' + p + '"?')) {
          const idx = (currentDict.clients || []).findIndex(c => patternKey(c.pattern) === patternKey(p));
          if (idx >= 0) {
            currentDict.clients.splice(idx, 1);
            saveDictionary('Removed client "' + p + '"');
            if (openClientKey === patternKey(p)) openClientKey = null;
            renderClients();
          }
        }
      });
      actions.appendChild(delBtn);

      header.appendChild(actions);

      const body = document.createElement("div");
      body.className = "client-body";

      const grid = document.createElement("div");
      grid.className = "client-edit-grid";

      const fPat = document.createElement("div");
      fPat.className = "field";
      const lPat = document.createElement("label");
      lPat.textContent = "Client Name";
      const iPat = document.createElement("input");
      iPat.type = "text";
      iPat.value = pat;
      fPat.appendChild(lPat);
      fPat.appendChild(iPat);
      grid.appendChild(fPat);

      const fReview = document.createElement("div");
      fReview.className = "field";
      const lReview = document.createElement("label");
      lReview.textContent = "Header: Review (Default)";
      const sReview = makeCategorySelect({ mode: "review", value: entry.defaultCategory || "" }, styleByName);
      fReview.appendChild(lReview);
      fReview.appendChild(sReview);
      grid.appendChild(fReview);

      const fImg = document.createElement("div");
      fImg.className = "field";
      const lImg = document.createElement("label");
      lImg.textContent = "Header: Image override";
      const sImg = makeCategorySelect({ mode: "override", value: (entry.overrides && entry.overrides.Image) || "" }, styleByName);
      fImg.appendChild(lImg);
      fImg.appendChild(sImg);
      grid.appendChild(fImg);

      const fPro = document.createElement("div");
      fPro.className = "field";
      const lPro = document.createElement("label");
      lPro.textContent = "Header: Profile override";
      const sPro = makeCategorySelect({ mode: "override", value: (entry.overrides && entry.overrides.Profile) || "" }, styleByName);
      fPro.appendChild(lPro);
      fPro.appendChild(sPro);
      grid.appendChild(fPro);

      const fQ = document.createElement("div");
      fQ.className = "field";
      const lQ = document.createElement("label");
      lQ.textContent = "Header: Question override";
      const sQ = makeCategorySelect({ mode: "override", value: (entry.overrides && entry.overrides.Question) || "" }, styleByName);
      fQ.appendChild(lQ);
      fQ.appendChild(sQ);
      grid.appendChild(fQ);

      const fCmt = document.createElement("div");
      fCmt.className = "field";
      const lCmt = document.createElement("label");
      lCmt.textContent = "Header: Comment override";
      const sCmt = makeCategorySelect({ mode: "override", value: (entry.overrides && entry.overrides.Comment) || "" }, styleByName);
      fCmt.appendChild(lCmt);
      fCmt.appendChild(sCmt);
      grid.appendChild(fCmt);

      body.appendChild(grid);

      // Mentions editor block (only if your HTML/CSS supports it visually, but functionally safe)
      const mentionsWrap = document.createElement("div");
      mentionsWrap.className = "client-mentions-wrap";

      const mGrid = document.createElement("div");
      mGrid.className = "client-edit-grid";

      const fMCat = document.createElement("div");
      fMCat.className = "field";
      const lMCat = document.createElement("label");
      lMCat.textContent = "Mentions: Category";
      const sMCat = makeCategorySelect({ mode: "override", value: entry.mentionCategory || "" }, styleByName);
      fMCat.appendChild(lMCat);
      fMCat.appendChild(sMCat);
      mGrid.appendChild(fMCat);

      const fAliases = document.createElement("div");
      fAliases.className = "field";
      fAliases.style.gridColumn = "1 / -1";
      const lAliases = document.createElement("label");
      lAliases.textContent = "Mentions: Aliases (one per line, supports * and ?)";
      const tAliases = document.createElement("textarea");
      tAliases.className = "word-list";
      tAliases.spellcheck = false;
      tAliases.style.minHeight = "90px";
      tAliases.value = Array.isArray(entry.aliases) ? entry.aliases.join("\n") : "";
      fAliases.appendChild(lAliases);
      fAliases.appendChild(tAliases);
      mGrid.appendChild(fAliases);

      const fInc = document.createElement("div");
      fInc.className = "field";
      fInc.style.gridColumn = "1 / -1";
      const lInc = document.createElement("label");
      lInc.style.display = "flex";
      lInc.style.alignItems = "center";
      lInc.style.gap = "10px";
      const cbInc = document.createElement("input");
      cbInc.type = "checkbox";
      cbInc.checked = (entry.includePatternInContent !== false);
      lInc.appendChild(cbInc);
      lInc.appendChild(document.createTextNode("Also treat the main Client Name as a mention in content (in addition to aliases)"));
      fInc.appendChild(lInc);

      const incHelp = document.createElement("div");
      incHelp.className = "muted";
      incHelp.style.marginTop = "4px";
      incHelp.textContent = "If Mentions category is set, this adds the Client Name as an extra mention matcher unless unchecked.";
      fInc.appendChild(incHelp);

      mGrid.appendChild(fInc);

      const fNote = document.createElement("div");
      fNote.className = "field";
      fNote.style.gridColumn = "1 / -1";
      const lNote = document.createElement("label");
      lNote.textContent = "Note";
      const iNote = document.createElement("input");
      iNote.type = "text";
      iNote.placeholder = "Optional note (not used for matching)";
      iNote.value = entry.note ? String(entry.note) : "";
      fNote.appendChild(lNote);
      fNote.appendChild(iNote);
      mGrid.appendChild(fNote);

      mentionsWrap.appendChild(mGrid);
      body.appendChild(mentionsWrap);

      function refreshHeaderVisuals() {
        summary.innerHTML = formatSummaryHtml(entry);

        const catName = pickHeaderSwatchCategory(entry);
        if (!catName) {
          swatch.style.backgroundColor = NO_HL_BG;
          swatch.style.borderColor = "#bdbdbd";
        } else {
          const st = styleByName.get(catName);
          if (st) {
            swatch.style.backgroundColor = st.color;
            swatch.style.borderColor = "rgba(0,0,0,0.2)";
          } else {
            swatch.style.backgroundColor = NO_HL_BG;
            swatch.style.borderColor = "#bdbdbd";
          }
        }
      }

      refreshHeaderVisuals();

      function commitClientListRefresh() {
        ensureClientsSorted();
        saveDictionary();
        renderClients();
      }

      iPat.addEventListener("change", () => {
        const newPat = normalizePattern(iPat.value);
        if (!newPat) {
          showMsg("Client Name cannot be blank", "error");
          iPat.value = entry.pattern || "";
          return;
        }

        const oldKey = patternKey(entry.pattern);
        const newKey = patternKey(newPat);

        if (newKey !== oldKey) {
          const exists = (currentDict.clients || []).some(c => patternKey(c.pattern) === newKey);
          if (exists) {
            showMsg('Client "' + newPat + '" already exists', "error");
            iPat.value = entry.pattern || "";
            return;
          }
        }

        entry.pattern = newPat;
        patSpan.textContent = newPat;
        openClientKey = patternKey(newPat);
        commitClientListRefresh();
      });

      sReview.addEventListener("change", () => {
        entry.defaultCategory = sReview.value ? sReview.value : null;
        refreshHeaderVisuals();
        saveDictionary();
      });

      sImg.addEventListener("change", () => {
        if (!entry.overrides) entry.overrides = {};
        if (sImg.value) entry.overrides.Image = sImg.value;
        else delete entry.overrides.Image;
        refreshHeaderVisuals();
        saveDictionary();
      });

      sPro.addEventListener("change", () => {
        if (!entry.overrides) entry.overrides = {};
        if (sPro.value) entry.overrides.Profile = sPro.value;
        else delete entry.overrides.Profile;
        refreshHeaderVisuals();
        saveDictionary();
      });

      sQ.addEventListener("change", () => {
        if (!entry.overrides) entry.overrides = {};
        if (sQ.value) entry.overrides.Question = sQ.value;
        else delete entry.overrides.Question;
        refreshHeaderVisuals();
        saveDictionary();
      });

      sCmt.addEventListener("change", () => {
        if (!entry.overrides) entry.overrides = {};
        if (sCmt.value) entry.overrides.Comment = sCmt.value;
        else delete entry.overrides.Comment;
        refreshHeaderVisuals();
        saveDictionary();
      });

      sMCat.addEventListener("change", () => {
        entry.mentionCategory = sMCat.value ? sMCat.value : null;
        saveDictionary();
        summary.innerHTML = formatSummaryHtml(entry);
      });

      tAliases.addEventListener("change", () => {
        entry.aliases = normalizeAliasesFromTextarea(tAliases.value);
        saveDictionary();
        summary.innerHTML = formatSummaryHtml(entry);
      });

      cbInc.addEventListener("change", () => {
        entry.includePatternInContent = !!cbInc.checked;
        saveDictionary();
        summary.innerHTML = formatSummaryHtml(entry);
      });

      iNote.addEventListener("change", () => {
        entry.note = (iNote.value || "").trim();
        saveDictionary();
        summary.innerHTML = formatSummaryHtml(entry);
      });

      header.addEventListener("click", () => {
        const isOpen = (openClientKey === key);
        openClientKey = isOpen ? null : key;
        renderClients();
      });

      if (openClientKey === key) {
        body.classList.add("open");
        arrow.classList.add("open");
      } else {
        body.classList.remove("open");
        arrow.classList.remove("open");
      }

      card.appendChild(header);
      card.appendChild(body);
      clientListBodyEl.appendChild(card);
    });
  }

  let _clientSearchTimer = null;
  clientSearchEl.addEventListener("input", () => {
    clearTimeout(_clientSearchTimer);
    _clientSearchTimer = setTimeout(renderClients, 80);
  });

  if (newClientPattern) {
    newClientPattern.addEventListener("input", () => {
      syncAddClientFormFromPattern();
    });
  }

  btnAddClient.addEventListener("click", () => {
    const pattern = normalizePattern(newClientPattern.value);
    if (!pattern) {
      showMsg("Enter a client name", "error");
      return;
    }

    const clients = currentDict.clients || [];
    const key = patternKey(pattern);
    let entry = findClientByKey(key);
    const isUpdate = !!entry;

    if (!entry) {
      entry = {
        pattern: pattern,
        defaultCategory: null,
        overrides: {},
        mentionCategory: null,
        aliases: [],
        includePatternInContent: true,
        note: ""
      };
      clients.push(entry);
      currentDict.clients = clients;
    }

    entry.pattern = pattern;
    entry.defaultCategory = newClientReview.value ? newClientReview.value : null;
    entry.overrides = {};
    entry.overrides.Image = newClientImage.value || null;
    entry.overrides.Profile = newClientProfile.value || null;
    entry.overrides.Question = newClientQuestion.value || null;
    if (newClientComment) {
      entry.overrides.Comment = newClientComment.value || null;
    }
    entry.mentionCategory = (newClientMentionCategory && newClientMentionCategory.value)
      ? newClientMentionCategory.value
      : null;
    entry.aliases = newClientAliases ? normalizeAliasesFromTextarea(newClientAliases.value) : [];
    entry.includePatternInContent = newClientIncludePatternInContent
      ? !!newClientIncludePatternInContent.checked
      : true;
    entry.note = newClientNote ? (newClientNote.value || "").trim() : "";

    ensureClientsSorted();
    openClientKey = patternKey(pattern);

    saveDictionary((isUpdate ? 'Updated client "' : 'Added client "') + pattern + '"');
    renderClients();
  });

  // ---------------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------------
  function renderCategories() {
    catEditorsEl.innerHTML = "";
    if (!currentDict.categories) return;

    // ── Ignore List — rendered as the first (top) category card ──────────────
    (function() {
      const igEditor = document.createElement("div");
      igEditor.className = "cat-editor";

      const igHeader = document.createElement("div");
      igHeader.className = "cat-header";

      const igArrow = document.createElement("span");
      igArrow.className = "cat-arrow";
      igArrow.textContent = "\u25b6";
      const igDragHandle = document.createElement("span");
      igDragHandle.className = "cat-drag-handle";
      igDragHandle.textContent = "\u22EE\u22EE";
      igHeader.appendChild(igDragHandle);

      igHeader.appendChild(igArrow);

      const igSwatch = document.createElement("span");
      igSwatch.style.display = "inline-block";
      igSwatch.style.width = "14px";
      igSwatch.style.height = "14px";
      igSwatch.style.borderRadius = "3px";
      igSwatch.style.backgroundColor = "#d1d5db";
      igSwatch.style.border = "1px solid rgba(0,0,0,0.2)";
      igHeader.appendChild(igSwatch);

      const igNameSpan = document.createElement("span");
      igNameSpan.className = "cat-header-name";
      igNameSpan.textContent = "Ignore List";
      igHeader.appendChild(igNameSpan);

      const igCountSpan = document.createElement("span");
      igCountSpan.className = "cat-header-count";
      const igWords = currentDict.ignoreList || [];
      igCountSpan.textContent = igWords.length + " words";
      igHeader.appendChild(igCountSpan);

      igEditor.appendChild(igHeader);

      const igBody = document.createElement("div");
      igBody.className = "cat-body";

      const igDesc = document.createElement("p");
      igDesc.style.fontSize = "11px";
      igDesc.style.color = "#999";
      igDesc.style.marginBottom = "6px";
      igDesc.textContent = "Words here block highlights from all categories. One per line. Wildcards (* ?) work.";
      igBody.appendChild(igDesc);

      const igArea = document.createElement("textarea");
      igArea.className = "word-list";
      igArea.style.minHeight = "250px";
      igArea.spellcheck = false;
      igArea.value = igWords.join("\n");
      igBody.appendChild(igArea);

      const igSaveRow = document.createElement("div");
      igSaveRow.style.marginTop = "10px";
      const igSaveBtn = document.createElement("button");
      igSaveBtn.className = "primary";
      igSaveBtn.textContent = "Save Ignore List";
      igSaveBtn.addEventListener("click", () => {
        const lines = igArea.value.split("\n").map(l => l.trim()).filter(l => l.length > 0);
        currentDict.ignoreList = lines;
        igCountSpan.textContent = lines.length + " words";
        saveDictionary("Ignore list saved (" + lines.length + " words)");
      });
      igSaveRow.appendChild(igSaveBtn);
      igBody.appendChild(igSaveRow);

      igHeader.addEventListener("click", () => {
        const isOpen = igBody.classList.contains("open");
        document.querySelectorAll(".cat-body").forEach(b => b.classList.remove("open"));
        document.querySelectorAll(".cat-arrow").forEach(a => a.classList.remove("open"));
        if (!isOpen) {
          igBody.classList.add("open");
          igArrow.classList.add("open");
        }
      });

      igEditor.appendChild(igBody);
      catEditorsEl.appendChild(igEditor);
    })();
    // ─────────────────────────────────────────────────────────────────────────

    currentDict.categories.forEach((cat, index) => {
      const editor = document.createElement("div");
      editor.className = "cat-editor";

      // Header
      const header = document.createElement("div");
      header.className = "cat-header";

      const catDragHandle = document.createElement("span");
      catDragHandle.className = "cat-drag-handle";
      catDragHandle.textContent = "\u22EE\u22EE";
      header.appendChild(catDragHandle);

      const arrow = document.createElement("span");
      arrow.className = "cat-arrow";
      arrow.textContent = "\u25b6";
      header.appendChild(arrow);

      const colorPrev = document.createElement("span");
      colorPrev.style.display = "inline-block";
      colorPrev.style.width = "14px";
      colorPrev.style.height = "14px";
      colorPrev.style.borderRadius = "3px";
      colorPrev.style.backgroundColor = cat.color || "#FFFF00";
      colorPrev.style.border = "1px solid rgba(0,0,0,0.2)";
      header.appendChild(colorPrev);

      const nameSpan = document.createElement("span");
      nameSpan.className = "cat-header-name";
      nameSpan.textContent = cat.name || "";
      header.appendChild(nameSpan);

      const countSpan = document.createElement("span");
      countSpan.className = "cat-header-count";
      countSpan.textContent = (cat.words ? cat.words.length : 0) + " words";
      header.appendChild(countSpan);

      const enabledLabel = document.createElement("label");
      enabledLabel.style.marginLeft = "8px";
      enabledLabel.addEventListener("click", (e) => e.stopPropagation());
      const enabledCb = document.createElement("input");
      enabledCb.type = "checkbox";
      enabledCb.checked = cat.enabled !== false;
      enabledCb.addEventListener("change", () => {
        cat.enabled = enabledCb.checked;
        saveDictionary();
      });
      enabledLabel.appendChild(enabledCb);
      enabledLabel.appendChild(document.createTextNode(" On"));
      header.appendChild(enabledLabel);

      editor.appendChild(header);

      // Body
      const body = document.createElement("div");
      body.className = "cat-body";

      // Sanitise colour values before injecting into HTML — only allow valid
      // CSS hex colours (#xxx or #xxxxxx) to prevent attribute injection.
      const safeHexColor = (v, fallback) =>
        /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(v) ? v : fallback;
      const safeBg = safeHexColor(cat.color, "#FFFF00");
      const safeFg = safeHexColor(cat.fColor, "#FFFFFF");

      const colorRow = document.createElement("div");
      colorRow.className = "color-picker-row";
      colorRow.innerHTML =
        "<label>BG Color:</label>" +
        '<input type="color" class="bg-color" value="' + safeBg + '">' +
        "<label>Text Color:</label>" +
        '<input type="color" class="fg-color" value="' + safeFg + '">' +
        '<span class="preview" style="padding:2px 8px; border-radius:3px; background:' + safeBg + "; color:" + safeFg + '">Preview</span>';

      body.appendChild(colorRow);

      const bgInput = colorRow.querySelector(".bg-color");
      const fgInput = colorRow.querySelector(".fg-color");
      const preview = colorRow.querySelector(".preview");

      // Update local preview while dragging - no save/re-render on every pixel
      bgInput.addEventListener("input", () => {
        colorPrev.style.backgroundColor = bgInput.value;
        preview.style.background = bgInput.value;
      });
      // Persist and refresh client swatches only when picker is released
      bgInput.addEventListener("change", () => {
        cat.color = bgInput.value;
        saveDictionary();
        renderClients();
      });

      fgInput.addEventListener("input", () => {
        preview.style.color = fgInput.value;
      });
      fgInput.addEventListener("change", () => {
        cat.fColor = fgInput.value;
        saveDictionary();
        renderClients();
      });

      const nameRow = document.createElement("div");
      nameRow.className = "row";
      nameRow.innerHTML = "<label>Name:</label>";
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.value = cat.name || "";
      nameInput.addEventListener("change", () => {
        cat.name = nameInput.value;
        nameSpan.textContent = nameInput.value;
        saveDictionary();
        renderClients(); // refresh dropdowns and swatches
      });
      nameRow.appendChild(nameInput);
      body.appendChild(nameRow);

      const wordLabel = document.createElement("h3");
      wordLabel.textContent = "Words (one per line):";
      body.appendChild(wordLabel);

      const helpText = document.createElement("p");
      helpText.style.fontSize = "11px";
      helpText.style.color = "#999";
      helpText.style.marginBottom = "6px";
      helpText.textContent = "Prefix with // for exact match, CS: for case-sensitive. Wildcards: * (any chars), ? (one char).";
      body.appendChild(helpText);

      const wordArea = document.createElement("textarea");
      wordArea.className = "word-list";
      wordArea.spellcheck = false;
      wordArea.value = (cat.words || []).join("\n");
      body.appendChild(wordArea);

      const addRow = document.createElement("div");
      addRow.className = "add-word-row";

      const addInput = document.createElement("input");
      addInput.type = "text";
      addInput.placeholder = "Quick add a word (Enter to add)";

      const addExactCb = document.createElement("input");
      addExactCb.type = "checkbox";
      addExactCb.id = "exact-" + index;

      const addExactLabel = document.createElement("label");
      addExactLabel.htmlFor = "exact-" + index;
      addExactLabel.textContent = " Exact";
      addExactLabel.style.fontSize = "12px";

      addInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && addInput.value.trim()) {
          let word = addInput.value.trim();
          if (addExactCb.checked && !word.startsWith("//")) {
            word = "//" + word;
          }
          if (!Array.isArray(cat.words)) cat.words = [];
          insertAlphabetically(cat.words, word);
          wordArea.value = cat.words.join("\n");
          countSpan.textContent = cat.words.length + " words";
          addInput.value = "";
          saveDictionary('Added "' + word + '" to ' + (cat.name || "category"));
        }
      });

      addRow.appendChild(addInput);
      addRow.appendChild(addExactCb);
      addRow.appendChild(addExactLabel);
      body.appendChild(addRow);

      const saveRow = document.createElement("div");
      saveRow.style.marginTop = "10px";
      saveRow.style.display = "flex";
      saveRow.style.gap = "8px";

      const saveBtn = document.createElement("button");
      saveBtn.className = "primary";
      saveBtn.textContent = "Save Words";
      saveBtn.addEventListener("click", () => {
        const lines = wordArea.value.split("\n").map(l => l.trim()).filter(l => l.length > 0);
        cat.words = lines;
        countSpan.textContent = lines.length + " words";
        saveDictionary((cat.name || "Category") + ": saved " + lines.length + " words");
      });
      saveRow.appendChild(saveBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "danger";
      deleteBtn.textContent = "Delete Category";
      deleteBtn.addEventListener("click", () => {
        const nm = cat.name || "";
        const n = (cat.words && cat.words.length) ? cat.words.length : 0;
        if (confirm('Delete "' + nm + '" and all its ' + n + " words?")) {
          currentDict.categories.splice(index, 1);
          saveDictionary('Deleted "' + nm + '"');
          renderCategories();
          renderClients();
        }
      });
      saveRow.appendChild(deleteBtn);

      body.appendChild(saveRow);
      editor.appendChild(body);

      header.addEventListener("click", () => {
        const isOpen = body.classList.contains("open");
        document.querySelectorAll(".cat-body").forEach(b => b.classList.remove("open"));
        document.querySelectorAll(".cat-arrow").forEach(a => a.classList.remove("open"));
        if (!isOpen) {
          body.classList.add("open");
          arrow.classList.add("open");
        }
      });

      catEditorsEl.appendChild(editor);
    });
  }

  btnAddCat.addEventListener("click", () => {
    const name = (newCatName.value || "").trim();
    if (!name) {
      showMsg("Enter a category name", "error");
      return;
    }

    currentDict.categories.push({
      id: "cat_" + Date.now(),
      name: name,
      color: newCatColor.value,
      fColor: "#FFFFFF",
      enabled: true,
      words: []
    });

    newCatName.value = "";
    saveDictionary('Added category "' + name + '"');
    renderCategories();
    renderClients();
  });

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  btnExport.addEventListener("click", () => {
    chrome.storage.local.get(["dictionary"], (result) => {
      const data = JSON.stringify(result.dictionary || {}, null, 2);
      const blob = new Blob([data], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = "cms-highlighter-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      URL.revokeObjectURL(url);
      showMsg("Dictionary exported", "success");
    });
  });

  // ---------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------
  btnImportHT.addEventListener("click", () => {
    importMode = "ht";
    importFileEl.click();
  });

  btnImportJSON.addEventListener("click", () => {
    importMode = "json";
    importFileEl.click();
  });

  importFileEl.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const MAX_IMPORT_BYTES = 10 * 1024 * 1024; // 10 MB guard
    if (file.size > MAX_IMPORT_BYTES) {
      showMsg("File too large to import (max 10 MB)", "error");
      importFileEl.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);

        if (importMode === "json") {
          importCMSJSON(data);
        } else {
          importHighlightThis(data);
        }
      } catch (err) {
        showMsg("Invalid JSON file: " + err.message, "error");
      }
      importFileEl.value = "";
    };
    reader.readAsText(file);
  });

  function importCMSJSON(data) {
    if (!data.categories || !Array.isArray(data.categories)) {
      showMsg("Not a valid CMS Highlighter dictionary", "error");
      return;
    }

    if (!Array.isArray(data.ignoreList)) data.ignoreList = [];
    if (!Array.isArray(data.clients)) data.clients = [];

    currentDict = data;
    openClientKey = null;
    saveDictionary("Imported " + data.categories.length + " categories, " + data.clients.length + " clients");
    renderIgnoreList();
    renderClients();
    renderCategories();
  }

  function importHighlightThis(backup) {
    if (!backup.groups || !backup.order || !Array.isArray(backup.order)) {
      showMsg("Not a valid HighlightThis backup (missing groups/order)", "error");
      return;
    }

    const dict = { ignoreList: [], categories: [], clients: [] };
    let totalWords = 0;

    for (const id of backup.order) {
      const group = backup.groups[id];
      if (!group) continue;
      if (!group.enabled) continue;

      const words = (group.words || [])
        .map(w => String(w || "").replace(/[\n\r]+$/g, "").replace(/^[\n\r]+/, ""))
        .filter(w => w.length > 0)
        .map(w => group.findWords ? "//" + w : w);

      totalWords += words.length;

      if (group.name === "Unhighlight") {
        dict.ignoreList = words;
        continue;
      }

      dict.categories.push({
        id: id,
        name: group.name,
        color: group.color || "#FFFF00",
        fColor: group.fColor || "#FFFFFF",
        enabled: true,
        words: words
      });
    }

    currentDict = dict;
    openClientKey = null;
    saveDictionary("Imported HighlightThis backup: " + dict.categories.length + " categories, " + totalWords + " words");
    renderIgnoreList();
    renderClients();
    renderCategories();
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  load();

})();
