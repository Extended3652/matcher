// =============================================================================
// EDGE CASE & ADVANCED MATCHING TESTS
// =============================================================================
// Comprehensive tests for wildcards, exact matches, ignore interactions,
// overlap resolution, boundary behavior, and tricky real-world scenarios.
//
// Run with:   node tools/test_edge_cases.js
// =============================================================================

"use strict";

const { compileAll, findMatches, parseWordEntry } = require("./matcher.js");

let passed = 0;
let failed = 0;

function test(name, config, text, expectedNames) {
  const compiled = compileAll(config);
  const matches = findMatches(text, compiled);
  const gotNames = matches.map(m => text.slice(m.start, m.end) + ":" + m.categoryName);
  const expNames = expectedNames.slice().sort();
  const gotSorted = gotNames.slice().sort();

  const ok = JSON.stringify(expNames) === JSON.stringify(gotSorted);
  if (ok) {
    passed++;
    console.log(`  PASS: ${name}`);
  } else {
    failed++;
    console.log(`  FAIL: ${name}`);
    console.log(`    Expected: ${JSON.stringify(expectedNames)}`);
    console.log(`    Got:      ${JSON.stringify(gotNames)}`);
  }
}

// Helper: standard category config builder
function cat(name, words, opts) {
  return {
    id: name.toLowerCase().replace(/\s+/g, "_"),
    name,
    color: "#ff0000",
    fColor: "#fff",
    enabled: true,
    words,
    ...opts,
  };
}

// =====================================================================
console.log("\n=== USER SCENARIO: scan / //scans ===\n");

test(
  '"scan" in RET codes "scan" in text',
  { ignoreList: [], categories: [cat("RET", ["scan"])] },
  "Please scan the barcode before checkout.",
  ["scan:RET"]
);

test(
  '"scan" in RET also codes "scans" (substring match)',
  { ignoreList: [], categories: [cat("RET", ["scan"])] },
  "She scans each item carefully.",
  ["scan:RET"]
);

test(
  '"//scans" in ignore blocks "scans" but NOT "scan"',
  { ignoreList: ["//scans"], categories: [cat("RET", ["scan"])] },
  "She scans each item. Please scan the barcode.",
  ["scan:RET"]
);

test(
  '"//scans" in ignore: "scan" inside "scans" is blocked (overlap)',
  { ignoreList: ["//scans"], categories: [cat("RET", ["scan"])] },
  "She scans each item.",
  []  // "scan" match at pos 4-8 overlaps with "scans" ignore at pos 4-9
);

test(
  '"//scan" in ignore blocks standalone "scan" but "scans" still codes',
  { ignoreList: ["//scan"], categories: [cat("RET", ["scan"])] },
  "She scans each item. Please scan the barcode.",
  ["scan:RET"]  // "scan" inside "scans" has no boundary after → //scan doesn't match; standalone "scan" is blocked
);

test(
  'Both "scan" and "//scans" — scan still codes in other words like "scanner"',
  { ignoreList: ["//scans"], categories: [cat("RET", ["scan"])] },
  "The scanner works. She scans items. Please scan it.",
  ["scan:RET", "scan:RET"]  // "scanner" and standalone "scan"; "scans" is blocked
);

// =====================================================================
console.log("\n=== EXACT MATCH (//) BOUNDARY BEHAVIOR ===\n");

test(
  '//word matches at start of text',
  { ignoreList: [], categories: [cat("C", ["//hello"])] },
  "hello world",
  ["hello:C"]
);

test(
  '//word matches at end of text',
  { ignoreList: [], categories: [cat("C", ["//world"])] },
  "hello world",
  ["world:C"]
);

test(
  '//word matches with punctuation boundary',
  { ignoreList: [], categories: [cat("C", ["//hello"])] },
  "Say hello, world!",
  ["hello:C"]
);

test(
  '//word does NOT match inside another word',
  { ignoreList: [], categories: [cat("C", ["//hell"])] },
  "The word hello contains hell but only at word boundary",
  ["hell:C"]  // matches "hell" before space in "hell but" — wait, "hello" has no boundary after "hell"
);

test(
  '//word does NOT match as substring in middle of word',
  { ignoreList: [], categories: [cat("C", ["//can"])] },
  "The scanner is amazing",
  []  // "can" in "scanner" has no boundary before or after
);

