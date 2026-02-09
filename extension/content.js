// =============================================================================
// CMS Highlighter - Content Script
// - Walk text nodes
// - Wrap matches in spans
// - Client name in navbar highlighted based on dict.clients rules
// - Mentions/aliases highlighted in review text
// - Auto-refreshes when options page saves (storage.onChanged)
// =============================================================================

(function() {
  "use strict";

  const MARKER_ATTR = "data-cms-hl-processed";
  const HL_CLASS = "cms-hl";
  const MAX_SPAN_LEN = 120;

  let globalEnabled = true;

  // Compiled matcher
  let compiledMatcher = null;
  let mentionMatcher = null;

  // Client highlight config
  let clientRules = [];
  let categoryStyleByName = new Map();
  let lastMentionClient = null; // cache to avoid redundant recompilation

  // ---------------------------------------------------------------------------
  // Route guard
  // ---------------------------------------------------------------------------
  function isBlockedRoute() {
    return (
      location.hostname === "cms.bazaarvoice.com" &&
      location.hash &&
      (location.hash.includes("/modstatus") || location.hash.includes("/guidelinesMod"))
    );
  }

  // ---------------------------------------------------------------------------
  // Dictionary helpers
  // ---------------------------------------------------------------------------
  function buildCategoryStyleMap(dict) {
    const map = new Map();
    const cats = Array.isArray(dict.categories) ? dict.categories : [];
    for (const c of cats) {
      const name = (c && c.name) ? String(c.name).trim() : "";
      if (!name) continue;
      map.set(name, {
        color: c.color || "#FFFF00",
        fColor: c.fColor || "#FFFFFF"
      });
    }
    return map;
  }

  // ---------------------------------------------------------------------------
  // Client-name highlight
  // ---------------------------------------------------------------------------
  function getCmsClientNameEl() {
    return document.querySelector(".navbar-inner .client-name");
  }

  function getCmsClientName() {
    const el = getCmsClientNameEl();
    return el ? String(el.textContent || "").trim() : "";
  }

  function getCmsContentType() {
    const el = document.querySelector(".navbar-inner .decisionAreaLabel");
    const raw = el ? String(el.textContent || "").trim().toLowerCase() : "";

    if (raw.includes("image") || raw.includes("photo") || raw.includes("media")) return "Image";
    if (raw.includes("profile")) return "Profile";
    if (raw.includes("question")) return "Question";
    return "Default";
  }

  function globToRegex(pattern) {
    const p = String(pattern || "").trim();
    if (!p) return null;
    const escaped = p.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const rx = "^" + escaped.replace(/\*/g, ".*").replace(/\?/g, ".") + "$";
    try { return new RegExp(rx, "i"); } catch (e) { return null; }
  }

  function patternHasWildcard(pattern) {
    return /[*?]/.test(String(pattern || ""));
  }

  // Sort client rules: specific (non-wildcard) patterns first so they match
  // before catch-all wildcard patterns like *-*-*
  function prepareClientRules(clients) {
    const rules = Array.isArray(clients) ? clients.slice() : [];
    for (const r of rules) {
      r._rx = globToRegex(r.pattern);
      r._isWild = patternHasWildcard(r.pattern);
    }
    rules.sort((a, b) => {
      if (a._isWild !== b._isWild) return a._isWild ? 1 : -1;
      return 0;
    });
    return rules;
  }

  function findClientRule(clientName) {
    const name = String(clientName || "").trim();
    if (!name) return null;
    for (const r of clientRules) {
      if (!r || !r._rx) continue;
      if (r._rx.test(name)) return r;
    }
    return null;
  }

  function pickClientCategory(rule, contentType) {
    if (!rule) return null;
    const overrides = rule.overrides || {};
    if (contentType === "Image" && overrides.Image) return overrides.Image;
    if (contentType === "Profile" && overrides.Profile) return overrides.Profile;
    if (contentType === "Question" && overrides.Question) return overrides.Question;
    return rule.defaultCategory || null;
  }

  function clearClientHighlight() {
    const el = getCmsClientNameEl();
    if (!el) return;
    if (el.hasAttribute("data-client-hl")) {
      el.style.backgroundColor = "";
      el.style.color = "";
      el.style.borderRadius = "";
      el.style.padding = "";
      el.removeAttribute("data-client-hl");
    }
  }

  function applyClientHighlight() {
    clearClientHighlight();
    if (isBlockedRoute()) return;
    if (!globalEnabled) return;

    const clientName = getCmsClientName();
    if (!clientName) return;

    const rule = findClientRule(clientName);
    if (!rule) return;

    const type = getCmsContentType();
    const catName = pickClientCategory(rule, type);
    if (!catName) return;

    const style = categoryStyleByName.get(catName);
    if (!style) return;

    const el = getCmsClientNameEl();
    if (!el) return;

    el.style.backgroundColor = style.color;
    el.style.color = style.fColor;
    el.style.borderRadius = "3px";
    el.style.padding = "2px 6px";
    el.setAttribute("data-client-hl", "1");
  }

  // ---------------------------------------------------------------------------
  // Mentions: compile alias patterns for the current client
  // ---------------------------------------------------------------------------
  function buildMentionMatcher() {
    const clientName = getCmsClientName();

    // Skip rebuild if client hasn't changed
    if (clientName === lastMentionClient) return;
    lastMentionClient = clientName;
    mentionMatcher = null;

    if (!clientName) return;

    const rule = findClientRule(clientName);
    if (!rule || !rule.mentionCategory) return;

    const mentionCat = rule.mentionCategory;
    const style = categoryStyleByName.get(mentionCat);
    if (!style) return;

    const words = [];
    if (Array.isArray(rule.aliases)) {
      for (const a of rule.aliases) {
        const trimmed = String(a || "").trim();
        if (trimmed) words.push(trimmed);
      }
    }
    if (rule.includePatternInContent !== false && rule.pattern) {
      words.push(String(rule.pattern).trim());
    }
    if (words.length === 0) return;

    mentionMatcher = MatcherEngine.compileAll({
      ignoreList: [],
      categories: [{
        id: "__mentions__",
        name: mentionCat,
        color: style.color,
        fColor: style.fColor,
        enabled: true,
        words: words
      }]
    });
  }

  // ---------------------------------------------------------------------------
  // DOM walking
  // ---------------------------------------------------------------------------
  function getTextNodes(root) {
    const clientEl = getCmsClientNameEl();
    const nodes = [];
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          if (!node || !node.parentElement) return NodeFilter.FILTER_REJECT;

          // Skip nodes inside our own highlights
          if (node.parentElement.classList.contains(HL_CLASS)) {
            return NodeFilter.FILTER_REJECT;
          }

          // Skip the client-name element (handled separately by applyClientHighlight)
          if (clientEl && (node.parentElement === clientEl || clientEl.contains(node.parentElement))) {
            return NodeFilter.FILTER_REJECT;
          }

          // Skip script/style/textarea/input/select/noscript
          const tag = node.parentElement.tagName || "";
          if (["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "SELECT", "NOSCRIPT"].includes(tag)) {
            return NodeFilter.FILTER_REJECT;
          }

          // Skip already-processed parents
          if (node.parentElement.hasAttribute(MARKER_ATTR)) {
            return NodeFilter.FILTER_REJECT;
          }

          // Only process nodes with visible text
          if (!node.textContent || node.textContent.trim().length === 0) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
    }
    return nodes;
  }

  // ---------------------------------------------------------------------------
  // Match sanitization (matcher-core.js already resolves overlaps)
  // ---------------------------------------------------------------------------
  function sanitizeMatches(matches, textLen) {
    if (!Array.isArray(matches) || matches.length === 0) return [];
    const out = [];
    for (const m of matches) {
      if (!m) continue;
      const s = m.start, e = m.end;
      if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
      if (s < 0 || e <= s || e > textLen) continue;
      if ((e - s) > MAX_SPAN_LEN) continue;
      if (!m.categoryName) continue;
      out.push(m);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function renderMatchesIntoNode(textNode, matches) {
    if (!textNode || !textNode.parentNode) return;
    const text = textNode.textContent || "";
    if (!text) return;

    const frag = document.createDocumentFragment();
    let lastIndex = 0;

    for (const match of matches) {
      if (match.start > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, match.start)));
      }

      const span = document.createElement("span");
      span.className = HL_CLASS;
      span.style.backgroundColor = match.color || "#FFFF00";
      span.style.color = match.fColor || "#FFFFFF";
      span.setAttribute("data-hl-cat", match.categoryName);
      span.textContent = text.slice(match.start, match.end);
      frag.appendChild(span);

      lastIndex = match.end;
    }

    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    const parent = textNode.parentNode;
    if (parent) {
      parent.setAttribute(MARKER_ATTR, "1");
      parent.replaceChild(frag, textNode);
    }
  }

  // ---------------------------------------------------------------------------
  // Run matcher on text (includes mention matches)
  // ---------------------------------------------------------------------------
  function findMatchesForText(text) {
    if (!text) return [];

    const mainMatches = compiledMatcher
      ? (MatcherEngine.findMatches(text, compiledMatcher) || [])
      : [];

    if (!mentionMatcher) return mainMatches;

    const mentionMatches = MatcherEngine.findMatches(text, mentionMatcher) || [];
    if (mentionMatches.length === 0) return mainMatches;

    // Merge: main matches have priority; add non-overlapping mention matches
    const merged = [...mainMatches];
    for (const mm of mentionMatches) {
      const overlaps = mainMatches.some(m => mm.start < m.end && mm.end > m.start);
      if (!overlaps) {
        merged.push(mm);
      }
    }
    merged.sort((a, b) => a.start - b.start);
    return merged;
  }

  function highlightTextNode(textNode) {
    if (isBlockedRoute()) return;
    if (!globalEnabled) return;
    if (!compiledMatcher) return;
    if (!textNode || !textNode.parentNode) return;

    const text = textNode.textContent;
    if (!text || text.trim().length === 0) return;

    const matches = sanitizeMatches(findMatchesForText(text), text.length);
    if (matches.length === 0) return;

    renderMatchesIntoNode(textNode, matches);
  }

  function highlightAll(root) {
    if (isBlockedRoute()) return;
    if (!globalEnabled) return;
    if (!compiledMatcher) return;

    const target = root || document.body;
    const textNodes = getTextNodes(target);

    for (const node of textNodes) {
      highlightTextNode(node);
    }
  }

  // ---------------------------------------------------------------------------
  // Clear highlights
  // ---------------------------------------------------------------------------
  function removeAllHighlights() {
    const spans = document.querySelectorAll("." + HL_CLASS);
    spans.forEach(span => {
      const parent = span.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(span.textContent), span);
      parent.normalize();
    });

    const marked = document.querySelectorAll("[" + MARKER_ATTR + "]");
    marked.forEach(el => el.removeAttribute(MARKER_ATTR));

    clearClientHighlight();
  }

  // ---------------------------------------------------------------------------
  // Observer
  // ---------------------------------------------------------------------------
  let observer = null;
  let debounceTimer = null;
  let pendingNodes = [];

  function startObserver() {
    if (observer) return;

    observer = new MutationObserver((mutations) => {
      if (isBlockedRoute()) return;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.classList && node.classList.contains(HL_CLASS)) continue;
            pendingNodes.push({ type: "element", node });
          } else if (node.nodeType === Node.TEXT_NODE) {
            if (node.parentElement && !node.parentElement.classList.contains(HL_CLASS)) {
              pendingNodes.push({ type: "text", node });
            }
          }
        }
      }

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const batch = pendingNodes;
        pendingNodes = [];

        for (const item of batch) {
          if (!item.node || !item.node.parentNode) continue;

          if (item.type === "element") {
            if (item.node === document.body || item.node === document.documentElement) {
              highlightAll(document.body);
            } else {
              highlightAll(item.node);
            }
          } else {
            highlightTextNode(item.node);
          }
        }

        // Also update client highlight when header changes
        applyClientHighlight();
      }, 80);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    pendingNodes = [];
  }

  // ---------------------------------------------------------------------------
  // Load dictionary and compile
  // ---------------------------------------------------------------------------
  function loadAndCompile(callback) {
    chrome.storage.local.get(["dictionary", "enabled"], (result) => {
      if (chrome.runtime.lastError) {
        console.error("CMS Highlighter: storage error", chrome.runtime.lastError);
        if (callback) callback();
        return;
      }

      globalEnabled = result.enabled !== false;

      const dict = result.dictionary;
      if (!dict || !dict.categories) {
        console.log("CMS Highlighter: no dictionary found in storage.");
        if (callback) callback();
        return;
      }

      compiledMatcher = MatcherEngine.compileAll(dict);
      categoryStyleByName = buildCategoryStyleMap(dict);
      clientRules = prepareClientRules(dict.clients);

      // Force mention matcher rebuild since dictionary changed
      lastMentionClient = null;
      buildMentionMatcher();

      console.log(
        "CMS Highlighter: compiled " +
        (compiledMatcher.compiledCategories ? compiledMatcher.compiledCategories.length : 0) +
        " categories, " + clientRules.length + " client rules"
      );

      if (callback) callback();
    });
  }

  function applyHighlights() {
    removeAllHighlights();
    if (globalEnabled) {
      highlightAll(document.body);
      applyClientHighlight();
      startObserver();
    } else {
      stopObserver();
    }
  }

  // ---------------------------------------------------------------------------
  // Init + messages
  // ---------------------------------------------------------------------------
  function init() {
    if (isBlockedRoute()) {
      console.log("CMS Highlighter: disabled on this route");
      return;
    }

    loadAndCompile(() => {
      if (globalEnabled) {
        highlightAll(document.body);
        applyClientHighlight();
        startObserver();
      }
    });
  }

  // Auto-refresh when options page saves (debounced to avoid rapid recompilation)
  let storageChangeTimer = null;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (!changes.dictionary && !changes.enabled) return;

    if (storageChangeTimer) clearTimeout(storageChangeTimer);
    storageChangeTimer = setTimeout(() => {
      loadAndCompile(applyHighlights);
    }, 500);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.action) {
      sendResponse({ ok: false });
      return true;
    }

    switch (message.action) {
      case "toggle":
        globalEnabled = !!message.enabled;
        if (globalEnabled) {
          removeAllHighlights();
          highlightAll(document.body);
          applyClientHighlight();
          startObserver();
        } else {
          stopObserver();
          removeAllHighlights();
        }
        sendResponse({ ok: true });
        break;

      case "refresh":
        loadAndCompile(() => {
          applyHighlights();
          sendResponse({ ok: true });
        });
        return true;

      case "getClientName":
        sendResponse({ clientName: getCmsClientName() });
        break;

      case "getStats":
        sendResponse({
          highlights: document.querySelectorAll("." + HL_CLASS).length,
          enabled: globalEnabled,
          categories: compiledMatcher && compiledMatcher.compiledCategories ? compiledMatcher.compiledCategories.length : 0,
          clients: clientRules.length
        });
        break;

      case "notify":
        console.log("CMS Highlighter:", message.message || "");
        sendResponse({ ok: true });
        break;

      default:
        sendResponse({ error: "unknown action" });
    }

    return true;
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
