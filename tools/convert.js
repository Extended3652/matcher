// =============================================================================
// DICTIONARY CONVERTER
// =============================================================================
// Reads a HighlightThis backup file and converts it to the format
// expected by the matcher engine.
//
// Usage:
//   node convert.js <path_to_backup_file>
//   node convert.js HighlightThis20260131
//
// Output:
//   converted_dictionary.json  (written to same directory as this script)
//
// What it does:
//   1. Reads the backup JSON (groups + order array)
//   2. Walks categories in priority order (order array)
//   3. "Unhighlight" category becomes the ignoreList (separate from categories)
//   4. Categories with findWords:true get "//" prefixed to each word
//      (that's how the matcher engine knows to do whole-word matching)
//   5. Strips trailing \n and \r from words (junk from the old extension)
//      BUT preserves intentional boundary spaces (leading/trailing " ")
//   6. Skips disabled categories
//   7. Outputs clean JSON the matcher engine can consume directly
// =============================================================================

const fs   = require('fs');
const path = require('path');

// --- Read input ---
const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node convert.js <path_to_backup_file>');
  process.exit(1);
}

let raw;
try {
  raw = fs.readFileSync(inputPath, 'utf8');
} catch (e) {
  console.error(`Cannot read file: ${inputPath}`);
  console.error(e.message);
  process.exit(1);
}

let backup;
try {
  backup = JSON.parse(raw);
} catch (e) {
  console.error('File is not valid JSON.');
  console.error(e.message);
  process.exit(1);
}

// --- Validate structure ---
if (!backup.groups || !backup.order || !Array.isArray(backup.order)) {
  console.error('File does not look like a HighlightThis backup.');
  console.error('Expected top-level keys: groups, order');
  process.exit(1);
}

// -----------------------------------------------------------------------------
// Clean a single word entry.
//
// Rules:
//   - Strip trailing \n and \r (these are junk from the old extension,
//     NOT intentional boundary markers)
//   - Do NOT strip spaces — leading/trailing spaces ARE intentional
//     boundary markers that the matcher engine uses
//   - If the result is empty, return null (skip it)
// -----------------------------------------------------------------------------
function cleanWord(raw) {
  // Remove trailing \n and \r only (not spaces)
  let w = raw.replace(/[\n\r]+$/g, '');
  // Also remove leading \n\r if any (shouldn't exist but just in case)
  w = w.replace(/^[\n\r]+/, '');
  // If nothing left, skip
  if (w.length === 0) return null;
  return w;
}

// -----------------------------------------------------------------------------
// Convert one category's word list.
//
// If the category has findWords:true, prefix each word with "//"
// so the matcher engine treats it as whole-word match.
//
// The "//" goes BEFORE any boundary space, so:
//   findWords:true + " elf " → "// elf "  (exact + boundary)
//   findWords:true + "HP"    → "//HP"     (exact, no boundary)
//   findWords:false + " elf " → " elf "   (boundary only)
//   findWords:false + "walmart" → "walmart" (plain substring)
// -----------------------------------------------------------------------------
function convertWords(words, findWords) {
  const out = [];
  let skipped = 0;

  for (const raw of words) {
    const cleaned = cleanWord(raw);
    if (cleaned === null) {
      skipped++;
      continue;
    }

    if (findWords) {
      out.push('//' + cleaned);
    } else {
      out.push(cleaned);
    }
  }

  return { words: out, skipped };
}

// -----------------------------------------------------------------------------
// Main conversion
// -----------------------------------------------------------------------------
const output = {
  ignoreList: [],        // words from the Unhighlight category
  categories: []         // all other categories, in priority order
};

let totalWords = 0;
let totalSkipped = 0;
let skippedCategories = 0;

for (const id of backup.order) {
  const group = backup.groups[id];
  if (!group) {
    console.warn(`Warning: order references unknown group ID: ${id}`);
    continue;
  }

  // Skip disabled categories entirely
  if (!group.enabled) {
    skippedCategories++;
    continue;
  }

  const { words, skipped } = convertWords(group.words || [], group.findWords);
  totalWords += words.length;
  totalSkipped += skipped;

  // Unhighlight is special — it becomes the ignoreList
  if (group.name === 'Unhighlight') {
    output.ignoreList = words;
    continue;
  }

  // Everything else is a normal category
  output.categories.push({
    id:     id,
    name:   group.name,
    color:  group.color,
    fColor: group.fColor || '#FFFFFF',
    words:  words
  });
}

// --- Write output ---
const outputPath = path.join(path.dirname(path.resolve(__dirname || '.', inputPath)), 'converted_dictionary.json');
// Actually write next to this script for simplicity
const outFile = path.join(__dirname || '.', 'converted_dictionary.json');
fs.writeFileSync(outFile, JSON.stringify(output, null, 2), 'utf8');

// --- Report ---
console.log('='.repeat(60));
console.log('CONVERSION COMPLETE');
console.log('='.repeat(60));
console.log('');
console.log(`  Input file:          ${inputPath}`);
console.log(`  Output file:         ${outFile}`);
console.log('');
console.log(`  Ignore list words:   ${output.ignoreList.length}`);
console.log(`  Categories:          ${output.categories.length}`);
console.log(`  Total words:         ${totalWords}`);
if (totalSkipped > 0) {
  console.log(`  Skipped (empty):     ${totalSkipped}`);
}
if (skippedCategories > 0) {
  console.log(`  Skipped (disabled):  ${skippedCategories} categories`);
}
console.log('');
console.log('  Category breakdown:');
output.categories.forEach((cat, i) => {
  const exactCount = cat.words.filter(w => w.startsWith('//')).length;
  const label = exactCount > 0 ? ` (${exactCount} exact)` : '';
  console.log(`    ${(i+1).toString().padStart(2)}. ${cat.name.padEnd(35)} ${cat.words.length} words${label}`);
});
console.log('');
console.log('='.repeat(60));
