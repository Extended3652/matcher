// =============================================================================
// CMS Highlighter — Assertion-based test suite
// =============================================================================
// Run with:  node tools/test_assertions.js
//
// Tests matcher correctness with pass/fail output.
// Covers the isExact bug fix and all core matching behaviors.
// =============================================================================

"use strict";

const { compileAll, findMatches, parseWordEntry } = require("./matcher.js");

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log("  \x1b[32m✓\x1b[0m", message);
    passed++;
  } else {
    console.error("  \x1b[31m✗\x1b[0m", message);
    failed++;
  }
}

/**
 * Assert that findMatches returns exactly expected matches.
 * expected = [{cat: categoryName, word: matchedText}, ...]
 * NOTE: cat must be the category *name* field, not the id.
 */
function assertMatches(label, config, text, expected) {
  const compiled = compileAll(config);
  const matches  = findMatches(text, compiled);

  const gotStr = matches.map(m => `[${m.categoryName}] "${text.slice(m.start, m.end)}"`).join(", ");
  const expStr = expected.map(e => `[${e.cat}] "${e.word}"`).join(", ");

  const ok =
    matches.length === expected.length &&
    expected.every((e, i) => {
      const m = matches[i];
      return m && m.categoryName === e.cat && text.slice(m.start, m.end) === e.word;
    });

  if (ok) {
    console.log("  \x1b[32m✓\x1b[0m", label);
    passed++;
  } else {
    console.error("  \x1b[31m✗\x1b[0m", label);
    console.error("      Expected:", expStr || "(none)");
    console.error("      Got:     ", gotStr  || "(none)");
    failed++;
  }
}

function section(title) {
  console.log("\n\x1b[1m" + title + "\x1b[0m");
}

// ---------------------------------------------------------------------------
// Config builders
// ---------------------------------------------------------------------------
function cat(id, name, color, words) {
  return { id, name, color: color || "#ff0", fColor: "#000", enabled: true, words };
}
function cfg(categories, ignoreList) {
  return { categories: categories || [], ignoreList: ignoreList || [] };
}

// =============================================================================
// 1. parseWordEntry — unit tests
// =============================================================================
section("1. parseWordEntry");

(function() {
  let p;

  p = parseWordEntry("walmart");
  assert(p && !p.exact && !p.caseSensitive && !p.hasWildcard && p.pattern === "walmart",
    "plain word: no flags, lowercased");

  p = parseWordEntry("//walmart");
  assert(p && p.exact && !p.caseSensitive && p.pattern === "walmart",
    "// prefix → exact, pattern lowercased");

  p = parseWordEntry("CS:walmart");
  assert(p && !p.exact && p.caseSensitive && p.pattern === "walmart",
    "CS: prefix → case-sensitive, pattern kept as-is");

  p = parseWordEntry("CS://HP");
  assert(p && p.exact && p.caseSensitive && p.pattern === "HP",
    "CS:// → exact + case-sensitive, pattern not lowercased");

  p = parseWordEntry("amazon*");
  assert(p && p.hasWildcard && p.pattern === "amazon*",
    "trailing * → hasWildcard");

  p = parseWordEntry("LIT:test*file");
  assert(p && p.literal && !p.hasWildcard && p.pattern === "test*file",
    "LIT: → literal flag, * not treated as wildcard");

  p = parseWordEntry(" elf ");
  assert(p && p.boundaryBefore && p.boundaryAfter && p.pattern === "elf",
    "surrounding spaces → boundary markers, whitespace stripped from pattern");

  p = parseWordEntry("   ");
  assert(p === null, "whitespace-only → null");

  // "//AF\n" — exact flag, then text="AF\n", trimmed to "AF", then lowercased → "af"
  p = parseWordEntry("//AF\n");
  assert(p && p.exact && p.pattern === "af",
    "// with trailing newline → trimmed + lowercased to 'af'");

  p = parseWordEntry("CS://ELF\r\n");
  assert(p && p.exact && p.caseSensitive && p.pattern === "ELF",
    "CS:// with trailing CRLF → trimmed, NOT lowercased");
})();

