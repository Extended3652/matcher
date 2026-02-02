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
    let literal = false;

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

    // Check for LIT: prefix (treat * and ? as literal characters)
    if (text.startsWith("LIT:")) {
      literal = true;
      text = text.slice(4);
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

    const hasWildcard = (!literal) && (text.includes("*") || text.includes("?"));

    return {
      pattern: text,
      exact: exact,
      caseSensitive: caseSensitive,
      boundaryBefore: exact ? true : boundaryBefore,
      boundaryAfter:  exact ? true : boundaryAfter,
      hasWildcard: hasWildcard,
      literal: literal,
    };
}

  // ---------------------------------------------------------------------------
  // STEP 2: Convert a glob pattern into a regex fragment string.
  // Supports escaping: \* and \? mean literal characters, not wildcards.
  // ---------------------------------------------------------------------------
  function globToRegexFragment(pattern) {
    let result = "";
    const chars = [...pattern];
    const hasLiteralSpace = pattern.includes(" ");

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      const isFirst = (i === 0);
      const isLast  = (i === chars.length - 1);

      // Escape support: treat next char literally (including * and ?)
      if (ch === "\\") {
        const next = chars[i + 1];
        if (next === undefined) {
          // trailing backslash, treat it literally
          result += "\\\\";
        } else {
          // add escaped literal of next char
          result += next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          i++; // consume next
        }
        continue;
      }

        if (ch === "*") {
          const prev = chars[i - 1];
          const next = chars[i + 1];

          // If "*" is surrounded by literal spaces in the PATTERN, treat it as "one token"
          // Example: "took * days" => "*" matches exactly one non-space run (allows hyphens)
          if (prev === " " && next === " ") {
            result += "[^\\s]+";
          } else if (isFirst || isLast) {
            result += "[^\\s\\p{P}]*";
          } else {
            result += "[^\\s\\p{P}]*?";
          }
        } else if (ch === "?") {
          result += "[\\s\\S]";
      } else if (ch === " ") {
        result += "\\s+";
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

    fragment += parsed.literal
      ? parsed.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      : globToRegexFragment(parsed.pattern);

    if (parsed.boundaryAfter) {
      fragment += "(?=$|[\\s\\p{P}])";
    }

    return fragment;
  }

  // ---------------------------------------------------------------------------
  // STEP 4: Compile one category into RegExp(s).
  // Words are split into case-sensitive and case-insensitive groups,
  // each getting their own regex, so flags can differ.
  //
  // NOTE: We wrap each fragment in a capturing group so we can recover
  // which entry matched (needed for wildcard precedence rules).
  // ---------------------------------------------------------------------------
  function compileCategory(category) {
    const groups = { sensitive: [], insensitive: [] };

    for (const rawWord of category.words) {
      const parsed = parseWordEntry(rawWord);
      if (!parsed) continue;

      const fragment = compileWordToRegexFragment(parsed);
      const bucket = parsed.caseSensitive ? "sensitive" : "insensitive";
      groups[bucket].push({ fragment, parsed });
    }

    const regexes = [];

    for (const [key, items] of Object.entries(groups)) {
      if (items.length === 0) continue;

      // Longer patterns first for longest-match preference at same start
      items.sort((a, b) => b.parsed.pattern.length - a.parsed.pattern.length);

      // Chunk large alternations to keep capture-group scanning fast
      const MAX_ALTS_PER_REGEX = 120;

      const flags = key === "sensitive" ? "gu" : "giu";

      for (let start = 0; start < items.length; start += MAX_ALTS_PER_REGEX) {
        const chunk = items.slice(start, start + MAX_ALTS_PER_REGEX);

        // Wrap each in a CAPTURE group so we can identify which matched
        const combined = chunk.map(f => "(" + f.fragment + ")").join("|");
        const metas = chunk.map(f => ({
          hasWildcard: !!f.parsed.hasWildcard,
          patternLen: f.parsed.pattern.length
        }));

        try {
          regexes.push({ re: new RegExp(combined, flags), metas });
        } catch (e) {
          console.error(`Failed to compile regex for "${category.name}" (${key}):`, e.message);
        }
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

    // --- Collect Ignore List match ranges ---
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
    }

    // --- Collect all category matches ---
    const allMatches = [];
    for (let i = 0; i < compiledCategories.length; i++) {
      const cat = compiledCategories[i];

      for (const rx of cat.regexes) {
        const re = rx.re;
        const metas = rx.metas;

        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
          if (m[0].length === 0) { re.lastIndex++; continue; }

          // Identify which capture group matched
          let meta = null;
          for (let gi = 1; gi < m.length; gi++) {
            if (m[gi] !== undefined) {
              meta = metas[gi - 1];
              break;
            }
          }

          allMatches.push({
            start:    m.index,
            end:      m.index + m[0].length,
            name:     cat.name,
            color:    cat.color,
            fColor:   cat.fColor,
            priority: i,
            isWildcard: meta ? !!meta.hasWildcard : false,
          });
        }
      }
    }

    // --- Remove matches that overlap with any Ignore range ---
    let filtered = allMatches;
    if (ignoreRanges.length > 0) {
      filtered = allMatches.filter(match => {
        return !ignoreRanges.some(ig => match.start < ig.end && match.end > ig.start);
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
