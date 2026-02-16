#!/usr/bin/env node
"use strict";

// Tests for whitespace normalization (NBSP, zero-width chars, etc.)
const M = require("./matcher.js");

let passed = 0, failed = 0;

function test(label, pattern, text, shouldMatch) {
  const compiled = M.compileAll({
    ignoreList: [],
    categories: [{
      id: "cat1", name: "CAT", color: "#FF0000", fColor: "#FFFFFF",
      enabled: true, words: [pattern]
    }]
  });

  const matches = M.findMatches(text, compiled);
  const didMatch = matches.length > 0;

  if (didMatch === shouldMatch) {
    console.log("  PASS: " + label);
    passed++;
  } else {
    console.log("  FAIL: " + label);
    console.log("        pattern: " + JSON.stringify(pattern));
    console.log("        text: " + JSON.stringify(text));
    console.log("        expected " + (shouldMatch ? "match" : "no match") + ", got " + (didMatch ? "match" : "no match"));
    if (didMatch) {
      console.log("        matches: " + JSON.stringify(matches.map(m => text.slice(m.start, m.end))));
    }
    failed++;
  }
}

console.log("\n=== NBSP IN PATTERNS (should be normalized to regular space) ===\n");

// Patterns with NBSP between words — should match text with regular spaces
test("NBSP in pattern matches regular space in text",
  "minimal\u00A0discomfort", "I felt minimal discomfort.", true);

test("NBSP in pattern matches NBSP in text",
  "minimal\u00A0discomfort", "I felt minimal\u00A0discomfort.", true);

test("regular space in pattern matches NBSP in text",
  "minimal discomfort", "I felt minimal\u00A0discomfort.", true);

test("multi-NBSP pattern: 'not as described'",
  "not\u00A0as\u00A0described", "The product was not as described.", true);

test("mixed NBSP/space pattern",
  "time\u00A0of month", "It's that time of month.", true);

console.log("\n=== ZERO-WIDTH CHARS IN PATTERNS (should be stripped) ===\n");

test("zero-width space in pattern is stripped",
  "disco\u200Bntinued", "Product was discontinued.", true);

test("zero-width joiner in pattern is stripped",
  "sexu\u200Dalized", "The content was sexualized.", true);

test("BOM in pattern is stripped",
  "\uFEFFdiscontinued", "Product was discontinued.", true);

test("soft hyphen in pattern is stripped",
  "dis\u00ADcontinued", "Product was discontinued.", true);

console.log("\n=== WILDCARD + NBSP PATTERNS ===\n");

test("wildcard with NBSP: 'need*\u00A0to' matches 'needs to'",
  "need*\u00A0to\u00A0be\u00A0re*designed", "needs to be redesigned", true);

test("wildcard surrounded by NBSP: 'took\u00A0*\u00A0days'",
  "took\u00A0*\u00A0days", "took five days to arrive", true);

test("leading wildcard with NBSP: '*\u00A0routine'",
  "*\u00A0routine", "daily routine is good", true);

console.log("\n=== NBSP IN TEXT (matched by \\s+ regex) ===\n");

test("text has NBSP, pattern has space",
  "no noticeable effect", "There was no\u00A0noticeable\u00A0effect.", true);

test("text has tab, pattern has space",
  "no noticeable effect", "There was no\tnoticeable\teffect.", true);

test("text has multiple spaces, pattern has single space",
  "minimal discomfort", "I felt minimal   discomfort.", true);

console.log("\n=== parseWordEntry NORMALIZATION ===\n");

function testParsed(label, input, expectedPattern) {
  const parsed = M.parseWordEntry(input);
  if (parsed && parsed.pattern === expectedPattern) {
    console.log("  PASS: " + label);
    passed++;
  } else {
    console.log("  FAIL: " + label + " — got '" + (parsed ? parsed.pattern : "null") + "', expected '" + expectedPattern + "'");
    failed++;
  }
}

testParsed("parseWordEntry normalizes NBSP to space",
  "hello\u00A0world", "hello world");

testParsed("parseWordEntry strips zero-width space",
  "he\u200Bllo", "hello");

testParsed("parseWordEntry collapses multiple spaces",
  "multiple   spaces", "multiple spaces");

console.log("\n============================================================");
console.log(" Results: " + passed + " passed, " + failed + " failed");
console.log("============================================================");

process.exit(failed > 0 ? 1 : 0);
