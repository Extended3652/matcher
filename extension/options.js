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
  const ignoreArea    = document.getElementById("ignoreListArea");
  const ignoreCount   = document.getElementById("ignoreCount");
  const catEditorsEl  = document.getElementById("catEditors");
  const btnSaveIgnore = document.getElementById("btnSaveIgnore");
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

  // Newer "Mentions" fields
  const newClientMentionCategory = document.getElementById("newClientMentionCategory");
  const newClientAliases = document.getElementById("newClientAliases");
  const newClientIncludePatternInContent = document.getElementById("newClientIncludePatternInContent");
  const newClientNote = document.getElementById("newClientNote");

  // Clear / Save / Detected client
  const btnClearClient = document.getElementById("btnClearClient");
  const btnSaveClients = document.getElementById("btnSaveClients");
  const detectedBanner = document.getElementById("detectedClientBanner");
  const detectedNameEl = document.getElementById("detectedClientName");
  const btnUseDetected = document.getElementById("btnUseDetectedClient");

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let currentDict = null;
  let importMode  = null; // "ht" or "json"
  let openClientKey = null; // keeps one client expanded

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

  function normalizeAliasesFromTextarea(txt) {
    return String(txt || "")
      .split("\n")
      .map(s => String(s).trim())
      .filter(s => s.length > 0);
  }

  function sortKey(raw) {
    return safeStr(raw).replace(/^(CS:)?(\/\/)?/, "").toLowerCase();
  }

  function insertAlphabetically(arr, word) {
    const key = sortKey(word);
    let i = 0;
    while (i < arr.length && sortKey(arr[i]) < key) i++;
    arr.splice(i, 0, word);
  }

  function normalizePattern(p) {
    return safeStr(p).trim();
  }

  function globToRegex(pattern) {
    const p = safeStr(pattern).trim();
    if (!p) return null;
    const escaped = p.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const rx = "^" + escaped.replace(/\*/g, ".*").replace(/\?/g, ".") + "$";
    try { return new RegExp(rx, "i"); } catch (e) { return null; }
  }

  function patternKey(p) {
    return normalizePattern(p).toLowerCase();
  }

  function getCategoryNames() {
    if (!currentDict || !Array.isArray(currentDict.categories)) return [];
    return currentDict.categories.map(c => c && c.name).filter(Boolean);
  }

  function getCategoryStyleByName() {
    const map = new Map();
    if (!currentDict || !Array.isArray(currentDict.categories)) return map;
    for (const c of currentDict.categories) {
      if (!c || !c.name) continue;
      map.set(c.name, { color: c.color || "#FFFF00", fColor: c.fColor || "#FFFFFF" });
    }
    return map;
  }

  function applySelectVisualForCategory(sel) {
    const v = sel.value;
    if (!v) {
      sel.style.backgroundColor = "";
      sel.style.color = "";
      sel.style.borderColor = "";
      return;
    }
    const st = getCategoryStyleByName().get(v);
    if (!st) {
      sel.style.backgroundColor = "";
      sel.style.color = "";
      sel.style.borderColor = "";
      return;
    }
    sel.style.backgroundColor = st.color || "";
    sel.style.color = st.fColor || "";
    sel.style.borderColor = "rgba(0,0,0,0.25)";
  }

  function makeCategorySelect(opts) {
    // opts:
    // - mode: "review" or "override"
    // - value: current value (string or null)
    // review: includes "(no highlight)" + categories
    // override: includes "-" (inherit) + categories
    const sel = document.createElement("select");

    function makeOption(value, label, st) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;

      // Some Chrome builds will apply these option styles, some will not.
      // Even if options do not style, the select styling still gives you color context.
      if (st && value) {
        opt.style.backgroundColor = st.color || "";
        opt.style.color = st.fColor || "";
      }
      return opt;
    }

    if (opts.mode === "override") {
      sel.appendChild(makeOption("", "-", null));
    } else {
      sel.appendChild(makeOption("", "(no highlight)", null));
    }

    const stMap = getCategoryStyleByName();
    for (const name of getCategoryNames()) {
      sel.appendChild(makeOption(name, name, stMap.get(name) || null));
    }

    sel.value = opts.value || "";
    applySelectVisualForCategory(sel);
    sel.addEventListener("change", () => applySelectVisualForCategory(sel));

    return sel;
  }

  function formatSummary(entry) {
    const def = entry.defaultCategory ? entry.defaultCategory : "-";
    const o = entry.overrides || {};
    const img = o.Image ? o.Image : "-";
    const pro = o.Profile ? o.Profile : "-";
    const q = o.Question ? o.Question : "-";

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

    return "Review: " + def + " | Img: " + img + " | Pro: " + pro + " | Q: " + q + extra;
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

      renderIgnoreList();
      renderClients();
      renderCategories();
    });
  }

  function saveDictionary(msg) {
    chrome.storage.local.set({ dictionary: currentDict }, () => {
      if (msg) showMsg(msg, "success");
    });
  }

  // ---------------------------------------------------------------------------
  // Ignore List
  // ---------------------------------------------------------------------------
  function renderIgnoreList() {
    const words = currentDict.ignoreList || [];
    ignoreArea.value = words.join("\n");
    ignoreCount.textContent = "(" + words.length + " words)";
  }

  btnSaveIgnore.addEventListener("click", () => {
    const lines = ignoreArea.value.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    currentDict.ignoreList = lines;
    saveDictionary("Ignore list saved (" + lines.length + " words)");
    ignoreCount.textContent = "(" + lines.length + " words)";
  });

  // ---------------------------------------------------------------------------
  // Clients
  // ---------------------------------------------------------------------------
  function populateAddClientDropdowns() {
    // We build temp <select>s so we inherit the same options + styling logic
    // then move options into the real DOM selects.
    newClientReview.innerHTML = "";
    newClientImage.innerHTML = "";
    newClientProfile.innerHTML = "";
    newClientQuestion.innerHTML = "";

    const reviewSel = makeCategorySelect({ mode: "review", value: "" });
    const imgSel = makeCategorySelect({ mode: "override", value: "" });
    const proSel = makeCategorySelect({ mode: "override", value: "" });
    const qSel = makeCategorySelect({ mode: "override", value: "" });

    while (reviewSel.firstChild) newClientReview.appendChild(reviewSel.firstChild);
    while (imgSel.firstChild) newClientImage.appendChild(imgSel.firstChild);
    while (proSel.firstChild) newClientProfile.appendChild(proSel.firstChild);
    while (qSel.firstChild) newClientQuestion.appendChild(qSel.firstChild);

    newClientReview.value = "";
    newClientImage.value = "";
    newClientProfile.value = "";
    newClientQuestion.value = "";

    // Mentions category select, if present in HTML
    if (newClientMentionCategory) {
      newClientMentionCategory.innerHTML = "";
      const mentionSel = makeCategorySelect({ mode: "override", value: "" });
      while (mentionSel.firstChild) newClientMentionCategory.appendChild(mentionSel.firstChild);
      newClientMentionCategory.value = "";
    }

    // Apply visual styling to real form selects (temp selects' handlers don't transfer)
    [newClientReview, newClientImage, newClientProfile, newClientQuestion, newClientMentionCategory]
      .filter(Boolean)
      .forEach(sel => applySelectVisualForCategory(sel));
  }

  function getClientFilter() {
    return safeStr(clientSearchEl.value).trim().toLowerCase();
  }

  function filteredClients() {
    const all = currentDict.clients || [];
    const f = getClientFilter();
    if (!f) return all.slice();

    return all.filter(c => {
      const p = safeStr(c && c.pattern).toLowerCase();
      if (p.includes(f)) return true;

      const note = safeStr(c && c.note).toLowerCase();
      if (note.includes(f)) return true;

      const aliases = Array.isArray(c && c.aliases) ? c.aliases : [];
      for (const a of aliases) {
        if (safeStr(a).toLowerCase().includes(f)) return true;
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

    ensureClientsSorted();

    const all = currentDict.clients || [];
    const list = filteredClients();

    clientCountEl.textContent = "(" + all.length + " entries)";
    clientShowingEl.textContent = (list.length === all.length)
      ? ("Showing " + list.length)
      : ("Showing " + list.length + " of " + all.length);

    populateAddClientDropdowns();

    clientListBodyEl.innerHTML = "";

    if (all.length === 0) {
      const div = document.createElement("div");
      div.style.padding = "12px";
      div.style.color = "#888";
      div.textContent = "No client entries yet. Add one above.";
      clientListBodyEl.appendChild(div);
      return;
    }

    if (list.length === 0) {
      const div = document.createElement("div");
      div.style.padding = "12px";
      div.style.color = "#888";
      div.textContent = "No matches. Clear the search box to see all clients.";
      clientListBodyEl.appendChild(div);
      return;
    }

    const styleByName = getCategoryStyleByName();

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
      summary.textContent = formatSummary(entry);
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
      lReview.textContent = "Default";
      const sReview = makeCategorySelect({ mode: "review", value: entry.defaultCategory || "" });
      fReview.appendChild(lReview);
      fReview.appendChild(sReview);
      grid.appendChild(fReview);

      const overrideSep = document.createElement("div");
      overrideSep.style.gridColumn = "1 / -1";
      overrideSep.style.borderTop = "1px solid #e5e5e5";
      overrideSep.style.paddingTop = "6px";
      overrideSep.style.marginTop = "2px";
      overrideSep.innerHTML = '<span style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.5px;">Overrides</span>';
      grid.appendChild(overrideSep);

      const fImg = document.createElement("div");
      fImg.className = "field";
      const lImg = document.createElement("label");
      lImg.textContent = "Image";
      const sImg = makeCategorySelect({ mode: "override", value: (entry.overrides && entry.overrides.Image) || "" });
      fImg.appendChild(lImg);
      fImg.appendChild(sImg);
      grid.appendChild(fImg);

      const fPro = document.createElement("div");
      fPro.className = "field";
      const lPro = document.createElement("label");
      lPro.textContent = "Profile";
      const sPro = makeCategorySelect({ mode: "override", value: (entry.overrides && entry.overrides.Profile) || "" });
      fPro.appendChild(lPro);
      fPro.appendChild(sPro);
      grid.appendChild(fPro);

      const fQ = document.createElement("div");
      fQ.className = "field";
      const lQ = document.createElement("label");
      lQ.textContent = "Question";
      const sQ = makeCategorySelect({ mode: "override", value: (entry.overrides && entry.overrides.Question) || "" });
      fQ.appendChild(lQ);
      fQ.appendChild(sQ);
      grid.appendChild(fQ);

      body.appendChild(grid);

      // Mentions editor block
      const mentionsWrap = document.createElement("div");
      mentionsWrap.style.borderTop = "1px solid #e5e5e5";
      mentionsWrap.style.paddingTop = "8px";
      mentionsWrap.style.marginTop = "8px";

      const mentionHeader = document.createElement("div");
      mentionHeader.innerHTML = '<span style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.5px;">Mentions</span>';
      mentionHeader.style.marginBottom = "8px";
      mentionsWrap.appendChild(mentionHeader);

      const mGrid = document.createElement("div");
      mGrid.className = "client-edit-grid";

      const fMCat = document.createElement("div");
      fMCat.className = "field";
      const lMCat = document.createElement("label");
      lMCat.textContent = "Mentions: Category";
      const sMCat = makeCategorySelect({ mode: "override", value: entry.mentionCategory || "" });
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
        summary.textContent = formatSummary(entry);

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

      sMCat.addEventListener("change", () => {
        entry.mentionCategory = sMCat.value ? sMCat.value : null;
        saveDictionary();
        summary.textContent = formatSummary(entry);
      });

      tAliases.addEventListener("change", () => {
        entry.aliases = normalizeAliasesFromTextarea(tAliases.value);
        saveDictionary();
        summary.textContent = formatSummary(entry);
      });

      cbInc.addEventListener("change", () => {
        entry.includePatternInContent = !!cbInc.checked;
        saveDictionary();
        summary.textContent = formatSummary(entry);
      });

      iNote.addEventListener("change", () => {
        entry.note = (iNote.value || "").trim();
        saveDictionary();
        summary.textContent = formatSummary(entry);
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

  clientSearchEl.addEventListener("input", () => {
    renderClients();
  });

  btnAddClient.addEventListener("click", () => {
    const pattern = normalizePattern(newClientPattern.value);
    if (!pattern) {
      showMsg("Enter a client name", "error");
      return;
    }

    const clients = currentDict.clients || [];
    const key = patternKey(pattern);
    const exists = clients.some(c => patternKey(c.pattern) === key);
    if (exists) {
      showMsg('Client "' + pattern + '" already exists', "error");
      return;
    }

    const entry = {
      pattern: pattern,
      defaultCategory: newClientReview.value ? newClientReview.value : null,
      overrides: {},
      mentionCategory: (newClientMentionCategory && newClientMentionCategory.value) ? newClientMentionCategory.value : null,
      aliases: newClientAliases ? normalizeAliasesFromTextarea(newClientAliases.value) : [],
      includePatternInContent: newClientIncludePatternInContent ? !!newClientIncludePatternInContent.checked : true,
      note: newClientNote ? (newClientNote.value || "").trim() : ""
    };

    if (newClientImage.value) entry.overrides.Image = newClientImage.value;
    if (newClientProfile.value) entry.overrides.Profile = newClientProfile.value;
    if (newClientQuestion.value) entry.overrides.Question = newClientQuestion.value;

    clients.push(entry);
    currentDict.clients = clients;
    ensureClientsSorted();

    newClientPattern.value = "";
    newClientReview.value = "";
    newClientImage.value = "";
    newClientProfile.value = "";
    newClientQuestion.value = "";

    if (newClientMentionCategory) newClientMentionCategory.value = "";
    if (newClientAliases) newClientAliases.value = "";
    if (newClientIncludePatternInContent) newClientIncludePatternInContent.checked = true;
    if (newClientNote) newClientNote.value = "";

    openClientKey = patternKey(pattern);

    saveDictionary('Added client "' + pattern + '"');
    renderClients();
  });

  // ---------------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------------
  function renderCategories() {
    catEditorsEl.innerHTML = "";
    if (!currentDict.categories) return;

    currentDict.categories.forEach((cat, index) => {
      const editor = document.createElement("div");
      editor.className = "cat-editor";

      // Header
      const header = document.createElement("div");
      header.className = "cat-header";

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

      const colorRow = document.createElement("div");
      colorRow.className = "color-picker-row";
      colorRow.innerHTML =
        "<label>BG Color:</label>" +
        '<input type="color" class="bg-color" value="' + (cat.color || "#FFFF00") + '">' +
        "<label>Text Color:</label>" +
        '<input type="color" class="fg-color" value="' + (cat.fColor || "#FFFFFF") + '">' +
        '<span class="preview" style="padding:2px 8px; border-radius:3px; background:' + (cat.color || "#FFFF00") + "; color:" + (cat.fColor || "#FFFFFF") + '">Preview</span>';

      body.appendChild(colorRow);

      const bgInput = colorRow.querySelector(".bg-color");
      const fgInput = colorRow.querySelector(".fg-color");
      const preview = colorRow.querySelector(".preview");

      bgInput.addEventListener("input", () => {
        cat.color = bgInput.value;
        colorPrev.style.backgroundColor = bgInput.value;
        preview.style.background = bgInput.value;
        saveDictionary();
        renderClients(); // update client swatches + dropdown styling
      });

      fgInput.addEventListener("input", () => {
        cat.fColor = fgInput.value;
        preview.style.color = fgInput.value;
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
  // Clear / Save client form
  // ---------------------------------------------------------------------------
  function clearClientForm() {
    if (newClientPattern) newClientPattern.value = "";
    if (newClientReview) newClientReview.value = "";
    if (newClientImage) newClientImage.value = "";
    if (newClientProfile) newClientProfile.value = "";
    if (newClientQuestion) newClientQuestion.value = "";
    if (newClientMentionCategory) newClientMentionCategory.value = "";
    if (newClientAliases) newClientAliases.value = "";
    if (newClientIncludePatternInContent) newClientIncludePatternInContent.checked = true;
    if (newClientNote) newClientNote.value = "";

    [newClientReview, newClientImage, newClientProfile, newClientQuestion, newClientMentionCategory]
      .filter(Boolean)
      .forEach(sel => applySelectVisualForCategory(sel));
  }

  if (btnClearClient) {
    btnClearClient.addEventListener("click", clearClientForm);
  }

  if (btnSaveClients) {
    btnSaveClients.addEventListener("click", () => {
      saveDictionary("Clients saved (" + (currentDict.clients || []).length + " entries)");
    });
  }

  // ---------------------------------------------------------------------------
  // Detect current CMS client from open tabs
  // ---------------------------------------------------------------------------
  let detectedClient = null;

  function detectCurrentClient() {
    if (!chrome.tabs) return;

    chrome.tabs.query({}, (tabs) => {
      if (!tabs || tabs.length === 0) return;

      let found = false;
      for (const tab of tabs) {
        if (found) break;
        try {
          chrome.tabs.sendMessage(tab.id, { action: "getClientName" }, (response) => {
            if (chrome.runtime.lastError) return;
            if (found) return;
            if (response && response.clientName) {
              found = true;
              detectedClient = response.clientName;
              onClientDetected(response.clientName);
            }
          });
        } catch (e) {
          // tab doesn't have content script
        }
      }
    });
  }

  function onClientDetected(clientName) {
    if (detectedBanner && detectedNameEl) {
      detectedNameEl.textContent = clientName;
      detectedBanner.style.display = "flex";
    }

    // Pre-fill pattern if form is empty
    if (newClientPattern && !newClientPattern.value) {
      newClientPattern.value = clientName;
    }

    // Auto-expand matching client in the list
    if (currentDict) {
      const match = (currentDict.clients || []).find(c => {
        const rx = globToRegex(c.pattern);
        return rx && rx.test(clientName);
      });
      if (match) {
        openClientKey = patternKey(match.pattern);
        renderClients();
      }
    }
  }

  if (btnUseDetected) {
    btnUseDetected.addEventListener("click", () => {
      if (detectedClient && newClientPattern) {
        newClientPattern.value = detectedClient;
        newClientPattern.focus();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  // One-time change handlers for "Add client" form selects (visual styling)
  [newClientReview, newClientImage, newClientProfile, newClientQuestion, newClientMentionCategory]
    .filter(Boolean)
    .forEach(sel => sel.addEventListener("change", () => applySelectVisualForCategory(sel)));

  load();

  // Detect CMS client after dictionary loads (small delay to let storage callback finish)
  setTimeout(detectCurrentClient, 300);

})();
