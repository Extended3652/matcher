#!/usr/bin/env node
"use strict";

// Diagnostic tests for user-reported matching issues
const M = require("./matcher.js");

let passed = 0, failed = 0;

function test(label, textInput, words, expectedMatch, opts) {
  opts = opts || {};
  const catName = opts.catName || "CAT";
  const categories = [{
    id: "cat1",
    name: catName,
    color: "#FF0000",
    fColor: "#FFFFFF",
    enabled: true,
    words: Array.isArray(words) ? words : [words]
  }];

  // Allow multiple categories for priority testing
  if (opts.extraCategories) {
    for (const ec of opts.extraCategories) {
      categories.push({
        id: ec.id || "cat_extra",
        name: ec.name,
        color: ec.color || "#00FF00",
        fColor: "#FFFFFF",
        enabled: true,
        words: ec.words
      });
    }
  }

  const compiled = M.compileAll({
    ignoreList: opts.ignoreList || [],
    categories: categories
  });

  const matches = M.findMatches(textInput, compiled);

  if (expectedMatch === false) {
    if (matches.length === 0) {
      console.log("  PASS: '" + words + "' correctly does NOT match '" + textInput + "'");
      passed++;
    } else {
      console.log("  FAIL: '" + words + "' should NOT match '" + textInput + "' but got: " +
        JSON.stringify(matches.map(m => textInput.slice(m.start, m.end))));
      failed++;
    }
    return;
  }

  if (typeof expectedMatch === "string") {
    const found = matches.find(m => textInput.slice(m.start, m.end).toLowerCase() === expectedMatch.toLowerCase());
    if (found) {
      console.log("  PASS: found '" + expectedMatch + "' in '" + textInput + "' (cat=" + found.categoryName + ")");
      passed++;
    } else {
      console.log("  FAIL: expected '" + expectedMatch + "' in '" + textInput + "' but got: " +
        JSON.stringify(matches.map(m => ({text: textInput.slice(m.start, m.end), cat: m.categoryName}))));
      failed++;
    }
    return;
  }

  // expectedMatch === true: just check we got at least one match
  if (matches.length > 0) {
    console.log("  PASS: '" + words + "' matches in '" + textInput + "' → " +
      JSON.stringify(matches.map(m => textInput.slice(m.start, m.end))));
    passed++;
  } else {
    console.log("  FAIL: '" + words + "' should match somewhere in '" + textInput + "' but got no matches");
    failed++;
  }
}

function testMatchFull(label, textInput, words, expectedFullMatch) {
  // Test that the ENTIRE expected text is matched
  const compiled = M.compileAll({
    ignoreList: [],
    categories: [{
      id: "cat1", name: "CAT", color: "#FF0000", fColor: "#FFFFFF",
      enabled: true,
      words: Array.isArray(words) ? words : [words]
    }]
  });

  const matches = M.findMatches(textInput, compiled);
  const found = matches.find(m => textInput.slice(m.start, m.end) === expectedFullMatch);
  if (found) {
    console.log("  PASS: '" + words + "' → matched '" + expectedFullMatch + "'");
    passed++;
  } else {
    console.log("  FAIL: '" + words + "' expected full match '" + expectedFullMatch + "' in '" + textInput + "'");
    console.log("        got: " + JSON.stringify(matches.map(m => textInput.slice(m.start, m.end))));
    failed++;
  }
}

// ============================================================================
console.log("\n=== ISSUE: 'should be taken' vs 'should be taken off the shelves' ===");
// "should be taken" highlighting over "should be taken off the shelves" in NLI

test("longer phrase should win (same cat)",
  "This product should be taken off the shelves immediately.",
  ["should be taken", "should be taken off the shelves"],
  "should be taken off the shelves"
);

test("longer phrase in lower-priority cat wins via containment",
  "This product should be taken off the shelves immediately.",
  ["should be taken"],
  "should be taken off the shelves",
  { extraCategories: [{ id: "nli", name: "NLI", words: ["should be taken off the shelves"] }] }
);

// ============================================================================
console.log("\n=== ISSUE: 'minimal discomfort' in AE not highlighting ===");

test("'minimal discomfort' as multi-word phrase",
  "I felt only minimal discomfort during the procedure.",
  ["minimal discomfort"],
  "minimal discomfort"
);