test(
  '//word matches when surrounded by punctuation',
  { ignoreList: [], categories: [cat("C", ["//ok"])] },
  'She said "ok" and left.',
  ["ok:C"]
);

test(
  '//word with trailing punctuation in pattern',
  { ignoreList: [], categories: [cat("C", ["//damn!"])] },
  "Oh damn! That hurt.",
  ["damn!:C"]
);

// =====================================================================
console.log("\n=== WILDCARD EDGE CASES ===\n");

test(
  '? matches exactly one character (including space)',
  { ignoreList: [], categories: [cat("C", ["a?b"])] },
  "a b works, a-b works, ab does not",
  ["a b:C", "a-b:C"]
);

test(
  '* at start matches variable prefix',
  { ignoreList: [], categories: [cat("C", ["*tion"])] },
  "The action and motion were great",
  ["action:C", "motion:C"]
);

test(
  '* at end matches variable suffix',
  { ignoreList: [], categories: [cat("C", ["re*"])] },
  "She returned her receipt yesterday",
  ["returned:C", "receipt:C"]
);

test(
  '* in middle stays within token (no spaces)',
  { ignoreList: [], categories: [cat("C", ["s*n"])] },
  "The sun and scan are bright",
  ["sun:C", "scan:C"]
);

test(
  '* surrounded by spaces matches one token',
  { ignoreList: [], categories: [cat("C", ["took * days"])] },
  "It took five days to arrive. It took 30 days too.",
  ["took five days:C", "took 30 days:C"]
);

test(
  'Multiple wildcards in one pattern',
  { ignoreList: [], categories: [cat("C", ["d*n*t"])] },
  "She doesn't and didn't care",
  ["doesn't:C", "didn't:C"]
);

test(
  'Wildcard does not cross word boundaries (no spaces in pattern)',
  { ignoreList: [], categories: [cat("C", ["h*d"])] },
  "She had a hard day",
  ["had:C", "hard:C"]
);

test(
  '\\* is literal asterisk (escaped)',
  { ignoreList: [], categories: [cat("C", ["5\\*"])] },
  "Rated 5* out of 5 stars",
  ["5*:C"]
);

test(
  'LIT: prefix treats * as literal',
  { ignoreList: [], categories: [cat("C", ["LIT:5*"])] },
  "Rated 5* out of 5 stars",
  ["5*:C"]
);

// =====================================================================
console.log("\n=== CASE SENSITIVITY (CS:) ===\n");

test(
  'CS: matches only exact case',
  { ignoreList: [], categories: [cat("C", ["CS:HP"])] },
  "HP makes great laptops. My hp printer works.",
  ["HP:C"]
);

test(
  'Without CS:, matches any case',
  { ignoreList: [], categories: [cat("C", ["hp"])] },
  "HP makes great laptops. My hp printer works.",
  ["HP:C", "hp:C"]
);

test(
  'CS: combined with // (exact + case-sensitive)',
  { ignoreList: [], categories: [cat("C", ["CS://US"])] },
  "US policy. Let us go. The USB port.",
  ["US:C"]  // matches standalone "US" only (not "us" or "US" inside "USB")
);

test(
  'CS: in ignore only blocks matching case',
  {
    ignoreList: ["CS:Post"],
    categories: [cat("C", ["post"])]
  },
  "She wrote a post about it. Post was updated.",
  ["post:C"]  // lowercase "post" highlights, uppercase "Post" blocked
);

test(
  'CS: combined with wildcard',
  { ignoreList: [], categories: [cat("C", ["CS:App*"])] },
  "Apple makes Apps. The application is great. apps too.",
  ["Apple:C", "Apps:C"]  // case-sensitive: only matches starting with capital A-p-p
);

// =====================================================================
console.log("\n=== BOUNDARY SPACES ===\n");

test(
  '" it " with boundary spaces matches standalone "it"',
  { ignoreList: [], categories: [cat("C", [" it "])] },
  "It works but it does not fit in.",
  ["It:C", "it:C"]  // boundary before and after both "it" instances; "fit" has no boundary before "it"
);

test(
  'Leading boundary only: " dis" matches "dis" at word start',
  { ignoreList: [], categories: [cat("C", [" dis"])] },
  "I dislike this. Undiscovered territory.",
  ["dis:C"]  // only the "dis" at word start; "dis" inside "Undiscovered" has no boundary before
);

