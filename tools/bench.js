"use strict";
const { compileAll, findMatches } = require("./matcher");

// Generate a realistic dictionary with N words per category
function makeDictionary(wordsPerCat, numCats, ignoreCount) {
  const words = [
    "burn", "pain", "itching", "rash", "swelling", "discontinu*",
    "help with itching", "night*time routine", "from start to finish",
    "//elf", " elf ", "CS://IT Cosmetics", "d*t know",
    "within minutes the pain", "wal*mart", "cotton*touch",
    "long?term", "//long term", "decent sizing", "strip* * skin",
    "* pleasantly surprised", "gifted by *", "easy to use",
    "took * days", "no * at all", "out of *", "//ass", "//damn",
    "post?partum", "sunburn", "store front", "scanner",
  ];

  const categories = [];
  for (let c = 0; c < numCats; c++) {
    const catWords = [];
    for (let w = 0; w < wordsPerCat; w++) {
      // Mix real patterns with generated ones
      if (w < words.length) {
        catWords.push(words[w]);
      } else {
        // Generate unique words to fill up
        catWords.push(`word${c}_${w}`);
      }
    }
    categories.push({
      id: `cat${c}`,
      name: `Category ${c}`,
      color: "#FF0000",
      fColor: "#FFFFFF",
      enabled: true,
      words: catWords,
    });
  }

  const ignoreList = [];
  for (let i = 0; i < ignoreCount; i++) {
    ignoreList.push(i < words.length ? `//ignore${i}` : `ignore_word_${i}`);
  }

  return { categories, ignoreList };
}

// Sample CMS review text (~500 chars)
const sampleText = `I bought this product at wal mart last week. The burn cream really helped with itching and the pain went away within minutes. My skin feels great from start to finish of the routine. I was pleasantly surprised by the decent sizing of the container. The night-time routine is simple and I don't know if they were old but the strips your skin feeling is gone. Long-term results are excellent. I would recommend this to anyone looking for a cotton touch moisturizer. It took five days to arrive but was worth the wait. The store front had limited stock.`;

function bench(label, dict) {
  // Compile
  const t0 = performance.now();
  const compiled = compileAll(dict);
  const compileTime = performance.now() - t0;

  // Count total words and regexes
  let totalWords = 0;
  let totalRegexes = 0;
  for (const cat of dict.categories) totalWords += cat.words.length;
  totalWords += dict.ignoreList.length;
  for (const cc of compiled.compiledCategories) totalRegexes += cc.regexes.length;
  if (compiled.ignoreCompiled) totalRegexes += compiled.ignoreCompiled.regexes.length;

  // Warm up
  for (let i = 0; i < 10; i++) findMatches(sampleText, compiled);

  // Match (1000 iterations)
  const iterations = 1000;
  const t1 = performance.now();
  let matchCount = 0;
  for (let i = 0; i < iterations; i++) {
    const m = findMatches(sampleText, compiled);
    matchCount = m.length;
  }
  const matchTime = performance.now() - t1;

  console.log(`${label}:`);
  console.log(`  Words: ${totalWords}, Regexes: ${totalRegexes}`);
  console.log(`  Compile: ${compileTime.toFixed(1)}ms`);
  console.log(`  Match: ${(matchTime / iterations).toFixed(3)}ms/call (${matchCount} matches, ${iterations} iters)`);
  console.log(`  Throughput: ${(iterations / matchTime * 1000).toFixed(0)} calls/sec`);
  console.log();
}

console.log("=== PERFORMANCE BENCHMARK ===\n");
console.log(`Text length: ${sampleText.length} chars\n`);

// Small dict (current typical usage)
bench("Small (5 cats x 30 words + 10 ignore)", makeDictionary(30, 5, 10));

// Medium dict
bench("Medium (10 cats x 100 words + 50 ignore)", makeDictionary(100, 10, 50));

// Large dict
bench("Large (15 cats x 300 words + 100 ignore)", makeDictionary(300, 15, 100));

// Very large dict
bench("XL (20 cats x 500 words + 200 ignore)", makeDictionary(500, 20, 200));

// Stress test
bench("XXL (30 cats x 1000 words + 500 ignore)", makeDictionary(1000, 30, 500));
