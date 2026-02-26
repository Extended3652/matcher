// =============================================================================
// CMS Highlighter - Content Script
// - Walk text nodes grouped by block-level ancestor (cross-node phrase matching)
// - Wrap matches in spans
// - Client name in navbar can be highlighted based on dict.clients rules
// =============================================================================

(function() {
  "use strict";

  const MARKER_ATTR = "data-cms-hl-processed";
  const HL_CLASS = "cms-hl";

  // Guardrails
  const MAX_SPAN_LEN = 120;

  let globalEnabled = true;

  // Compiled matcher
  let compiledMatcher = null;

  // Client highlight config
  let clientRules = [];
  let categoryStyleByName = new Map();

  // Retry timers for SPA late-loading content
  let retryTimers = [];

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
    if (raw.includes("comment")) return "Comment";
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

    if (contentType === "Image"   && overrides.Image)   return overrides.Image;
    if (contentType === "Profile" && overrides.Profile) return overrides.Profile;
    if (contentType === "Question" && overrides.Question) return overrides.Question;
    if (contentType === "Comment" && overrides.Comment) return overrides.Comment;

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
  // Block-level grouping for cross-node phrase matching
  // ---------------------------------------------------------------------------
  const BLOCK_TAGS = new Set([
    "ADDRESS","ARTICLE","ASIDE","BLOCKQUOTE","CANVAS","DD","DIV","DL","DT",
    "FIELDSET","FIGCAPTION","FIGURE","FOOTER","FORM","H1","H2","H3","H4","H5","H6",
    "HEADER","HR","LI","MAIN","NAV","OL","P","PRE","SECTION","SUMMARY",
    "TABLE","TBODY","TD","TH","THEAD","TFOOT","TR","UL"
  ]);

  function nearestBlockAncestor(node) {
    let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (el && el !== document.body) {
      if (BLOCK_TAGS.has(el.tagName)) return el;
      el = el.parentElement;
    }
    return document.body;
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
  // Run matcher on text
  // ---------------------------------------------------------------------------
  function findMatchesForText(text) {
    if (!text || !compiledMatcher) return [];
    return MatcherEngine.findMatches(text, compiledMatcher) || [];
  }

  // ---------------------------------------------------------------------------
  // Block-level highlight: groups text nodes by block ancestor for cross-node
  // phrase matching (e.g. "customer service" spanning a <strong> tag).
  // ---------------------------------------------------------------------------
  function highlightBlock(textNodes) {
    if (!textNodes || textNodes.length === 0) return;

    // Build virtual concatenated text with position mapping
    const segments = []; // { node, vStart, vEnd }
    let vText = "";

    for (const node of textNodes) {
      if (!node.parentNode) continue; // detached node
      const text = node.textContent;
      if (!text) continue;
      segments.push({ node, vStart: vText.length, vEnd: vText.length + text.length });
      vText += text;
    }

    if (!vText.trim() || segments.length === 0) return;

    const matches = sanitizeMatches(findMatchesForText(vText), vText.length);
    if (matches.length === 0) return;

    // Distribute each match's coverage to the text nodes it overlaps
    const nodeOps = new Map(); // textNode → [{start, end, categoryName, color, fColor}]

    for (const match of matches) {
      for (const seg of segments) {
        const lo = Math.max(match.start, seg.vStart);
        const hi = Math.min(match.end, seg.vEnd);
        if (lo >= hi) continue;

        if (!nodeOps.has(seg.node)) nodeOps.set(seg.node, []);
        nodeOps.get(seg.node).push({
          start: lo - seg.vStart,
          end:   hi - seg.vStart,
          categoryName: match.categoryName,
          color:        match.color,
          fColor:       match.fColor,
        });
      }
    }

    // Render into each affected text node
    for (const [node, ops] of nodeOps) {
      if (!node.parentNode) continue;
      ops.sort((a, b) => a.start - b.start);
      renderMatchesIntoNode(node, ops);
    }
  }

  // ---------------------------------------------------------------------------
  // Highlight a single text node (used for characterData mutations)
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // highlightAll: gather text nodes, group by block ancestor, process each block
  // ---------------------------------------------------------------------------
  function highlightAll(root) {
    if (isBlockedRoute()) return;
    if (!globalEnabled) return;
    if (!compiledMatcher) return;

    const target = root || document.body;
    const textNodes = getTextNodes(target);
    if (textNodes.length === 0) return;

    // Group by nearest block-level ancestor so that multi-word phrases that
    // span inline elements (e.g. "customer <strong>service</strong>") are still
    // matched as a phrase against the higher-priority category.
    const blockGroups = new Map();
    for (const node of textNodes) {
      const block = nearestBlockAncestor(node);
      if (!blockGroups.has(block)) blockGroups.set(block, []);
      blockGroups.get(block).push(node);
    }

    for (const nodes of blockGroups.values()) {
      highlightBlock(nodes);
    }
  }

  // ---------------------------------------------------------------------------
  // Clear highlights
  // ---------------------------------------------------------------------------
  function removeAllHighlights() {
    const spans = document.querySelectorAll("." + HL_CLASS);
    const parents = new Set();
    spans.forEach(span => {
      const parent = span.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(span.textContent), span);
      parents.add(parent);
    });
    // Normalize once per parent, not once per span (avoids redundant reflows)
    parents.forEach(p => p.normalize());

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
        // Text node content changed in-place (e.g. SPA framework updating nodeValue/data)
        if (mutation.type === "characterData") {
          const node = mutation.target;
          if (
            node.nodeType === Node.TEXT_NODE &&
            node.parentElement &&
            !node.parentElement.classList.contains(HL_CLASS) &&
            !node.parentElement.hasAttribute(MARKER_ATTR)
          ) {
            pendingNodes.push({ type: "text", node });
          }
          continue;
        }

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

        // Also update the client-name highlight when the header changes
        applyClientHighlight();
      }, 80);
    });

    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    pendingNodes = [];
  }

  // ---------------------------------------------------------------------------
  // SPA hash-change handler (re-scan when route changes)
  // ---------------------------------------------------------------------------
  function onHashChange() {
    if (isBlockedRoute()) {
      removeAllHighlights();
      return;
    }
    if (!globalEnabled || !compiledMatcher) return;

    // Brief delay to let the SPA render the new view
    setTimeout(() => {
      removeAllHighlights();
      highlightAll(document.body);
      applyClientHighlight();
    }, 250);
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

      // Compile matcher
      compiledMatcher = MatcherEngine.compileAll(dict);

      // Build client highlight maps
      categoryStyleByName = buildCategoryStyleMap(dict);
      clientRules = Array.isArray(dict.clients) ? dict.clients.slice() : [];
      for (const r of clientRules) {
        r._rx = globToRegex(r.pattern);
      }

      console.log(
        "CMS Highlighter: compiled " +
        (compiledMatcher.compiledCategories ? compiledMatcher.compiledCategories.length : 0) +
        " categories, " + clientRules.length + " client rules"
      );

      if (globalEnabled) {
        highlightAll(document.body);
        applyClientHighlight();
        startObserver();

        // Retry scans for SPA content that loads after initial paint
        // (clear any previous timers first)
        retryTimers.forEach(t => clearTimeout(t));
        retryTimers = [300, 1500, 4000].map(delay =>
          setTimeout(() => {
            if (globalEnabled && compiledMatcher && !isBlockedRoute()) {
              highlightAll(document.body);
              applyClientHighlight();
            }
          }, delay)
        );
      }
    });
  }

  window.addEventListener("hashchange", onHashChange, { passive: true });

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
            compiledMatcher = MatcherEngine.compileAll(dict);

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
          cats: compiledMatcher && compiledMatcher.compiledCategories ? compiledMatcher.compiledCategories.length : 0,
          clients: clientRules.length
        });
        break;

      case "getClientInfo": {
        const clientName = getCmsClientName();
        const rule = findClientRule(clientName);
        const type = getCmsContentType();
        const catName = rule ? pickClientCategory(rule, type) : null;
        const catStyle = catName ? categoryStyleByName.get(catName) : null;
        sendResponse({
          clientName: clientName || "",
          pattern:    rule ? (rule.pattern || "") : "",
          catName:    catName || "",
          catColor:   catStyle ? catStyle.color  : "",
          catFColor:  catStyle ? catStyle.fColor : "",
          contentType: type,
        });
        break;
      }

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
