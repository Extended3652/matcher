// =============================================================================
// CMS Highlighter - Content Script
// - Group text nodes by block ancestor for cross-element phrase matching
// - Wrap matches in spans
// - Client name in navbar highlighted based on dict.clients rules
// =============================================================================

(function() {
  "use strict";

  const MARKER_ATTR = "data-cms-hl-processed";
  const HL_CLASS = "cms-hl";

  // Guardrails
  const MAX_SPAN_LEN = 120;

  // O(1) tag skip lookup (replaces per-node array allocation)
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "SELECT", "NOSCRIPT"]);

  // Block-level elements: text nodes inside different blocks are matched independently.
  // This prevents cross-paragraph phrase matches while enabling cross-inline-element phrases.
  const BLOCK_TAGS = new Set([
    "P", "DIV", "LI", "TD", "TH", "BLOCKQUOTE", "PRE",
    "H1", "H2", "H3", "H4", "H5", "H6",
    "ARTICLE", "SECTION", "ASIDE", "HEADER", "FOOTER", "MAIN", "NAV",
    "FIGURE", "FIGCAPTION", "DETAILS", "SUMMARY", "TR"
  ]);

  let globalEnabled = true;

  // Compiled matcher
  let compiledMatcher = null;

  // Client highlight config
  let clientRules = [];
  let categoryStyleByName = new Map();

  // Generation counter: incremented on every highlightAll / removeAllHighlights call.
  // In-flight async chunk processors compare against this and abort if it changed.
  let highlightGeneration = 0;

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
    return (
      document.querySelector(".navbar-inner .client-name") ||
      document.querySelector(".client-name") ||
      document.querySelector("[data-client-name]")
    );
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

    if (contentType === "Image"   && overrides.Image)    return overrides.Image;
    if (contentType === "Profile" && overrides.Profile)  return overrides.Profile;
    if (contentType === "Question" && overrides.Question) return overrides.Question;
    if (contentType === "Comment" && overrides.Comment)  return overrides.Comment;

    return rule.defaultCategory || null;
  }

  function applyClientHighlight() {
    const el = getCmsClientNameEl();

    // Clear previous highlight
    if (el && el.hasAttribute("data-client-hl")) {
      el.style.backgroundColor = "";
      el.style.color = "";
      el.style.borderRadius = "";
      el.style.padding = "";
      el.removeAttribute("data-client-hl");
    }

    if (isBlockedRoute() || !globalEnabled || !el) return;

    const clientName = String(el.textContent || "").trim();
    if (!clientName) return;

    const rule = findClientRule(clientName);
    if (!rule) return;

    const catName = pickClientCategory(rule, getCmsContentType());
    if (!catName) return;

    const style = categoryStyleByName.get(catName);
    if (!style) return;

    el.style.backgroundColor = style.color;
    el.style.color = style.fColor;
    el.style.borderRadius = "3px";
    el.style.padding = "2px 6px";
    el.setAttribute("data-client-hl", "1");
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

  // ---------------------------------------------------------------------------
  // DOM walking — group text nodes by block ancestor
  // ---------------------------------------------------------------------------
  function shouldSkipNode(node) {
    if (!node || !node.parentElement) return true;
    if (node.parentElement.classList.contains(HL_CLASS)) return true;
    if (node.parentElement.hasAttribute(MARKER_ATTR)) return true;
    if (SKIP_TAGS.has(node.parentElement.tagName || "")) return true;
    return false;
  }

  function getBlockAncestor(node) {
    let el = node.parentElement;
    while (el && el !== document.body) {
      if (BLOCK_TAGS.has(el.tagName)) return el;
      el = el.parentElement;
    }
    return document.body;
  }

  // Returns groups: each group = { nodes[], offsets[], combined }
  // All text nodes under the same block ancestor are concatenated so that
  // multi-word patterns spanning inline elements (e.g. <span>makes my</span> <span>nose run</span>)
  // can be matched as a single string.
  function groupTextNodes(root) {
    const target = root || document.body;
    const walker = document.createTreeWalker(
      target,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          return shouldSkipNode(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const groupMap = new Map(); // block element → group object

    while (walker.nextNode()) {
      const node = walker.currentNode;
      // Include whitespace-only nodes — they contribute spaces between inline elements
      // (e.g. the space between </span> and <span>) so cross-element phrases match correctly.
      const block = getBlockAncestor(node);
      if (!groupMap.has(block)) {
        groupMap.set(block, { nodes: [], offsets: [], combined: "" });
      }
      const g = groupMap.get(block);
      g.offsets.push(g.combined.length);
      g.combined += node.textContent;
      g.nodes.push(node);
    }

    // Only return groups with actual visible text
    return Array.from(groupMap.values()).filter(g => g.combined.trim().length > 0);
  }

  // ---------------------------------------------------------------------------
  // Match sanitization
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
  // Rendering — split a text node at match boundaries and wrap in spans
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
  // Highlight one group (cross-node phrase matching)
  // ---------------------------------------------------------------------------
  function findMatchesForText(text) {
    if (!text || !compiledMatcher) return [];
    return MatcherEngine.findMatches(text, compiledMatcher) || [];
  }

  function highlightGroup(group) {
    const { nodes, offsets, combined } = group;
    if (!combined || !compiledMatcher) return;

    const matches = sanitizeMatches(findMatchesForText(combined), combined.length);
    if (matches.length === 0) return;

    for (let ni = 0; ni < nodes.length; ni++) {
      const node = nodes[ni];
      if (!node.parentNode) continue;

      // Whitespace-only nodes included for spacing but have nothing to highlight
      if (!node.textContent.trim()) continue;

      const nodeStart = offsets[ni];
      const nodeEnd = nodeStart + node.textContent.length;

      // Collect matches that overlap with this node's slice of the combined string
      const nodeMatches = [];
      for (const m of matches) {
        const s = Math.max(m.start, nodeStart);
        const e = Math.min(m.end, nodeEnd);
        if (s >= e) continue;
        nodeMatches.push({ ...m, start: s - nodeStart, end: e - nodeStart });
      }

      if (nodeMatches.length > 0) {
        renderMatchesIntoNode(node, nodeMatches);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // highlightAll — chunked async so the page stays responsive
  // ---------------------------------------------------------------------------
  function highlightAll(root) {
    if (isBlockedRoute()) return;
    if (!globalEnabled) return;
    if (!compiledMatcher) return;

    highlightGeneration++;
    const gen = highlightGeneration;

    const groups = groupTextNodes(root || document.body);
    const CHUNK = 20; // block groups per frame

    let i = 0;
    function processChunk() {
      if (gen !== highlightGeneration) return; // cancelled by removeAllHighlights or new refresh

      const end = Math.min(i + CHUNK, groups.length);
      for (; i < end; i++) {
        if (gen !== highlightGeneration) return;
        highlightGroup(groups[i]);
      }

      if (i < groups.length) {
        setTimeout(processChunk, 0); // yield to browser, then continue
      }
    }

    processChunk();
  }

  // ---------------------------------------------------------------------------
  // Clear highlights
  // ---------------------------------------------------------------------------
  function removeAllHighlights() {
    highlightGeneration++; // cancel any in-flight async chunks

    const spans = document.querySelectorAll("." + HL_CLASS);
    const parents = new Set();
    spans.forEach(span => {
      const parent = span.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(span.textContent), span);
      parents.add(parent);
    });
    // Normalize once per parent (avoids redundant reflows)
    parents.forEach(p => p.normalize());

    const marked = document.querySelectorAll("[" + MARKER_ATTR + "]");
    marked.forEach(el => el.removeAttribute(MARKER_ATTR));

    clearClientHighlight();
  }

  // ---------------------------------------------------------------------------
  // Observer — with element-level deduplication
  // ---------------------------------------------------------------------------
  let observer = null;
  let debounceTimer = null;
  let pendingSet = new Set(); // deduplicates elements (and block ancestors of text nodes)

  function startObserver() {
    if (observer) return;

    observer = new MutationObserver((mutations) => {
      if (isBlockedRoute()) return;

      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          const node = mutation.target;
          if (
            node.nodeType === Node.TEXT_NODE &&
            node.parentElement &&
            !node.parentElement.classList.contains(HL_CLASS) &&
            !node.parentElement.hasAttribute(MARKER_ATTR)
          ) {
            // Re-scan the block ancestor so group-based matching picks up the change
            pendingSet.add(getBlockAncestor(node));
          }
          continue;
        }

        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.classList && node.classList.contains(HL_CLASS)) continue;
            pendingSet.add(node);
          } else if (node.nodeType === Node.TEXT_NODE) {
            if (node.parentElement && !node.parentElement.classList.contains(HL_CLASS)) {
              pendingSet.add(getBlockAncestor(node));
            }
          }
        }
      }

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const nodes = Array.from(pendingSet);
        pendingSet = new Set();

        for (const node of nodes) {
          if (!node || !node.parentNode) continue;
          if (node === document.body || node === document.documentElement) {
            highlightAll(document.body);
          } else {
            highlightAll(node);
          }
        }

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
    pendingSet = new Set();
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

      compiledMatcher = MatcherEngine.compileAll(dict);
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
          cats: compiledMatcher && compiledMatcher.compiledCategories
            ? compiledMatcher.compiledCategories.length : 0,
          clients: clientRules.length
        });
        break;

      case "getClientName":
        sendResponse({ clientName: getCmsClientName() });
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