// =============================================================================
// 2. Basic matching
// =============================================================================
section("2. Basic matching");

assertMatches(
  "plain substring match",
  cfg([cat("a", "Ret", "#0f0", ["walmart"])]),
  "I shop at walmart today",
  [{ cat:"Ret", word:"walmart" }]
);

assertMatches(
  "case-insensitive by default",
  cfg([cat("a", "Ret", "#0f0", ["walmart"])]),
  "I shop at WALMART today",
  [{ cat:"Ret", word:"WALMART" }]
);

assertMatches(
  "no match when text absent",
  cfg([cat("a", "Ret", "#0f0", ["walmart"])]),
  "I shop at target today",
  []
);

assertMatches(
  "multiple non-overlapping matches in same category",
  cfg([cat("a", "Ret", "#0f0", ["walmart", "amazon"])]),
  "walmart and amazon are retailers",
  [{ cat:"Ret", word:"walmart" }, { cat:"Ret", word:"amazon" }]
);

// =============================================================================
// 3. Exact match (// prefix)
// =============================================================================
section("3. Exact match (// prefix)");

assertMatches(
  "exact: matches standalone word",
  cfg([cat("a", "PRF", "#f00", ["//flu"])]),
  "I had the flu last week",
  [{ cat:"PRF", word:"flu" }]
);

assertMatches(
  "exact: does NOT match inside another word",
  cfg([cat("a", "PRF", "#f00", ["//flu"])]),
  "This product is fluffy and fun",
  []
);

assertMatches(
  "exact: matches word followed by punctuation",
  cfg([cat("a", "Ret", "#0f0", ["//walmart"])]),
  "I went to walmart, then left",
  [{ cat:"Ret", word:"walmart" }]
);

assertMatches(
  "exact: matches word at start of string",
  cfg([cat("a", "Ret", "#0f0", ["//walmart"])]),
  "walmart is a big store",
  [{ cat:"Ret", word:"walmart" }]
);

// =============================================================================
// 4. Wildcard matching
// =============================================================================
section("4. Wildcard matching");

assertMatches(
  "trailing wildcard amazon* matches amazonian",
  cfg([cat("a", "Ret", "#0f0", ["amazon*"])]),
  "I use amazonian products",
  [{ cat:"Ret", word:"amazonian" }]
);

assertMatches(
  "leading wildcard *etailer matches 'retailer' (starts after punctuation boundary)",
  cfg([cat("a", "Ret", "#0f0", ["*etailer"])]),
  "That e-retailer is big",
  [{ cat:"Ret", word:"retailer" }]
);

assertMatches(
  "middle wildcard sh*t stays in-token",
  cfg([cat("a", "PRF", "#f00", ["sh*t"])]),
  "What a load of shit here",
  [{ cat:"PRF", word:"shit" }]
);

assertMatches(
  "multi-word wildcard: took * days spans one token",
  cfg([cat("a", "SI", "#00f", ["took * days"])]),
  "The package took 5 days to arrive",
  [{ cat:"SI", word:"took 5 days" }]
);

assertMatches(
  "? wildcard matches any single character",
  cfg([cat("a", "SI", "#00f", ["sh?t"])]),
  "What a shot in the dark",
  [{ cat:"SI", word:"shot" }]
);

// =============================================================================
// 5. Case-sensitive (CS: prefix)
// =============================================================================
section("5. Case-sensitive (CS: prefix)");

assertMatches(
  "CS: matches uppercase only, not lowercase",
  cfg([cat("a", "CS", "#90f", ["CS:HP"])]),
  "My HP printer and hp brand",
  [{ cat:"CS", word:"HP" }]
);

assertMatches(
  "CS:// exact + case-sensitive matches correctly cased word only",
  cfg([cat("a", "CS", "#90f", ["CS://ATT"])]),
  "The ATT network and att service",
  [{ cat:"CS", word:"ATT" }]
);

// =============================================================================
// 6. Ignore list
// =============================================================================
section("6. Ignore list");

