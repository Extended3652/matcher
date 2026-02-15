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
    return document.querySelector(".navbar-inner .client-name")
        || document.querySelector(".client-name")
        || document.querySelector("[class*='client-name']");
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
      // Alphabetical tiebreaker for stable ordering
      return String(a.pattern || "").localeCompare(String(b.pattern || ""));
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
    if (!clientName) {
      console.debug("CMS Highlighter: no client name element found on page");
      return;
    }

    const rule = findClientRule(clientName);
    if (!rule) {
      console.debug("CMS Highlighter: no client rule matches '%s' (%d rules loaded)", clientName, clientRules.length);
      return;
    }

    const type = getCmsContentType();
    const catName = pickClientCategory(rule, type);
    if (!catName) {
      console.debug("CMS Highlighter: client '%s' type '%s' has no category set (rule: %s)", clientName, type, rule.pattern);
      return;
    }

    const style = categoryStyleByName.get(catName);
    if (!style) {
      console.warn("CMS Highlighter: category '%s' (from client '%s') not found in dictionary — was it renamed?", catName, clientName);
      return;
    }

    const el = getCmsClientNameEl();
    if (!el) return;

    el.style.backgroundColor = style.color;
    el.style.color = style.fColor;
    el.style.borderRadius = "3px";
    el.style.padding = "2px 6px";
    el.setAttribute("data-client-hl", "1");

    console.debug("CMS Highlighter: client '%s' → type '%s' → category '%s'", clientName, type, catName);
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
          const tag = node.parentElement.tagName;
          if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA" ||
              tag === "INPUT" || tag === "SELECT" || tag === "NOSCRIPT") {
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

  // ---------------------------------------------------------------------------
  // Inline element detection (for cross-node matching)
  // ---------------------------------------------------------------------------
  const BLOCK_TAGS = new Set([
    "ADDRESS","ARTICLE","ASIDE","BLOCKQUOTE","DETAILS","DIALOG","DD","DIV",
    "DL","DT","FIELDSET","FIGCAPTION","FIGURE","FOOTER","FORM","H1","H2",
    "H3","H4","H5","H6","HEADER","HGROUP","HR","LI","MAIN","NAV","OL","P",
    "PRE","SECTION","TABLE","TBODY","TD","TFOOT","TH","THEAD","TR","UL"
  ]);

  function isBlockElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    return BLOCK_TAGS.has(el.tagName);
  }

  // Find the nearest block-level ancestor of a text node
  function blockAncestor(textNode) {
    let el = textNode.parentElement;
    while (el && !isBlockElement(el) && el !== document.body) {
      el = el.parentElement;
    }
    return el || document.body;
  }

  // Group consecutive text nodes that share the same block ancestor.
  // Each group's texts are concatenated for matching, then results are
  // mapped back to individual nodes.
  function groupTextNodes(nodes) {
    const groups = [];
    let currentGroup = null;

    for (const node of nodes) {
      const block = blockAncestor(node);
      if (currentGroup && currentGroup.block === block) {
        currentGroup.nodes.push(node);
      } else {
        currentGroup = { block, nodes: [node] };
        groups.push(currentGroup);
      }
    }
    return groups;
  }

  // ---------------------------------------------------------------------------
  // Rendering for cross-node match groups
  // ---------------------------------------------------------------------------
  function highlightGroup(group) {
    if (isBlockedRoute()) return;
    if (!globalEnabled) return;
    if (!compiledMatcher) return;

    const nodes = group.nodes;
    if (nodes.length === 0) return;

    // Build combined text and offset map
    const segments = []; // { node, start, end } in combined string
    let combined = "";
    for (const node of nodes) {
      const text = node.textContent || "";
      segments.push({ node, start: combined.length, end: combined.length + text.length });
      combined += text;
    }

    if (!combined || combined.trim().length === 0) return;

    const matches = sanitizeMatches(findMatchesForText(combined), combined.length);
    if (matches.length === 0) return;

    // For single-node groups, use the fast path
    if (nodes.length === 1) {
      renderMatchesIntoNode(nodes[0], matches);
      return;
    }

    // Multi-node: map each match back to the nodes it spans.
    // Process nodes from last to first so DOM mutations don't affect earlier nodes.
    // First, build per-node match slices.
    const nodeSlices = segments.map(() => []);
    for (const match of matches) {
      for (let si = 0; si < segments.length; si++) {
        const seg = segments[si];
        // Does this match overlap this segment?
        const overlapStart = Math.max(match.start, seg.start);
        const overlapEnd = Math.min(match.end, seg.end);
        if (overlapStart < overlapEnd) {
          nodeSlices[si].push({
            start: overlapStart - seg.start,
            end: overlapEnd - seg.start,
            color: match.color,
            fColor: match.fColor,
            categoryName: match.categoryName
          });
        }
      }
    }

    // Render per-node slices (process in reverse to preserve DOM order)
    for (let si = segments.length - 1; si >= 0; si--) {
      const slices = nodeSlices[si];
      if (slices.length === 0) continue;
      const node = segments[si].node;
      if (!node || !node.parentNode) continue;
      renderMatchesIntoNode(node, slices);
    }
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

    // Group adjacent text nodes under the same block ancestor
    // so multi-word patterns can match across inline element boundaries
    const groups = groupTextNodes(textNodes);
    for (const group of groups) {
      highlightGroup(group);
    }
  }

  // ---------------------------------------------------------------------------
  // Clear highlights
  // ---------------------------------------------------------------------------
  function removeAllHighlights() {
    const spans = document.querySelectorAll("." + HL_CLASS);
    const parentsToNormalize = new Set();
    spans.forEach(span => {
      const parent = span.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(span.textContent), span);
      parentsToNormalize.add(parent);
    });

    // Batch normalize after all spans are replaced (avoids repeated reflows)
    parentsToNormalize.forEach(p => { try { p.normalize(); } catch (e) { console.warn("CMS Highlighter: normalize failed:", e.message); } });

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

        // Deduplicate: collect unique element roots to highlight.
        // If a parent element is in the batch, skip its child text nodes.
        const roots = new Set();
        let hasBody = false;

        for (const item of batch) {
          if (!item.node || !item.node.parentNode) continue;

          if (item.type === "element") {
            if (item.node === document.body || item.node === document.documentElement) {
              hasBody = true;
              break;
            }
            roots.add(item.node);
          } else {
            // For text nodes, add the block ancestor so we get cross-node matching
            const block = blockAncestor(item.node);
            if (block) roots.add(block);
          }
        }

        if (hasBody) {
          highlightAll(document.body);
        } else {
          for (const root of roots) {
            // Skip if this root is inside another root
            if (root.parentNode && roots.has(root.parentNode)) continue;
            highlightAll(root);
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
          clients: clientRules.length,
          clientName: getCmsClientName() || ""
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
