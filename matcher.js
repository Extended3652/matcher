// =============================================================================
// MATCHER ENGINE v5
// =============================================================================
// This file does one job: takes text + a dictionary config, returns matches.
// No Chrome extension. No DOM. No UI. Just the matching logic.
//
// Changes in this version:
//   - Exact prefix changed from ! to //
//   - Exact + boundary spaces: exact means whole-word match on the word itself.
//     Boundary spaces are only used for detection, never included in the match.
//   - "Unhighlight" category renamed to "Ignore List" concept. It's not a
//     category anymore — it's a separate list. Words in it create exclusion
//     zones that prevent any other category from highlighting overlapping text.
//
// HOW IT WORKS (plain english):
//   1. Every word in the dictionary gets compiled into a regex fragment once.
//   2. All words in a category get combined into one big regex.
//   3. When we match text, we run each category's regex against it.
//   4. We collect all matches, then throw away any that overlap with
//      something in the Ignore List.
//   5. If two normal categories match the same spot, the one higher in
//      the priority order wins.
//   6. We return a clean list of {start, end, categoryName, color}.
//
// WILDCARD RULES:
//   *  at the END of a word  → eats to end of the current token
//          example: "amazon*" matches "amazonprime", "amazons"
//   *  at the START of a word → eats from start of current token
//          example: "*etailer" matches "retailer"
//   *  in the MIDDLE, no spaces in pattern → stays in-token
//          example: "sh*t" matches "shit", "shot" but NOT "should...mat"
//   *  in the MIDDLE, pattern has spaces → can span words
//          example: "took * days" matches "took 5 days", "took several long days"
//   ?  → exactly one character (same space rules as * above)
//
// EXACT FLAG:
//   Prefix a word with // to mark it as exact (whole-word match).
//          example: "//elf" only matches standalone "elf", not inside "herself"
//   You can also type it normally and check a checkbox in the UI — same result.
//   The // is just the fast-typing shortcut.
//
// BOUNDARY SPACES:
//   If a word has leading or trailing whitespace (space, \n, \r), that means
//   "require a word boundary here." The whitespace is stripped before matching
//   and is NEVER part of the highlighted text.
//          example: " elf " detects standalone "elf" but highlights only "elf"
//   Boundary spaces and exact can coexist. Exact already implies boundaries
//   on both sides, so adding spaces on top is redundant but harmless.
// =============================================================================


// -----------------------------------------------------------------------------
// STEP 1: Parse a raw word entry into a structured object.
// This runs once at compile time, not per-match.
// -----------------------------------------------------------------------------
// Examples:
//   "walmart"        → { pattern:"walmart",  exact:false, bBefore:false, bAfter:false }
//   "//walmart"      → { pattern:"walmart",  exact:true,  bBefore:true,  bAfter:true  }
//   " elf "          → { pattern:"elf",       exact:false, bBefore:true,  bAfter:true  }
//   "// elf "        → { pattern:"elf",       exact:true,  bBefore:true,  bAfter:true  }
//   "amazon*"        → { pattern:"amazon*",   exact:false, bBefore:false, bAfter:false }
//   "AF\n"           → { pattern:"af",        exact:false, bBefore:false, bAfter:true  }
// -----------------------------------------------------------------------------
function parseWordEntry(rawEntry) {
  let text = rawEntry;
  let exact = false;

  // Check for // prefix (exact flag)
  if (text.startsWith("//")) {
    exact = true;
    text = text.slice(2);
  }

  // Detect boundary markers BEFORE stripping whitespace.
  // Any whitespace char at start or end = boundary required there.
  const boundaryBefore = /^[\s\n\r\t]/.test(text);
  const boundaryAfter  = /[\s\n\r\t]$/.test(text);

  // Strip all leading/trailing whitespace
  text = text.trim();

  // Nothing left after trim = skip this entry
  if (text.length === 0) return null;

  // Everything is case-insensitive, so normalize to lowercase now
  text = text.toLowerCase();

  return {
    pattern: text,
    exact: exact,
    // Exact implies boundary on both sides automatically
    boundaryBefore: exact ? true : boundaryBefore,
    boundaryAfter:  exact ? true : boundaryAfter,
  };
}