assertMatches(
  "ignore list blocks matched phrase",
  cfg([cat("a", "Ret", "#0f0", ["store"])], ["easy to use"]),
  "This is easy to use at the store",
  [{ cat:"Ret", word:"store" }]
);

assertMatches(
  "boundary ignore ' elf ' blocks standalone elf",
  cfg([cat("a", "Ret", "#0f0", ["elf"])], [" elf "]),
  "I went to the elf store",
  []
);

assertMatches(
  "boundary ignore ' elf ' does NOT block elf inside compound word",
  cfg([cat("a", "Ret", "#0f0", ["elf"])], [" elf "]),
  "I went to herself today",
  [{ cat:"Ret", word:"elf" }]
);

assertMatches(
  "'store front' in ignore list, standalone store still matches",
  cfg([cat("a", "Ret", "#0f0", ["store"])], ["store front"]),
  "I went to the store front but the store was open",
  [{ cat:"Ret", word:"store" }]
);

// =============================================================================
// 7. Overlap resolution
// =============================================================================
section("7. Overlap resolution");

assertMatches(
  "non-wildcard beats wildcard at same span",
  cfg([
    cat("wc", "Wildcard", "#00f", ["amazon*"]),
    cat("nw", "NonWild",  "#f00", ["amazon"]),
  ]),
  "I love amazon products",
  [{ cat:"NonWild", word:"amazon" }]
);

assertMatches(
  "higher priority category (lower index) beats lower priority",
  cfg([
    cat("hi", "High", "#0f0", ["walmart"]),
    cat("lo", "Low",  "#f00", ["walmart"]),
  ]),
  "I shop at walmart today",
  [{ cat:"High", word:"walmart" }]
);

assertMatches(
  "longer match wins over shorter at same start",
  cfg([cat("a", "Ret", "#0f0", ["walmart", "walmart store"])]),
  "I shop at walmart store today",
  [{ cat:"Ret", word:"walmart store" }]
);

assertMatches(
  "two non-overlapping matches from different categories",
  cfg([
    cat("r", "Retailer", "#0f0", ["walmart"]),
    cat("s", "Shipping", "#00f", ["arrived"]),
  ]),
  "I ordered from walmart and it arrived",
  [{ cat:"Retailer", word:"walmart" }, { cat:"Shipping", word:"arrived" }]
);

// =============================================================================
// 8. isExact fix: exact contained match beats non-exact container
// =============================================================================
section("8. isExact fix — exact match beats wildcard container");

// Core test: a wildcard matches a longer span that contains an exact match.
// Before fix: isExact was always false → container (wildcard) always won.
// After fix:  isExact is set correctly → exact contained match wins.
assertMatches(
  "//exact wins over wildcard* container (isExact fix)",
  cfg([
    cat("wc", "Wildcard", "#00f", ["amazon*"]),   // matches "amazon.com" (longer, wildcard)
    cat("ex", "Exact",    "#f00", ["//amazon"]),   // matches "amazon" (shorter, exact)
  ]),
  "I shop at amazon.com daily",
  // "amazon*" matches "amazon.com" [11,21]
  // "//amazon" matches "amazon"    [11,17]
  // "amazon.com" contains "amazon"; contained is exact, container is not → exact wins
  [{ cat:"Exact", word:"amazon" }]
);

assertMatches(
  "non-wildcard (exact) beats wildcard at same span, regardless of priority",
  cfg([
    cat("wc", "Wildcard", "#00f", ["walmart*"]),   // priority 0, wildcard
    cat("ex", "Exact",    "#f00", ["//walmart"]),  // priority 1, non-wildcard
  ]),
  "I love walmart today",
  // same span [8,15]; non-wildcard rule fires before priority → exact wins
  [{ cat:"Exact", word:"walmart" }]
);

assertMatches(
  "//exact beats wildcard* on contained phrase",
  cfg([
    cat("wc", "Wildcard", "#00f", ["bought*"]),   // matches "bought from" (greedy) ? No — ends at boundary
    cat("ex", "Exact",    "#f00", ["//bought"]),  // matches "bought" (exact, boundary)
  ]),
  "I bought from amazon",
  // "bought*" with trailing * ends at word boundary (space after "bought"), so matches "bought"
  // "//bought" also matches "bought" — same span
  // non-wildcard (exact) beats wildcard → Exact wins
  [{ cat:"Exact", word:"bought" }]
);

