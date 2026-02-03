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

    if (opts.mode === "override") {
      const optInherit = document.createElement("option");
      optInherit.value = "";
      optInherit.textContent = "-";
      sel.appendChild(optInherit);
    } else {
      const optNone = document.createElement("option");
      optNone.value = "";
      optNone.textContent = "(no highlight)";
      sel.appendChild(optNone);
    }

    for (const name of getCategoryNames()) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    }

    sel.value = opts.value || "";
    return sel;
  }

  function formatSummary(entry) {
    const def = entry.defaultCategory ? entry.defaultCategory : "none";
    const o = entry.overrides || {};
    const img = o.Image ? o.Image : "-";
    const pro = o.Profile ? o.Profile : "-";
    const q = o.Question ? o.Question : "-";
    return "Review: " + def + " | Img: " + img + " | Pro: " + pro + " | Q: " + q;
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
    // Review uses "review" mode, overrides use "override" mode
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
      return p.includes(f);
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
      lPat.textContent = "Pattern";
      const iPat = document.createElement("input");
      iPat.type = "text";
      iPat.value = pat;
      fPat.appendChild(lPat);
      fPat.appendChild(iPat);
      grid.appendChild(fPat);

      const fReview = document.createElement("div");
      fReview.className = "field";
      const lReview = document.createElement("label");
      lReview.textContent = "Review (Default)";
      const sReview = makeCategorySelect({ mode: "review", value: entry.defaultCategory || "" });
      fReview.appendChild(lReview);
      fReview.appendChild(sReview);
      grid.appendChild(fReview);

      const fImg = document.createElement("div");
      fImg.className = "field";
      const lImg = document.createElement("label");
      lImg.textContent = "Image override";
      const sImg = makeCategorySelect({ mode: "override", value: (entry.overrides && entry.overrides.Image) || "" });
      fImg.appendChild(lImg);
      fImg.appendChild(sImg);
      grid.appendChild(fImg);

      const fPro = document.createElement("div");
      fPro.className = "field";
      const lPro = document.createElement("label");
      lPro.textContent = "Profile override";
      const sPro = makeCategorySelect({ mode: "override", value: (entry.overrides && entry.overrides.Profile) || "" });
      fPro.appendChild(lPro);
      fPro.appendChild(sPro);
      grid.appendChild(fPro);

      const fQ = document.createElement("div");
      fQ.className = "field";
      const lQ = document.createElement("label");
      lQ.textContent = "Question override";
      const sQ = makeCategorySelect({ mode: "override", value: (entry.overrides && entry.overrides.Question) || "" });
      fQ.appendChild(lQ);
      fQ.appendChild(sQ);
      grid.appendChild(fQ);

      body.appendChild(grid);

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
          showMsg("Pattern cannot be blank", "error");
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
        summary.textContent = formatSummary(entry);
      });

      sImg.addEventListener("change", () => {
        if (!entry.overrides) entry.overrides = {};
        if (sImg.value) entry.overrides.Image = sImg.value;
        else delete entry.overrides.Image;
        refreshHeaderVisuals();
        saveDictionary();
        summary.textContent = formatSummary(entry);
      });

      sPro.addEventListener("change", () => {
        if (!entry.overrides) entry.overrides = {};
        if (sPro.value) entry.overrides.Profile = sPro.value;
        else delete entry.overrides.Profile;
        refreshHeaderVisuals();
        saveDictionary();
        summary.textContent = formatSummary(entry);
      });

      sQ.addEventListener("change", () => {
        if (!entry.overrides) entry.overrides = {};
        if (sQ.value) entry.overrides.Question = sQ.value;
        else delete entry.overrides.Question;
        refreshHeaderVisuals();
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
      showMsg("Enter a client pattern", "error");
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
      overrides: {}
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
        renderClients(); // update client swatches immediately when a category color changes
      });

      fgInput.addEventListener("input", () => {
        cat.fColor = fgInput.value;
        preview.style.color = fgInput.value;
        saveDictionary();
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
  // Init
  // ---------------------------------------------------------------------------
  load();

})();
