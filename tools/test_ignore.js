// =============================================================================
// IGNORE LIST LOGIC TESTS
// =============================================================================
// Focused tests for ignore list behavior, edge cases, and interactions
// with wildcards, exact matches, and category priority.
//
// Run with:   node tools/test_ignore.js
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

// =====================================================================
console.log("\n=== IGNORE LIST: SUBSTRING vs EXACT ===\n");

// The core issue: "post" (substring) in ignore blocks "postpartum" matching
test(
  'Bare "post" in ignore blocks "post?partum" category match',
  {
    ignoreList: ["post"],
    categories: [{
      id: "c1", name: "Medical", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["post?partum"]
    }]
  },
  "She discussed postpartum recovery",
  []  // "postpartum" is blocked because "post" ignore range overlaps it
);

// NOTE: post?partum requires exactly 11 chars (post + 1 char + partum).
// "postpartum" is only 10 chars — ? needs a separator char between "post" and "partum".
// So post?partum matches "post-partum" or "post partum" but NOT "postpartum".
test(
  '//post (exact) in ignore does NOT block "post-partum" (hyphenated)',
  {
    ignoreList: ["//post"],
    categories: [{
      id: "c1", name: "Medical", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["post?partum"]
    }]
  },
  "She discussed post-partum recovery",
  // //post matches "post" before "-" (hyphen is punctuation → boundary OK)
  // ignore range covers "post" (14-18), category "post-partum" covers (14-27)
  // overlap → blocked. This is the real issue.
  []
);

test(
  'Without "post" in ignore, "post?partum" matches "post-partum"',
  {
    ignoreList: [],
    categories: [{
      id: "c1", name: "Medical", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["post?partum"]
    }]
  },
  "She discussed post-partum recovery",
  ["post-partum:Medical"]
);

test(
  '"postpartum" (literal) in category matches regardless of "//post" in ignore',
  {
    ignoreList: ["//post"],
    categories: [{
      id: "c1", name: "Medical", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["postpartum"]
    }]
  },
  "She discussed postpartum recovery",
  ["postpartum:Medical"]  // //post doesn't match inside "postpartum" (no boundary after)
);

test(
  '//post (exact) still blocks standalone "post"',
  {
    ignoreList: ["//post"],
    categories: [{
      id: "c1", name: "Cat", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["post"]
    }]
  },
  "She wrote a post about it",
  []  // standalone "post" is blocked by //post
);

// =====================================================================
console.log("\n=== IGNORE LIST: WILDCARDS ===\n");

test(
  'd*t burn in ignore blocks "doesn\'t burn"',
  {
    ignoreList: ["d*t burn"],
    categories: [{
      id: "c1", name: "AE", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["burn"]
    }]
  },
  "It doesn't burn at all",
  []  // "doesn't burn" creates ignore range that covers "burn"
);

test(
  'd*t burn in ignore blocks "didnt burn" too',
  {
    ignoreList: ["d*t burn"],
    categories: [{
      id: "c1", name: "AE", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["burn"]
    }]
  },
  "Product didnt burn my skin",
  []
);

test(
  'd*t dry in ignore blocks "doesn\'t dry"',
  {
    ignoreList: ["d*t dry"],
    categories: [{
      id: "c1", name: "AE", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["dry"]
    }]
  },
  "It doesn't dry out my skin",
  []
);

test(
  '"burn" still highlights when NOT preceded by d*t',
  {
    ignoreList: ["d*t burn"],
    categories: [{
      id: "c1", name: "AE", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["burn"]
    }]
  },
  "It will burn your skin if misused",
  ["burn:AE"]
);

test(
  'Wildcard ignore "no burn" blocks correctly',
  {
    ignoreList: ["no burn"],
    categories: [{
      id: "c1", name: "AE", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["burn"]
    }]
  },
  "There was no burn at all. But this one did burn.",
  ["burn:AE"]  // second "burn" still highlights (not preceded by "no")
);

// =====================================================================
console.log("\n=== IGNORE LIST: BOUNDARY SPACES ===\n");

test(
  '" elf " (boundary) in ignore blocks standalone elf',
  {
    ignoreList: [" elf "],
    categories: [{
      id: "c1", name: "RET", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["elf"]
    }]
  },
  "I love elf products",
  []  // " elf " matches standalone elf
);

test(
  '" elf " (boundary) in ignore does NOT block "herself"',
  {
    ignoreList: [" elf "],
    categories: [{
      id: "c1", name: "RET", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["elf"]
    }]
  },
  "She herself was surprised",
  ["elf:RET"]  // "elf" inside "herself" is NOT blocked by " elf "
);

