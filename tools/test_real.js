// =============================================================================
// REAL DICTIONARY TEST — Combined file
// =============================================================================
// Copy this into nano on your Pi and run with:   node test_real.js
// It includes the matcher engine + your real dictionary + sample reviews.
// =============================================================================

// ---------------------------------------------------------------------------
// MATCHER ENGINE (same functions as matcher.js)
// ---------------------------------------------------------------------------

function parseWordEntry(rawEntry) {
  let text = rawEntry;
  let exact = false;
  if (text.startsWith("//")) { exact = true; text = text.slice(2); }
  const boundaryBefore = /^[\s\n\r\t]/.test(text);
  const boundaryAfter  = /[\s\n\r\t]$/.test(text);
  text = text.trim();
  if (text.length === 0) return null;
  text = text.toLowerCase();
  return {
    pattern: text, exact: exact,
    boundaryBefore: exact ? true : boundaryBefore,
    boundaryAfter:  exact ? true : boundaryAfter,
  };
}

function globToRegexFragment(pattern) {
  let result = "";
  const chars = [...pattern];
  const hasLiteralSpace = pattern.includes(" ");
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const isFirst = (i === 0), isLast = (i === chars.length - 1);
    if (ch === "*") {
      if (isFirst || isLast) { result += "[^\\s\\p{P}]*"; }
      else { result += hasLiteralSpace ? "[\\s\\S]*?" : "[^\\s]*?"; }
    } else if (ch === "?") {
      result += hasLiteralSpace ? "[\\s\\S]" : "[^\\s]";
    } else {
      result += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return result;
}

function compileWordToRegexFragment(parsed) {
  let fragment = "";
  if (parsed.boundaryBefore) fragment += "(?:^|(?<=[\\s\\p{P}]))";
  fragment += globToRegexFragment(parsed.pattern);
  if (parsed.boundaryAfter)  fragment += "(?=$|[\\s\\p{P}])";
  return fragment;
}

function compileCategory(category) {
  const fragments = [];
  for (const rawWord of category.words) {
    const parsed = parseWordEntry(rawWord);
    if (!parsed) continue;
    fragments.push({ fragment: compileWordToRegexFragment(parsed), parsed });
  }
  if (fragments.length === 0) return null;
  fragments.sort((a, b) => b.parsed.pattern.length - a.parsed.pattern.length);
  let regex;
  try { regex = new RegExp(fragments.map(f => f.fragment).join("|"), "giu"); }
  catch (e) { console.error("Regex compile failed for " + category.name, e.message); return null; }
  return { id: category.id, name: category.name, color: category.color, fColor: category.fColor, regex };
}

function compileAll(config) {
  const ignoreRegex = config.ignoreList && config.ignoreList.length > 0
    ? compileCategory({ id:"__ignore__", name:"Ignore", color:null, fColor:null, words: config.ignoreList })
    : null;
  const compiledCategories = [];
  for (const cat of config.categories) {
    if (!cat.enabled) continue;
    const c = compileCategory(cat);
    if (c) compiledCategories.push(c);
  }
  return { ignoreRegex, compiledCategories };
}

function findMatches(text, compiled) {
  const { ignoreRegex, compiledCategories } = compiled;
  const ignoreRanges = [];
  if (ignoreRegex) {
    ignoreRegex.regex.lastIndex = 0;
    let m;
    while ((m = ignoreRegex.regex.exec(text)) !== null) {
      if (m[0].length === 0) { ignoreRegex.regex.lastIndex++; continue; }
      ignoreRanges.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  const allMatches = [];
  for (let i = 0; i < compiledCategories.length; i++) {
    const cat = compiledCategories[i];
    cat.regex.lastIndex = 0;
    let m;
    while ((m = cat.regex.exec(text)) !== null) {
      if (m[0].length === 0) { cat.regex.lastIndex++; continue; }
      allMatches.push({ start: m.index, end: m.index + m[0].length, name: cat.name, color: cat.color, fColor: cat.fColor, priority: i });
    }
  }
  let filtered = allMatches;
  if (ignoreRanges.length > 0) {
    filtered = allMatches.filter(match => !ignoreRanges.some(ig => match.start < ig.end && match.end > ig.start));
  }
  filtered.sort((a, b) => a.start !== b.start ? a.start - b.start : a.priority - b.priority);
  const final = [];
  let lastEnd = -1;
  for (const match of filtered) {
    if (match.start >= lastEnd) { final.push(match); lastEnd = match.end; }
  }
  return final.map(m => ({ start: m.start, end: m.end, categoryName: m.name, color: m.color, fColor: m.fColor }));
}


// ---------------------------------------------------------------------------
// YOUR REAL DICTIONARY (converted from your backup JSON)
// ---------------------------------------------------------------------------
// Notes on what happened during conversion:
//   - "Unhighlight" category became the ignoreList (no color, no priority)
//   - Categories with findWords:true had // added to every word automatically
//   - Word order within categories is unchanged
//   - \n and \r in words are preserved — they act as boundary markers
// ---------------------------------------------------------------------------

const config = {
  ignoreList: [
    "easy to use", "easy to clean", "easy to wear", "easy to open",
    "store front", "near store",
    " elf ",
    "drug store", "drugstore",
    "highly recommend", "highly",
    "beautiful", "basically", "because", "interesting",
    "d*t burn", "d*t dry", "d*t hurt", "d*t sting", "d*t irritate",
    "no burn", "no sting", "no issue", "no problem",
    "from the", "from this", "of the", "of this",
    "good for dry skin", "gentle on skin", "gentle on my",
    "skin feel* smooth*", "skin feel* soft",
    "worth it", "worth trying",
    "after", "along", "because", "before",
    "not harsh", "not dry", "not painful",
    "as expected", "as well",
    "stores", "stored",
  ],

  categories: [
    {
      id: "RET_CR_Rx",
      name: "RET / CR / Rx",
      color: "#32CD32",
      fColor: "#FFFFFF",
      enabled: true,
      words: [
        "walmart", "wal*mart", "amazon", "target", "store",
        "best buy", "bestbuy", "cvs", "walgreens",
        "amazon*", "ebay", "e?bay", "etsy",
        "costco", "sam's club", "sams club",
        "home dep?t", "homedepot", "lowes", "lowe",
        "nike", "adidas", "elf", "from elf",
        "bought * from", "bought at", "bought from",
        "order from", "order* from",
        "available at", "available from",
        "*etailer", "*purchase* from",
        "apple", "google", "samsung",
        "ikea", "netflix", "uber",
        "*.com",
      ],
    },
    {
      id: "SI",
      name: "SI",
      color: "#00BFFF",
      fColor: "#FFFFFF",
      enabled: true,
      words: [
        "arriv*", "deliver*", "d?liver*",
        "took * days", "took * weeks",
        "came * fast", "came late*", "came in fast",
        "ship*", "shipping", "shipped",
        "never arrived", "never received",
        "lost in transit", "lost in mail",
        "tracking", "tracking number",
        "wrong item", "wrong size", "wrong * sent",
        "damaged", "damag*", "broken", "broke",
        "missing", "not delivered", "not received",
        "fast* shipping", "free shipping", "free delivery",
        "next day", "following day",
        "took forever", "took too long", "took days",
        "fast and convenient",
        "arrived in a good *",
        "package*", "*packag*",
      ],
    },
    {
      id: "PRF_Exact",
      name: "PRF Exact",
      color: "#FF0000",
      fColor: "#FFFFFF",
      enabled: true,
      words: [
        "//AF\n", "//AF", "//B S", "//DAT", "//F?U", "//FU",
        "//SOB", "//Zalando", "//as!", "//as.", "//flu", "//nads", "//pm", "//s*hit*",
      ],
    },
    {
      id: "RET_Exact",
      name: "RET Exact",
      color: "#32CD32",
      fColor: "#FFFFFF",
      enabled: true,
      words: [
        "//ELF\r", "//ELF", "//GE", "//HP", "//MEC", "//UA", "//ego", "//elf",
      ],
    },
    {
      id: "GIU_Clients_Exact",
      name: "GIU Clients Exact",
      color: "#FF9900",
      fColor: "#FFFFFF",
      enabled: true,
      words: [
        "//ATT\n", "//ATT", "//LG", "//Macys", "//anaconda",
        "//booking.com", "//cuisinart", "//since birth",
      ],
    },
    {
      id: "PRF",
      name: "PRF",
      color: "#FF0000",
      fColor: "#FFFFFF",
      enabled: true,
      words: [
        "sh*t", "sh?t", "sh?tty", "sh*show",
        "f?ck", "fuc*", "fuck",
        "a*hole", "ass", "assh*",
        "b?tch", "dick", "cock",
        "bull*", "crap*", "damn*", "d?mn*",
        "idio*", "stupid*", "mofo", "mo?fo",
        "never bought", "never ordered", "never used",
        "did*t buy", "did*t order", "did*t purchase",
        "not purchased", "have not tried",
      ],
    },
  ],
};


// ---------------------------------------------------------------------------
// SAMPLE REVIEWS + EXPECTED BEHAVIOR
// ---------------------------------------------------------------------------
// Each review has a "notes" field explaining what should and should NOT
// highlight. After you run this, compare the output to the notes.
// If something feels wrong, tell me which review and what's off.
// ---------------------------------------------------------------------------

const reviews = [
  {
    label: "Review 1 — retailer + shipping",
    text: "I bought this at walmart and it arrived in 3 days. Great product!",
    notes: 'SHOULD: "walmart" (RET), "arrived" (SI). Nothing else.',
  },
  {
    label: "Review 2 — elf standalone vs inside word",
    text: "I got this from elf. My herself thought it was amazing.",
    notes: 'SHOULD: "elf" inside "herself" (RET). NOT standalone "elf" (ignore list).',
  },
  {
    label: "Review 3 — shipping issues",
    text: "The package took 5 days to arrive and it was damaged. Tracking showed it was lost in transit.",
    notes: 'SHOULD: "package" (SI), "took 5 days" (SI), "arrive" (SI), "damaged" (SI), "Tracking" (SI), "lost in transit" (SI).',
  },
  {
    label: "Review 4 — exact words HP, ATT, ELF",
    text: "I use my HP laptop every day. The ATT service is fine. ELF makeup is cheap.",
    notes: 'SHOULD: "HP" (RET Exact), "ATT" (GIU Exact). NOT "ELF" (ignore list blocks standalone elf).',
  },
  {
    label: "Review 5 — profanity",
    text: "This product is shit quality. I never bought this. What a piece of crap.",
    notes: 'SHOULD: "shit" (PRF Exact — has //s*hit*), "never bought" (PRF), "crap" (PRF).',
  },
  {
    label: "Review 6 — ignore list blocks 'easy to use'",
    text: "This is easy to use and the store had it in stock. I ordered from amazon.",
    notes: 'SHOULD: "store" (RET), "ordered from" (RET), "amazon" (RET). NOT "easy to use" (ignore list).',
  },
  {
    label: "Review 7 — store front vs standalone store",
    text: "I went to the store front but the store was out of stock.",
    notes: 'SHOULD: second "store" only (RET). NOT "store" inside "store front" (ignore list).',
  },
  {
    label: "Review 8 — flu exact vs fluffy",
    text: "I had the flu last week. This product is fluffy and fun.",
    notes: 'SHOULD: "flu" standalone (PRF Exact). NOT "flu" inside "fluffy".',
  },
  {
    label: "Review 9 — amazon.com and ebay",
    text: "I found it on amazon.com for a good price. Also on ebay for less.",
    notes: 'SHOULD: "amazon" (RET), ".com" (RET), "ebay" (RET).',
  },
  {
    label: "Review 10 — nothing should match",
    text: "This lotion feels great on my skin. Very moisturizing and gentle.",
    notes: 'SHOULD: nothing. All benign text.',
  },
];


// ---------------------------------------------------------------------------
// RUN
// ---------------------------------------------------------------------------

const compiled = compileAll(config);

console.log("=".repeat(70));
console.log(" REAL DICTIONARY TEST");
console.log("=".repeat(70));
console.log(`\n  Categories: ${compiled.compiledCategories.length} | Ignore list: active\n`);

reviews.forEach((review, i) => {
  const matches = findMatches(review.text, compiled);

  console.log(`\n--- Review ${i + 1}: ${review.label} ---`);
  console.log(`  Text:  "${review.text}"`);
  console.log(`  Notes: ${review.notes}`);
  console.log(`  Output:`);

  if (matches.length === 0) {
    console.log(`    → (no highlights)`);
  } else {
    matches.forEach(m => {
      const word = review.text.slice(m.start, m.end);
      console.log(`    → [${m.categoryName}] "${word}"`);
    });
  }
});

console.log("\n" + "=".repeat(70));
console.log(" Compare each Output to its Notes above.");
console.log(" Anything that feels wrong — tell me which review and what's off.");
console.log("=".repeat(70) + "\n");