test(
  'Trailing boundary only: "ing " matches "ing" at word end',
  { ignoreList: [], categories: [cat("C", ["ing "])] },
  "Running is great. The king rules.",
  ["ing:C", "ing:C"]  // both "running" and "king" end with "ing" at boundary
);

// =====================================================================
console.log("\n=== OVERLAP RESOLUTION: PRIORITY ===\n");

test(
  'Same word in two categories: higher priority wins',
  {
    ignoreList: [],
    categories: [
      cat("AE", ["burn"]),
      cat("INGR", ["burn"])
    ]
  },
  "The burn was severe.",
  ["burn:AE"]
);

test(
  'Longer match beats shorter even from lower-priority category',
  {
    ignoreList: [],
    categories: [
      cat("Short", ["ship"]),
      cat("Long", ["shipping"])
    ]
  },
  "The shipping cost was high.",
  ["shipping:Long"]
);

test(
  'Exact match beats wildcard from higher-priority category',
  {
    ignoreList: [],
    categories: [
      cat("Wild", ["s*n"]),
      cat("Exact", ["//scan"])
    ]
  },
  "Please scan the item.",
  ["scan:Exact"]
);

test(
  'Non-wildcard beats wildcard at same priority',
  {
    ignoreList: [],
    categories: [
      cat("Mixed", ["s*n", "sun"])
    ]
  },
  "The sun is bright.",
  ["sun:Mixed"]  // literal "sun" beats wildcard "s*n"
);

// =====================================================================
console.log("\n=== OVERLAP RESOLUTION: CONTAINMENT ===\n");

test(
  'Longer containing match wins over shorter contained',
  {
    ignoreList: [],
    categories: [
      cat("C1", ["store front"]),
      cat("C2", ["store"])
    ]
  },
  "The store front was nice.",
  ["store front:C1"]
);

test(
  'Exact contained match beats non-exact container (wildcard)',
  {
    ignoreList: [],
    categories: [
      cat("C1", ["s*ning"]),
      cat("C2", ["//scan"])
    ]
  },
  "She was scanning items.",
  ["scanning:C1"]  // "scanning" contains "scan" but scanning is longer
);

// =====================================================================
console.log("\n=== IGNORE + CATEGORY INTERACTIONS ===\n");

test(
  'Substring ignore blocks all occurrences including inside larger words',
  {
    ignoreList: ["burn"],
    categories: [cat("AE", ["sunburn"])]
  },
  "She got a sunburn.",
  []  // "burn" ignore range overlaps with "sunburn" category match
);

test(
  'Exact ignore "//burn" does NOT block "sunburn" category match',
  {
    ignoreList: ["//burn"],
    categories: [cat("AE", ["sunburn"])]
  },
  "She got a sunburn from the burn.",
  ["sunburn:AE"]  // //burn has boundaries → doesn't match inside "sunburn"; blocks standalone "burn" but that's not in category
);

test(
  'Ignore with wildcard: "no * at all" blocks multi-word span',
  {
    ignoreList: ["no * at all"],
    categories: [cat("AE", ["burn", "sting"])]
  },
  "There was no burn at all. But the sting was real.",
  ["sting:AE"]
);

test(
  'Ignore blocks category match even if category is higher priority',
  {
    ignoreList: ["test"],
    categories: [cat("C1", ["test"])]
  },
  "This is a test.",
  []  // ignore always wins
);

test(
  'Ignore range only blocks overlapping category matches',
  {
    ignoreList: ["good burn"],
    categories: [cat("AE", ["burn"])]
  },
  "The good burn and the bad burn.",
  ["burn:AE"]  // only second "burn" (after "bad") codes
);

// =====================================================================
console.log("\n=== DUPLICATE AND REDUNDANT ENTRIES ===\n");

test(
  'Same word twice in same category: still matches once per position',
  {
    ignoreList: [],
    categories: [cat("C", ["scan", "scan"])]
  },
  "Please scan the barcode.",
  ["scan:C"]
);

test(
  'Substring "scan" makes exact "//scan" redundant (both in same cat)',
  {
    ignoreList: [],
    categories: [cat("C", ["scan", "//scan"])]
  },
  "Please scan the barcode. She scans daily.",
  ["scan:C", "scan:C"]  // substring "scan" covers both
);

