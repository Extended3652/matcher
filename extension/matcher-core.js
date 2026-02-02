// =============================================================================
// MATCHER ENGINE v6 — Chrome Extension Module
// =============================================================================
// Pure matching logic. No DOM, no Chrome APIs. Just text in, matches out.
//
// Changes from v5:
//   - Case-sensitive support via CS: prefix (e.g., "CS:HP" or "CS://ELF")
//   - Exported as global (window.MatcherEngine) for use by content script
//   - enabled flag on categories respected at compile time
//
// WORD ENTRY SYNTAX:
//   walmart           → substring, case-insensitive
//   //walmart         → exact (whole-word), case-insensitive
//   CS:walmart        → substring, case-SENSITIVE
//   CS://walmart      → exact, case-SENSITIVE
//   " elf "           → boundary spaces (require whitespace/punctuation around)
//   amazon*           → wildcard (end)
//   *etailer          → wildcard (start)
//   sh*t              → wildcard (middle, stays in-token)
//   took * days       → wildcard (middle with spaces, spans words)
// =============================================================================

(function() {
  "use strict";

  // ---------------------------------------------------------------------------
  // STEP 1: Parse a raw word entry into a structured object.
  // ---------------------------------------------------------------------------
  function parseWordEntry(rawEntry) {
    let text = String(rawEntry || "");
    let exact = false;
    let caseSensitive = false;

    // Check for CS: prefix (case-sensitive flag)
    if (text.startsWith("CS:")) {
      caseSensitive = true;
      text = text.slice(3);
    }

    // Check for // prefix (exact flag)
    if (text.startsWith("//")) {
      exact = true;
      text = text.slice(2);
    }

    // Detect boundary markers BEFORE stripping whitespace
    const boundaryBefore = /^[\s\n\r\t]/.test(text);
    const boundaryAfter  = /[\s\n\r\t]$/.test(text);

    // Strip all leading/trailing whitespace
    text = text.trim();

    if (text.length === 0) return null;

    // Only lowercase if case-insensitive
    if (!caseSensitive) {
      text = text.toLowerCase();
    }

    const hasWildcard = text.includes("*") || text.includes("?");

    return {
      pattern: text,
      exact: exact,
      caseSensitive: caseSensitive,
      boundaryBefore: exact ? true : boundaryBefore,
      boundaryAfter:  exact ? true : boundaryAfter,
      hasWildcard: hasWildcard,
    };
  }

  // ---------------------------------------------------------------------------
  // STEP 2: Convert a glob pattern into a regex fragment string.
  //
  // Edge wildcards (* at start/end) use [^\s\p{P}]* — they stop at both
  // whitespace AND punctuation, giving precise token-level matching.
  // E.g. *escent matches "fluorescent" (not "non-fluorescent" as a unit).
  //
  // Middle wildcards (* not at edges) in patterns WITHOUT literal spaces
  // use [^\s]*? — they cross punctuation (hyphens, apostrophes) so that
  // patterns like fast*drying match "fast-drying" and sh*t matches "sh't".
  // Patterns WITH literal spaces always use [\s\S]*? to span across words.
  // ---------------------------------------------------------------------------
  function globToRegexFragment(pattern) {
    let result = "";
    const chars = [...pattern];
    const hasLiteralSpace = pattern.includes(" ");

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      const isFirst = (i === 0);
      const isLast  = (i === chars.length - 1);

      if (ch === "*") {
        if (isFirst || isLast) {
          // Edge wildcard: stop at whitespace AND punctuation (token boundary)
          result += "[^\\s\\p{P}]*";
        } else {
          // Middle wildcard: with spaces spans anything; without spaces
          // spans within a whitespace-delimited token (crosses punctuation)
          result += hasLiteralSpace ? "[\\s\\S]*?" : "[^\\s]*?";
        }
      } else if (ch === "?") {
        // Same logic: edge-like single char vs middle single char
        result += hasLiteralSpace ? "[\\s\\S]" : "[^\\s]";
      } else {
        result += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // STEP 3: Wrap a glob fragment with boundary assertions if needed.
  // ---------------------------------------------------------------------------
  function compileWordToRegexFragment(parsed) {
    let fragment = "";

    if (parsed.boundaryBefore) {
      fragment += "(?:^|(?<=[\\s\\p{P}]))";
    }

    fragment += globToRegexFragment(parsed.pattern);

    if (parsed.boundaryAfter) {
      fragment += "(?=$|[\\s\\p{P}])";
    }

    return fragment;
  }

  // ---------------------------------------------------------------------------
  // STEP 4: Compile one category into RegExp(s).
  // Words are split into four buckets:
  //   case-sensitive / insensitive  ×  simple / wildcard
  //
  // Simple (non-wildcard) patterns use NON-CAPTURING groups — no need to
  // scan capture groups to identify the match because isWildcard is always
  // false for these.  Wildcard patterns also use non-capturing groups
  // because isWildcard is always true for them.  This eliminates the O(N)
  // capture-group scan that was the main per-match bottleneck.
  // ---------------------------------------------------------------------------
  function compileCategory(category) {
    const buckets = {
      sensitive_simple: [],
      sensitive_wild: [],
      insensitive_simple: [],
      insensitive_wild: [],
    };

    for (const rawWord of category.words) {
      const parsed = parseWordEntry(rawWord);
      if (!parsed) continue;

      const fragment = compileWordToRegexFragment(parsed);
      const cs = parsed.caseSensitive ? "sensitive" : "insensitive";
      const wc = parsed.hasWildcard ? "wild" : "simple";
      buckets[`${cs}_${wc}`].push({ fragment, parsed });
    }

    const regexes = [];

    for (const [key, items] of Object.entries(buckets)) {
      if (items.length === 0) continue;

      // Longer patterns first for longest-match preference at same start
      items.sort((a, b) => b.parsed.pattern.length - a.parsed.pattern.length);

      // Non-capturing groups — identification comes from which bucket matched
      const combined = items.map(f => "(?:" + f.fragment + ")").join("|");
      const flags = key.startsWith("sensitive") ? "gu" : "giu";
      const isWildcard = key.endsWith("_wild");

      try {
        regexes.push({ re: new RegExp(combined, flags), isWildcard });
      } catch (e) {
        console.error(`Failed to compile regex for "${category.name}" (${key}):`, e.message);
      }
    }

    if (regexes.length === 0) return null;

    return {
      id:      category.id,
      name:    category.name,
      color:   category.color,
      fColor:  category.fColor,
      regexes: regexes,
    };
  }

  // ---------------------------------------------------------------------------
  // STEP 5: Compile everything — categories + ignore list.
  // ---------------------------------------------------------------------------
  function compileAll(config) {
    let ignoreCompiled = null;
    if (config.ignoreList && config.ignoreList.length > 0) {
      ignoreCompiled = compileCategory({
        id: "__ignore__",
        name: "Ignore List",
        color: null,
        fColor: null,
        words: config.ignoreList,
      });
    }

    const compiledCategories = [];
    for (const cat of config.categories) {
      if (cat.enabled === false) continue;
      const compiled = compileCategory(cat);
      if (compiled) compiledCategories.push(compiled);
    }

    return { ignoreCompiled, compiledCategories };
  }

  function pickBetterOverlap(a, b) {
    // Rule:
    // 1) Non-wildcard (specific) beats wildcard (vague)
    // 2) if both wildcard or both non-wildcard, category priority wins (lower number = higher priority)
    // 3) tie-break: longer wins
    // 4) final tie-break: earlier start wins, then earlier end
    const aWild = !!a.isWildcard;
    const bWild = !!b.isWildcard;

    // FIX: specific (non-wildcard) beats vague (wildcard)
    if (aWild !== bWild) return aWild ? b : a;

    if (a.priority !== b.priority) return (a.priority < b.priority) ? a : b;

    const aLen = a.end - a.start;
    const bLen = b.end - b.start;
    if (aLen !== bLen) return (aLen > bLen) ? a : b;

    if (a.start !== b.start) return (a.start < b.start) ? a : b;
    if (a.end !== b.end) return (a.end < b.end) ? a : b;

    return a;
  }

  // ---------------------------------------------------------------------------
  // STEP 6: Run matching on a piece of text.
  // ---------------------------------------------------------------------------
  function findMatches(text, compiled) {
    const { ignoreCompiled, compiledCategories } = compiled;

    // --- Collect Ignore List match ranges (sorted by start for binary search) ---
    const ignoreRanges = [];
    if (ignoreCompiled) {
      for (const rx of ignoreCompiled.regexes) {
        const re = rx.re;
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
          if (m[0].length === 0) { re.lastIndex++; continue; }
          ignoreRanges.push({ start: m.index, end: m.index + m[0].length });
        }
      }
      ignoreRanges.sort((a, b) => a.start - b.start);
    }

    // --- Collect all category matches ---
    const allMatches = [];
    for (let i = 0; i < compiledCategories.length; i++) {
      const cat = compiledCategories[i];

      for (const rx of cat.regexes) {
        const re = rx.re;
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
          if (m[0].length === 0) { re.lastIndex++; continue; }

          allMatches.push({
            start:    m.index,
            end:      m.index + m[0].length,
            name:     cat.name,
            color:    cat.color,
            fColor:   cat.fColor,
            priority: i,
            isWildcard: rx.isWildcard,
          });
        }
      }
    }

    // --- Remove matches that overlap with any Ignore range ---
    // Uses binary search on sorted ignoreRanges: O(matches × log(ignoreRanges))
    let filtered = allMatches;
    if (ignoreRanges.length > 0) {
      filtered = allMatches.filter(match => {
        // Binary search for first ignore range whose end > match.start
        let lo = 0, hi = ignoreRanges.length - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (ignoreRanges[mid].end <= match.start) {
            lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }
        // Check from lo onward — any range starting before match.end overlaps
        for (let k = lo; k < ignoreRanges.length; k++) {
          const ig = ignoreRanges[k];
          if (ig.start >= match.end) break;  // no more possible overlaps
          if (match.start < ig.end && match.end > ig.start) return false;
        }
        return true;
      });
    }

    if (filtered.length === 0) return [];

    // Sort by start, then longer first (helps reduce churn)
    filtered.sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      const aLen = a.end - a.start;
      const bLen = b.end - b.start;
      if (aLen !== bLen) return bLen - aLen;
      return a.priority - b.priority;
    });

    // Overlap resolver:
    // Keep a "current winner". When an overlapping match appears, choose the better.
    // When a non-overlapping match appears, finalize the winner and move on.
    const final = [];
    let winner = null;

    for (const m of filtered) {
      if (!winner) {
        winner = m;
        continue;
      }

      const overlaps = (m.start < winner.end) && (m.end > winner.start);
      if (!overlaps) {
        final.push(winner);
        winner = m;
        continue;
      }

      winner = pickBetterOverlap(winner, m);
    }

    if (winner) final.push(winner);

    return final.map(m => ({
      start:        m.start,
      end:          m.end,
      categoryName: m.name,
      color:        m.color,
      fColor:       m.fColor,
    }));
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  const MatcherEngine = {
    parseWordEntry,
    compileAll,
    findMatches,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = MatcherEngine;
  } else if (typeof window !== "undefined") {
    window.MatcherEngine = MatcherEngine;
  }
})();