assertMatches(
  "wildcard beats plain substring at same span (no exact to rescue)",
  cfg([
    cat("wc", "Wildcard", "#00f", ["amazon*"]),  // wildcard, longer match "amazonian"
    cat("pl", "Plain",    "#f00", ["amazon"]),   // plain substring, shorter "amazon"
  ]),
  "I love amazonian products",
  // "amazon*" matches "amazonian" [7,16], "amazon" matches [7,13]
  // "amazonian" contains "amazon"; neither is exact → container wins
  [{ cat:"Wildcard", word:"amazonian" }]
);

assertMatches(
  "exact match on same span as non-wildcard: priority decides",
  cfg([
    cat("hi", "High", "#0f0", ["walmart"]),    // priority 0, non-wildcard
    cat("lo", "Low",  "#f00", ["//walmart"]),  // priority 1, non-wildcard (exact)
  ]),
  "I shop at walmart today",
  // same span, both non-wildcard → priority decides → High wins
  [{ cat:"High", word:"walmart" }]
);

// =============================================================================
// 9. LIT: prefix (literal asterisk)
// =============================================================================
section("9. LIT: prefix");

assertMatches(
  "LIT: matches literal asterisk in text",
  cfg([cat("a", "CS", "#90f", ["LIT:test*file"])]),
  "The file is named test*file.txt",
  [{ cat:"CS", word:"test*file" }]
);

assertMatches(
  "LIT: does NOT match when literal asterisk is absent",
  cfg([cat("a", "CS", "#90f", ["LIT:test*file"])]),
  "The file is named testfile.txt",
  []
);

// =============================================================================
// 10. Boundary markers
// =============================================================================
section("10. Boundary markers");

assertMatches(
  "boundary-padded entry requires word boundary",
  cfg([cat("a", "Ret", "#0f0", [" elf "])]),
  "I love elf products",
  [{ cat:"Ret", word:"elf" }]
);

assertMatches(
  "boundary-padded entry does not match inside compound word",
  cfg([cat("a", "Ret", "#0f0", [" elf "])]),
  "I love herself today",
  []
);

// =============================================================================
// 11. Disabled categories
// =============================================================================
section("11. Disabled categories");

assertMatches(
  "disabled category produces no matches",
  cfg([
    { id:"a", name:"Active",   color:"#0f0", fColor:"#000", enabled: true,  words:["walmart"] },
    { id:"b", name:"Disabled", color:"#f00", fColor:"#000", enabled: false, words:["amazon"]  },
  ]),
  "walmart and amazon are retailers",
  [{ cat:"Active", word:"walmart" }]
);

// =============================================================================
// 12. Ignore list — containment semantics (Bug 3 / "switch" fix)
// =============================================================================
// The ignore filter now uses CONTAINMENT, not overlap.
// A category match is suppressed only when it is fully inside an ignore range.
// This means a larger compound match (e.g. "bait and switch") survives even
// when a sub-term ("//switch") is in the ignore list.
// =============================================================================
section("12. Ignore list — containment (not overlap) semantics");

assertMatches(
  "//switch in ignore suppresses standalone 'switch'",
  cfg([cat("a", "Cat", "#f00", ["switch", "bait * switch"])], ["//switch"]),
  "the switch was broken",
  []
);

assertMatches(
  "//switch in ignore does NOT suppress 'bait and switch' compound match",
  cfg([cat("a", "Cat", "#f00", ["switch", "bait * switch"])], ["//switch"]),
  "classic bait and switch scheme",
  [{ cat:"Cat", word:"bait and switch" }]
);

assertMatches(
  "plain 'arsen' in ignore suppresses 'arse' inside 'arsenal'",
  cfg([cat("a", "PRF", "#f00", ["arse"])], ["arsen"]),
  "arsenal",
  []
);