test(
  '"scan" and "scans" in same category: longer "scans" wins at that position',
  {
    ignoreList: [],
    categories: [cat("C", ["scan", "scans"])]
  },
  "She scans and he scanned things.",
  ["scans:C", "scan:C"]  // "scans" is longer, wins overlap; "scan" still matches inside "scanned"
);

test(
  '"//scan" and "//scans" in same category: two separate exact matches',
  {
    ignoreList: [],
    categories: [cat("C", ["//scan", "//scans"])]
  },
  "She scans and he does a scan.",
  ["scans:C", "scan:C"]
);

// =====================================================================
console.log("\n=== CONFLICTING ENTRIES: IGNORE vs CATEGORY ===\n");

test(
  'Word in both ignore and category: ignore wins',
  {
    ignoreList: ["red"],
    categories: [cat("COLOR", ["red"])]
  },
  "The red car is fast.",
  []
);

test(
  '//word in ignore, substring in category: exact ignore blocks at boundary only',
  {
    ignoreList: ["//red"],
    categories: [cat("COLOR", ["red"])]
  },
  "The red car. She blushed and reddened.",
  ["red:COLOR"]  // "red" inside "reddened" not blocked (no boundary after "red"); standalone "red" blocked
);

test(
  'Wildcard in ignore, exact in category: wildcard range blocks',
  {
    ignoreList: ["no *ing"],
    categories: [cat("AE", ["//burning"])]
  },
  "There was no burning. But the burning continued.",
  ["burning:AE"]  // only second "burning"
);

test(
  'Substring ignore "a" blocks everything containing "a"',
  {
    ignoreList: ["a"],
    categories: [cat("C", ["apple", "banana", "cat"])]
  },
  "I like apple banana and cat.",
  []  // "a" in ignore creates ranges everywhere, blocking all
);

// =====================================================================
console.log("\n=== REAL-WORLD SCENARIOS ===\n");

test(
  'Brand names: "elf" codes as retailer but "herself" does not (using //elf)',
  {
    ignoreList: [],
    categories: [cat("RET", ["//elf"])]
  },
  "I love elf cosmetics. She herself liked them.",
  ["elf:RET"]
);

test(
  'Brand names: "elf" (substring) codes both, " elf " (boundary) would limit',
  {
    ignoreList: [],
    categories: [cat("RET", [" elf "])]
  },
  "I love elf cosmetics. She herself liked them.",
  ["elf:RET"]
);

test(
  'Profanity: "//ass" matches "ass" but not "class" or "passed"',
  {
    ignoreList: [],
    categories: [cat("PRF", ["//ass"])]
  },
  "Don't be an ass. The class passed the test.",
  ["ass:PRF"]
);

test(
  'Profanity: "a*s" (wildcard) matches too broadly — catches "akes", "apps", "arious", "actions"',
  {
    ignoreList: [],
    categories: [cat("PRF", ["a*s"])]
  },
  "She makes great apps. Various actions.",
  ["akes:PRF", "apps:PRF", "arious:PRF", "actions:PRF"]  // wildcard a*s is substring, very broad
);

test(
  'Adverse events: "d*t burn" in ignore, standalone "burn" still codes',
  {
    ignoreList: ["d*t burn"],
    categories: [cat("AE", ["burn"])]
  },
  "It doesn't burn. But the burn was bad.",
  ["burn:AE"]
);

test(
  'Product names: "IT Cosmetics" uses CS:// to avoid matching lowercase "it"',
  {
    ignoreList: [],
    categories: [cat("RET", ["CS://IT"])]
  },
  "IT Cosmetics is great. I love it when it works.",
  ["IT:RET"]
);

test(
  'Gifting context: ignore "gifted by *" but code standalone "gifted"',
  {
    ignoreList: ["gifted by *"],
    categories: [cat("PRF", ["gifted"])]
  },
  "I was gifted by the brand. The gifted artist painted.",
  ["gifted:PRF"]
);

test(
  'Multi-word category entry with wildcard: "out of *" in category',
  {
    ignoreList: [],
    categories: [cat("AE", ["out of *"])]
  },
  "I ran out of stock quickly.",
  ["out of stock:AE"]
);

// =====================================================================
console.log("\n=== PUNCTUATION BOUNDARY BEHAVIOR ===\n");

test(
  '//word matches before comma',
  { ignoreList: [], categories: [cat("C", ["//hello"])] },
  "hello, world",
  ["hello:C"]
);

