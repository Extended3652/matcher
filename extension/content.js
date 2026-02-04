// =============================================================================
// CMS Highlighter - Content Script (simple rewrite)
// - Walk text nodes
// - Wrap matches in spans
// - Exactly one decision point: which matcher to use based on region
// - Client name in navbar can be highlighted based on dict.clients rules
// =============================================================================

(function() {
  "use strict";

  const MARKER_ATTR = "data-cms-hl-processed";
  const HL_CLASS = "cms-hl";

  // We are NOT using a special "IMG Clients" category anymore.
  const CLIENT_ONLY_CATEGORIES = [];

  // Guardrails
  const MAX_SPAN_LEN = 120;

  let globalEnabled = true;

  // Compiled matchers
  let compiledClientOnly = null; // only CLIENT_ONLY_CATEGORIES
  let compiledNonClientOnly = null; // everything except CLIENT_ONLY_CATEGORIES

  // Priority map from original dictionary category order (lower = higher priority)
  let priorityByName = new Map();

  // Client highlight config
  let clientRules = [];
  let categoryStyleByName = new Map();

  // Selector caching - cleared per processing batch
  let cachedReviewRoot = undefined; // undefined = not cached, null = no root found
  let cacheTimestamp = 0;
  const CACHE_TTL_MS = 50; // Cache valid for 50ms (within a batch)

  // Navigation detection - track last client/type to detect SPA navigation
  let lastClientName = "";
  let lastContentType = "";

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
  // Region detection (with caching)
  // ---------------------------------------------------------------------------
  function invalidateCache() {
    cachedReviewRoot = undefined;
    cacheTimestamp = 0;
  }

  function getReviewRoot() {
    const now = Date.now();
    if (cachedReviewRoot !== undefined && (now - cacheTimestamp) < CACHE_TTL_MS) {
      return cachedReviewRoot;
    }

    // Cache miss - do the expensive querySelector calls
    cachedReviewRoot = (
      document.querySelector("div.ugcAndDetails") ||
      document.querySelector("dd.moderatable") ||
      document.querySelector("div.read") ||
      null
    );
    cacheTimestamp = now;
    return cachedReviewRoot;
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

  function buildCategoryStyleMap(dict) {
    const map = new Map();
    const cats = Array.isArray(dict.categories) ? dict.categories : [];
    for (const c of cats) {
      const name = normalizeName(getCategoryName(c));
      if (!name) continue;
      map.set(name, {
        color: c.color || "#FFFF00",
        fColor: c.fColor || "#000000"
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

    if (raw.includes("image")) return "Image";
    if (raw.includes("profile")) return "Profile";
    if (raw.includes("question")) return "Question";
    return "Default";
  }

  function globToRegex(pattern) {
    const p = String(pattern || "").trim();
    if (!p) return null;

    // Escape regex specials, then convert * and ? to wildcards
    const escaped = p.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const rx = "^" + escaped.replace(/\*/g, ".*").replace(/\?/g, ".") + "$";

    try {
      return new RegExp(rx, "i");
    } catch (e) {
      return null;
    }
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

    // Default: blank means no highlight
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

    // blank means no highlight
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

    // In clientbar, client-only categories always win (not used currently)
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

    if (a.start !== b.start) return a.start < b.start;
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

    matches.sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
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

      if (betterMatch(m, last, region)) {
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

    if (region === "review") {
      return MatcherEngine.findMatches(text, compiledNonClientOnly) || [];
    }

    if (region === "clientbar") {
      const a = MatcherEngine.findMatches(text, compiledClientOnly) || [];
      const b = MatcherEngine.findMatches(text, compiledNonClientOnly) || [];
      return a.concat(b);
    }

    return MatcherEngine.findMatches(text, compiledNonClientOnly) || [];
  }

  function highlightTextNode(textNode) {
    if (isBlockedRoute()) return;
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
    if (isBlockedRoute()) return;
    if (!globalEnabled) return;
    if (!compiledNonClientOnly) return;

    // Invalidate cache for fresh lookups at start of batch
    if (root === document.body) {
      invalidateCache();
    }

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
  // Observer + Navigation Detection
  // ---------------------------------------------------------------------------
  let observer = null;
  let debounceTimer = null;
  let pendingNodes = [];
  let navPollTimer = null;

  // Check if SPA navigated to new content (client or content type changed)
  function checkNavigation() {
    const currentClient = getCmsClientName();
    const currentType = getCmsContentType();

    // If client or content type changed, we navigated
    if (currentClient !== lastClientName || currentType !== lastContentType) {
      console.log("CMS Highlighter: navigation detected, clearing highlights");
      lastClientName = currentClient;
      lastContentType = currentType;
      invalidateCache();
      removeAllHighlights();
      highlightAll(document.body);
      applyClientHighlight();
    }
  }

  function startNavPoll() {
    if (navPollTimer) return;
    navPollTimer = setInterval(checkNavigation, 500);
  }

  function stopNavPoll() {
    if (navPollTimer) {
      clearInterval(navPollTimer);
      navPollTimer = null;
    }
  }

  function startObserver() {
    if (observer) return;

    // Track seen nodes to avoid duplicates within a batch
    let seenNodes = new WeakSet();

    observer = new MutationObserver((mutations) => {
      if (isBlockedRoute()) return;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          // Skip already-seen nodes
          if (seenNodes.has(node)) continue;

          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.classList && node.classList.contains(HL_CLASS)) continue;
            seenNodes.add(node);
            pendingNodes.push({ type: "element", node });
          } else if (node.nodeType === Node.TEXT_NODE) {
            if (node.parentElement && !node.parentElement.classList.contains(HL_CLASS)) {
              seenNodes.add(node);
              pendingNodes.push({ type: "text", node });
            }
          }
        }
      }

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const batch = pendingNodes;
        pendingNodes = [];
        seenNodes = new WeakSet(); // Reset for next batch
        invalidateCache(); // Clear selector cache for new batch

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

        // Also update the client-name highlight when the header changes
        applyClientHighlight();
      }, 80);
    });

    observer.observe(document.body, { childList: true, subtree: true });
    startNavPoll(); // Start navigation detection polling
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    pendingNodes = [];
    stopNavPoll(); // Stop navigation detection
  }

  // ---------------------------------------------------------------------------
  // Init + messages
  // ---------------------------------------------------------------------------
  function init() {
    if (isBlockedRoute()) {
      console.log("CMS Highlighter: disabled on this route");
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

      // Compile matchers
      compiledClientOnly = MatcherEngine.compileAll(dictOnlyClientOnly(dict));
      compiledNonClientOnly = MatcherEngine.compileAll(dictWithoutClientOnly(dict));

      // Build client highlight maps
      categoryStyleByName = buildCategoryStyleMap(dict);
      clientRules = Array.isArray(dict.clients) ? dict.clients.slice() : [];
      for (const r of clientRules) {
        r._rx = globToRegex(r.pattern);
      }

      console.log(
        "CMS Highlighter: compiled non-client-only cats=" + (compiledNonClientOnly.compiledCategories ? compiledNonClientOnly.compiledCategories.length : 0) +
        ", client-only cats=" + (compiledClientOnly.compiledCategories ? compiledClientOnly.compiledCategories.length : 0) +
        ", clients=" + clientRules.length
      );

      // Initialize navigation tracking
      lastClientName = getCmsClientName();
      lastContentType = getCmsContentType();

      if (globalEnabled) {
        highlightAll(document.body);
        applyClientHighlight();
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
          applyClientHighlight();
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

            categoryStyleByName = buildCategoryStyleMap(dict);
            clientRules = Array.isArray(dict.clients) ? dict.clients.slice() : [];
            for (const r of clientRules) {
              r._rx = globToRegex(r.pattern);
            }
          }

          removeAllHighlights();
          if (globalEnabled) {
            highlightAll(document.body);
            applyClientHighlight();
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
          catsClientOnly: compiledClientOnly && compiledClientOnly.compiledCategories ? compiledClientOnly.compiledCategories.length : 0,
          clients: clientRules.length
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
