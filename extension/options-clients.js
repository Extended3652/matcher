/* global newClientReview, newClientImage, newClientProfile, newClientQuestion,
   newClientComment, newClientMentionCategory, newClientAliases,
   newClientIncludePatternInContent, newClientNote, newClientPattern,
   btnAddClient, clientSearchEl, clientListBodyEl, clientCountEl,
   clientShowingEl, currentDict, openClientKey:writable, _selectOptionsHtml:writable,
   NO_HL_BG, CLIENT_SEARCH_DEBOUNCE_MS,
   makeCategorySelect, getCategoryStyleByName, normalizePattern, patternKey,
   findClientByKey, safeStr, showMsg, showConfirmDialog, saveDictionary,
   debouncedSaveDictionary, formatSummaryHtml, pickHeaderSwatchCategory,
   normalizeAliasesFromTextarea, renderAliasChips,
   invalidateCaches */
/* exported populateAddClientDropdowns, syncAddClientFormFromPattern,
   renderClientListBody, renderClients, ensureClientsSorted */
"use strict";

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
  if (newClientComment) {
    while (cSel.firstChild) newClientComment.appendChild(cSel.firstChild);
  }

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
      newClientIncludePatternInContent.checked = existing.includePatternInContent !== false;
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
      note: safeStr(c.note).toLowerCase(),
      aliases: Array.isArray(c.aliases) ? c.aliases.map((a) => safeStr(a).toLowerCase()) : [],
    };
  }
  return c._lower;
}

