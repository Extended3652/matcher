// =============================================================================
// CMS Highlighter — Content Script
// =============================================================================
// This runs on the target CMS pages. It:
//   1. Loads the dictionary from chrome.storage.local
//   2. Compiles it once using MatcherEngine
//   3. Walks all text nodes and wraps matches in <span> tags
//   4. Watches for DOM changes (Angular SPA) and re-highlights new content
//   5. Listens for messages from popup/background to toggle/refresh
// =============================================================================

(function() {
  "use strict";

  const MARKER_ATTR = "data-cms-hl-processed";
  const HL_CLASS = "cms-hl";

  // Guardrails to prevent broken matcher output from creating huge spans
  const MAX_SPAN_LEN = 80;    // prevent pathological spans from slowing DOM work
  const LOG_GUARDS = true;    // set false to silence guard logs

  let compiled = null;
  let globalEnabled = true;
  let debounceTimer = null;
  // Accumulates snapshotted nodes across debounced mutation batches
  let pendingNodes = [];

  // ---------------------------------------------------------------------------
  // PERF COUNTERS (dev toggle)
  // ---------------------------------------------------------------------------
  const PERF = (() => {
    const WINDOW = 20;
    const state = {
      enabled: false,
      depth: 0,
      current: null,
      runs: [],
    };

    function now() {
      return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    }

    function begin(trigger) {
      if (!state.enabled) return;
      state.depth++;
      if (state.depth > 1) return; // nested work, count into the outer run

      state.current = {
        trigger: trigger || "unknown",
        t0: now(),
        msWalk: 0,
        msMatch: 0,
        msDom: 0,
        textNodesSeen: 0,
        textNodesProcessed: 0,
        matchesFound: 0,
        spansApplied: 0,
        errors: 0,
      };
    }

    function addTime(key, ms) {
      if (!state.enabled || !state.current) return;
      state.current[key] += ms;
    }

    function addCount(key, n) {
      if (!state.enabled || !state.current) return;
      state.current[key] += (n || 0);
    }

    function error() {
      if (!state.enabled || !state.current) return;
      state.current.errors += 1;
    }

    function end() {
      if (!state.enabled) return;
      if (state.depth === 0) return;

      state.depth--;
      if (state.depth > 0) return; // end inner nesting

      const cur = state.current;
      if (!cur) return;

      const total = now() - cur.t0;
      state.runs.push({ ...cur, msTotal: total });
      if (state.runs.length > WINDOW) state.runs.shift();

      // rolling averages
      const n = state.runs.length;
      let aTotal = 0, aWalk = 0, aMatch = 0, aDom = 0;
      for (const r of state.runs) {
        aTotal += r.msTotal;
        aWalk += r.msWalk;
        aMatch += r.msMatch;
        aDom += r.msDom;
      }
      aTotal /= n; aWalk /= n; aMatch /= n; aDom /= n;

      // one line per run
      const msg =
        `CMSHL PERF | ${cur.trigger} | ` +
        `total ${total.toFixed(1)}ms (avg ${aTotal.toFixed(1)}ms) | ` +
        `walk ${cur.msWalk.toFixed(1)} (avg ${aWalk.toFixed(1)}) | ` +
        `match ${cur.msMatch.toFixed(1)} (avg ${aMatch.toFixed(1)}) | ` +
        `dom ${cur.msDom.toFixed(1)} (avg ${aDom.toFixed(1)}) | ` +
        `seen ${cur.textNodesSeen} | processed ${cur.textNodesProcessed} | ` +
        `matches ${cur.matchesFound} | spans ${cur.spansApplied}` +
        (cur.errors ? ` | errors ${cur.errors}` : "");

      // warn on slow runs (tweak threshold if you want)
      if (total >= 50) {
        console.warn(msg);
      } else {
        console.log(msg);
      }

      state.current = null;
    }

    function setEnabled(v) {
      state.enabled = !!v;
      if (!state.enabled) {
        state.depth = 0;
        state.current = null;
      }
    }

    function isEnabled() {
      return !!state.enabled;
    }

    return { now, begin, end, addTime, addCount, error, setEnabled, isEnabled };
  })();

  function isModStatusRoute() {
    return (
      location.hostname === "cms.bazaarvoice.com" &&
      location.hash &&
      location.hash.includes("/modstatus")
    );
  }

  // ---------------------------------------------------------------------------
  // Load dictionary from storage, compile, and highlight
  // ---------------------------------------------------------------------------
  function init() {
    if (isModStatusRoute()) {
      console.log("CMS Highlighter: disabled on modstatus route");
      return;
    }

    chrome.storage.local.get(["dictionary", "enabled", "perfEnabled"], (result) => {
      if (chrome.runtime.lastError) {
        console.error("CMS Highlighter: storage error", chrome.runtime.lastError);
        return;
      }

      globalEnabled = result.enabled !== false; // default true
      PERF.setEnabled(result.perfEnabled === true);

      const dict = result.dictionary;
      if (!dict || !dict.categories) {
        console.log("CMS Highlighter: no dictionary found in storage.");
        return;
      }

      compiled = MatcherEngine.compileAll(dict);
      console.log(
        `CMS Highlighter: compiled ${compiled.compiledCategories.length} categories, ` +
        `ignore list: ${compiled.ignoreCompiled ? "active" : "none"}`
      );

      if (globalEnabled) {
        PERF.begin("init-full");
        try {
          highlightAll();
        } finally {
          PERF.end();
        }
        startObserver();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // DOM Walking — find all text nodes under a root element
  // ---------------------------------------------------------------------------
  function getTextNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          // Skip nodes inside our own highlights
          if (node.parentElement && node.parentElement.classList.contains(HL_CLASS)) {
            return NodeFilter.FILTER_REJECT;
          }
          // Skip script/style/textarea/input
          const tag = node.parentElement ? node.parentElement.tagName : "";
          if (["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "SELECT", "NOSCRIPT"].includes(tag)) {
            return NodeFilter.FILTER_REJECT;
          }
          // Skip already-processed parents
          if (node.parentElement && node.parentElement.hasAttribute(MARKER_ATTR)) {
            return NodeFilter.FILTER_REJECT;
          }
          // Only process nodes with actual visible text
          if (node.textContent.trim().length === 0) {
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
  // Highlight a single text node by splitting it and wrapping matches
  // ---------------------------------------------------------------------------
  function highlightTextNode(textNode) {
    if (isModStatusRoute()) return;
    if (!compiled || !globalEnabled) return;

    // Node may have been removed from DOM by Angular between snapshot and now
    if (!textNode.parentNode) return;

    const text = textNode.textContent;
    if (!text || text.trim().length === 0) return;

    const tMatch0 = PERF.now();
    let matches = MatcherEngine.findMatches(text, compiled);
    PERF.addTime("msMatch", PERF.now() - tMatch0);

    if (!Array.isArray(matches) || matches.length === 0) return;

    // Sanitize matcher output so we never create runaway spans
    // - enforce numeric bounds
    // - sort by start/end
    // - drop overlaps
    // - drop absurdly long spans
    matches = matches
      .filter(m =>
        m &&
        Number.isFinite(m.start) &&
        Number.isFinite(m.end) &&
        m.start >= 0 &&
        m.end > m.start &&
        m.end <= text.length
      )
      .sort((a, b) => (a.start - b.start) || (a.end - b.end));

    const cleaned = [];
    let lastEnd = -1;

    for (const m of matches) {
      const spanLen = m.end - m.start;

      if (spanLen > MAX_SPAN_LEN) {
        if (LOG_GUARDS) {
          console.warn(
            "CMSHL GUARD: dropping huge span " +
            "len=" + spanLen +
            " cat=" + m.categoryName +
            " sample=" + JSON.stringify(
              text.slice(m.start, Math.min(m.end, m.start + 80))
            )
          );
        }
        continue;
      }

      // Drop overlaps (keeps earlier match, prevents nested/giant rendering issues)
      if (m.start < lastEnd) {
        if (LOG_GUARDS) {
          console.warn("CMSHL GUARD: dropping overlap", {
            prevEnd: lastEnd,
            start: m.start,
            end: m.end,
            cat: m.categoryName
          });
        }
        continue;
      }

      cleaned.push(m);
      lastEnd = m.end;
    }

    matches = cleaned;
    if (matches.length === 0) return;

    PERF.addCount("textNodesProcessed", 1);
    PERF.addCount("matchesFound", matches.length);
    PERF.addCount("spansApplied", matches.length);

    const tDom0 = PERF.now();

    // Build a document fragment with text and highlighted spans
    const frag = document.createDocumentFragment();
    let lastIndex = 0;

    for (const match of matches) {
      // Text before this match
      if (match.start > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, match.start)));
      }

      // The highlighted span
      const span = document.createElement("span");
      span.className = HL_CLASS;
      span.style.backgroundColor = match.color || "#FFFF00";
      span.style.color = match.fColor || "#000000";
      span.setAttribute("data-hl-cat", match.categoryName);
      span.textContent = text.slice(match.start, match.end);
      frag.appendChild(span);

      lastIndex = match.end;
    }

    // Remaining text after last match
    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    // Mark the parent so we don't reprocess
    const parent = textNode.parentNode;
    if (parent) {
      parent.setAttribute(MARKER_ATTR, "1");
      parent.replaceChild(frag, textNode);
    }

    PERF.addTime("msDom", PERF.now() - tDom0);
  }

  // ---------------------------------------------------------------------------
  // Highlight all text nodes on the page (or under a specific root)
  // ---------------------------------------------------------------------------
  function highlightAll(root) {
    if (isModStatusRoute()) return;
    if (!compiled || !globalEnabled) return;

    const target = root || document.body;

    const tWalk0 = PERF.now();
    const textNodes = getTextNodes(target);
    PERF.addTime("msWalk", PERF.now() - tWalk0);
    PERF.addCount("textNodesSeen", textNodes.length);

    for (const node of textNodes) {
      highlightTextNode(node);
    }
  }

  // ---------------------------------------------------------------------------
  // Remove all highlights (restore original text)
  // ---------------------------------------------------------------------------
  function removeAllHighlights() {
    const spans = document.querySelectorAll("." + HL_CLASS);
    spans.forEach(span => {
      const parent = span.parentNode;
      if (!parent) return;
      // Replace the span with its text content
      const textNode = document.createTextNode(span.textContent);
      parent.replaceChild(textNode, span);
      // Merge adjacent text nodes
      parent.normalize();
    });

    // Remove all processed markers
    const marked = document.querySelectorAll(`[${MARKER_ATTR}]`);
    marked.forEach(el => el.removeAttribute(MARKER_ATTR));
  }

  // ---------------------------------------------------------------------------
  // MutationObserver — watch for Angular DOM changes
  // ---------------------------------------------------------------------------
  let observer = null;

  function startObserver() {
    if (observer) return;

    observer = new MutationObserver((mutations) => {
      if (isModStatusRoute()) return;

      // SNAPSHOT immediately — don't wait for debounce to read addedNodes,
      // because Angular may have already replaced them by then.
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

      // Debounce the actual highlighting work
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const batch = pendingNodes;
        pendingNodes = [];

        PERF.begin("mutation-batch");
        try {
          for (const item of batch) {
            // Re-check: node might have been removed by Angular during the 80ms wait
            if (!item.node.parentNode) continue;

            if (item.type === "element") {
              highlightAll(item.node);
            } else {
              highlightTextNode(item.node);
            }
          }
        } catch (e) {
          PERF.error();
          console.error("CMSHL PERF: error during mutation batch", e);
        } finally {
          PERF.end();
        }
      }, 80);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    pendingNodes = [];
  }

  // ---------------------------------------------------------------------------
  // Message listener — communicate with popup and background script
  // ---------------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case "notify":
        console.log("CMS Highlighter:", message.message);
        sendResponse({ ok: true });
        break;

      case "setPerf":
        PERF.setEnabled(!!message.enabled);
        chrome.storage.local.set({ perfEnabled: PERF.isEnabled() }, () => {
          sendResponse({ ok: true, perfEnabled: PERF.isEnabled() });
        });
        break;

      case "toggle":
        globalEnabled = message.enabled;
        if (globalEnabled) {
          // Recompile in case dictionary changed
          chrome.storage.local.get(["dictionary"], (result) => {
            if (result.dictionary) {
              compiled = MatcherEngine.compileAll(result.dictionary);
            }

            PERF.begin("toggle-on-full");
            try {
              highlightAll();
            } finally {
              PERF.end();
            }

            startObserver();
            sendResponse({ ok: true });
          });
          return true; // async response
        } else {
          PERF.begin("toggle-off-remove");
          try {
            stopObserver();
            removeAllHighlights();
          } finally {
            PERF.end();
          }
          sendResponse({ ok: true });
        }
        break;

      case "refresh":
        // Dictionary was updated — recompile and re-highlight
        chrome.storage.local.get(["dictionary", "enabled"], (result) => {
          globalEnabled = result.enabled !== false;
          if (result.dictionary) {
            compiled = MatcherEngine.compileAll(result.dictionary);
          }

          PERF.begin("refresh-full");
          try {
            removeAllHighlights();
            if (globalEnabled) {
              highlightAll();
            }
          } finally {
            PERF.end();
          }

          if (globalEnabled) {
            startObserver();
          } else {
            stopObserver();
          }

          sendResponse({ ok: true });
        });
        return true; // async response

      case "getStats":
        const hlCount = document.querySelectorAll("." + HL_CLASS).length;
        sendResponse({
          highlights: hlCount,
          enabled: globalEnabled,
          categories: compiled ? compiled.compiledCategories.length : 0,
        });
        break;

      default:
        sendResponse({ error: "unknown action" });
    }
    return true; // async response
  });

  // ---------------------------------------------------------------------------
  // Kick it off
  // ---------------------------------------------------------------------------
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