test(
  '//word matches before period',
  { ignoreList: [], categories: [cat("C", ["//hello"])] },
  "Say hello.",
  ["hello:C"]
);

test(
  '//word matches before exclamation',
  { ignoreList: [], categories: [cat("C", ["//hello"])] },
  "Oh hello!",
  ["hello:C"]
);

test(
  '//word matches after opening paren',
  { ignoreList: [], categories: [cat("C", ["//test"])] },
  "Results (test) confirmed.",
  ["test:C"]
);

test(
  '//word matches after hyphen (hyphen is punctuation)',
  { ignoreList: [], categories: [cat("C", ["//free"])] },
  "This is cruelty-free product.",
  ["free:C"]
);

test(
  '//word matches after slash',
  { ignoreList: [], categories: [cat("C", ["//or"])] },
  "Use this and/or that.",
  ["or:C"]
);

// =====================================================================
console.log("\n=== MULTIPLE CATEGORIES AND COMPLEX OVERLAP ===\n");

test(
  'Three categories, overlapping matches: longest wins',
  {
    ignoreList: [],
    categories: [
      cat("C1", ["sun"]),
      cat("C2", ["sunburn"]),
      cat("C3", ["severe sunburn"])
    ]
  },
  "She had a severe sunburn.",
  ["severe sunburn:C3"]
);

test(
  'Adjacent matches from different categories',
  {
    ignoreList: [],
    categories: [
      cat("AE", ["dry"]),
      cat("INGR", ["skin"])
    ]
  },
  "My dry skin needs help.",
  ["dry:AE", "skin:INGR"]
);

test(
  'Overlapping matches: category priority breaks tie at same length',
  {
    ignoreList: [],
    categories: [
      cat("AE", ["//burn"]),
      cat("INGR", ["//burn"])
    ]
  },
  "The burn was bad.",
  ["burn:AE"]
);

test(
  'Wildcard in high-pri cat, exact in low-pri cat: exact wins',
  {
    ignoreList: [],
    categories: [
      cat("Wild", ["sc*"]),
      cat("Exact", ["//scan"])
    ]
  },
  "Please scan the item.",
  ["scan:Exact"]  // exact beats wildcard even from lower priority
);

// =====================================================================
console.log("\n=== SPECIAL CHARACTERS AND UNICODE ===\n");

test(
  'Word with curly apostrophe matches',
  { ignoreList: [], categories: [cat("C", ["don\u2019t"])] },
  "I don\u2019t like it.",
  ["don\u2019t:C"]
);

test(
  'Straight apostrophe matches curly apostrophe (quote normalization)',
  { ignoreList: [], categories: [cat("C", ["don't"])] },
  "I don\u2019t like it.",
  ["don\u2019t:C"]  // quote normalization: straight ' matches curly \u2019
);

test(
  'Accented characters match case-insensitively',
  { ignoreList: [], categories: [cat("C", ["caf\u00e9"])] },
  "Visit the Caf\u00e9 downtown.",
  ["Caf\u00e9:C"]
);

test(
  'Emoji in text does not break matching',
  { ignoreList: [], categories: [cat("C", ["love"])] },
  "I love \u2764\uFE0F this product and love it.",
  ["love:C", "love:C"]
);

// =====================================================================
console.log("\n=== EMPTY AND DEGENERATE INPUTS ===\n");

test(
  'Empty category word list produces no matches',
  { ignoreList: [], categories: [cat("C", [])] },
  "Hello world.",
  []
);

test(
  'Category with only whitespace entries produces no matches',
  { ignoreList: [], categories: [cat("C", ["", "   ", "\n"])] },
  "Hello world.",
  []
);

test(
  'Single character exact match: "//a"',
  { ignoreList: [], categories: [cat("C", ["//a"])] },
  "I saw a cat.",
  ["a:C"]  // "a" between spaces has word boundaries
);

test(
  'Very short substring match: "a" matches everywhere',
  { ignoreList: [], categories: [cat("C", ["a"])] },
  "a cat sat.",
  ["a:C", "a:C", "a:C"]
);

test(
  'No categories at all',
  { ignoreList: ["test"], categories: [] },
  "This is a test.",
  []
);

test(
  'Disabled category produces no matches',
  { ignoreList: [], categories: [cat("C", ["hello"], { enabled: false })] },
  "Hello world.",
  []
);

// =====================================================================
console.log("\n=== QUOTE NORMALIZATION ===\n");

