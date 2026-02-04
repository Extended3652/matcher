// =============================================================================
// CMS Highlighter — Content Script
// =============================================================================
// - Region-aware highlighting (clientbar vs review vs other)
// - Client-field highlighting independent of content matching
//   Reads span.client-name + span.decisionAreaLabel, looks up dict.clients
// - Performance: cached selectors, auto-clear on content navigation,
//   observer dedup, no full-dictionary cloning
// =============================================================================

(function () {
  "use strict";

  const MARKER_ATTR = "data-cms-hl-processed";
  const HL_CLASS = "cms-hl";
  const CLIENT_HL_CLASS = "cms-hl-client"; // separate class for client-field highlights

  // Guardrails
  const MAX_SPAN_LEN = 120;

  let globalEnabled = true;

  // Compiled matcher for all enabled categories (review + other text)
  let compiledAll = null;

  // Priority map from original dictionary category order
  let priorityByName = new Map();

  // Client config from dictionary
  let clientsConfig = []; // array of { pattern, defaultCategory, overrides }

  // Category color lookup: name -> { color, fColor }
  let categoryColors = new Map();

  // ---------------------------------------------------------------------------
  // Selector cache — invalidated on content navigation
  // ---------------------------------------------------------------------------
  let cachedReviewRoot = undefined; // undefined = not yet queried, null = not found
  let cachedClientName = undefined;
  let cachedContentType = undefined;

  function invalidateCache() {
    cachedReviewRoot = undefined;
    cachedClientName = undefined;
    cachedContentType = undefined;
  }

  function getReviewRoot() {
    if (cachedReviewRoot !== undefined) return cachedReviewRoot;
    cachedReviewRoot =
      document.querySelector("div.ugcAndDetails") ||
      document.querySelector("dd.moderatable") ||
      document.querySelector("div.read") ||
      null;
    return cachedReviewRoot;
  }

  function getClientName() {
    if (cachedClientName !== undefined) return cachedClientName;
    const el = document.querySelector("span.client-name");
    cachedClientName = el ? el.textContent.trim() : null;
    return cachedClientName;
  }

  function getContentType() {
    if (cachedContentType !== undefined) return cachedContentType;
    const el = document.querySelector("span.decisionAreaLabel");
    cachedContentType = el ? el.textContent.trim() : null;
    return cachedContentType;
  }

  // ---------------------------------------------------------------------------
  // Route guard
  // ---------------------------------------------------------------------------
  function isModStatusRoute() {
    return (
      location.hostname === "cms.bazaarvoice.com" &&
      location.hash &&
      location.hash.includes("/modstatus")
    );
  }

  // ---------------------------------------------------------------------------
  // Region detection
  // ---------------------------------------------------------------------------
  function getNodeRegion(node) {
    const el =
      node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!el || !el.closest) return "other";

    if (el.closest(".navbar-inner") || el.closest(".sidebar"))
      return "clientbar";

    const reviewRoot = getReviewRoot();
    if (reviewRoot && (el === reviewRoot || reviewRoot.contains(el)))
      return "review";

    return "other";
  }

  // ---------------------------------------------------------------------------
  // Dictionary helpers — NO cloning, just filter references
  // ---------------------------------------------------------------------------
  function getCategoryName(cat) {
    return cat && (cat.name || cat.categoryName || cat.title || cat.label)
      ? String(cat.name || cat.categoryName || cat.title || cat.label)
      : "";
  }

  function normalizeName(s) {
    return String(s || "").trim();
  }

  function buildPriorityMapFromDict(dict) {
    const map = new Map();
    const cats = Array.isArray(dict.categories) ? dict.categories : [];
    for (let i = 0; i < cats.length; i++) {
      const name = normalizeName(getCategoryName(cats[i]));
      if (name && !map.has(name)) {
        map.set(name, i);
      }
    }
    return map;
  }

  function buildCategoryColorMap(dict) {
    const map = new Map();
    const cats = Array.isArray(dict.categories) ? dict.categories : [];
    for (const cat of cats) {
      const name = normalizeName(getCategoryName(cat));
      if (name) {
        map.set(name, { color: cat.color || "#FFFF00", fColor: cat.fColor || "#FFFFFF" });
      }
    }
    return map;
  }

  // Build a compiled config from the full dictionary (all enabled categories)
  function compileFromDict(dict) {
    // Pass the full dictionary to MatcherEngine — no cloning needed
    return MatcherEngine.compileAll(dict);
  }

  // ---------------------------------------------------------------------------
  // Client pattern matching
  // ---------------------------------------------------------------------------
  // Simple glob match: supports * and ? against a string (case-insensitive)
  function globMatch(pattern, text) {
    const p = pattern.toLowerCase();
    const t = text.toLowerCase();

    // Fast paths
    if (p === t) return true;
    if (!p.includes("*") && !p.includes("?")) return p === t;

    // Convert glob to regex
    let re = "^";
    for (const ch of p) {
      if (ch === "*") re += ".*";
      else if (ch === "?") re += ".";
      else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    re += "$";

    try {
      return new RegExp(re, "i").test(t);
    } catch (_) {
      return false;
    }
  }

  function resolveClientCategory(clientName, contentType) {
    if (!clientName || clientsConfig.length === 0) return null;

    // Find first matching client entry
    for (const entry of clientsConfig) {
      if (!globMatch(entry.pattern, clientName)) continue;

      // Check content-type override first
      if (contentType && entry.overrides && entry.overrides[contentType]) {
        return entry.overrides[contentType]; // category name
      }

      // Fall back to default
      return entry.defaultCategory; // null = uncoded
    }

    return null; // no matching client entry
  }

  // ---------------------------------------------------------------------------
  // Client field highlighting — independent of content matching
  // ---------------------------------------------------------------------------
  function highlightClientField() {
    if (!globalEnabled) return;

    // Remove previous client highlights
    removeClientHighlights();

    const clientName = getClientName();
    const contentType = getContentType();
    if (!clientName) return;

    const catName = resolveClientCategory(clientName, contentType);
    if (!catName) return; // null = uncoded, no highlight

    const colors = categoryColors.get(catName);
    if (!colors) return;

    // Find all span.client-name elements and highlight them
    const els = document.querySelectorAll("span.client-name");
    for (const el of els) {
      const span = document.createElement("span");
      span.className = CLIENT_HL_CLASS;
      span.style.backgroundColor = colors.color;
      span.style.color = colors.fColor;
      span.style.padding = "0 2px";
      span.style.borderRadius = "3px";
      span.style.boxShadow = "0 0 0 1px rgba(0,0,0,0.1)";
      span.setAttribute("data-hl-cat", catName);
      span.textContent = el.textContent;

      el.textContent = "";
      el.appendChild(span);
    }

    // Also highlight client name in sidebar (meta-value.client-display)
    const sideEls = document.querySelectorAll(".client-display, .meta-value.client-display");
    for (const el of sideEls) {
      if (el.querySelector("." + CLIENT_HL_CLASS)) continue; // already done
      const text = el.textContent.trim();
      if (!text) continue;

      const span = document.createElement("span");
      span.className = CLIENT_HL_CLASS;
      span.style.backgroundColor = colors.color;
      span.style.color = colors.fColor;
      span.style.padding = "0 4px";
      span.style.borderRadius = "3px";
      span.style.boxShadow = "0 0 0 1px rgba(0,0,0,0.1)";
      span.setAttribute("data-hl-cat", catName);
      span.textContent = text;

      el.textContent = "";
      el.appendChild(span);
    }
  }

  function removeClientHighlights() {
    const spans = document.querySelectorAll("." + CLIENT_HL_CLASS);
    spans.forEach((span) => {
      const parent = span.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(span.textContent), span);
      parent.normalize();
    });
  }

  // ---------------------------------------------------------------------------
  // DOM walking
  // ---------------------------------------------------------------------------
  function getTextNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node || !node.parentElement) return NodeFilter.FILTER_REJECT;

        // Skip nodes inside our own highlights
        if (
          node.parentElement.classList.contains(HL_CLASS) ||
          node.parentElement.classList.contains(CLIENT_HL_CLASS)
        ) {
          return NodeFilter.FILTER_REJECT;
        }

        // Skip script/style/textarea/input/select/noscript
        const tag = node.parentElement.tagName || "";
        if (
          ["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "SELECT", "NOSCRIPT"].includes(tag)
        ) {
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
      },
    });

    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
    }
    return nodes;
  }

  // ---------------------------------------------------------------------------
  // Match choosing and overlap resolution
  // ---------------------------------------------------------------------------
  function getPriority(catName) {
    const name = normalizeName(catName);
    const p = priorityByName.get(name);
    return Number.isFinite(p) ? p : 999999;
  }

  function betterMatch(a, b) {
    const pa = getPriority(a.categoryName);
    const pb = getPriority(b.categoryName);
    if (pa !== pb) return pa < pb;

    const la = a.end - a.start;
    const lb = b.end - b.start;
    if (la !== lb) return la > lb;

    if (a.start !== b.start) return a.start < b.start;
    return a.end < b.end;
  }

  function sanitizeMatches(matches, textLen) {
    if (!Array.isArray(matches) || matches.length === 0) return [];

    const out = [];
    for (const m of matches) {
      if (!m) continue;
      const s = m.start,
        e = m.end;
      if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
      if (s < 0 || e <= s || e > textLen) continue;
      if (e - s > MAX_SPAN_LEN) continue;
      if (!m.categoryName) continue;
      out.push(m);
    }
    return out;
  }

  function resolveOverlaps(matches) {
    if (!Array.isArray(matches) || matches.length === 0) return [];

    matches.sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      if (betterMatch(a, b)) return -1;
      if (betterMatch(b, a)) return 1;
      return b.end - b.start - (a.end - a.start);
    });

    const picked = [];
    for (const m of matches) {
      if (picked.length === 0) {
        picked.push(m);
        continue;
      }

      const last = picked[picked.length - 1];

      if (m.start >= last.end) {
        picked.push(m);
        continue;
      }

      // Overlap: keep the better one
      if (betterMatch(m, last)) {
        picked[picked.length - 1] = m;
      }
    }

    picked.sort((a, b) => a.start - b.start || a.end - b.end);
    return picked;
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
        frag.appendChild(
          document.createTextNode(text.slice(lastIndex, match.start))
        );
      }

      const span = document.createElement("span");
      span.className = HL_CLASS;
      span.style.backgroundColor = match.color || "#FFFF00";
      span.style.color = match.fColor || "#000000";
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
  // Highlight a single text node
  // ---------------------------------------------------------------------------
  function highlightTextNode(textNode) {
    if (isModStatusRoute()) return;
    if (!globalEnabled) return;
    if (!compiledAll) return;

    if (!textNode || !textNode.parentNode) return;

    const text = textNode.textContent;
    if (!text || text.trim().length === 0) return;

    // Skip client-name elements — handled by highlightClientField
    if (
      textNode.parentElement &&
      textNode.parentElement.classList &&
      textNode.parentElement.classList.contains("client-name")
    ) {
      return;
    }

    let matches = MatcherEngine.findMatches(text, compiledAll) || [];
    matches = sanitizeMatches(matches, text.length);
    if (matches.length === 0) return;

    matches = resolveOverlaps(matches);
    if (matches.length === 0) return;

    renderMatchesIntoNode(textNode, matches);
  }

  function highlightAll(root) {
    if (isModStatusRoute()) return;
    if (!globalEnabled) return;
    if (!compiledAll) return;

    const target = root || document.body;
    const textNodes = getTextNodes(target);

    for (const node of textNodes) {
      highlightTextNode(node);
    }

    // Also run client field highlighting
    highlightClientField();
  }

  // ---------------------------------------------------------------------------
  // Clear highlights
  // ---------------------------------------------------------------------------
  function removeAllHighlights() {
    const spans = document.querySelectorAll("." + HL_CLASS);
    spans.forEach((span) => {
      const parent = span.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(span.textContent), span);
      parent.normalize();
    });

    const marked = document.querySelectorAll("[" + MARKER_ATTR + "]");
    marked.forEach((el) => el.removeAttribute(MARKER_ATTR));

    removeClientHighlights();
  }

  // ---------------------------------------------------------------------------
  // Content navigation detection
  // ---------------------------------------------------------------------------
  // Watch for changes to span.client-name or span.decisionAreaLabel
  // which indicates the CMS navigated to a new content item.
  let navObserver = null;
  let lastSeenClient = null;
  let lastSeenType = null;

  function startNavObserver() {
    if (navObserver) return;

    // Check periodically (more reliable than MutationObserver for text changes)
    const checkInterval = setInterval(() => {
      const clientEl = document.querySelector("span.client-name");
      const typeEl = document.querySelector("span.decisionAreaLabel");
      const currentClient = clientEl ? clientEl.textContent.trim() : null;
      const currentType = typeEl ? typeEl.textContent.trim() : null;

      if (currentClient !== lastSeenClient || currentType !== lastSeenType) {
        lastSeenClient = currentClient;
        lastSeenType = currentType;

        // Content changed — clear and re-highlight
        invalidateCache();
        removeAllHighlights();
        if (globalEnabled && compiledAll) {
          highlightAll(document.body);
        }
      }
    }, 500);

    // Store ref for cleanup
    navObserver = { interval: checkInterval };
  }

  function stopNavObserver() {
    if (navObserver) {
      clearInterval(navObserver.interval);
      navObserver = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Observer for dynamic content
  // ---------------------------------------------------------------------------
  let observer = null;
  let debounceTimer = null;
  let pendingSet = new Set(); // dedup: track node references

  function startObserver() {
    if (observer) return;

    observer = new MutationObserver((mutations) => {
      if (isModStatusRoute()) return;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.classList && node.classList.contains(HL_CLASS)) continue;
            if (node.classList && node.classList.contains(CLIENT_HL_CLASS)) continue;
            pendingSet.add(node);
          } else if (node.nodeType === Node.TEXT_NODE) {
            if (
              node.parentElement &&
              !node.parentElement.classList.contains(HL_CLASS) &&
              !node.parentElement.classList.contains(CLIENT_HL_CLASS) &&
              !node.parentElement.hasAttribute(MARKER_ATTR)
            ) {
              pendingSet.add(node);
            }
          }
        }
      }

      if (pendingSet.size === 0) return;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const batch = Array.from(pendingSet);
        pendingSet.clear();

        for (const node of batch) {
          if (!node || !node.parentNode) continue;

          if (node.nodeType === Node.ELEMENT_NODE) {
            if (
              node === document.body ||
              node === document.documentElement
            ) {
              highlightAll(document.body);
            } else {
              highlightAll(node);
            }
          } else if (node.nodeType === Node.TEXT_NODE) {
            highlightTextNode(node);
          }
        }
      }, 80);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    pendingSet.clear();
  }

  // ---------------------------------------------------------------------------
  // Init + messages
  // ---------------------------------------------------------------------------
  function compileAndHighlight(dict) {
    priorityByName = buildPriorityMapFromDict(dict);
    categoryColors = buildCategoryColorMap(dict);
    clientsConfig = Array.isArray(dict.clients) ? dict.clients : [];
    compiledAll = compileFromDict(dict);

    const catCount = compiledAll.compiledCategories
      ? compiledAll.compiledCategories.length
      : 0;
    console.log(
      "CMS Highlighter: compiled " +
        catCount +
        " categories, " +
        clientsConfig.length +
        " client entries"
    );
  }

  function init() {
    if (isModStatusRoute()) {
      console.log("CMS Highlighter: disabled on modstatus route");
      return;
    }

    chrome.storage.local.get(["dictionary", "enabled"], (result) => {
      if (chrome.runtime.lastError) {
        console.error(
          "CMS Highlighter: storage error",
          chrome.runtime.lastError
        );
        return;
      }

      globalEnabled = result.enabled !== false;

      const dict = result.dictionary;
      if (!dict || !dict.categories) {
        console.log("CMS Highlighter: no dictionary found in storage.");
        return;
      }

      compileAndHighlight(dict);

      // Seed nav tracking
      lastSeenClient = getClientName();
      lastSeenType = getContentType();

      if (globalEnabled) {
        highlightAll(document.body);
        startObserver();
        startNavObserver();
      }
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.action) {
      sendResponse({ ok: false });
      return true;
    }

    switch (message.action) {
      case "toggle":
        globalEnabled = !!message.enabled;
        if (globalEnabled) {
          invalidateCache();
          removeAllHighlights();
          highlightAll(document.body);
          startObserver();
          startNavObserver();
        } else {
          stopObserver();
          stopNavObserver();
          removeAllHighlights();
        }
        sendResponse({ ok: true });
        break;

      case "refresh":
        chrome.storage.local.get(["dictionary", "enabled"], (result) => {
          globalEnabled = result.enabled !== false;

          const dict = result.dictionary;
          if (dict && dict.categories) {
            compileAndHighlight(dict);
          }

          invalidateCache();
          removeAllHighlights();
          if (globalEnabled) {
            highlightAll(document.body);
            startObserver();
            startNavObserver();
          } else {
            stopObserver();
            stopNavObserver();
          }

          sendResponse({ ok: true });
        });
        return true;

      case "getStats": {
        const clientName = getClientName();
        const contentType = getContentType();
        const resolvedCat = resolveClientCategory(clientName, contentType);
        sendResponse({
          highlights: document.querySelectorAll("." + HL_CLASS).length,
          clientHighlights: document.querySelectorAll("." + CLIENT_HL_CLASS).length,
          enabled: globalEnabled,
          categories: compiledAll && compiledAll.compiledCategories
            ? compiledAll.compiledCategories.length
            : 0,
          clientName: clientName,
          contentType: contentType,
          clientCategory: resolvedCat,
          clientEntries: clientsConfig.length,
        });
        break;
      }

      case "notify":
        if (message.message) console.log("CMS Highlighter:", message.message);
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
