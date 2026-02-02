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

  let compiled = null;
  let globalEnabled = true;
  let debounceTimer = null;
  // Accumulates snapshotted nodes across debounced mutation batches
  let pendingNodes = [];

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

    chrome.storage.local.get(["dictionary", "enabled"], (result) => {
      if (chrome.runtime.lastError) {
        console.error("CMS Highlighter: storage error", chrome.runtime.lastError);
        return;
      }

      globalEnabled = result.enabled !== false; // default true
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
        highlightAll();
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

    const matches = MatcherEngine.findMatches(text, compiled);
    if (matches.length === 0) return;

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
  }


  // ---------------------------------------------------------------------------
  // Highlight all text nodes on the page (or under a specific root)
  // ---------------------------------------------------------------------------
  function highlightAll(root) {
    if (isModStatusRoute()) return;
    if (!compiled || !globalEnabled) return;

    const target = root || document.body;
    const textNodes = getTextNodes(target);

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

        for (const item of batch) {
          // Re-check: node might have been removed by Angular during the 80ms wait
          if (!item.node.parentNode) continue;

          if (item.type === "element") {
            highlightAll(item.node);
          } else {
            highlightTextNode(item.node);
          }
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

      case "toggle":
        globalEnabled = message.enabled;
        if (globalEnabled) {
          // Recompile in case dictionary changed
          chrome.storage.local.get(["dictionary"], (result) => {
            if (result.dictionary) {
              compiled = MatcherEngine.compileAll(result.dictionary);
            }
            highlightAll();
            startObserver();
          });
        } else {
          stopObserver();
          removeAllHighlights();
        }
        sendResponse({ ok: true });
        break;

      case "refresh":
        // Dictionary was updated — recompile and re-highlight
        chrome.storage.local.get(["dictionary", "enabled"], (result) => {
          globalEnabled = result.enabled !== false;
          if (result.dictionary) {
            compiled = MatcherEngine.compileAll(result.dictionary);
          }
          removeAllHighlights();
          if (globalEnabled) {
            highlightAll();
            startObserver();
          }
        });
        sendResponse({ ok: true });
        break;

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