test(
  'Curly apostrophe in pattern matches straight apostrophe in text',
  { ignoreList: [], categories: [cat("C", ["don\u2019t"])] },
  "I don't like it.",
  ["don't:C"]
);

test(
  'Straight apostrophe in pattern matches curly in text (already tested above)',
  { ignoreList: [], categories: [cat("C", ["it's"])] },
  "It\u2019s great.",
  ["It\u2019s:C"]
);

test(
  'Curly double quotes in pattern match straight in text',
  { ignoreList: [], categories: [cat("C", ["\u201Ctest\u201D"])] },
  'She said "test" loudly.',
  ['"test":C']
);

test(
  'Straight double quotes in pattern match curly in text',
  { ignoreList: [], categories: [cat("C", ['"hello"'])] },
  "She said \u201Chello\u201D to him.",
  ["\u201Chello\u201D:C"]
);

test(
  'Wildcard with apostrophe: d*t still matches contractions with curly quote',
  { ignoreList: [], categories: [cat("C", ["d*t"])] },
  "It doesn\u2019t work and didn't either.",
  ["doesn\u2019t:C", "didn't:C"]
);

test(
  'Quote normalization in ignore list works too',
  {
    ignoreList: ["don't"],
    categories: [cat("C", ["don\u2019t"])]
  },
  "I don\u2019t like it.",
  []  // ignore "don't" (straight) blocks "don\u2019t" (curly) in text
);

test(
  'LIT: prefix with quotes still normalizes',
  { ignoreList: [], categories: [cat("C", ["LIT:it's"])] },
  "It\u2019s great.",
  ["It\u2019s:C"]  // LIT: only affects * and ?, not quote normalization
);

// =====================================================================
console.log("\n=== ESCAPE PATTERNS (\\* \\? LITERALS) ===\n");

test(
  '\\* matches literal asterisk',
  { ignoreList: [], categories: [cat("C", ["5\\*"])] },
  "Rated 5* out of 10",
  ["5*:C"]
);

test(
  '\\*\\** matches literal ** with optional trailing wildcard',
  { ignoreList: [], categories: [cat("C", ["\\*\\**"])] },
  "The **bold** text and **italic** tag.",
  ["**bold:C", "**:C", "**italic:C", "**:C"]  // wildcard * can match zero chars, so bare ** matches too
);

test(
  '*\\*\\* matches optional leading wildcard then literal **',
  { ignoreList: [], categories: [cat("C", ["*\\*\\*"])] },
  "The **bold** text and end**.",
  ["**:C", "bold**:C", "end**:C"]  // leading wildcard can match zero chars
);

test(
  '\\? matches literal question mark',
  { ignoreList: [], categories: [cat("C", ["what\\?"])] },
  "She said what? Really?",
  ["what?:C"]
);

test(
  'Mixed escapes: \\*\\?test matches literal *?test',
  { ignoreList: [], categories: [cat("C", ["\\*\\?test"])] },
  "Enter *?test in the search box.",
  ["*?test:C"]
);

test(
  'LIT: prefix: LIT:** matches literal **',
  { ignoreList: [], categories: [cat("C", ["LIT:**"])] },
  "Use ** for bold and * for italic.",
  ["**:C"]
);

test(
  'Backslash at end of pattern is treated literally',
  { ignoreList: [], categories: [cat("C", ["path\\"])] },
  "The path\\ was wrong.",
  ["path\\:C"]
);

// =====================================================================
console.log("\n=== USER-REPORTED BUG SCENARIOS ===\n");

// --- long?term / long term / //long term ---
test(
  '"long?term" matches "long-term" (? = any single char)',
  { ignoreList: [], categories: [cat("UA", ["long?term"])] },
  "This is a long-term solution.",
  ["long-term:UA"]
);

test(
  '"long?term" matches "long term" (? matches space)',
  { ignoreList: [], categories: [cat("UA", ["long?term"])] },
  "This is a long term solution.",
  ["long term:UA"]
);

test(
  '"long term" (substring) matches "long term"',
  { ignoreList: [], categories: [cat("UA", ["long term"])] },
  "This is a long term solution.",
  ["long term:UA"]
);

test(
  '"//long term" (exact) matches "long term" with boundaries',
  { ignoreList: [], categories: [cat("UA", ["//long term"])] },
  "This is a long term solution.",
  ["long term:UA"]
);

