// =============================================================================
// CMS Highlighter — Popup Script
// =============================================================================
// Controls:
//   - Master on/off toggle
//   - Options button (top)
//   - Top search filters categories + words + ignore list
//   - "Ignore List (global)" appears as a category row with an editor drawer
//   - Per-category toggle + color picker (via swatch click)
//   - Drag-to-reorder categories (priority) via hamburger grip
//   - Click category row to open/close editor (no Edit buttons)
//   - Inline edit for entries: click to edit, Enter save, Esc cancel
//   - Shift+click to remove (no Remove buttons)
//   - Alt+click to move entry to another category (inserts alphabetically)
// =============================================================================

(function() {
  "use strict";

  const masterToggle = document.getElementById("masterToggle");
  const statsEl      = document.getElementById("stats");
  const catListEl    = document.getElementById("catList");
  const btnOptions   = document.getElementById("btnOptions");
  const popupSearch  = document.getElementById("popupSearch");

  let currentDict = null;

  // Use a string key so we can have "ignore" plus normal categories.
  let openEditorKey = null;

  // Track which entry is being edited
  // shape: { scope: "ignore" | "cat", catIndex?: number, entryIndex: number }
  let editing = null;

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

  function confirmRemove(label, value) {
    return window.confirm(`Remove from ${label}?\n\n${value}`);
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

      const cats = (currentDict.categories || [])
        .filter(c => c && c.id && c.name && c.id !== excludeCatId);

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
        try {
          document.removeEventListener("keydown", onKeyDown, true);
        } catch (_) {}
        try {
          overlay.remove();
        } catch (_) {}
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


  // ---------------------------------------------------------------------------
  // Storage + refresh helpers
  // ---------------------------------------------------------------------------
  function refreshActiveTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "refresh" }).catch(() => {});
      }
    });
  }

  function saveDictionaryAndRefresh() {
    chrome.storage.local.set({ dictionary: currentDict }, () => {
      refreshActiveTab();
      updateStats();
    });
  }

  // ---------------------------------------------------------------------------
  // Load state
  // ---------------------------------------------------------------------------
  function loadState() {
    chrome.storage.local.get(["dictionary", "enabled"], (result) => {
      const enabled = result.enabled !== false;
      masterToggle.checked = enabled;

      currentDict = result.dictionary || { ignoreList: [], categories: [] };
      if (!currentDict.ignoreList) currentDict.ignoreList = [];
      if (!currentDict.categories) currentDict.categories = [];

      renderAll();
      updateStats();
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
        chrome.tabs.sendMessage(tabs[0].id, {
          action: "toggle",
          enabled: enabled,
        }).catch(() => {});
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
        return;
      }

      chrome.tabs.sendMessage(tabs[0].id, { action: "getStats" }, (response) => {
        if (chrome.runtime.lastError || !response) {
          statsEl.textContent = "Not running on this page";
          return;
        }
        statsEl.textContent =
          `${response.highlights} highlights | ${response.categories} categories | ` +
          `${response.enabled ? "ON" : "OFF"}`;
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Search filters (top)
  // ---------------------------------------------------------------------------
  popupSearch.addEventListener("input", () => {
    renderAll();
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
  // Drag reorder (categories only)
  // ---------------------------------------------------------------------------
  let dragIndex = null;

  function onDragStart(e) {
    dragIndex = parseInt(e.currentTarget.dataset.index, 10);
    e.currentTarget.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add("drag-over");
  }

  function onDragLeave(e) {
    e.currentTarget.classList.remove("drag-over");
  }

  function onDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove("drag-over");

    const dropIndex = parseInt(e.currentTarget.dataset.index, 10);
    if (dragIndex === null || dragIndex === dropIndex) return;

    const cats = currentDict.categories;
    const [moved] = cats.splice(dragIndex, 1);
    cats.splice(dropIndex, 0, moved);

    saveDictionaryAndRefresh();
    renderAll();
  }

  function onDragEnd(e) {
    e.currentTarget.classList.remove("dragging");
    dragIndex = null;
    document.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function renderAll() {
    catListEl.innerHTML = "";
    if (!currentDict) return;

    const q = normalizeTrim(popupSearch.value);

    // 1) Ignore List pseudo-category
    if (matchesGlobalSearchForIgnore(q)) {
      renderIgnoreRow();
    }

    // 2) Normal categories
    (currentDict.categories || []).forEach((cat, index) => {
      if (!cat.words) cat.words = [];
      if (!matchesGlobalSearchForCategory(cat, q)) return;
      renderCategoryRow(cat, index);
    });
  }

  function setOpenEditor(nextKey) {
    if (openEditorKey === nextKey) {
      openEditorKey = null;
      editing = null;
    } else {
      openEditorKey = nextKey;
      editing = null;
    }
    renderAll();
  }

  function renderEditableRow(listEl, scopeLabel, scope, catIndex, entryIndex, raw, onSave, onRemove) {
    function handleRemoveClick(e) {
      e.preventDefault();
      e.stopPropagation();
      if (!confirmRemove(scopeLabel, raw)) return;
      editing = null;
      onRemove();
    }

    function handleEnterEdit(e) {
      e.preventDefault();
      e.stopPropagation();
      editing = { scope, catIndex, entryIndex };
      renderAll();
      // focus will happen on rerender
    }

    const row = document.createElement("div");
    row.className = "word-row";

    if (sameEditing(scope, catIndex, entryIndex)) {
      // edit mode
      const input = document.createElement("input");
      input.type = "text";
      input.value = raw;
      input.style.width = "100%";
      input.style.padding = "8px 10px";
      input.style.fontSize = "13px";
      input.style.border = "1px solid #cfd8dc";
      input.style.borderRadius = "8px";

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const nextRaw = normalizeTrim(input.value);
          if (!nextRaw) return; // stay in edit mode
          editing = null;
          onSave(nextRaw);
          return;
        }

        if (e.key === "Escape") {
          e.preventDefault();
          editing = null;
          renderAll();
          return;
        }
      });

      // Prevent category drawer toggles
      input.addEventListener("click", (e) => {
        e.stopPropagation();
      });

      row.appendChild(input);

      // focus after insert
      setTimeout(() => {
        try {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        } catch (_) {}
      }, 0);

    } else {
      // display mode
      const text = document.createElement("span");
      text.className = "word-text";
      text.textContent = raw;
      row.appendChild(text);

      row.addEventListener("click", (e) => {
        // Alt+click = move entry to another category
        if (e.altKey) {
          e.preventDefault();
          e.stopPropagation();

          const excludeCatId =
            (catIndex == null ? null : currentDict.categories[catIndex]?.id) || null;

          showMoveToCategoryDialog(excludeCatId).then((destCat) => {
            if (!destCat) return;

            if (!destCat.words) destCat.words = [];

            // Remove from source FIRST, before we insert into destination.
            // This prevents indexOf from finding a newly-inserted duplicate
            // when source and dest are the same array.
            if (scope === "ignore") {
              const srcIdx = currentDict.ignoreList.indexOf(raw);
              if (srcIdx !== -1) currentDict.ignoreList.splice(srcIdx, 1);
            } else {
              const srcWords = currentDict.categories[catIndex].words;
              const srcIdx = srcWords.indexOf(raw);
              if (srcIdx !== -1) srcWords.splice(srcIdx, 1);
            }

            // Now insert into destination (avoid duplicates by raw string)
            if (!destCat.words.includes(raw)) {
              insertAlphabetically(destCat.words, raw);
            }

            // Find the destination's current index so we can open its editor.
            // Editor keys are "cat:INDEX", not the category's uuid.
            const destIndex = currentDict.categories.indexOf(destCat);

            // One save, one render, one editor open.
            saveDictionaryAndRefresh();
            renderAll();
            if (destIndex !== -1) {
              setOpenEditor(`cat:${destIndex}`);
            }
          });

          return;
        }

        // Shift+click = remove (with confirm)
        if (e.shiftKey) {
          handleRemoveClick(e);
          return;
        }

        // Normal click = edit
        handleEnterEdit(e);
      });
    }

    listEl.appendChild(row);
  } // end renderEditableRow

  function renderIgnoreRow() {
    const key = "ignore";

    const item = document.createElement("div");
    item.className = "cat-item";

    // swatch
    const swatchWrap = document.createElement("span");
    swatchWrap.style.position = "relative";

    const swatch = document.createElement("span");
    swatch.className = "cat-accent";
    swatch.style.backgroundColor = "#d1d5db";
    swatchWrap.appendChild(swatch);
    item.appendChild(swatchWrap);

    // grip placeholder (not draggable)
    const grip = document.createElement("span");
    grip.className = "cat-grip";
    grip.textContent = "\u2630";
    item.appendChild(grip);

    // name
    const name = document.createElement("span");
    name.className = "cat-name";
    name.textContent = "Ignore List (global)";
    name.title = "Ignore List (global)";
    item.appendChild(name);

    // count
    const count = document.createElement("span");
    count.className = "cat-count";
    count.textContent = `${(currentDict.ignoreList || []).length}`;
    item.appendChild(count);

    // spacer where toggle would be
    const spacer = document.createElement("div");
    spacer.style.width = "40px";
    item.appendChild(spacer);

    // click row to toggle editor
    item.addEventListener("click", () => setOpenEditor(key));

    catListEl.appendChild(item);

    // editor drawer
    const editor = document.createElement("div");
    editor.className = "cat-editor" + (openEditorKey === key ? " open" : "");

    if (openEditorKey === key) {
      const searchRow = document.createElement("div");
      searchRow.className = "row";

      const searchInput = document.createElement("input");
      searchInput.type = "text";
      searchInput.placeholder = "Search ignore list";
      searchRow.appendChild(searchInput);
      editor.appendChild(searchRow);

      const addRow = document.createElement("div");
      addRow.className = "row";

      const addInput = document.createElement("input");
      addInput.type = "text";
      addInput.placeholder = "Add a word/pattern and press Enter";

      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.textContent = "Add";

      addRow.appendChild(addInput);
      addRow.appendChild(addBtn);
      editor.appendChild(addRow);

      const flagRow = document.createElement("div");
      flagRow.className = "flags";

      const exactLabel = document.createElement("label");
      const exactCb = document.createElement("input");
      exactCb.type = "checkbox";
      exactLabel.appendChild(exactCb);
      exactLabel.appendChild(document.createTextNode(" Exact"));

      const csLabel = document.createElement("label");
      const csCb = document.createElement("input");
      csCb.type = "checkbox";
      csLabel.appendChild(csCb);
      csLabel.appendChild(document.createTextNode(" CS"));

      flagRow.appendChild(exactLabel);
      flagRow.appendChild(csLabel);
      editor.appendChild(flagRow);

      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = "Tip: click to edit, Shift+click to remove, Alt+click to move.";
      editor.appendChild(hint);

      const list = document.createElement("div");
      list.className = "word-list";
      editor.appendChild(list);

      function renderIgnoreWords() {
        const wq = normalizeTrim(searchInput.value);
        list.innerHTML = "";

        const words = currentDict.ignoreList || [];
        const filtered = words
          .map((raw, entryIndex) => ({ raw, entryIndex }))
          .filter(item2 => (wq ? includesCI(item2.raw, wq) : true));

        if (filtered.length === 0) {
          const empty = document.createElement("div");
          empty.className = "word-row";
          const t = document.createElement("span");
          t.className = "word-text";
          t.textContent = wq ? "No matches" : "No ignore entries";
          empty.appendChild(t);
          list.appendChild(empty);
          return;
        }

        filtered.forEach(item2 => {
          renderEditableRow(
            list,
            "Ignore List",
            "ignore",
            null,
            item2.entryIndex,
            item2.raw,
            (nextRaw) => {
              // Avoid duplicate raw strings
              const existingIdx = currentDict.ignoreList.indexOf(nextRaw);
              if (existingIdx !== -1 && existingIdx !== item2.entryIndex) {
                // do nothing, keep original
                renderAll();
                setOpenEditor("ignore");
                return;
              }
              currentDict.ignoreList[item2.entryIndex] = nextRaw;
              saveDictionaryAndRefresh();
              renderAll();
              setOpenEditor("ignore");
            },
            () => {
              currentDict.ignoreList.splice(item2.entryIndex, 1);
              saveDictionaryAndRefresh();
              renderAll();
              setOpenEditor("ignore");
            }
          );
        });
      }

      searchInput.addEventListener("input", renderIgnoreWords);

      function addIgnoreEntry() {
        const base = normalizeTrim(addInput.value);
        if (!base) return;

        const raw = buildRaw(base, !!exactCb.checked, !!csCb.checked);
        if (!raw) return;

        if (!currentDict.ignoreList) currentDict.ignoreList = [];
        if (currentDict.ignoreList.includes(raw)) {
          addBtn.textContent = "Exists";
          setTimeout(() => { addBtn.textContent = "Add"; }, 700);
          return;
        }

        // Insert alphabetically instead of appending
        insertAlphabetically(currentDict.ignoreList, raw);
        addInput.value = "";
        saveDictionaryAndRefresh();

        addBtn.textContent = "Added";
        setTimeout(() => { addBtn.textContent = "Add"; }, 700);

        renderIgnoreWords();
        renderAll();
        setOpenEditor("ignore");
      }

      addBtn.addEventListener("click", (e) => {
        e.preventDefault();
        addIgnoreEntry();
      });

      addInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          addIgnoreEntry();
        }
      });

      renderIgnoreWords();
    }

    catListEl.appendChild(editor);
  }

  function renderCategoryRow(cat, index) {
    const key = `cat:${index}`;

    const item = document.createElement("div");
    item.className = "cat-item";
    item.draggable = true;
    item.dataset.index = index;

    // swatch + color picker
    const swatchWrap = document.createElement("span");
    swatchWrap.style.position = "relative";

    const swatch = document.createElement("span");
    swatch.className = "cat-accent";
    swatch.style.backgroundColor = cat.color || "#FFFF00";

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.className = "cat-color-input";
    colorInput.value = cat.color || "#FFFF00";

    colorInput.addEventListener("input", () => {
      swatch.style.backgroundColor = colorInput.value;
      cat.color = colorInput.value;
      saveDictionaryAndRefresh();
    });

    swatch.addEventListener("mousedown", (e) => e.stopPropagation());
    swatch.addEventListener("click", (e) => {
      e.stopPropagation();
      colorInput.click();
    });

    swatchWrap.appendChild(swatch);
    swatchWrap.appendChild(colorInput);
    item.appendChild(swatchWrap);

    // grip
    const grip = document.createElement("span");
    grip.className = "cat-grip";
    grip.textContent = "\u2630";
    item.appendChild(grip);

    // name
    const name = document.createElement("span");
    name.className = "cat-name";
    name.textContent = cat.name;
    name.title = cat.name;
    item.appendChild(name);

    // count
    const count = document.createElement("span");
    count.className = "cat-count";
    count.textContent = `${(cat.words || []).length}`;
    item.appendChild(count);

    // toggle
    const toggleLabel = document.createElement("label");
    toggleLabel.className = "toggle-switch cat-toggle";
    toggleLabel.addEventListener("mousedown", (e) => e.stopPropagation());
    toggleLabel.addEventListener("click", (e) => e.stopPropagation());

    const toggleInput = document.createElement("input");
    toggleInput.type = "checkbox";
    toggleInput.checked = cat.enabled !== false;
    toggleInput.addEventListener("change", () => {
      cat.enabled = toggleInput.checked;
      saveDictionaryAndRefresh();
    });

    const toggleSlider = document.createElement("span");
    toggleSlider.className = "toggle-slider";

    toggleLabel.appendChild(toggleInput);
    toggleLabel.appendChild(toggleSlider);
    item.appendChild(toggleLabel);

    // click row to open/close editor
    item.addEventListener("click", () => setOpenEditor(key));

    // drag handlers
    item.addEventListener("dragstart", onDragStart);
    item.addEventListener("dragover", onDragOver);
    item.addEventListener("dragleave", onDragLeave);
    item.addEventListener("drop", onDrop);
    item.addEventListener("dragend", onDragEnd);

    catListEl.appendChild(item);

    // editor drawer
    const editor = document.createElement("div");
    editor.className = "cat-editor" + (openEditorKey === key ? " open" : "");

    if (openEditorKey === key) {
      const searchRow = document.createElement("div");
      searchRow.className = "row";

      const searchInput = document.createElement("input");
      searchInput.type = "text";
      searchInput.placeholder = "Search words in this category";
      searchRow.appendChild(searchInput);
      editor.appendChild(searchRow);

      const addRow = document.createElement("div");
      addRow.className = "row";

      const addInput = document.createElement("input");
      addInput.type = "text";
      addInput.placeholder = "Add a word/pattern and press Enter";

      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.textContent = "Add";

      addRow.appendChild(addInput);
      addRow.appendChild(addBtn);
      editor.appendChild(addRow);

      const flagRow = document.createElement("div");
      flagRow.className = "flags";

      const exactLabel = document.createElement("label");
      const exactCb = document.createElement("input");
      exactCb.type = "checkbox";
      exactLabel.appendChild(exactCb);
      exactLabel.appendChild(document.createTextNode(" Exact"));

      const csLabel = document.createElement("label");
      const csCb = document.createElement("input");
      csCb.type = "checkbox";
      csLabel.appendChild(csCb);
      csLabel.appendChild(document.createTextNode(" CS"));

      flagRow.appendChild(exactLabel);
      flagRow.appendChild(csLabel);
      editor.appendChild(flagRow);

      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = "Tip: click to edit, Shift+click to remove, Alt+click to move.";
      editor.appendChild(hint);

      const list = document.createElement("div");
      list.className = "word-list";
      editor.appendChild(list);

      function renderWordList() {
        const wq = normalizeTrim(searchInput.value);
        list.innerHTML = "";

        const words = cat.words || [];
        const filtered = words
          .map((raw, entryIndex) => ({ raw, entryIndex }))
          .filter(item2 => (wq ? includesCI(item2.raw, wq) : true));

        if (filtered.length === 0) {
          const empty = document.createElement("div");
          empty.className = "word-row";
          const t = document.createElement("span");
          t.className = "word-text";
          t.textContent = wq ? "No matches" : "No words";
          empty.appendChild(t);
          list.appendChild(empty);
          return;
        }

        filtered.forEach(item2 => {
          renderEditableRow(
            list,
            cat.name,
            "cat",
            index,
            item2.entryIndex,
            item2.raw,
            (nextRaw) => {
              const existingIdx = cat.words.indexOf(nextRaw);
              if (existingIdx !== -1 && existingIdx !== item2.entryIndex) {
                renderAll();
                setOpenEditor(key);
                return;
              }
              cat.words[item2.entryIndex] = nextRaw;
              saveDictionaryAndRefresh();
              renderAll();
              setOpenEditor(key);
            },
            () => {
              cat.words.splice(item2.entryIndex, 1);
              saveDictionaryAndRefresh();
              renderAll();
              setOpenEditor(key);
            }
          );
        });
      }

      searchInput.addEventListener("input", renderWordList);

      function addCatEntry() {
        const base = normalizeTrim(addInput.value);
        if (!base) return;

        const raw = buildRaw(base, !!exactCb.checked, !!csCb.checked);
        if (!raw) return;

        if (!cat.words) cat.words = [];
        if (cat.words.includes(raw)) {
          addBtn.textContent = "Exists";
          setTimeout(() => { addBtn.textContent = "Add"; }, 700);
          return;
        }

        // Insert alphabetically instead of appending
        insertAlphabetically(cat.words, raw);
        addInput.value = "";
        saveDictionaryAndRefresh();

        addBtn.textContent = "Added";
        setTimeout(() => { addBtn.textContent = "Add"; }, 700);

        renderWordList();
        renderAll();
        setOpenEditor(key);
      }

      addBtn.addEventListener("click", (e) => {
        e.preventDefault();
        addCatEntry();
      });

      addInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          addCatEntry();
        }
      });

      renderWordList();
    }

    catListEl.appendChild(editor);
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  loadState();

})();