test("'minimal discomfort' case-insensitive",
  "Minimal Discomfort was experienced.",
  ["minimal discomfort"],
  "Minimal Discomfort"
);

// ============================================================================
console.log("\n=== ISSUE: 'Time of month' and 'that time of the month' in PRF ===");

test("'time of month' matches",
  "It's that time of month again.",
  ["time of month"],
  "time of month"
);

test("'that time of the month' matches",
  "It's that time of the month when I need this product.",
  ["that time of the month"],
  "that time of the month"
);

test("'Time of month' case-insensitive",
  "My Time Of Month is always tough.",
  ["time of month"],
  "Time Of Month"
);

// ============================================================================
console.log("\n=== ISSUE: 'no noticeable effect' in AE not working ===");

test("'no noticeable effect' matches",
  "There was no noticeable effect from using this product.",
  ["no noticeable effect"],
  "no noticeable effect"
);

// ============================================================================
console.log("\n=== ISSUE: 'discontin*' in CS not working ===");

test("'discontin*' matches 'discontinued'",
  "This product has been discontinued by the manufacturer.",
  ["discontin*"],
  "discontinued"
);

test("'discontin*' matches 'discontinue'",
  "They will discontinue this item next month.",
  ["discontin*"],
  "discontinue"
);

test("'discontin*' matches 'discontinuation'",
  "The discontinuation was unexpected.",
  ["discontin*"],
  "discontinuation"
);

// ============================================================================
console.log("\n=== ISSUE: 'sexualized' in LI not highlighting ===");

test("'sexualized' matches as substring",
  "The content appears sexualized and inappropriate.",
  ["sexualized"],
  "sexualized"
);

test("'sexualized' embedded in word",
  "The oversexualized content was flagged.",
  ["sexualized"],
  "sexualized"
);

// ============================================================================
console.log("\n=== ISSUE: 'need* to be re*designed' only highlighting 'needs' ===");

test("'need* to be re*designed' matches full phrase",
  "This product needs to be redesigned from scratch.",
  ["need* to be re*designed"],
  true
);

testMatchFull("'need* to be re*designed' matches entire phrase",
  "This product needs to be redesigned from scratch.",
  ["need* to be re*designed"],
  "needs to be redesigned"
);

test("'need* to be re*designed' with extra wildcard chars",
  "This product needed to be re-designed from scratch.",
  ["need* to be re*designed"],
  true
);

// Now test that if "need*" is separately in another category, the longer wins
test("separate 'need*' entry doesn't steal from multi-word pattern",
  "This product needs to be redesigned from scratch.",
  ["need*"],
  "needs to be redesigned",
  { extraCategories: [{ id: "cat2", name: "FULLPHRASE", words: ["need* to be re*designed"] }] }
);

// ============================================================================
console.log("\n=== ISSUE: 'not as described' in PD not working ===");

test("'not as described' matches",
  "The product was not as described in the listing.",
  ["not as described"],
  "not as described"
);

test("'not as described' case-insensitive",
  "Product NOT AS DESCRIBED and I want a refund.",
  ["not as described"],
  "NOT AS DESCRIBED"
);

// ============================================================================
console.log("\n=== REGEX COMPILATION CHECK ===");
// Let's check what regex is generated for multi-word phrases

function showRegex(pattern) {
  const parsed = M.parseWordEntry(pattern);
  if (!parsed) { console.log("  [null parsed for '" + pattern + "']"); return; }

  const compiled = M.compileAll({
    ignoreList: [],
    categories: [{
      id: "test", name: "TEST", color: "#FF0000", fColor: "#FFFFFF",
      enabled: true, words: [pattern]
    }]
  });

  if (compiled.compiledCategories.length > 0) {
    const re = compiled.compiledCategories[0].regexes[0].re;
    console.log("  Pattern: '" + pattern + "' → Regex: " + re.toString());
  }
}

showRegex("should be taken off the shelves");
showRegex("minimal discomfort");
showRegex("time of month");
showRegex("that time of the month");
showRegex("no noticeable effect");
showRegex("discontin*");
showRegex("sexualized");
showRegex("need* to be re*designed");
showRegex("not as described");

// ============================================================================
console.log("\n============================================================");
console.log(" Results: " + passed + " passed, " + failed + " failed");
console.log("============================================================");

process.exit(failed > 0 ? 1 : 0);
