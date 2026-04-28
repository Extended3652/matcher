/* global log, MatcherEngine, insertAlphabetically,
   currentDict, catListEl, popupSearch, openEditorKey:writable, editing:writable,
   normalizeTrim, buildRaw, includesCI, confirmRemove, sameEditing,
   showMoveToCategoryDialog, ERROR_FLASH_MS, INVALID_RESET_MS,
   BUTTON_FEEDBACK_MS, matchesGlobalSearchForIgnore,
   matchesGlobalSearchForCategory, updateStats */
/* exported refreshActiveTab, renderAll, setOpenEditor,
   saveDictionary */
"use strict";

// ---------------------------------------------------------------------------
// Storage + refresh helpers
// ---------------------------------------------------------------------------
function refreshActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { action: "refresh" }).catch((e) => {
        log.debug(" refresh message failed:", e.message);
      });
    }
  });
}

function saveDictionary() {
  // Strip cached _rx (RegExp) from client objects before persisting.
  // Chrome serialises RegExp as {}, which breaks the instanceof check in content.js.
  const clients = (currentDict.clients || []).map((c) => {
    const copy = Object.assign({}, c);
    delete copy._rx;
    return copy;
  });
  const dict = Object.assign({}, currentDict, { clients });
  chrome.storage.local.set({ dictionary: dict }, () => {
    updateStats();
  });
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

  saveDictionary();
  renderAll();
}

