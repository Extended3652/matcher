// =============================================================================
// CMS Highlighter - Content Script
// - Walk text nodes (grouped by block container for cross-node phrase matching)
// - Wrap matches in spans
// - Client name in navbar can be highlighted based on dict.clients rules
// =============================================================================

(function() {
  "use strict";

  const MARKER_ATTR = "data-cms-hl-processed";
  const HL_CLASS = "cms-hl";

  // Guardrails
  const MAX_SPAN_LEN = 500;

  let globalEnabled = true;

  // Compiled matcher
  let compiledMatcher = null;

  // Client highlight config
  let clientRules = [];
  let categoryStyleByName = new Map();

  // Default color for client name area when no rule/category match
  let clientNameDefaultColor = null;
  let clientNameDefaultFColor = null;

  // Block-level tags used to group text nodes for cross-node phrase matching.
  // Text nodes that share the same nearest block ancestor are concatenated so
  // that multi-word patterns (e.g. "easy to swallow") can span inline elements.
  const BLOCK_TAGS = new Set([
    'P','DIV','LI','TD','TH','TR','TABLE','TBODY','THEAD','TFOOT',
    'ARTICLE','SECTION','MAIN','HEADER','FOOTER','NAV','ASIDE',
    'H1','H2','H3','H4','H5','H6','BLOCKQUOTE','PRE',
    'DL','DT','DD','FIGURE','FIGCAPTION','FORM','FIELDSET',
    'DETAILS','SUMMARY','DIALOG'
  ]);

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

    if (raw.includes("image") || raw.includes("photo")) return "Image";
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
    let bgColor = null;
    let fgColor = null;

    if (rule) {
      const type = getCmsContentType();
      const catName = pickClientCategory(rule, type);
      if (catName) {
        const style = categoryStyleByName.get(catName);
        if (style) {
          bgColor = style.color;
          fgColor = style.fColor;
        }
      }
    }

    // Fall back to global default client-name color (if set in dictionary)
    if (!bgColor && clientNameDefaultColor) {
      bgColor = clientNameDefaultColor;
      fgColor = clientNameDefaultFColor || "#000000";
    }

    if (!bgColor) return;

    const el = getCmsClientNameEl();
    if (!el) return;

    el.style.backgroundColor = bgColor;
    el.style.color = fgColor;
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

  // Returns the nearest block-level ancestor element (or document.body).
  // Used to group sibling inline text nodes together for cross-node matching.
  function nearestBlock(node) {
    let el = node.parentElement;
    while (el && el !== document.body) {
      if (BLOCK_TAGS.has(el.tagName || "")) return el;
      el = el.parentElement;
    }
    return document.body;
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
  // Single text-node highlight (used by observer for orphan nodes)
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
  // Group-highlight: concatenate adjacent text nodes within the same block
  // so that multi-word patterns can match across inline element boundaries.
  // E.g. "easy to swallow" split across <em>to</em> will now be found.
  // ---------------------------------------------------------------------------
  function highlightNodeGroup(nodes) {
    if (nodes.length === 0) return;

    // Single-node fast path: no concatenation needed
    if (nodes.length === 1) {
      highlightTextNode(nodes[0]);
      return;
    }

    // Build concatenated text and offset map
    const parts = [];
    let offset = 0;
    for (const node of nodes) {
      const text = node.textContent;
      parts.push({ node, start: offset, end: offset + text.length, len: text.length });
      offset += text.length;
    }
    const fullText = nodes.map(n => n.textContent).join("");

    const matches = sanitizeMatches(findMatchesForText(fullText), fullText.length);
    if (matches.length === 0) return;

    // Apply each match's relevant slice to each text node
    for (const part of parts) {
      if (!part.node.parentNode) continue; // already replaced by an earlier part

      const local = [];
      for (const m of matches) {
        if (m.start >= part.end || m.end <= part.start) continue;
        local.push({
          ...m,
          start: Math.max(0, m.start - part.start),
          end:   Math.min(part.len, m.end - part.start),
        });
      }
      if (local.length > 0) {
        renderMatchesIntoNode(part.node, local);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Highlight all text in a subtree, grouping nodes by block container
  // ---------------------------------------------------------------------------
  function highlightAll(root) {
    if (isBlockedRoute()) return;
    if (!globalEnabled) return;
    if (!compiledMatcher) return;

    const target = root || document.body;
    const textNodes = getTextNodes(target);
    if (textNodes.length === 0) return;

    // Group text nodes by their nearest block-level ancestor so that
    // multi-word phrases spanning inline elements match correctly.
    const blockGroups = new Map();
    for (const node of textNodes) {
      const block = nearestBlock(node);
      if (!blockGroups.has(block)) blockGroups.set(block, []);
      blockGroups.get(block).push(node);
    }

    for (const nodes of blockGroups.values()) {
      highlightNodeGroup(nodes);
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

        // Separate elements from text nodes, filter dead nodes
        const elementNodes = [];
        const textItems = [];
        for (const item of batch) {
          if (!item.node || !item.node.parentNode) continue;
          if (item.type === "element") elementNodes.push(item.node);
          else textItems.push(item.node);
        }

        // Build minimal ancestor set: no root is a descendant of another.
        // This prevents walking the same subtree multiple times when a parent
        // and its children are both in the same mutation batch.
        const roots = [];
        for (const node of elementNodes) {
          if (node === document.body || node === document.documentElement) {
            roots.length = 0;
            roots.push(document.body);
            break;
          }
          let dominated = false;
          for (const root of roots) {
            if (root.contains(node)) { dominated = true; break; }
          }
          if (!dominated) {
            for (let i = roots.length - 1; i >= 0; i--) {
              if (node.contains(roots[i])) roots.splice(i, 1);
            }
            roots.push(node);
          }
        }

        for (const root of roots) highlightAll(root);

        // Process orphan text nodes not already covered by a root
        for (const node of textItems) {
          if (!roots.some(r => r.contains(node))) highlightTextNode(node);
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
  // Helpers to load dict data into module-level state
  // ---------------------------------------------------------------------------
  function applyDict(dict) {
    if (!dict || !dict.categories) return false;

    compiledMatcher = MatcherEngine.compileAll(dict);
    categoryStyleByName = buildCategoryStyleMap(dict);

    clientRules = Array.isArray(dict.clients) ? dict.clients.slice() : [];
    for (const r of clientRules) {
      r._rx = globToRegex(r.pattern);
    }

    clientNameDefaultColor  = dict.clientNameDefaultColor  || null;
    clientNameDefaultFColor = dict.clientNameDefaultFColor || null;

    return true;
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

      if (!applyDict(result.dictionary)) {
        console.log("CMS Highlighter: no dictionary found in storage.");
        return;
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
          applyDict(result.dictionary);

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

      case "getClientName":
        sendResponse({
          clientName: getCmsClientName(),
          contentType: getCmsContentType()
        });
        break;

      case "notify":
        console.log("CMS Highlighter:", message.message);
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
