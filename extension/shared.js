// =============================================================================
// CMS Highlighter — Shared Utilities
// =============================================================================
// Loaded before background.js (via importScripts), popup.js, and options.js.
// =============================================================================

"use strict";

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