function onDragEnd(e) {
  e.currentTarget.classList.remove("dragging");
  dragIndex = null;
  document.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
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

function setOpenEditor(nextKey, skipRender) {
  if (openEditorKey === nextKey) {
    openEditorKey = null;
    editing = null;
  } else {
    openEditorKey = nextKey;
    editing = null;
  }
  if (!skipRender) renderAll();
}

function renderEditableRow(listEl, scopeLabel, scope, catIndex, entryIndex, raw, onSave, onRemove) {
  function handleRemoveClick(e) {
    e.preventDefault();
    e.stopPropagation();
    confirmRemove(scopeLabel, raw).then((yes) => {
      if (!yes) return;
      editing = null;
      onRemove();
    });
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

    function flashError(msg) {
      input.style.borderColor = "#e74c3c";
      input.title = msg;
      setTimeout(() => {
        input.style.borderColor = "#cfd8dc";
        input.title = "";
      }, ERROR_FLASH_MS);
    }
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const nextRaw = normalizeTrim(input.value);
        if (!nextRaw) return; // stay in edit mode
        if (typeof MatcherEngine !== "undefined") {
          const check = MatcherEngine.validatePattern(nextRaw);
          if (!check.ok) {
            flashError(check.reason);
            return;
          }
        }
        editing = null;
        onSave(nextRaw, flashError);
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
      } catch (_) { /* focus may fail if element was removed */ }
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

        const excludeCatId = (catIndex == null ? null : currentDict.categories[catIndex]?.id) || null;

        showMoveToCategoryDialog(excludeCatId).then((destCat) => {
          if (!destCat) return;

          if (!destCat.words) destCat.words = [];

          // Avoid duplicates (by raw string)
          if (!destCat.words.includes(raw)) {
            // Insert alphabetically into destination
            insertAlphabetically(destCat.words, raw);
          }

          // Remove from source BY VALUE, not by index.
          // We can't use onRemove() here — it splices by the entryIndex
          // captured at render time, but insertAlphabetically may have
          // already shifted indices if dest and source are the same array.
          // onRemove also does its own save/render/setOpenEditor which
          // would fight with ours below. So we do it directly.
          if (scope === "ignore") {
            const srcIdx = currentDict.ignoreList.indexOf(raw);
            if (srcIdx !== -1) currentDict.ignoreList.splice(srcIdx, 1);
          } else {
            const srcWords = currentDict.categories[catIndex].words;
            const srcIdx = srcWords.indexOf(raw);
            if (srcIdx !== -1) srcWords.splice(srcIdx, 1);
          }

          // Find the destination's current index so we can open its editor.
          // Editor keys are "cat:INDEX", not the category's uuid.
          const destIndex = currentDict.categories.indexOf(destCat);

          // One save, one render — source drawer stays open for further moves.
          saveDictionary();
          renderAll();
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
  swatch.setAttribute("aria-label", "Ignore List color");
  swatch.title = "Ignore List";
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
    searchInput.value = normalizeTrim(popupSearch.value);
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
        .filter((item2) => (wq ? includesCI(item2.raw, wq) : true));

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

      filtered.forEach((item2) => {
        renderEditableRow(
          list,
          "Ignore List",
          "ignore",
          null,
          item2.entryIndex,
          item2.raw,
          (nextRaw, flashError) => {
            // Avoid duplicate raw strings
            const existingIdx = currentDict.ignoreList.indexOf(nextRaw);
            if (existingIdx !== -1 && existingIdx !== item2.entryIndex) {
              if (flashError) {
                editing = { scope: "ignore", catIndex: null, entryIndex: item2.entryIndex };
                flashError("Duplicate entry");
              }
              return;
            }
            currentDict.ignoreList[item2.entryIndex] = nextRaw;
            saveDictionary();
            setOpenEditor("ignore");
          },
          () => {
            currentDict.ignoreList.splice(item2.entryIndex, 1);
            saveDictionary();
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

      if (typeof MatcherEngine !== "undefined") {
        const check = MatcherEngine.validatePattern(raw);
        if (!check.ok) {
          addBtn.textContent = "Invalid";
          addBtn.title = check.reason;
          setTimeout(() => {
            addBtn.textContent = "Add";
            addBtn.title = "";
          }, INVALID_RESET_MS);
          return;
        }
      }

      if (!currentDict.ignoreList) currentDict.ignoreList = [];
      if (currentDict.ignoreList.includes(raw)) {
        addBtn.textContent = "Exists";
        setTimeout(() => {
          addBtn.textContent = "Add";
        }, BUTTON_FEEDBACK_MS);
        return;
      }

      // Insert alphabetically instead of appending
      insertAlphabetically(currentDict.ignoreList, raw);
      addInput.value = "";
      saveDictionary();

      addBtn.textContent = "Added";
      setTimeout(() => {
        addBtn.textContent = "Add";
      }, 700);

      renderIgnoreWords();
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
  swatch.setAttribute("aria-label", "Category: " + (cat.name || ""));
  swatch.title = cat.name || "";

  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.className = "cat-color-input";
  colorInput.value = cat.color || "#FFFF00";

  // Live preview while dragging - no storage writes on every pixel
  colorInput.addEventListener("input", () => {
    swatch.style.backgroundColor = colorInput.value;
  });
  // Persist only when picker is released/committed
  colorInput.addEventListener("change", () => {
    cat.color = colorInput.value;
    saveDictionary();
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
    saveDictionary();
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
    searchInput.value = normalizeTrim(popupSearch.value);
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
        .filter((item2) => (wq ? includesCI(item2.raw, wq) : true));

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

      filtered.forEach((item2) => {
        renderEditableRow(
          list,
          cat.name,
          "cat",
          index,
          item2.entryIndex,
          item2.raw,
          (nextRaw, flashError) => {
            const existingIdx = cat.words.indexOf(nextRaw);
            if (existingIdx !== -1 && existingIdx !== item2.entryIndex) {
              if (flashError) {
                editing = { scope: "cat", catIndex: index, entryIndex: item2.entryIndex };
                flashError("Duplicate entry");
              }
              return;
            }
            cat.words[item2.entryIndex] = nextRaw;
            saveDictionary();
            setOpenEditor(key);
          },
          () => {
            cat.words.splice(item2.entryIndex, 1);
            saveDictionary();
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

      if (typeof MatcherEngine !== "undefined") {
        const check = MatcherEngine.validatePattern(raw);
        if (!check.ok) {
          addBtn.textContent = "Invalid";
          addBtn.title = check.reason;
          setTimeout(() => {
            addBtn.textContent = "Add";
            addBtn.title = "";
          }, INVALID_RESET_MS);
          return;
        }
      }

      if (!cat.words) cat.words = [];
      if (cat.words.includes(raw)) {
        addBtn.textContent = "Exists";
        setTimeout(() => {
          addBtn.textContent = "Add";
        }, BUTTON_FEEDBACK_MS);
        return;
      }

      // Insert alphabetically instead of appending
      insertAlphabetically(cat.words, raw);
      addInput.value = "";
      saveDictionary();

      addBtn.textContent = "Added";
      setTimeout(() => {
        addBtn.textContent = "Add";
      }, 700);

      renderWordList();
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
