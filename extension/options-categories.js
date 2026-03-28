/* global catEditorsEl, currentDict, saveDictionary, safeHexColor,
   _selectOptionsHtml:writable, populateAddClientDropdowns, getCategoryStyleByName,
   renderClientListBody, renderClients, MatcherEngine, showMsg,
   insertAlphabetically, showConfirmDialog, btnAddCat, newCatName, newCatColor */
/* exported renderCategories */
"use strict";

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
function renderCategories() {
  catEditorsEl.innerHTML = "";
  if (!currentDict.categories) return;

  // ── Ignore List — rendered as the first (top) category card ──────────────
  (function () {
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
      const lines = igArea.value
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      currentDict.ignoreList = lines;
      igCountSpan.textContent = lines.length + " words";
      saveDictionary("Ignore list saved (" + lines.length + " words)");
    });
    igSaveRow.appendChild(igSaveBtn);
    igBody.appendChild(igSaveRow);

    igHeader.addEventListener("click", () => {
      const isOpen = igBody.classList.contains("open");
      document.querySelectorAll(".cat-body").forEach((b) => b.classList.remove("open"));
      document.querySelectorAll(".cat-arrow").forEach((a) => a.classList.remove("open"));
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

    const safeBg = safeHexColor(cat.color, "#FFFF00");
    const safeFg = safeHexColor(cat.fColor, "#FFFFFF");

    const colorRow = document.createElement("div");
    colorRow.className = "color-picker-row";
    colorRow.innerHTML =
      "<label>BG Color:</label>" +
      '<input type="color" class="bg-color" value="' +
      safeBg +
      '">' +
      "<label>Text Color:</label>" +
      '<input type="color" class="fg-color" value="' +
      safeFg +
      '">' +
      '<span class="preview" style="padding:2px 8px; border-radius:3px; background:' +
      safeBg +
      "; color:" +
      safeFg +
      '">Preview</span>';

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
      _selectOptionsHtml = {};
      saveDictionary();
      populateAddClientDropdowns(getCategoryStyleByName());
      renderClientListBody();
    });

    fgInput.addEventListener("input", () => {
      preview.style.color = fgInput.value;
    });
    fgInput.addEventListener("change", () => {
      cat.fColor = fgInput.value;
      _selectOptionsHtml = {};
      saveDictionary();
      populateAddClientDropdowns(getCategoryStyleByName());
      renderClientListBody();
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
    helpText.textContent =
      "Prefix with // for exact match, CS: for case-sensitive. Wildcards: * (any chars), ? (one char).";
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
        if (typeof MatcherEngine !== "undefined") {
          var check = MatcherEngine.validatePattern(word);
          if (!check.ok) {
            showMsg("Invalid pattern: " + check.reason, "error");
            return;
          }
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
      const lines = wordArea.value
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
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
      const n = cat.words && cat.words.length ? cat.words.length : 0;
      showConfirmDialog("Delete category", '"' + nm + '" and all its ' + n + " words will be removed.", "Delete").then(
        (yes) => {
          if (!yes) return;
          currentDict.categories.splice(index, 1);
          saveDictionary('Deleted "' + nm + '"');
          renderCategories();
          renderClients();
        }
      );
    });
    saveRow.appendChild(deleteBtn);

    body.appendChild(saveRow);
    editor.appendChild(body);

    header.addEventListener("click", () => {
      const isOpen = body.classList.contains("open");
      document.querySelectorAll(".cat-body").forEach((b) => b.classList.remove("open"));
      document.querySelectorAll(".cat-arrow").forEach((a) => a.classList.remove("open"));
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

  const duplicate = currentDict.categories.some((c) => c.name.toLowerCase() === name.toLowerCase());
  if (duplicate) {
    showMsg('A category named "' + name + '" already exists', "error");
    return;
  }

  currentDict.categories.push({
    id: "cat_" + Date.now(),
    name: name,
    color: newCatColor.value,
    fColor: "#FFFFFF",
    enabled: true,
    words: [],
  });

  newCatName.value = "";
  saveDictionary('Added category "' + name + '"');
  renderCategories();
  renderClients();
});
