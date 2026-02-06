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

  // Newer "Mentions" fields (must exist in options.html)
  const newClientMentionCategory = document.getElementById("newClientMentionCategory");
  const newClientAliases = document.getElementById("newClientAliases");
  const newClientIncludePatternInContent = document.getElementById("newClientIncludePatternInContent");
  const newClientNote = document.getElementById("newClientNote");

  // Client form state elements
  const clientFormTitle = document.getElementById("clientFormTitle");
  const clientExistsNotice = document.getElementById("clientExistsNotice");
  const btnClearClient = document.getElementById("btnClearClient");

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let currentDict = null;
  let importMode  = null; // "ht" or "json"
  let openClientKey = null; // keeps one client expanded
  let editingClientKey = null; // key of client being edited (null = adding new)
  let cmsClientName = null; // current client name from CMS

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
      map.set(c.name, { color: c.color || "#FFFF00", fColor: c.fColor || "#000000" });
    }
    return map;
  }

  function makeCategorySelect(opts) {
    // opts:
    // - mode: "review" or "override"
    // - value: current value (string or null)
    // review: includes "(no highlight)" + categories
    // override: includes "-" (inherit) + categories
    const sel = document.createElement("select");

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
      const st = getCategoryStyleByName().get(v);
      if (!st) {
        resetSelectVisual();
        return;
      }
      sel.style.backgroundColor = st.color || "";
      sel.style.color = st.fColor || "";
      sel.style.borderColor = "rgba(0,0,0,0.25)";
    }

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

    return "Def: " + def + " | Img: " + img + " | Pro: " + pro + " | Q: " + q + extra;
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
  // Client Form Management
  // ---------------------------------------------------------------------------
  function findClientByKey(key) {
    if (!key || !currentDict || !currentDict.clients) return null;
    return currentDict.clients.find(c => patternKey(c.pattern) === key) || null;
  }

  function loadClientIntoForm(entry) {
    if (!entry) return;

    newClientPattern.value = safeStr(entry.pattern);
    newClientReview.value = entry.defaultCategory || "";
    newClientImage.value = (entry.overrides && entry.overrides.Image) || "";
    newClientProfile.value = (entry.overrides && entry.overrides.Profile) || "";
    newClientQuestion.value = (entry.overrides && entry.overrides.Question) || "";

    if (newClientMentionCategory) newClientMentionCategory.value = entry.mentionCategory || "";
    if (newClientAliases) newClientAliases.value = Array.isArray(entry.aliases) ? entry.aliases.join("\n") : "";
    if (newClientIncludePatternInContent) newClientIncludePatternInContent.checked = entry.includePatternInContent !== false;
    if (newClientNote) newClientNote.value = entry.note || "";

    editingClientKey = patternKey(entry.pattern);
    updateClientFormUI();
  }

  function clearClientForm() {
    newClientPattern.value = "";
    newClientReview.value = "";
    newClientImage.value = "";
    newClientProfile.value = "";
    newClientQuestion.value = "";

    if (newClientMentionCategory) newClientMentionCategory.value = "";
    if (newClientAliases) newClientAliases.value = "";
    if (newClientIncludePatternInContent) newClientIncludePatternInContent.checked = true;
    if (newClientNote) newClientNote.value = "";

    editingClientKey = null;
    updateClientFormUI();
  }

  function updateClientFormUI() {
    const isEditing = editingClientKey !== null;
    clientFormTitle.textContent = isEditing ? "Edit Client" : "Add Client";
    clientExistsNotice.style.display = isEditing ? "block" : "none";
    btnClearClient.style.display = isEditing ? "inline-block" : "none";
    btnAddClient.textContent = isEditing ? "Save Changes" : "Add Client";
  }

  function getCmsClientFromTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;

      chrome.tabs.sendMessage(tabs[0].id, { action: "getClientName" }, (response) => {
        if (chrome.runtime.lastError || !response || !response.clientName) {
          cmsClientName = null;
          return;
        }
        cmsClientName = response.clientName;

        // Auto-populate form if we have a CMS client
        if (cmsClientName && currentDict) {
          const existing = findClientByKey(patternKey(cmsClientName));
          if (existing) {
            loadClientIntoForm(existing);
          } else {
            newClientPattern.value = cmsClientName;
            editingClientKey = null;
            updateClientFormUI();
          }
        }
      });
    });
  }

  // Handle pattern input changes to check if client exists
  newClientPattern.addEventListener("input", () => {
    const pattern = normalizePattern(newClientPattern.value);
    if (!pattern) {
      editingClientKey = null;
      updateClientFormUI();
      return;
    }

    const key = patternKey(pattern);
    const existing = findClientByKey(key);
    if (existing && editingClientKey !== key) {
      loadClientIntoForm(existing);
    } else if (!existing && editingClientKey !== null) {
      editingClientKey = null;
      updateClientFormUI();
    }
  });

  btnClearClient.addEventListener("click", () => {
    clearClientForm();
  });

  // ---------------------------------------------------------------------------
  // Load / Save
  // ---------------------------------------------------------------------------
  function load() {
    chrome.storage.local.get(["dictionary"], (result) => {
      currentDict = result.dictionary || { ignoreList: [], categories: [], clients: [] };
      if (!Array.isArray(currentDict.ignoreList)) currentDict.ignoreList = [];
      if (!Array.isArray(currentDict.categories)) currentDict.categories = [];
      if (!Array.isArray(currentDict.clients)) currentDict.clients = [];

      renderClients();
      renderCategories();

      // Try to get current CMS client after loading
      getCmsClientFromTab();
    });
  }

  function saveDictionary(msg) {
    chrome.storage.local.set({ dictionary: currentDict }, () => {
      if (msg) showMsg(msg, "success");
    });
  }

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

      body.appendChild(grid);

      // Divider for overrides
      const divider = document.createElement("div");
      divider.className = "override-divider";
      divider.innerHTML = "<span>Content Type Overrides</span>";
      divider.style.cssText = "display:flex;align-items:center;margin:14px 0 10px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.5px;";
      const beforeLine = document.createElement("span");
      beforeLine.style.cssText = "flex:1;height:1px;background:#ddd;";
      const afterLine = document.createElement("span");
      afterLine.style.cssText = "flex:1;height:1px;background:#ddd;";
      const divText = document.createElement("span");
      divText.style.padding = "0 10px";
      divText.textContent = "Content Type Overrides";
      divider.innerHTML = "";
      divider.appendChild(beforeLine);
      divider.appendChild(divText);
      divider.appendChild(afterLine);
      body.appendChild(divider);

      const overrideGrid = document.createElement("div");
      overrideGrid.className = "client-edit-grid";

      const fImg = document.createElement("div");
      fImg.className = "field";
      const lImg = document.createElement("label");
      lImg.textContent = "Image";
      const sImg = makeCategorySelect({ mode: "override", value: (entry.overrides && entry.overrides.Image) || "" });
      fImg.appendChild(lImg);
      fImg.appendChild(sImg);
      overrideGrid.appendChild(fImg);

      const fPro = document.createElement("div");
      fPro.className = "field";
      const lPro = document.createElement("label");
      lPro.textContent = "Profile";
      const sPro = makeCategorySelect({ mode: "override", value: (entry.overrides && entry.overrides.Profile) || "" });
      fPro.appendChild(lPro);
      fPro.appendChild(sPro);
      overrideGrid.appendChild(fPro);

      const fQ = document.createElement("div");
      fQ.className = "field";
      const lQ = document.createElement("label");
      lQ.textContent = "Question";
      const sQ = makeCategorySelect({ mode: "override", value: (entry.overrides && entry.overrides.Question) || "" });
      fQ.appendChild(lQ);
      fQ.appendChild(sQ);
      overrideGrid.appendChild(fQ);

      body.appendChild(overrideGrid);

      // Mentions editor block (only if your HTML/CSS supports it visually, but functionally safe)
      const mentionsWrap = document.createElement("div");
      mentionsWrap.className = "client-mentions-wrap";

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
    const existingIdx = clients.findIndex(c => patternKey(c.pattern) === key);
    const isEditing = editingClientKey !== null;

    if (isEditing) {
      // Update existing client
      let entry;
      if (existingIdx >= 0) {
        entry = clients[existingIdx];
      } else {
        // Key changed - find by old key and update pattern
        const oldIdx = clients.findIndex(c => patternKey(c.pattern) === editingClientKey);
        if (oldIdx >= 0) {
          entry = clients[oldIdx];
          entry.pattern = pattern;
        } else {
          showMsg("Client not found", "error");
          return;
        }
      }

      entry.defaultCategory = newClientReview.value || null;
      entry.overrides = {};
      if (newClientImage.value) entry.overrides.Image = newClientImage.value;
      if (newClientProfile.value) entry.overrides.Profile = newClientProfile.value;
      if (newClientQuestion.value) entry.overrides.Question = newClientQuestion.value;
      entry.mentionCategory = (newClientMentionCategory && newClientMentionCategory.value) || null;
      entry.aliases = newClientAliases ? normalizeAliasesFromTextarea(newClientAliases.value) : [];
      entry.includePatternInContent = newClientIncludePatternInContent ? !!newClientIncludePatternInContent.checked : true;
      entry.note = newClientNote ? (newClientNote.value || "").trim() : "";

      ensureClientsSorted();
      saveDictionary('Updated client "' + pattern + '"');
      editingClientKey = patternKey(pattern);
      renderClients();

    } else {
      // Add new client
      if (existingIdx >= 0) {
        showMsg('Client "' + pattern + '" already exists', "error");
        return;
      }

      const entry = {
        pattern: pattern,
        defaultCategory: newClientReview.value || null,
        overrides: {},
        mentionCategory: (newClientMentionCategory && newClientMentionCategory.value) || null,
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

      clearClientForm();
      openClientKey = patternKey(pattern);

      saveDictionary('Added client "' + pattern + '"');
      renderClients();
    }
  });

  // ---------------------------------------------------------------------------
  // Ignore List (rendered as first category)
  // ---------------------------------------------------------------------------
  let ignoreListOpen = false;

  function renderIgnoreListCategory() {
    const words = currentDict.ignoreList || [];

    const editor = document.createElement("div");
    editor.className = "ignore-cat-editor";

    // Header
    const header = document.createElement("div");
    header.className = "ignore-cat-header";

    const arrow = document.createElement("span");
    arrow.className = "cat-arrow" + (ignoreListOpen ? " open" : "");
    arrow.textContent = "\u25b6";
    header.appendChild(arrow);

    const colorPrev = document.createElement("span");
    colorPrev.style.cssText = "display:inline-block;width:14px;height:14px;border-radius:3px;background:#d1d5db;border:1px solid rgba(0,0,0,0.2);";
    header.appendChild(colorPrev);

    const nameSpan = document.createElement("span");
    nameSpan.className = "cat-header-name";
    nameSpan.textContent = "Ignore List (global)";
    header.appendChild(nameSpan);

    const countSpan = document.createElement("span");
    countSpan.className = "cat-header-count";
    countSpan.textContent = words.length + " words";
    header.appendChild(countSpan);

    editor.appendChild(header);

    // Body
    const body = document.createElement("div");
    body.className = "cat-body" + (ignoreListOpen ? " open" : "");

    const helpText = document.createElement("p");
    helpText.style.cssText = "font-size:12px;color:#777;margin-bottom:8px;";
    helpText.textContent = "Words here block highlights from all categories. One per line. Wildcards (* ?) work.";
    body.appendChild(helpText);

    const wordArea = document.createElement("textarea");
    wordArea.className = "word-list";
    wordArea.spellcheck = false;
    wordArea.value = words.join("\n");
    body.appendChild(wordArea);

    const addRow = document.createElement("div");
    addRow.className = "add-word-row";

    const addInput = document.createElement("input");
    addInput.type = "text";
    addInput.placeholder = "Quick add (Enter to add)";

    addInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && addInput.value.trim()) {
        const word = addInput.value.trim();
        if (!Array.isArray(currentDict.ignoreList)) currentDict.ignoreList = [];
        insertAlphabetically(currentDict.ignoreList, word);
        wordArea.value = currentDict.ignoreList.join("\n");
        countSpan.textContent = currentDict.ignoreList.length + " words";
        addInput.value = "";
        saveDictionary('Added "' + word + '" to Ignore List');
      }
    });

    addRow.appendChild(addInput);
    body.appendChild(addRow);

    const saveRow = document.createElement("div");
    saveRow.style.marginTop = "10px";

    const saveBtn = document.createElement("button");
    saveBtn.className = "primary";
    saveBtn.textContent = "Save Ignore List";
    saveBtn.addEventListener("click", () => {
      const lines = wordArea.value.split("\n").map(l => l.trim()).filter(l => l.length > 0);
      currentDict.ignoreList = lines;
      countSpan.textContent = lines.length + " words";
      saveDictionary("Ignore list saved (" + lines.length + " words)");
    });
    saveRow.appendChild(saveBtn);

    body.appendChild(saveRow);
    editor.appendChild(body);

    header.addEventListener("click", () => {
      ignoreListOpen = !ignoreListOpen;
      arrow.classList.toggle("open", ignoreListOpen);
      body.classList.toggle("open", ignoreListOpen);
    });

    catEditorsEl.appendChild(editor);
  }

  // ---------------------------------------------------------------------------
  // Categories (includes Ignore List as first item)
  // ---------------------------------------------------------------------------
  function renderCategories() {
    catEditorsEl.innerHTML = "";

    // Render Ignore List as first expandable item
    renderIgnoreListCategory();

    if (!currentDict.categories) return;

    if (currentDict.categories.length === 0) {
      const empty = document.createElement("div");
      empty.style.padding = "20px";
      empty.style.color = "#888";
      empty.style.textAlign = "center";
      empty.innerHTML = "No categories yet.<br>Use the form above to add your first category.";
      catEditorsEl.appendChild(empty);
      return;
    }

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
    renderClients();
    renderCategories();
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  load();

})();