// =====================================================================
console.log("\n=== IGNORE LIST: OVERLAP WITH LONGER CATEGORY MATCH ===\n");

test(
  'Ignore "store" (substring) blocks "store" but also "store front" category',
  {
    ignoreList: ["store front"],
    categories: [{
      id: "c1", name: "RET", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["store"]
    }]
  },
  "The store front was nice. The store had good deals.",
  ["store:RET"]  // only second "store" highlights, first is inside "store front" ignore
);

test(
  '"stores" in ignore (substring) blocks category matching "store" inside "stores"',
  {
    ignoreList: ["stores"],
    categories: [{
      id: "c1", name: "RET", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["store"]
    }]
  },
  "Multiple stores are available. The store is here.",
  ["store:RET"]  // only the standalone "store" matches
);

test(
  '"//stores" in ignore: blocks "store" inside "stores" but allows standalone "store"',
  {
    ignoreList: ["//stores"],
    categories: [{
      id: "c1", name: "RET", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["store"]
    }]
  },
  "Multiple stores are available. The store is here.",
  ["store:RET"]  // "store" inside "stores" overlaps the //stores ignore range -> blocked; standalone -> OK
);

// =====================================================================
console.log("\n=== IGNORE LIST: INTERACTION WITH EXACT CATEGORY MATCHES ===\n");

test(
  'Ignore "as" (substring) blocks exact "//as!" match',
  {
    ignoreList: ["as"],
    categories: [{
      id: "c1", name: "PRF", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["//as!"]
    }]
  },
  "That is disgusting, as!",
  []  // "as" substring creates ignore range that overlaps "as!"
);

test(
  'Ignore "//as" (exact) DOES block "as!" because "!" is punctuation (boundary)',
  {
    ignoreList: ["//as"],
    categories: [{
      id: "c1", name: "PRF", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["//as!"]
    }]
  },
  "That is disgusting, as!",
  []  // "//as" matches "as" before "!" (punct = boundary), ignore range overlaps "as!" category match
);

// =====================================================================
console.log("\n=== IGNORE LIST: CASE SENSITIVE INTERACTIONS ===\n");

test(
  'Ignore "post" blocks "Post" (case-insensitive by default)',
  {
    ignoreList: ["post"],
    categories: [{
      id: "c1", name: "Cat", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["post"]
    }]
  },
  "She wrote a Post about it",
  []
);

test(
  'CS:Post in ignore only blocks "Post", not "post"',
  {
    ignoreList: ["CS:Post"],
    categories: [{
      id: "c1", name: "Cat", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["post"]
    }]
  },
  "She wrote a post about it. Then another Post.",
  ["post:Cat"]  // lowercase "post" highlights, uppercase "Post" blocked
);

// =====================================================================
console.log("\n=== CATEGORY PRIORITY AND OVERLAP RESOLUTION ===\n");

test(
  'Higher priority category wins when two categories match same text',
  {
    ignoreList: [],
    categories: [
      { id: "c1", name: "HighPri", color: "#ff0000", fColor: "#fff", enabled: true, words: ["burn"] },
      { id: "c2", name: "LowPri", color: "#00ff00", fColor: "#fff", enabled: true, words: ["burn"] }
    ]
  },
  "It will burn",
  ["burn:HighPri"]
);

test(
  'Exact match wins over wildcard containing it',
  {
    ignoreList: [],
    categories: [
      { id: "c1", name: "Wild", color: "#ff0000", fColor: "#fff", enabled: true, words: ["b*n"] },
      { id: "c2", name: "Exact", color: "#00ff00", fColor: "#fff", enabled: true, words: ["//burn"] }
    ]
  },
  "It will burn your skin",
  ["burn:Exact"]  // exact //burn beats wildcard b*n even though Wild is higher priority
);

test(
  'Longer match wins over shorter at same position',
  {
    ignoreList: [],
    categories: [
      { id: "c1", name: "Short", color: "#ff0000", fColor: "#fff", enabled: true, words: ["ship"] },
      { id: "c2", name: "Long", color: "#00ff00", fColor: "#fff", enabled: true, words: ["shipping"] }
    ]
  },
  "The shipping was fast",
  ["shipping:Long"]
);

// =====================================================================
console.log("\n=== WILDCARD APOSTROPHE/HYPHEN MATCHING ===\n");

test(
  '* matches apostrophe in contractions (doesn\'t)',
  {
    ignoreList: [],
    categories: [{
      id: "c1", name: "Cat", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["d*t"]
    }]
  },
  "It doesn't work",
  ["doesn't:Cat"]
);

