// =============================================================================
// CMS Highlighter — Shared Utilities
// =============================================================================
// Loaded before background.js (importScripts), options.js, and popup.js.
// Do NOT wrap in an IIFE — these need to be globals accessible to all scripts.
// =============================================================================

"use strict";

// ---------------------------------------------------------------------------
// Alphabetical insert helpers
// ---------------------------------------------------------------------------
// Strips CS: and // prefixes so that "CS://HP" sorts by "hp", not the prefix.
function sortKey(raw) {
  return String(raw || "").replace(/^(CS:)?(\/\/)?/, "").toLowerCase();
}

// Inserts word into arr at the correct alphabetical position (by bare word).
// Binary search: O(log n) comparisons instead of O(n).
function insertAlphabetically(arr, word) {
  const key = sortKey(word);
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortKey(arr[mid]) < key) lo = mid + 1;
    else hi = mid;
  }
  arr.splice(lo, 0, word);
}

// ---------------------------------------------------------------------------
// Client-pattern glob helpers
// ---------------------------------------------------------------------------
// Converts a simple client glob pattern (wildcards * and ?) into a RegExp.
// Used for matching client names against stored patterns.
function clientGlobToRegex(pattern) {
  const p = String(pattern || "").trim();
  if (!p) return null;
  const esc = p.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const rx = "^" + esc.replace(/\*/g, ".*").replace(/\?/g, ".") + "$";
  try { return new RegExp(rx, "i"); } catch (_) { return null; }
}