// -----------------------------------------------------------------------------
// STEP 2: Convert a glob pattern into a regex fragment string.
// -----------------------------------------------------------------------------
function globToRegexFragment(pattern) {
  let result = "";
  const chars = [...pattern];

  // Key rule: if the pattern contains a literal space anywhere,
  // wildcards are allowed to cross word boundaries.
  // If no space, wildcards stay within a single token.
  const hasLiteralSpace = pattern.includes(" ");

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const isFirst = (i === 0);
    const isLast  = (i === chars.length - 1);

    if (ch === "*") {
      if (isFirst || isLast) {
        // * at start or end: eat to edge of current token
        // Stops at whitespace or punctuation
        result += "[^\\s\\p{P}]*";
      } else {
        // * in the middle
        if (hasLiteralSpace) {
          // Multi-word pattern: * can span across spaces, non-greedy
          result += "[\\s\\S]*?";
        } else {
          // Single-word pattern: * stays in-token, non-greedy
          result += "[^\\s]*?";
        }
      }
    } else if (ch === "?") {
      if (hasLiteralSpace) {
        result += "[\\s\\S]";   // any single char including space
      } else {
        result += "[^\\s]";     // any single char except space
      }
    } else {
      // Escape anything that's special in regex
      result += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return result;
}


// -----------------------------------------------------------------------------
// STEP 3: Wrap a glob fragment with boundary assertions if needed.
// -----------------------------------------------------------------------------
// Boundaries use lookahead/lookbehind so they don't consume characters.
// This means the spaces around a word are never part of the match.
// -----------------------------------------------------------------------------
function compileWordToRegexFragment(parsed) {
  let fragment = "";

  if (parsed.boundaryBefore) {
    // Must be preceded by: start of string, whitespace, or punctuation
    fragment += "(?:^|(?<=[\\s\\p{P}]))";
  }

  fragment += globToRegexFragment(parsed.pattern);

  if (parsed.boundaryAfter) {
    // Must be followed by: end of string, whitespace, or punctuation
    fragment += "(?=$|[\\s\\p{P}])";
  }

  return fragment;
}


// -----------------------------------------------------------------------------
// STEP 4: Compile one category into a single RegExp.
// All its words get joined with | (alternation).
// Longer patterns are sorted first so the regex prefers longer matches.
// -----------------------------------------------------------------------------
function compileCategory(category) {
  const fragments = [];

  for (const rawWord of category.words) {
    const parsed = parseWordEntry(rawWord);
    if (!parsed) continue;

    const fragment = compileWordToRegexFragment(parsed);
    fragments.push({ fragment, parsed });
  }

  if (fragments.length === 0) return null;

  // Longer patterns first — helps regex pick the longest match
  fragments.sort((a, b) => b.parsed.pattern.length - a.parsed.pattern.length);

  const combined = fragments.map(f => f.fragment).join("|");

  let regex;
  try {
    regex = new RegExp(combined, "giu");  // g=global, i=case-insensitive, u=unicode
  } catch (e) {
    console.error(`Failed to compile regex for "${category.name}":`, e.message);
    return null;
  }

  return {
    id:   category.id,
    name: category.name,
    color: category.color,
    fColor: category.fColor,
    regex: regex,
  };
}


// -----------------------------------------------------------------------------
// STEP 5: Compile the Ignore List into its own RegExp.
// Same logic as a category, but it has no color — it just produces
// exclusion zones.
// -----------------------------------------------------------------------------
function compileIgnoreList(ignoreWords) {
  if (!ignoreWords || ignoreWords.length === 0) return null;

  // Wrap it as a fake category so we can reuse compileCategory
  const result = compileCategory({
    id: "__ignore__",
    name: "Ignore List",
    color: null,
    fColor: null,
    words: ignoreWords,
  });

  return result;
}


// -----------------------------------------------------------------------------
// STEP 6: Compile everything — categories + ignore list — in one call.
// -----------------------------------------------------------------------------
// Input: { ignoreList: [...words], categories: [...category objects] }
// Output: { ignoreRegex, compiledCategories }
//
// Categories are in priority order (index 0 = highest priority).
// Disabled categories are skipped.
// -----------------------------------------------------------------------------
function compileAll(config) {
  const ignoreRegex = compileIgnoreList(config.ignoreList);

  const compiledCategories = [];
  for (const cat of config.categories) {
    if (!cat.enabled) continue;
    const compiled = compileCategory(cat);
    if (!compiled) continue;
    compiledCategories.push(compiled);
  }

  return { ignoreRegex, compiledCategories };
}


// -----------------------------------------------------------------------------
// STEP 7: Run matching on a piece of text.
// -----------------------------------------------------------------------------
// 1. Find all matches from all categories
// 2. Find all Ignore List matches
// 3. Remove any category match that overlaps with an Ignore match
// 4. Resolve priority conflicts (higher priority wins at same position)
// 5. Return clean results
// -----------------------------------------------------------------------------
function findMatches(text, compiled) {
  const { ignoreRegex, compiledCategories } = compiled;

  // --- Collect Ignore List match ranges ---
  const ignoreRanges = [];
  if (ignoreRegex) {
    ignoreRegex.regex.lastIndex = 0;
    let m;
    while ((m = ignoreRegex.regex.exec(text)) !== null) {
      if (m[0].length === 0) { ignoreRegex.regex.lastIndex++; continue; }
      ignoreRanges.push({ start: m.index, end: m.index + m[0].length });
    }
  }

  // --- Collect all category matches ---
  const allMatches = [];
  for (let i = 0; i < compiledCategories.length; i++) {
    const cat = compiledCategories[i];
    cat.regex.lastIndex = 0;
    let m;
    while ((m = cat.regex.exec(text)) !== null) {
      if (m[0].length === 0) { cat.regex.lastIndex++; continue; }
      allMatches.push({
        start:    m.index,
        end:      m.index + m[0].length,
        name:     cat.name,
        color:    cat.color,
        fColor:   cat.fColor,
        priority: i,   // lower number = higher priority
      });
    }
  }

  // --- Remove matches that overlap with any Ignore range ---
  // "Overlap" = the two ranges share at least one character position
  let filtered = allMatches;
  if (ignoreRanges.length > 0) {
    filtered = allMatches.filter(match => {
      return !ignoreRanges.some(ig => {
        return match.start < ig.end && match.end > ig.start;
      });
    });
  }

  // --- Resolve priority: sort by position, then priority ---
  filtered.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return a.priority - b.priority;
  });

  // --- Greedy sweep: keep a match only if it doesn't overlap the last kept one ---
  const final = [];
  let lastEnd = -1;
  for (const match of filtered) {
    if (match.start >= lastEnd) {
      final.push(match);
      lastEnd = match.end;
    }
  }

  // --- Return clean output ---
  return final.map(m => ({
    start: m.start,
    end:   m.end,
    categoryName: m.name,
    color: m.color,
    fColor: m.fColor,
  }));
}