function filteredClients() {
  const all = currentDict.clients || [];
  const f = getClientFilter();
  if (!f) return all.slice();

  return all.filter((c) => {
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

// Rebuild only the list body (cards + counts). Skips repopulating the Add
// Client dropdowns and re-syncing the form — safe to call on every search
// keystroke because those elements are unaffected by filtering.
function renderClientListBody() {
  if (!currentDict) return;

  ensureClientsSorted();

  const all = currentDict.clients || [];
  const list = filteredClients();
  const styleByName = getCategoryStyleByName();

  clientCountEl.textContent = "(" + all.length + " entries)";
  clientShowingEl.textContent =
    list.length === all.length ? "Showing " + list.length : "Showing " + list.length + " of " + all.length;

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

  const frag = document.createDocumentFragment();

  list.forEach((entry) => {
    const pat = safeStr(entry.pattern);
    const key = patternKey(pat);

    const card = document.createElement("div");
    card.className = "client-card";
    card.setAttribute("data-key", key);

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
    const sImg = makeCategorySelect(
      { mode: "override", value: (entry.overrides && entry.overrides.Image) || "" },
      styleByName
    );
    fImg.appendChild(lImg);
    fImg.appendChild(sImg);
    grid.appendChild(fImg);

    const fPro = document.createElement("div");
    fPro.className = "field";
    const lPro = document.createElement("label");
    lPro.textContent = "Header: Profile override";
    const sPro = makeCategorySelect(
      { mode: "override", value: (entry.overrides && entry.overrides.Profile) || "" },
      styleByName
    );
    fPro.appendChild(lPro);
    fPro.appendChild(sPro);
    grid.appendChild(fPro);

    const fQ = document.createElement("div");
    fQ.className = "field";
    const lQ = document.createElement("label");
    lQ.textContent = "Header: Question override";
    const sQ = makeCategorySelect(
      { mode: "override", value: (entry.overrides && entry.overrides.Question) || "" },
      styleByName
    );
    fQ.appendChild(lQ);
    fQ.appendChild(sQ);
    grid.appendChild(fQ);

    const fCmt = document.createElement("div");
    fCmt.className = "field";
    const lCmt = document.createElement("label");
    lCmt.textContent = "Header: Comment override";
    const sCmt = makeCategorySelect(
      { mode: "override", value: (entry.overrides && entry.overrides.Comment) || "" },
      styleByName
    );
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
    cbInc.checked = entry.includePatternInContent !== false;
    lInc.appendChild(cbInc);
    lInc.appendChild(
      document.createTextNode("Also treat the main Client Name as a mention in content (in addition to aliases)")
    );
    fInc.appendChild(lInc);

    const incHelp = document.createElement("div");
    incHelp.className = "muted";
    incHelp.style.marginTop = "4px";
    incHelp.textContent =
      "If Mentions category is set, this adds the Client Name as an extra mention matcher unless unchecked.";
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
        swatch.setAttribute("aria-label", "No category color");
        swatch.title = "No category";
      } else {
        const st = styleByName.get(catName);
        if (st) {
          swatch.style.backgroundColor = st.color;
          swatch.style.borderColor = "rgba(0,0,0,0.2)";
        } else {
          swatch.style.backgroundColor = NO_HL_BG;
          swatch.style.borderColor = "#bdbdbd";
        }
        swatch.setAttribute("aria-label", "Category: " + catName);
        swatch.title = catName;
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
        const exists = (currentDict.clients || []).some((c) => patternKey(c.pattern) === newKey);
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
      debouncedSaveDictionary();
    });

    sImg.addEventListener("change", () => {
      if (!entry.overrides) entry.overrides = {};
      if (sImg.value) entry.overrides.Image = sImg.value;
      else delete entry.overrides.Image;
      refreshHeaderVisuals();
      debouncedSaveDictionary();
    });

    sPro.addEventListener("change", () => {
      if (!entry.overrides) entry.overrides = {};
      if (sPro.value) entry.overrides.Profile = sPro.value;
      else delete entry.overrides.Profile;
      refreshHeaderVisuals();
      debouncedSaveDictionary();
    });

    sQ.addEventListener("change", () => {
      if (!entry.overrides) entry.overrides = {};
      if (sQ.value) entry.overrides.Question = sQ.value;
      else delete entry.overrides.Question;
      refreshHeaderVisuals();
      debouncedSaveDictionary();
    });

    sCmt.addEventListener("change", () => {
      if (!entry.overrides) entry.overrides = {};
      if (sCmt.value) entry.overrides.Comment = sCmt.value;
      else delete entry.overrides.Comment;
      refreshHeaderVisuals();
      debouncedSaveDictionary();
    });

    sMCat.addEventListener("change", () => {
      entry.mentionCategory = sMCat.value ? sMCat.value : null;
      debouncedSaveDictionary();
      summary.innerHTML = formatSummaryHtml(entry);
    });

    tAliases.addEventListener("change", () => {
      entry.aliases = normalizeAliasesFromTextarea(tAliases.value);
      debouncedSaveDictionary();
      summary.innerHTML = formatSummaryHtml(entry);
    });

    cbInc.addEventListener("change", () => {
      entry.includePatternInContent = !!cbInc.checked;
      debouncedSaveDictionary();
      summary.innerHTML = formatSummaryHtml(entry);
    });

    iNote.addEventListener("change", () => {
      entry.note = (iNote.value || "").trim();
      debouncedSaveDictionary();
      summary.innerHTML = formatSummaryHtml(entry);
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
    frag.appendChild(card);
  });

  clientListBodyEl.appendChild(frag);
}

// Full render: repopulates Add Client dropdowns + rebuilds list body.
// Call this whenever the dictionary or category list changes.
function renderClients() {
  if (!currentDict) return;

  // Reset per-render option-HTML cache so selects reflect current categories.
  _selectOptionsHtml = {};

  const styleByName = getCategoryStyleByName();
  populateAddClientDropdowns(styleByName);

  // After dropdowns are repopulated, re-sync the add/edit form selection.
  syncAddClientFormFromPattern();

  renderClientListBody();
}

let _clientSearchTimer = null;
clientSearchEl.addEventListener("input", () => {
  clearTimeout(_clientSearchTimer);
  // Only rebuild the list body — skip repopulating the Add Client dropdowns.
  _clientSearchTimer = setTimeout(renderClientListBody, CLIENT_SEARCH_DEBOUNCE_MS);
});

// Delegated click handler for client list (header expand/collapse + delete)
clientListBodyEl.addEventListener("click", (e) => {
  const delBtn = e.target.closest(".btn-del");
  if (delBtn) {
    e.stopPropagation();
    const card = delBtn.closest(".client-card");
    const key = card && card.getAttribute("data-key");
    if (!key) return;
    const entry = (currentDict.clients || []).find((c) => patternKey(c.pattern) === key);
    if (entry) {
      showConfirmDialog("Remove client", safeStr(entry.pattern), "Remove").then((yes) => {
        if (!yes) return;
        const idx = (currentDict.clients || []).indexOf(entry);
        if (idx >= 0) {
          currentDict.clients.splice(idx, 1);
          saveDictionary('Removed client "' + safeStr(entry.pattern) + '"');
          if (openClientKey === key) openClientKey = null;
          renderClients();
        }
      });
    }
    return;
  }
  const header = e.target.closest(".client-header");
  if (header) {
    const card = header.closest(".client-card");
    const key = card && card.getAttribute("data-key");
    if (!key) return;
    const isOpen = openClientKey === key;
    openClientKey = isOpen ? null : key;
    renderClients();
  }
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
      note: "",
    };
    clients.push(entry);
    currentDict.clients = clients;
  }

  entry.pattern = pattern;
  entry.defaultCategory = newClientReview.value ? newClientReview.value : null;
  entry.overrides = {};
  if (newClientImage.value) entry.overrides.Image = newClientImage.value;
  if (newClientProfile.value) entry.overrides.Profile = newClientProfile.value;
  if (newClientQuestion.value) entry.overrides.Question = newClientQuestion.value;
  if (newClientComment && newClientComment.value) entry.overrides.Comment = newClientComment.value;
  entry.mentionCategory =
    newClientMentionCategory && newClientMentionCategory.value ? newClientMentionCategory.value : null;
  entry.aliases = newClientAliases ? normalizeAliasesFromTextarea(newClientAliases.value) : [];
  entry.includePatternInContent = newClientIncludePatternInContent ? !!newClientIncludePatternInContent.checked : true;
  entry.note = newClientNote ? (newClientNote.value || "").trim() : "";

  ensureClientsSorted();
  openClientKey = patternKey(pattern);

  saveDictionary((isUpdate ? 'Updated client "' : 'Added client "') + pattern + '"');
  renderClients();
});
