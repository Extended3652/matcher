// =============================================================================
// REAL DICTIONARY TEST — Uses matcher.js v6
// =============================================================================
// Run with:   node test_real.js
// Tests the matcher engine against sample reviews with your real dictionary.
// =============================================================================

"use strict";

const { compileAll, findMatches } = require("./matcher.js");

// ---------------------------------------------------------------------------
// SAMPLE DICTIONARY (converted from your backup JSON)
// ---------------------------------------------------------------------------
// Notes on what happened during conversion:
//   - "Unhighlight" category became the ignoreList (no color, no priority)
//   - Categories with findWords:true had // added to every word automatically
//   - Word order within categories is unchanged
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
    {
      id: "CS_Test",
      name: "CS Test",
      color: "#9900FF",
      fColor: "#FFFFFF",
      enabled: true,
      words: [
        "CS:HP",          // case-sensitive substring
        "CS://ATT",       // case-sensitive exact
        "LIT:test*file",  // literal asterisk
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
    notes: 'SHOULD: "from elf" (RET), "elf" inside "herself" (RET). NOT standalone "elf" if ignore list blocks it.',
  },
  {
    label: "Review 3 — shipping issues",
    text: "The package took 5 days to arrive and it was damaged. Tracking showed it was lost in transit.",
    notes: 'SHOULD: "package" (SI), "took 5 days" (SI), "damaged" (SI), "Tracking" (SI), "lost in transit" (SI).',
  },
  {
    label: "Review 4 — exact words HP, ATT, ELF",
    text: "I use my HP laptop every day. The ATT service is fine. ELF makeup is cheap.",
    notes: 'SHOULD: "HP" (RET Exact or CS Test), "ATT" (GIU Exact). Standalone "ELF" if not blocked by ignore.',
  },
  {
    label: "Review 5 — profanity",
    text: "This product is shit quality. I never bought this. What a piece of crap.",
    notes: 'SHOULD: "shit" (PRF), "never bought" (PRF), "crap" (PRF).',
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
  {
    label: "Review 11 — case-sensitive CS:HP",
    text: "My HP printer works great. The hp brand is reliable.",
    notes: 'SHOULD: first "HP" (CS Test, case-sensitive). NOT lowercase "hp" from CS:HP. But lowercase "hp" might match RET Exact //HP.',
  },
  {
    label: "Review 12 — literal asterisk LIT:test*file",
    text: "The file is named test*file.txt and also testfile.txt exists.",
    notes: 'SHOULD: "test*file" (CS Test, literal match). NOT "testfile" (no asterisk in text).',
  },
];


// ---------------------------------------------------------------------------
// RUN
// ---------------------------------------------------------------------------

const compiled = compileAll(config);

console.log("=".repeat(70));
console.log(" MATCHER ENGINE v6 — TEST RESULTS");
console.log("=".repeat(70));
console.log(`\n  Categories: ${compiled.compiledCategories.length} | Ignore list: ${compiled.ignoreCompiled ? "active" : "empty"}\n`);

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