// =============================================================================
// TEST HARNESS
// =============================================================================
// Run this file with:   node ~/matcher.js
// =============================================================================

// --- Config: Ignore List + Categories ---
const config = {

  // The Ignore List. Not a category — just a plain array of words.
  // Anything matching here blocks highlights from all categories.
  ignoreList: [
    " elf ",            // standalone "elf" → ignore it (makeup brand context)
    "easy to use",      // common phrase, not interesting
    "store front",      // "store" inside "store front" → ignore it
  ],

  // Categories, in priority order. Index 0 = highest priority.
  categories: [
    {
      id: "retailers",
      name: "RET / CR / Rx",
      color: "#32CD32",
      fColor: "#FFFFFF",
      enabled: true,
      words: [
        "walmart",
        "amazon*",          // matches amazonprime, amazons, etc.
        "target",
        "store",            // broad — matches "store" anywhere
        "elf",              // substring mode — matches inside "herself" too
        "best buy",
        "*etailer",         // start-wildcard
        "//ELF",            // exact — whole word only
        "//HP",             // exact — whole word only
      ],
    },
    {
      id: "profanity",
      name: "PRF",
      color: "#FF0000",
      fColor: "#FFFFFF",
      enabled: true,
      words: [
        "sh*t",             // middle wildcard, no spaces → stays in-token
        "f?ck",             // single-char wildcard
        "a*hole",           // middle wildcard, stays in-token
      ],
    },
    {
      id: "shipping",
      name: "SI",
      color: "#00BFFF",
      fColor: "#FFFFFF",
      enabled: true,
      words: [
        "arriv*",           // end-wildcard
        "deliver*",         // end-wildcard
        "took * days",      // middle wildcard WITH spaces → spans words
        "came * fast",      // middle wildcard WITH spaces → spans words
      ],
    },
    {
      id: "disabled_test",
      name: "Should Not Match",
      color: "#999999",
      fColor: "#FFFFFF",
      enabled: false,       // disabled — skipped entirely
      words: ["this should never match"],
    },
  ],
};