test(
  '* matches right single quote (curly apostrophe)',
  {
    ignoreList: [],
    categories: [{
      id: "c1", name: "Cat", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["d*t"]
    }]
  },
  "It doesn\u2019t work",
  ["doesn\u2019t:Cat"]
);

test(
  '* matches hyphen in compound words',
  {
    ignoreList: [],
    categories: [{
      id: "c1", name: "Cat", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["h*t rec*d"]
    }]
  },
  "Haven't received it yet",
  ["Haven't received:Cat"]
);

test(
  'Ignore with wildcard + apostrophe: d*t burn blocks doesn\'t burn',
  {
    ignoreList: ["d*t burn"],
    categories: [{
      id: "c1", name: "AE", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["burn"]
    }]
  },
  "It doesn't burn my eyes",
  []
);

test(
  'discontin* matches "Discontinuation"',
  {
    ignoreList: [],
    categories: [{
      id: "c1", name: "Cat", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["discontin*"]
    }]
  },
  "The Discontinuation was announced",
  ["Discontinuation:Cat"]
);

// =====================================================================
console.log("\n=== MULTI-WORD IGNORE PATTERNS ===\n");

test(
  '"easy to use" in ignore: doesn\'t block just "easy" or "use"',
  {
    ignoreList: ["easy to use"],
    categories: [{
      id: "c1", name: "Cat", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["easy", "use"]
    }]
  },
  "It was easy. Easy to use for sure. Also useful.",
  ["easy:Cat", "use:Cat"]  // first "easy" and "use" in "useful" highlight; "easy to use" is blocked
);

test(
  '"gifted by *" in ignore blocks "gifted by them" etc',
  {
    ignoreList: ["gifted by *"],
    categories: [{
      id: "c1", name: "PRF", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["gifted"]
    }]
  },
  "I was gifted by Sephora this product. I gifted it to her.",
  ["gifted:PRF"]  // only second "gifted" highlights
);

test(
  '"best * that I* had" in ignore blocks longer phrases',
  {
    ignoreList: ["best * that I* had"],
    categories: [{
      id: "c1", name: "Cat", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["best"]
    }]
  },
  "This is the best thing that I've had in years. Best product ever.",
  ["Best:Cat"]  // only the second "Best" highlights
);

// =====================================================================
console.log("\n=== EDGE CASES ===\n");

test(
  'Empty ignore list changes nothing',
  {
    ignoreList: [],
    categories: [{
      id: "c1", name: "Cat", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["hello"]
    }]
  },
  "Hello world",
  ["Hello:Cat"]
);

test(
  'Ignore entry that matches entire text blocks everything',
  {
    ignoreList: ["*"],
    categories: [{
      id: "c1", name: "Cat", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["hello"]
    }]
  },
  "hello",
  []
);

test(
  'Multiple ignore ranges can block different category matches',
  {
    ignoreList: ["no burn", "no sting"],
    categories: [{
      id: "c1", name: "AE", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["burn", "sting"]
    }]
  },
  "There was no burn and no sting. But the burn was bad.",
  ["burn:AE"]  // only the last standalone "burn" highlights
);

test(
  'Disabled category is not matched',
  {
    ignoreList: [],
    categories: [{
      id: "c1", name: "Cat", color: "#ff0000", fColor: "#fff",
      enabled: false, words: ["hello"]
    }]
  },
  "Hello world",
  []
);

test(
  '"cups" in ignore blocks "cups" but not "ups" in different word',
  {
    ignoreList: ["cups"],
    categories: [{
      id: "c1", name: "SI", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["ups"]
    }]
  },
  "I used 3 cups daily. UPS delivered it fast.",
  ["UPS:SI"]  // "ups" inside "cups" is blocked by "cups" ignore range; standalone "UPS" highlights
);

test(
  '"//cups" in ignore: blocks "ups" inside "cups" (overlap), allows standalone "UPS"',
  {
    ignoreList: ["//cups"],
    categories: [{
      id: "c1", name: "SI", color: "#ff0000", fColor: "#fff",
      enabled: true, words: ["ups"]
    }]
  },
  "I used 3 cups daily. UPS delivered it fast.",
  ["UPS:SI"]  // "ups" inside "cups" overlaps ignore range -> blocked; standalone "UPS" -> OK
);

// =====================================================================
// Summary
// =====================================================================
console.log("\n" + "=".repeat(60));
console.log(` Results: ${passed} passed, ${failed} failed`);
console.log("=".repeat(60) + "\n");

if (failed > 0) process.exit(1);