assertMatches(
  "//arsen (exact) in ignore does NOT suppress 'arse' inside 'arsenal' — word boundary fails",
  cfg([cat("a", "PRF", "#f00", ["arse"])], ["//arsen"]),
  "arsenal",
  [{ cat:"PRF", word:"arse" }]
);

assertMatches(
  "ignore entry wider than match: 'easy to use' suppresses 'use' inside it",
  cfg([cat("a", "Cat", "#f00", ["use"])], ["easy to use"]),
  "This is easy to use daily",
  []
);

assertMatches(
  "ignore entry narrower than match: plain 'switch' in ignore does NOT block 'bait * switch' (larger match)",
  cfg([cat("a", "Cat", "#f00", ["bait * switch"])], ["switch"]),
  "classic bait and switch scheme",
  [{ cat:"Cat", word:"bait and switch" }]
);

// =============================================================================
// 13. CS: prefix in the ignore list
// =============================================================================
// A CS: ignore entry is case-sensitive: it only suppresses category matches
// that have the exact same casing. A plain (no CS:) ignore entry is
// case-insensitive and suppresses all case variants.
// =============================================================================
section("13. CS: in ignore list");

assertMatches(
  "CS:HP in ignore suppresses 'HP' but not 'hp'",
  cfg([cat("a", "Tech", "#f00", ["hp"])], ["CS:HP"]),
  "The hp and HP products",
  [{ cat:"Tech", word:"hp" }]
);
// Category "hp" is case-insensitive → matches "hp" AND "HP".
// Ignore CS:HP is case-sensitive → ignore range covers only the capital "HP".
// "hp" (lowercase) is NOT inside the ignore range → survives.
// "HP" IS inside the ignore range → suppressed.

assertMatches(
  "plain (case-insensitive) ignore suppresses all case variants",
  cfg([cat("a", "Tech", "#f00", ["hp"])], ["hp"]),
  "The hp and HP products",
  []
);
// Ignore "hp" is case-insensitive → covers both "hp" and "HP".
// All category matches are suppressed.

// =============================================================================
// 14. Boundary markers + wildcards
// =============================================================================
// A word padded with spaces gets boundaryBefore + boundaryAfter flags.
// When that word also contains a wildcard, both constraints apply:
// the match must start and end at a word boundary, and the wildcard
// expands within the token.
// =============================================================================
section("14. Boundary markers + wildcards");

assertMatches(
  "' amazon* ' does not match 'primeamazon' (no boundary before)",
  cfg([cat("a", "Retail", "#f00", [" amazon* "])], []),
  "primeamazon amazon amazonian",
  [{ cat:"Retail", word:"amazon" }, { cat:"Retail", word:"amazonian" }]
);
// "primeamazon" — 'amazon' starts mid-token, boundary assertion fails → no match.
// "amazon"    — preceded by space, followed by space → matches (wildcard expands to nothing).
// "amazonian" — preceded by space, followed by end   → matches (wildcard expands to "ian").

assertMatches(
  "' *retailer ' boundary + wildcard: matches suffix form but not if no boundary before",
  cfg([cat("a", "Retail", "#f00", [" *retailer "])], []),
  "etailer eretailer retailer",
  [{ cat:"Retail", word:"eretailer" }, { cat:"Retail", word:"retailer" }]
);
// "etailer"   — 7 chars, 'retailer' (8 chars) can't fit as a suffix → no match.
// "eretailer" — at word boundary; * eats 'e', then 'retailer' matches → match.
// "retailer"  — at word boundary; * eats nothing → match.
// Note: hyphens and other punctuation ARE treated as word boundaries by the engine,
// so 'e-retailer' would yield a match on just the 'retailer' sub-token.

// =============================================================================
// Summary
// =============================================================================
console.log("\n" + "=".repeat(60));
console.log(` Results: \x1b[32m${passed} passed\x1b[0m, \x1b[${failed > 0 ? "31" : "32"}m${failed} failed\x1b[0m`);
console.log("=".repeat(60) + "\n");

if (failed > 0) {
  process.exit(1);
}
