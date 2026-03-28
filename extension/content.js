/* global log, MatcherEngine */
// =============================================================================
// CMS Highlighter - Content Script
// - Walk text nodes
// - Wrap matches in spans
// - Client name in navbar can be highlighted based on dict.clients rules
// =============================================================================

(function () {
  "use strict";

  const MARKER_ATTR = "data-cms-hl-processed";
  const HL_CLASS = "cms-hl";

  // Guardrails
  const MAX_SPAN_LEN = 120;
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "SELECT", "NOSCRIPT"]);

  // Tuning constants
  const WILDCARD_MAX_GAP = 60;
  const NODE_BATCH_SIZE = 200;
  const IDLE_CALLBACK_TIMEOUT_MS = 500;
  const MUTATION_DEBOUNCE_MS = 80;
  const STORAGE_CHANGE_DEBOUNCE_MS = 150;

  let globalEnabled = true;

  // Compiled matcher
  let compiledMatcher = null;

  // Client highlight config
  let clientRules = [];
  let categoryStyleByName = new Map();
  let currentMentionMatcher = null; // compiled mention patterns for the current page's client
  let _cachedMentionKey = null; // "<clientName>|<contentType>" — skip recompile when unchanged
  let _highlightCount = 0; // cached count of highlight spans on the page
  let _clientNameEl = null; // cached .navbar-inner .client-name element

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
      const name = c && c.name ? String(c.name).trim() : "";
      if (!name) continue;
      map.set(name, {
        color: c.color || "#FFFF00",
        fColor: c.fColor || "#000000",
      });
    }
    return map;
  }

  // ---------------------------------------------------------------------------
  // Client-name highlight
  // ---------------------------------------------------------------------------
  function getCmsClientNameEl() {
    if (!_clientNameEl || !_clientNameEl.isConnected) {
      _clientNameEl = document.querySelector(".navbar-inner .client-name");
    }
    return _clientNameEl;
  }

  function getCmsClientName() {
    const el = getCmsClientNameEl();
    return el ? String(el.textContent || "").trim() : "";
  }

  function getCmsContentType() {
    const el = document.querySelector("span.decisionAreaLabel");
    const raw = el
      ? String(el.textContent || "")
          .trim()
          .toLowerCase()
      : "";

    if (raw.includes("image")) return "Image";
    if (raw.includes("profile")) return "Profile";
    if (raw.includes("question") || raw.includes("answer")) return "Question";
    if (raw.includes("comment")) return "Comment";
    return "Default";
  }

  function getCmsContentRoot() {
    return (
      document.querySelector("div.ugcAndDetails") ||
      document.querySelector("dd.moderatable") ||
      document.querySelector("div.read") ||
      document.body
    );
  }

  function globToRegex(pattern) {
    const p = String(pattern || "").trim();
    if (!p) return null;

    // Walk char-by-char to support \* and \? escapes (literal * and ?)
    // and convert unescaped * / ? to bounded wildcards.
    let rx = "^";
    const chars = [...p];
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (ch === "\\" && chars[i + 1] !== undefined) {
        // Escaped: treat next char literally
        rx += chars[i + 1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        i++;
      } else if (ch === "*") {
        // Bound to 60 chars: client names can contain spaces and punctuation
        // (e.g. "Acme Corp — US"), so we use [\s\S] and a wider bound than
        // matcher-core's word wildcards (which use {0,30} and exclude \s\p{P}).
        rx += "[\\s\\S]{0," + WILDCARD_MAX_GAP + "}";
      } else if (ch === "?") {
        rx += "[\\s\\S]";
      } else {
        rx += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
    }
    rx += "$";

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
      if (!r || !(r._rx instanceof RegExp)) continue;
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
    if (contentType === "Comment" && overrides.Comment) return overrides.Comment;

    // Default: blank means no highlight
    return rule.defaultCategory || null;
  }

  function buildMentionMatcher(rule) {
    if (!rule || !rule.mentionCategory) return null;
    const catStyle = categoryStyleByName.get(rule.mentionCategory);
    if (!catStyle) return null;

    const patterns = [];
    if (rule.includePatternInContent !== false && rule.pattern) {
      patterns.push(rule.pattern);
    }
    (rule.aliases || []).forEach((a) => {
      const s = String(a || "").trim();
      if (s) patterns.push(s);
    });
    if (!patterns.length) return null;

    // Compile aliases as category words via MatcherEngine so wildcards + exact syntax work.
    const fakeCat = {
      id: "__mention__",
      name: rule.mentionCategory,
      color: catStyle.color,
      fColor: catStyle.fColor,
      words: patterns,
      enabled: true,
    };
    const compiled = MatcherEngine.compileAll({ categories: [fakeCat], ignoreList: [] });
    return compiled.compiledCategories.length > 0 ? compiled : null;
  }

  // Merge category matches and mention matches into one sorted array.
  // Category matches take priority — mention matches that overlap are dropped.
  function mergeMatches(catMatches, mentionMatches) {
    if (!mentionMatches || !mentionMatches.length) return catMatches;
    if (!catMatches || !catMatches.length) return mentionMatches;
    // Binary search: find first catMatch whose end > mm.start, then check overlap.
    // O(n log m) instead of O(n*m).
    const filtered = mentionMatches.filter((mm) => {
      let lo = 0,
        hi = catMatches.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (catMatches[mid].end <= mm.start) lo = mid + 1;
        else hi = mid;
      }
      return lo >= catMatches.length || catMatches[lo].start >= mm.end;
    });
    return [...catMatches, ...filtered].sort((a, b) => a.start - b.start);
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
    // Single querySelector for the whole function — used for both clearing and styling.
    const el = getCmsClientNameEl();

    // Clear any existing client highlight inline (avoids a second querySelector).
    if (el && el.hasAttribute("data-client-hl")) {
      el.style.backgroundColor = "";
      el.style.color = "";
      el.style.borderRadius = "";
      el.style.padding = "";
      el.removeAttribute("data-client-hl");
    }

    if (isBlockedRoute() || !globalEnabled) {
      currentMentionMatcher = null;
      _cachedMentionKey = null;
      return;
    }

    if (!el) {
      currentMentionMatcher = null;
      _cachedMentionKey = null;
      return;
    }

    const clientName = String(el.textContent || "").trim();
    if (!clientName) {
      currentMentionMatcher = null;
      _cachedMentionKey = null;
      return;
    }

    const rule = findClientRule(clientName);
    if (!rule) {
      currentMentionMatcher = null;
      _cachedMentionKey = null;
      return;
    }

    const type = getCmsContentType();

    // Only recompile the mention matcher when the client or content type has changed.
    const mentionKey = clientName + "|" + type;
    if (mentionKey !== _cachedMentionKey) {
      currentMentionMatcher = buildMentionMatcher(rule);
      _cachedMentionKey = mentionKey;
    }

    const catName = pickClientCategory(rule, type);

    // blank means no highlight
    if (!catName) return;

    const style = categoryStyleByName.get(catName);
    if (!style) return;

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
    // Cache once per call — avoids repeated .closest() traversal for every text node.
    const navbarInner = document.querySelector(".navbar-inner");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node || !node.parentElement) return NodeFilter.FILTER_REJECT;

        // Skip nodes inside our own highlights
        if (node.parentElement.classList.contains(HL_CLASS)) {
          return NodeFilter.FILTER_REJECT;
        }

        // Skip the navbar — highlighted exclusively by applyClientHighlight()
        // so that category spans don't override the block-level background colour.
        if (navbarInner && navbarInner.contains(node.parentElement)) {
          return NodeFilter.FILTER_REJECT;
        }

        // Skip script/style/textarea/input/select/noscript
        const tag = node.parentElement.tagName || "";
        if (SKIP_TAGS.has(tag)) {
          return NodeFilter.FILTER_REJECT;
        }

        // Skip contenteditable regions (user-editable rich text, e.g. TinyMCE body).
        // Traverse ancestors because the editable attribute may be on a grandparent.
        for (let ce = node.parentElement; ce; ce = ce.parentElement) {
          if (ce.isContentEditable) return NodeFilter.FILTER_REJECT;
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
  // Match sanitization (matcher-core.js already resolves overlaps)
  // ---------------------------------------------------------------------------
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
      _highlightCount++;

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

  function highlightTextNode(textNode) {
    if (isBlockedRoute()) return;
    if (!globalEnabled) return;
    if (!compiledMatcher) return;

    if (!textNode || !textNode.parentNode) return;

    const text = textNode.textContent;
    if (!text || text.trim().length === 0) return;

    const catMatches = sanitizeMatches(findMatchesForText(text), text.length);
    const mentionMatches = currentMentionMatcher
      ? sanitizeMatches(MatcherEngine.findMatches(text, currentMentionMatcher) || [], text.length)
      : [];

    const matches = mergeMatches(catMatches, mentionMatches);
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

  // Chunked variant for the initial full-page scan.
  // Yields between 200-node batches via requestIdleCallback (or setTimeout) so
  // the browser can render and respond to input between chunks.
  function highlightAllChunked(root) {
    if (isBlockedRoute()) return;
    if (!globalEnabled) return;
    if (!compiledMatcher) return;

    const target = root || document.body;
    const nodes = getTextNodes(target);
    if (nodes.length === 0) return;

    // When the content root falls back to document.body, prioritize nodes
    // visible in the viewport so the user sees highlights appear first.
    if (target === document.body && nodes.length > NODE_BATCH_SIZE) {
      const vpBottom = window.innerHeight;
      const inView = [];
      const outView = [];
      for (const n of nodes) {
        const el = n.parentElement;
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.bottom >= 0 && rect.top <= vpBottom) {
            inView.push(n);
          } else {
            outView.push(n);
          }
        } else {
          outView.push(n);
        }
      }
      // Replace nodes in-place: viewport nodes first, then the rest
      nodes.length = 0;
      nodes.push(...inView, ...outView);
    }

    // Process the first batch synchronously so highlights appear immediately
    // instead of waiting for requestIdleCallback (0-50ms idle delay).
    let i = 0;
    const firstEnd = Math.min(NODE_BATCH_SIZE, nodes.length);
    while (i < firstEnd) {
      highlightTextNode(nodes[i++]);
    }

    if (i >= nodes.length) return;

    function next() {
      const end = Math.min(i + NODE_BATCH_SIZE, nodes.length);
      while (i < end) {
        highlightTextNode(nodes[i++]);
      }
      if (i < nodes.length) {
        if (typeof requestIdleCallback !== "undefined") {
          requestIdleCallback(next, { timeout: IDLE_CALLBACK_TIMEOUT_MS });
        } else {
          setTimeout(next, 0);
        }
      }
    }
    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(next, { timeout: IDLE_CALLBACK_TIMEOUT_MS });
    } else {
      setTimeout(next, 0);
    }
  }

  // ---------------------------------------------------------------------------
  // Clear highlights
  // ---------------------------------------------------------------------------
  function removeAllHighlights() {
    _highlightCount = 0;
    const spans = document.querySelectorAll("." + HL_CLASS);
    const parents = new Set();
    spans.forEach((span) => {
      const parent = span.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(span.textContent), span);
      parents.add(parent);
    });
    // Normalize once per parent, not once per span (avoids redundant reflows)
    parents.forEach((p) => p.normalize());

    const marked = document.querySelectorAll("[" + MARKER_ATTR + "]");
    marked.forEach((el) => el.removeAttribute(MARKER_ATTR));

    clearClientHighlight();
  }

  // ---------------------------------------------------------------------------
  // Observer
  // ---------------------------------------------------------------------------
  let observer = null;
  let debounceTimer = null;
  let pendingNodes = [];
  let _storageChangeTimer = null;

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

        // Update client highlight + mention matcher FIRST so new nodes are
        // highlighted with the correct patterns for the current client.
        applyClientHighlight();

        // Deduplicate: skip nodes whose ancestor is already in the batch,
        // since highlightAllChunked on the ancestor covers descendants.
        const elementRoots = [];
        for (const item of batch) {
          if (item.type === "element" && item.node && item.node.parentNode) {
            elementRoots.push(item.node);
          }
        }

        for (const item of batch) {
          if (!item.node || !item.node.parentNode) continue;

          if (item.type === "element") {
            // Skip if a parent element is already queued (it will cover this node)
            if (elementRoots.some((r) => r !== item.node && r.contains(item.node))) continue;
            if (item.node === document.body || item.node === document.documentElement) {
              highlightAllChunked(getCmsContentRoot());
            } else {
              highlightAllChunked(item.node);
            }
          } else {
            // Skip text nodes inside an element that's already queued
            if (elementRoots.some((r) => r.contains(item.node))) continue;
            highlightTextNode(item.node);
          }
        }
      }, MUTATION_DEBOUNCE_MS);
    });

    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    pendingNodes = [];
  }

  // ---------------------------------------------------------------------------
  // Dictionary fingerprint — a fast hash of the parts that affect regex
  // compilation (category words, ignore list, enabled flags). When only
  // non-matching fields change (e.g. toggling enabled at the extension level),
  // we can skip the expensive regex recompilation.
  // ---------------------------------------------------------------------------
  let _lastDictFingerprint = null;

  function computeDictFingerprint(dict) {
    // Build a string that captures everything affecting compiled regexes.
    // Intentionally lightweight: JSON.stringify of the relevant slices.
    const parts = [];
    const cats = Array.isArray(dict.categories) ? dict.categories : [];
    for (const c of cats) {
      parts.push(c.enabled === false ? "0" : "1");
      parts.push(String(c.name || ""));
      parts.push(String(c.color || ""));
      parts.push(String(c.fColor || ""));
      parts.push(Array.isArray(c.words) ? c.words.join("\x01") : "");
    }
    parts.push("\x02");
    const il = Array.isArray(dict.ignoreList) ? dict.ignoreList : [];
    parts.push(il.join("\x01"));
    parts.push("\x02");
    const clients = Array.isArray(dict.clients) ? dict.clients : [];
    for (const r of clients) {
      parts.push(String(r.pattern || ""));
      parts.push(String(r.defaultCategory || ""));
      parts.push(String(r.mentionCategory || ""));
      parts.push(r.includePatternInContent === false ? "0" : "1");
      parts.push(Array.isArray(r.aliases) ? r.aliases.join("\x01") : "");
      const ov = r.overrides || {};
      parts.push([ov.Image, ov.Profile, ov.Question, ov.Comment].join("\x01"));
    }
    return parts.join("\x03");
  }

  // ---------------------------------------------------------------------------
  // Recompile dictionary — single function used by init, message handlers,
  // and storage.onChanged to avoid duplicating compilation logic.
  // Returns true if recompilation was performed, false if skipped.
  // ---------------------------------------------------------------------------
  function recompileDictionary(dict, force) {
    const fp = computeDictFingerprint(dict);
    if (!force && _lastDictFingerprint !== null && fp === _lastDictFingerprint) {
      return false; // dictionary hasn't changed in a way that affects matching
    }
    _lastDictFingerprint = fp;

    compiledMatcher = MatcherEngine.compileAll(dict);
    if (compiledMatcher.warnings && compiledMatcher.warnings.length > 0) {
      log.warn("some patterns failed to compile —", compiledMatcher.warnings);
    }
    categoryStyleByName = buildCategoryStyleMap(dict);
    clientRules = Array.isArray(dict.clients) ? dict.clients.slice() : [];
    for (const r of clientRules) {
      // Always recompile — storage serialises RegExp as {}, which is truthy but broken.
      r._rx = globToRegex(r.pattern);
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Init + messages
  // ---------------------------------------------------------------------------
  function init() {
    if (isBlockedRoute()) {
      return;
    }

    chrome.storage.local.get(["dictionary", "enabled"], (result) => {
      if (chrome.runtime.lastError) {
        log.error("storage error", chrome.runtime.lastError);
        return;
      }

      globalEnabled = result.enabled !== false;

      const dict = result.dictionary;
      if (!dict || !dict.categories) {
        return;
      }

      recompileDictionary(dict);

      if (globalEnabled) {
        applyClientHighlight(); // sets currentMentionMatcher before highlighting
        highlightAllChunked(getCmsContentRoot());
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
        _cachedMentionKey = null; // force mention matcher rebuild with new enabled state
        if (globalEnabled) {
          removeAllHighlights();
          applyClientHighlight(); // sets currentMentionMatcher before highlighting
          highlightAllChunked(getCmsContentRoot());
          startObserver();
        } else {
          stopObserver();
          removeAllHighlights();
        }
        sendResponse({ ok: true });
        break;

      case "refresh":
        _cachedMentionKey = null; // force mention matcher rebuild after dictionary change
        chrome.storage.local.get(["dictionary", "enabled"], (result) => {
          globalEnabled = result.enabled !== false;

          const dict = result.dictionary;
          if (dict && dict.categories) {
            recompileDictionary(dict, true); // force: explicit user action
          }

          removeAllHighlights();
          if (globalEnabled) {
            applyClientHighlight(); // sets currentMentionMatcher before highlighting
            highlightAllChunked(getCmsContentRoot());
            startObserver();
          } else {
            stopObserver();
          }

          sendResponse({ ok: true });
        });
        return true;

      case "getStats":
        sendResponse({
          highlights: _highlightCount,
          enabled: globalEnabled,
          cats: compiledMatcher && compiledMatcher.compiledCategories ? compiledMatcher.compiledCategories.length : 0,
          clients: clientRules.length,
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

  // Accumulate storage changes across rapid-fire events so the debounced
  // callback has the full picture (dictionary AND enabled), not just the last
  // event's changes object.
  let _pendingChanges = {};

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (!changes.dictionary && !changes.enabled) return;

    // Merge into pending: latest value wins per key.
    if (changes.dictionary) _pendingChanges.dictionary = changes.dictionary;
    if (changes.enabled) _pendingChanges.enabled = changes.enabled;

    // Debounce so rapid-fire edits from the options page coalesce into one
    // re-render instead of thrashing the DOM on every keystroke.
    if (_storageChangeTimer) clearTimeout(_storageChangeTimer);
    _storageChangeTimer = setTimeout(() => {
      _storageChangeTimer = null;
      const merged = _pendingChanges;
      _pendingChanges = {};
      _cachedMentionKey = null;

      const prevEnabled = globalEnabled;
      if (merged.enabled) {
        globalEnabled = merged.enabled.newValue !== false;
      }

      let dictChanged = false;
      if (merged.dictionary) {
        const dict = merged.dictionary.newValue;
        if (dict && dict.categories) {
          dictChanged = recompileDictionary(dict);
        }
      }

      // Skip full re-highlight if nothing meaningful changed
      if (!dictChanged && globalEnabled === prevEnabled) return;

      removeAllHighlights();
      if (globalEnabled) {
        applyClientHighlight();
        highlightAllChunked(getCmsContentRoot());
        startObserver();
      } else {
        stopObserver();
      }
    }, STORAGE_CHANGE_DEBOUNCE_MS);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
