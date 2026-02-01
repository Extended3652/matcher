// =============================================================================
// CMS Highlighter — Options Page Script
// =============================================================================
// Full dictionary management: categories, words, ignore list, import/export.
// =============================================================================
 
(function() {
  "use strict";
 
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
 
  let currentDict = null;
  let importMode  = null; // "ht" or "json"
 
  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------
  function showMsg(text, type) {
    msgEl.textContent = text;
    msgEl.className = "msg " + type;
    setTimeout(() => { msgEl.className = "msg"; }, 4000);
  }
 
  // ---------------------------------------------------------------------------
  // Load
  // ---------------------------------------------------------------------------
  function load() {
    chrome.storage.local.get(["dictionary"], (result) => {
      currentDict = result.dictionary || { ignoreList: [], categories: [] };
      renderIgnoreList();
      renderCategories();
    });
  }
 
  // ---------------------------------------------------------------------------
  // Save the whole dictionary
  // ---------------------------------------------------------------------------
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
    ignoreCount.textContent = `(${words.length} words)`;
  }
 
  btnSaveIgnore.addEventListener("click", () => {
    const lines = ignoreArea.value.split("\n").filter(l => l.trim().length > 0);
    currentDict.ignoreList = lines;
    saveDictionary(`Ignore list saved (${lines.length} words)`);
    ignoreCount.textContent = `(${lines.length} words)`;
  });
 
  // ---------------------------------------------------------------------------
  // Category editors
  // ---------------------------------------------------------------------------
  function renderCategories() {
    catEditorsEl.innerHTML = "";
 
    if (!currentDict.categories) return;
 
    currentDict.categories.forEach((cat, index) => {
      const editor = document.createElement("div");
      editor.className = "cat-editor";
 
      // Header (collapsible)
      const header = document.createElement("div");
      header.className = "cat-header";
 
      const arrow = document.createElement("span");
      arrow.className = "cat-arrow";
      arrow.textContent = "\u25b6"; // right triangle
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
      nameSpan.textContent = cat.name;
      header.appendChild(nameSpan);
 
      const countSpan = document.createElement("span");
      countSpan.className = "cat-header-count";
      countSpan.textContent = `${cat.words ? cat.words.length : 0} words`;
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
 
      // Body (hidden by default)
      const body = document.createElement("div");
      body.className = "cat-body";
 
      // Color + font color
      const colorRow = document.createElement("div");
      colorRow.className = "color-picker-row";
 
      colorRow.innerHTML = `
        <label>BG Color:</label>
        <input type="color" class="bg-color" value="${cat.color || '#FFFF00'}">
        <label>Text Color:</label>
        <input type="color" class="fg-color" value="${cat.fColor || '#FFFFFF'}">
        <span class="preview" style="padding:2px 8px; border-radius:3px; background:${cat.color || '#FFFF00'}; color:${cat.fColor || '#FFFFFF'}">Preview</span>
      `;
      body.appendChild(colorRow);
 
      const bgInput = colorRow.querySelector(".bg-color");
      const fgInput = colorRow.querySelector(".fg-color");
      const preview = colorRow.querySelector(".preview");
 
      bgInput.addEventListener("input", () => {
        cat.color = bgInput.value;
        colorPrev.style.backgroundColor = bgInput.value;
        preview.style.background = bgInput.value;
        saveDictionary();
      });
      fgInput.addEventListener("input", () => {
        cat.fColor = fgInput.value;
        preview.style.color = fgInput.value;
        saveDictionary();
      });
 
      // Category name edit
      const nameRow = document.createElement("div");
      nameRow.className = "row";
      nameRow.innerHTML = `<label>Name:</label>`;
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.value = cat.name;
      nameInput.addEventListener("change", () => {
        cat.name = nameInput.value;
        nameSpan.textContent = nameInput.value;
        saveDictionary();
      });
      nameRow.appendChild(nameInput);
      body.appendChild(nameRow);
 
      // Word list textarea
      const wordLabel = document.createElement("h3");
      wordLabel.textContent = "Words (one per line):";
      body.appendChild(wordLabel);
 
      const helpText = document.createElement("p");
      helpText.style.fontSize = "11px";
      helpText.style.color = "#999";
      helpText.style.marginBottom = "6px";
      helpText.textContent = 'Prefix with // for exact match, CS: for case-sensitive. Wildcards: * (any chars), ? (one char).';
      body.appendChild(helpText);
 
      const wordArea = document.createElement("textarea");
      wordArea.className = "word-list";
      wordArea.spellcheck = false;
      wordArea.value = (cat.words || []).join("\n");
      body.appendChild(wordArea);
 
      // Quick add row
      const addRow = document.createElement("div");
      addRow.className = "add-word-row";
      const addInput = document.createElement("input");
      addInput.type = "text";
      addInput.placeholder = "Quick add a word (Enter to add)";
      const addExactCb = document.createElement("input");
      addExactCb.type = "checkbox";
      addExactCb.id = `exact-${index}`;
      const addExactLabel = document.createElement("label");
      addExactLabel.htmlFor = `exact-${index}`;
      addExactLabel.textContent = " Exact";
      addExactLabel.style.fontSize = "12px";
 
      addInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && addInput.value.trim()) {
          let word = addInput.value.trim();
          if (addExactCb.checked && !word.startsWith("//")) {
            word = "//" + word;
          }
          cat.words.push(word);
          wordArea.value = cat.words.join("\n");
          countSpan.textContent = `${cat.words.length} words`;
          addInput.value = "";
          saveDictionary(`Added "${word}" to ${cat.name}`);
        }
      });
 
      addRow.appendChild(addInput);
      addRow.appendChild(addExactCb);
      addRow.appendChild(addExactLabel);
      body.appendChild(addRow);
 
      // Save words button
      const saveRow = document.createElement("div");
      saveRow.style.marginTop = "10px";
      saveRow.style.display = "flex";
      saveRow.style.gap = "8px";
 
      const saveBtn = document.createElement("button");
      saveBtn.className = "primary";
      saveBtn.textContent = "Save Words";
      saveBtn.addEventListener("click", () => {
        const lines = wordArea.value.split("\n").filter(l => l.trim().length > 0);
        cat.words = lines;
        countSpan.textContent = `${lines.length} words`;
        saveDictionary(`${cat.name}: saved ${lines.length} words`);
      });
      saveRow.appendChild(saveBtn);
 
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "danger";
      deleteBtn.textContent = "Delete Category";
      deleteBtn.addEventListener("click", () => {
        if (confirm(`Delete "${cat.name}" and all its ${cat.words.length} words?`)) {
          currentDict.categories.splice(index, 1);
          saveDictionary(`Deleted "${cat.name}"`);
          renderCategories();
        }
      });
      saveRow.appendChild(deleteBtn);
 
      body.appendChild(saveRow);
      editor.appendChild(body);
 
      // Toggle expand/collapse
      header.addEventListener("click", () => {
        const isOpen = body.classList.contains("open");
        // Close all others
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
 
  // ---------------------------------------------------------------------------
  // Add new category
  // ---------------------------------------------------------------------------
  btnAddCat.addEventListener("click", () => {
    const name = newCatName.value.trim();
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
      words: [],
    });
 
    newCatName.value = "";
    saveDictionary(`Added category "${name}"`);
    renderCategories();
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
      a.download = `cms-highlighter-backup-${new Date().toISOString().slice(0,10)}.json`;
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
      // Reset so same file can be selected again
      importFileEl.value = "";
    };
    reader.readAsText(file);
  });
 
  // ---------------------------------------------------------------------------
  // Import CMS Highlighter JSON (direct load)
  // ---------------------------------------------------------------------------
  function importCMSJSON(data) {
    if (!data.categories || !Array.isArray(data.categories)) {
      showMsg("Not a valid CMS Highlighter dictionary", "error");
      return;
    }
 
    currentDict = data;
    saveDictionary(`Imported ${data.categories.length} categories`);
    renderIgnoreList();
    renderCategories();
  }
 
  // ---------------------------------------------------------------------------
  // Import HighlightThis backup (convert on the fly)
  // ---------------------------------------------------------------------------
  function importHighlightThis(backup) {
    if (!backup.groups || !backup.order || !Array.isArray(backup.order)) {
      showMsg("Not a valid HighlightThis backup (missing groups/order)", "error");
      return;
    }
 
    const dict = { ignoreList: [], categories: [] };
    let totalWords = 0;
 
    for (const id of backup.order) {
      const group = backup.groups[id];
      if (!group) continue;
      if (!group.enabled) continue;
 
      const words = (group.words || [])
        .map(w => w.replace(/[\n\r]+$/g, "").replace(/^[\n\r]+/, ""))
        .filter(w => w.length > 0)
        .map(w => group.findWords ? "//" + w : w);
 
      totalWords += words.length;
 
      if (group.name === "Unhighlight") {
        dict.ignoreList = words;
        continue;
      }
 
      dict.categories.push({
        id:      id,
        name:    group.name,
        color:   group.color || "#FFFF00",
        fColor:  group.fColor || "#FFFFFF",
        enabled: true,
        words:   words,
      });
    }
 
    currentDict = dict;
    saveDictionary(`Imported HighlightThis backup: ${dict.categories.length} categories, ${totalWords} words`);
    renderIgnoreList();
    renderCategories();
  }
 
  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  load();
 
})();
