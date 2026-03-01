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

assertMatches(
  "//word does NOT steal plain phrase match that contains it",
  cfg([
    cat("ph", "Phrase",  "#0f0", ["customer service"]),  // plain phrase, longer
    cat("ex", "Exact",   "#f00", ["//customer"]),        // exact word, contained
  ]),
  "The customer service was great",
  // //customer matches "customer" [4,12]; "customer service" matches [4,20]
  // "customer service" (container, non-wildcard) should win over //customer (contained, exact)
  [{ cat:"Phrase", word:"customer service" }]
);

assertMatches(
  "//word still beats wildcard* container (isExact fix preserved)",
  cfg([
    cat("wc", "Wildcard", "#00f", ["customer*"]),   // matches "customer" (no trailing non-space), wildcard
    cat("ex", "Exact",    "#f00", ["//customer"]),  // matches "customer", exact
  ]),
  "I love customer products",
  // Both match "customer" at the same span — non-wildcard beats wildcard regardless
  [{ cat:"Exact", word:"customer" }]
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
// Summary
// =============================================================================
console.log("\n" + "=".repeat(60));
console.log(` Results: \x1b[32m${passed} passed\x1b[0m, \x1b[${failed > 0 ? "31" : "32"}m${failed} failed\x1b[0m`);
console.log("=".repeat(60) + "\n");

if (failed > 0) {
  process.exit(1);
}