// --- Tests ---
const tests = [
  // === Basic matching ===
  {
    label: "Basic word match",
    text: "I bought this at walmart last week.",
    expect: [{ cat: "RET / CR / Rx", word: "walmart" }],
  },
  {
    label: "End-wildcard: amazon* matches full token",
    text: "I found it on amazonprime for cheap.",
    expect: [{ cat: "RET / CR / Rx", word: "amazonprime" }],
  },
  {
    label: "End-wildcard: deliver* matches delivery and delivered",
    text: "The delivery was delivered quickly.",
    expect: [{ cat: "SI", word: "delivery" }, { cat: "SI", word: "delivered" }],
  },
  {
    label: "End-wildcard: arriv* matches arrive, arrived, arriving",
    text: "It arrive, it arrived, it is arriving.",
    expect: [{ cat: "SI", word: "arrive" }, { cat: "SI", word: "arrived" }, { cat: "SI", word: "arriving" }],
  },
  {
    label: "Start-wildcard: *etailer matches retailer",
    text: "I am a retailer.",
    expect: [{ cat: "RET / CR / Rx", word: "retailer" }],
  },

  // === Middle wildcard — single token (no spaces in pattern) ===
  {
    label: "sh*t does NOT cross words — no false positive on 'should...mat'",
    text: "This should never match anything. But shit does.",
    expect: [{ cat: "PRF", word: "shit" }],
  },
  {
    label: "a*hole stays in single token",
    text: "What an ashole and axxhole.",
    expect: [{ cat: "PRF", word: "ashole" }, { cat: "PRF", word: "axxhole" }],
  },

  // === Middle wildcard — multi-word (spaces in pattern) ===
  {
    label: "'took * days' spans words",
    text: "It took 5 days to arrive.",
    expect: [{ cat: "SI", word: "took 5 days" }, { cat: "SI", word: "arrive" }],
  },
  {
    label: "'took * days' with multiple words between",
    text: "It took several long days.",
    expect: [{ cat: "SI", word: "took several long days" }],
  },
  {
    label: "'came * fast' spans words",
    text: "The package came really fast.",
    expect: [{ cat: "SI", word: "came really fast" }],
  },

  // === Single-char wildcard ===
  {
    label: "f?ck matches fock, fick",
    text: "fock and fick.",
    expect: [{ cat: "PRF", word: "fock" }, { cat: "PRF", word: "fick" }],
  },

  // === Ignore List ===
  {
    label: "Ignore List: standalone 'elf' is ignored",
    text: "I bought elf makeup.",
    expect: [],   // " elf " in ignore list blocks it
  },
  {
    label: "Ignore List: 'elf' inside 'herself' is NOT ignored",
    text: "She herself loved it.",
    expect: [{ cat: "RET / CR / Rx", word: "elf" }],
  },
  {
    label: "Ignore List: 'store' in 'store front' is ignored, standalone 'store' is not",
    text: "The store front and the store.",
    expect: [{ cat: "RET / CR / Rx", word: "store" }],  // only the second one
  },
  {
    label: "Ignore List: 'easy to use' blocks the whole phrase",
    text: "This is easy to use and great.",
    expect: [],
  },

  // === Exact flag (//) ===
  {
    label: "//HP matches standalone HP only, not inside 'cheapness'",
    text: "My HP works but cheapness doesn't.",
    expect: [{ cat: "RET / CR / Rx", word: "HP" }],
  },
  {
    label: "//ELF is standalone but Ignore List has ' elf ' so it gets blocked",
    text: "The brand ELF is nice.",
    expect: [],   // ignore list wins
  },

  // === Priority ===
  {
    label: "Two categories match different parts — both show",
    text: "I bought it at walmart and it arrived yesterday.",
    expect: [{ cat: "RET / CR / Rx", word: "walmart" }, { cat: "SI", word: "arrived" }],
  },

  // === Edge cases ===
  {
    label: "Empty text",
    text: "",
    expect: [],
  },
  {
    label: "No matches in text",
    text: "Hello world, nothing to see here.",
    expect: [],
  },
  {
    label: "Disabled category never matches",
    text: "This should never match from the disabled one.",
    expect: [],
  },
];

// --- Runner ---
console.log("=".repeat(70));
console.log(" MATCHER ENGINE — TEST RESULTS");
console.log("=".repeat(70));

const compiled = compileAll(config);
console.log(`\n  Compiled ${compiled.compiledCategories.length} categories`);
console.log(`  Ignore list: ${compiled.ignoreRegex ? "active" : "empty"}\n`);

let passed = 0;
let failed = 0;

tests.forEach((test, i) => {
  const matches = findMatches(test.text, compiled);
  const got = matches.map(m => ({
    cat:  m.categoryName,
    word: test.text.slice(m.start, m.end),
  }));

  // Check every expected item exists in output
  let ok = true;
  for (const exp of test.expect) {
    if (!got.some(g => g.word === exp.word && g.cat === exp.cat)) {
      ok = false;
    }
  }
  // If we expected nothing, output must be empty
  if (test.expect.length === 0 && got.length !== 0) ok = false;

  if (ok) passed++; else failed++;

  const status = ok ? "  ✓" : "  ✗";
  console.log(`${status} Test ${i + 1}: ${test.label}`);

  if (!ok) {
    console.log(`      Text:     "${test.text}"`);
    console.log(`      Expected: ${JSON.stringify(test.expect)}`);
    console.log(`      Got:      ${JSON.stringify(got)}`);
  }
});

console.log("\n" + "=".repeat(70));
console.log(`  ${passed} passed, ${failed} failed out of ${tests.length} tests`);
console.log("=".repeat(70) + "\n");