// --- help with itching ---
test(
  '"help with itching" matches full phrase',
  { ignoreList: [], categories: [cat("UA", ["help with itching"])] },
  "This product does help with itching on my skin.",
  ["help with itching:UA"]
);

test(
  '"help with itching" in high-pri beats "itching" in low-pri',
  {
    ignoreList: [],
    categories: [
      cat("UA", ["help with itching"]),
      cat("AE", ["itching"])
    ]
  },
  "This product does help with itching on my skin.",
  ["help with itching:UA"]
);

// --- night*time routine ---
test(
  '"night*time routine" matches "nighttime routine"',
  { ignoreList: [], categories: [cat("CBN", ["night*time routine"])] },
  "My nighttime routine is simple.",
  ["nighttime routine:CBN"]
);

test(
  '"night*time routine" matches "night-time routine"',
  { ignoreList: [], categories: [cat("CBN", ["night*time routine"])] },
  "My night-time routine is simple.",
  ["night-time routine:CBN"]
);

// --- within minutes the pain ---
test(
  '"within minutes the pain" matches full phrase',
  { ignoreList: [], categories: [cat("UA", ["within minutes the pain"])] },
  "Within minutes the pain was gone.",
  ["Within minutes the pain:UA"]
);

test(
  '"within minutes the pain" in high-pri beats "pain" in low-pri',
  {
    ignoreList: [],
    categories: [
      cat("UA", ["within minutes the pain"]),
      cat("AE", ["pain"])
    ]
  },
  "Within minutes the pain was gone.",
  ["Within minutes the pain:UA"]
);

// --- from start to finish ---
test(
  '"from start to finish" matches full phrase',
  { ignoreList: [], categories: [cat("FIN", ["from start to finish"])] },
  "From start to finish this was great.",
  ["From start to finish:FIN"]
);

// --- * pleasantly surprised ---
test(
  '"* pleasantly surprised" matches "was pleasantly surprised"',
  { ignoreList: [], categories: [cat("C", ["* pleasantly surprised"])] },
  "I was pleasantly surprised by the results.",
  ["was pleasantly surprised:C"]
);

test(
  '"* pleasantly surprised" does NOT match starting with a space',
  { ignoreList: [], categories: [cat("C", ["* pleasantly surprised"])] },
  "Overall, pleasantly surprised by this.",
  ["pleasantly surprised:C"]  // when no word before, * matches zero chars but should not include leading space
);

// --- d*t know if th* w* old ---
test(
  '"d*t know if th* w* old" matches "don\'t know if they were old"',
  { ignoreList: [], categories: [cat("C", ["d*t know if th* w* old"])] },
  "I don't know if they were old.",
  ["don't know if they were old:C"]
);

// --- strip* * skin ---
test(
  '"strip* * skin" matches "strips your skin"',
  { ignoreList: [], categories: [cat("C", ["strip* * skin"])] },
  "It strips your skin of moisture.",
  ["strips your skin:C"]
);

test(
  '"strip* * skin" matches "stripped my skin"',
  { ignoreList: [], categories: [cat("C", ["strip* * skin"])] },
  "It stripped my skin badly.",
  ["stripped my skin:C"]
);

// --- cottontouch vs cotton ---
test(
  '"cottontouch" in high-pri beats "cotton" in low-pri (containment)',
  {
    ignoreList: [],
    categories: [
      cat("UA", ["cottontouch"]),
      cat("AE", ["cotton"])
    ]
  },
  "The cottontouch fabric is soft.",
  ["cottontouch:UA"]
);

// --- decent sizing ---
test(
  '"decent sizing" matches full phrase',
  { ignoreList: [], categories: [cat("C", ["decent sizing"])] },
  "It has decent sizing for the price.",
  ["decent sizing:C"]
);

test(
  '"decent sizing" in high-pri beats "sizing" in low-pri',
  {
    ignoreList: [],
    categories: [
      cat("UA", ["decent sizing"]),
      cat("AE", ["sizing"])
    ]
  },
  "It has decent sizing for the price.",
  ["decent sizing:UA"]
);

// =====================================================================
// Summary
// =====================================================================
console.log("\n" + "=".repeat(60));
console.log(` Results: ${passed} passed, ${failed} failed`);
console.log("=".repeat(60) + "\n");

if (failed > 0) process.exit(1);
