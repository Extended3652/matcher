// =============================================================================
// CMS Highlighter — Content Script (simple rewrite)
// - Walk text nodes
// - Wrap matches in spans
// - Exactly one decision point: which matcher to use based on region
// - Client-only categories apply only in clientbar, and win there
// =============================================================================

(function() {
  "use strict";

  const MARKER_ATTR = "data-cms-hl-processed";
  const HL_CLASS = "cms-hl";

  // Categories that should ONLY affect the client field area (clientbar)
  // Add more later if you create other client-only category types.
  const CLIENT_ONLY_CATEGORIES = ["IMG Clients"];

  // Guardrails
  const MAX_SPAN_LEN = 120;

  let globalEnabled = true;

  // Compiled matchers
  let compiledClientOnly = null; // only CLIENT_ONLY_CATEGORIES
  let compiledNonClientOnly = null; // everything except CLIENT_ONLY_CATEGORIES

  // Priority map from original dictionary category order (lower = higher priority)
  let priorityByName = new Map();

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
  function getReviewRoot() {
    return (
      document.querySelector("div.ugcAndDetails") ||
      document.querySelector("dd.moderatable") ||
      document.querySelector("div.read") ||
      null
    );
  }

  function getNodeRegion(node) {
    const el = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!el || !el.closest) return "other";

    // Client panel area (real CMS navbar-inner, fake CMS sidebar)
    if (el.closest(".navbar-inner") || el.closest(".sidebar")) return "clientbar";

    // Review area
    const reviewRoot = getReviewRoot();
    if (reviewRoot && (el === reviewRoot || reviewRoot.contains(el))) return "review";

    return "other";
  }

  // ---------------------------------------------------------------------------
  // Dictionary helpers
  // ---------------------------------------------------------------------------
  function cloneDict(dict) {
    return JSON.parse(JSON.stringify(dict));
  }

  function getCategoryName(cat) {
    return (cat && (cat.name || cat.categoryName || cat.title || cat.label))
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

  function dictOnlyClientOnly(dict) {
    const d = cloneDict(dict);
    if (Array.isArray(d.categories)) {
      d.categories = d.categories.filter(c => CLIENT_ONLY_CATEGORIES.includes(normalizeName(getCategoryName(c))));
    }
    return d;
  }

  function dictWithoutClientOnly(dict) {
    const d = cloneDict(dict);
    if (Array.isArray(d.categories)) {
      d.categories = d.categories.filter(c => !CLIENT_ONLY_CATEGORIES.includes(normalizeName(getCategoryName(c))));
    }
    return d;
  }

  // ---------------------------------------------------------------------------
  // DOM walking
  // ---------------------------------------------------------------------------
  function getTextNodes(root) {
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
  // Match choosing and overlap resolution
  // ---------------------------------------------------------------------------
  function getPriority(catName, region) {
    const name = normalizeName(catName);

    // In clientbar, client-only categories always win
    if (region === "clientbar" && CLIENT_ONLY_CATEGORIES.includes(name)) {
      return -100000;
    }

    const p = priorityByName.get(name);
    return Number.isFinite(p) ? p : 999999;
  }

  function betterMatch(a, b, region) {
    // Returns true if a is better than b
    const pa = getPriority(a.categoryName, region);
    const pb = getPriority(b.categoryName, region);
    if (pa !== pb) return pa < pb;

    const la = (a.end - a.start);
    const lb = (b.end - b.start);
    if (la !== lb) return la > lb;

    // If still tied, prefer earlier start
    if (a.start !== b.start) return a.start < b.start;

    // Finally, prefer earlier end
    return a.end < b.end;
  }

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

  function resolveOverlaps(matches, region) {
    if (!Array.isArray(matches) || matches.length === 0) return [];

    // Sort by start asc, then prefer better match first
    matches.sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      // better first
      if (betterMatch(a, b, region)) return -1;
      if (betterMatch(b, a, region)) return 1;
      return (b.end - b.start) - (a.end - a.start);
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
      if (betterMatch(m, last, region)) {
        picked[picked.length - 1] = m;
      }
      // else keep last
    }

    // After replacement, picked might be slightly out of order in edge cases.
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
        frag.appendChild(document.createTextNode(text.slice(lastIndex, match.start)));
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
  // One decision point: which matcher to use based on region
  // ---------------------------------------------------------------------------
  function findMatchesForNode(text, region) {
    if (!text) return [];

    // Review: never use client-only categories
    if (region === "review") {
      return MatcherEngine.findMatches(text, compiledNonClientOnly) || [];
    }

    // Clientbar: run client-only and non-client-only, then resolve overlaps
    if (region === "clientbar") {
      const a = MatcherEngine.findMatches(text, compiledClientOnly) || [];
      const b = MatcherEngine.findMatches(text, compiledNonClientOnly) || [];
      return a.concat(b);
    }

    // Other: treat like review
    return MatcherEngine.findMatches(text, compiledNonClientOnly) || [];
  }

  function highlightTextNode(textNode) {
    if (isModStatusRoute()) return;
    if (!globalEnabled) return;
    if (!compiledNonClientOnly) return;

    if (!textNode || !textNode.parentNode) return;

    const text = textNode.textContent;
    if (!text || text.trim().length === 0) return;

    const region = getNodeRegion(textNode);

    let matches = findMatchesForNode(text, region);
    matches = sanitizeMatches(matches, text.length);
    if (matches.length === 0) return;

    matches = resolveOverlaps(matches, region);
    if (matches.length === 0) return;

    renderMatchesIntoNode(textNode, matches);
  }

  function highlightAll(root) {
    if (isModStatusRoute()) return;
    if (!globalEnabled) return;
    if (!compiledNonClientOnly) return;

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
      if (isModStatusRoute()) return;

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
  // Init + messages
  // ---------------------------------------------------------------------------
  function init() {
    if (isModStatusRoute()) {
      console.log("CMS Highlighter: disabled on modstatus route");
      return;
    }

    chrome.storage.local.get(["dictionary", "enabled"], (result) => {
      if (chrome.runtime.lastError) {
        console.error("CMS Highlighter: storage error", chrome.runtime.lastError);
        return;
      }

      globalEnabled = result.enabled !== false;

      const dict = result.dictionary;
      if (!dict || !dict.categories) {
        console.log("CMS Highlighter: no dictionary found in storage.");
        return;
      }

      priorityByName = buildPriorityMapFromDict(dict);

      // Compile two matchers
      const dictClientOnly = dictOnlyClientOnly(dict);
      const dictNonClientOnly = dictWithoutClientOnly(dict);

      compiledClientOnly = MatcherEngine.compileAll(dictClientOnly);
      compiledNonClientOnly = MatcherEngine.compileAll(dictNonClientOnly);

      console.log(
        "CMS Highlighter: compiled non-client-only cats=" + (compiledNonClientOnly.compiledCategories ? compiledNonClientOnly.compiledCategories.length : 0) +
        ", client-only cats=" + (compiledClientOnly.compiledCategories ? compiledClientOnly.compiledCategories.length : 0)
      );

      if (globalEnabled) {
        highlightAll(document.body);
        startObserver();
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
          removeAllHighlights();
          highlightAll(document.body);
          startObserver();
        } else {
          stopObserver();
          removeAllHighlights();
        }
        sendResponse({ ok: true });
        break;

      case "refresh":
        chrome.storage.local.get(["dictionary", "enabled"], (result) => {
          globalEnabled = result.enabled !== false;

          const dict = result.dictionary;
          if (dict && dict.categories) {
            priorityByName = buildPriorityMapFromDict(dict);
            compiledClientOnly = MatcherEngine.compileAll(dictOnlyClientOnly(dict));
            compiledNonClientOnly = MatcherEngine.compileAll(dictWithoutClientOnly(dict));
          }

          removeAllHighlights();
          if (globalEnabled) {
            highlightAll(document.body);
            startObserver();
          } else {
            stopObserver();
          }

          sendResponse({ ok: true });
        });
        return true;

      case "getStats":
        sendResponse({
          highlights: document.querySelectorAll("." + HL_CLASS).length,
          enabled: globalEnabled,
          catsNonClientOnly: compiledNonClientOnly && compiledNonClientOnly.compiledCategories ? compiledNonClientOnly.compiledCategories.length : 0,
          catsClientOnly: compiledClientOnly && compiledClientOnly.compiledCategories ? compiledClientOnly.compiledCategories.length : 0
        });
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
