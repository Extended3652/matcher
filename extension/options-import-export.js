/* global btnExport, btnImportHT, btnImportJSON, importFileEl, showMsg,
   importMode:writable, currentDict:writable, openClientKey:writable,
   saveDictionary, renderIgnoreList, renderClients, renderCategories */
"use strict";

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
btnExport.addEventListener("click", () => {
  chrome.storage.local.get(["dictionary"], (result) => {
    const data = JSON.stringify(result.dictionary || {}, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
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
  reader.onerror = () => {
    showMsg("Could not read file — check file permissions", "error");
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
      .map((w) =>
        String(w || "")
          .replace(/[\n\r]+$/g, "")
          .replace(/^[\n\r]+/, "")
      )
      .filter((w) => w.length > 0)
      .map((w) => (group.findWords ? "//" + w : w));

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
      words: words,
    });
  }

  currentDict = dict;
  openClientKey = null;
  saveDictionary("Imported HighlightThis backup: " + dict.categories.length + " categories, " + totalWords + " words");
  renderIgnoreList();
  renderClients();
  renderCategories();
}
