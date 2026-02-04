#!/usr/bin/env node
// =============================================================================
// One-time migration: create "clients" array in the dictionary
// =============================================================================
// Moves IMG Clients entries fully (empties that word list).
// Copies identifiable client names from GIU Clients Exact, RET Exact,
// and RET / CR / Rx (originals stay in those categories for review text matching).
// =============================================================================

const fs = require("fs");
const path = require("path");

const dictPath = path.join(__dirname, "..", "extension", "default_dictionary.json");
const dict = JSON.parse(fs.readFileSync(dictPath, "utf8"));

// ---- helpers ----
const clientsMap = new Map(); // lowercase key -> entry

function addClient(pattern, defaultCategory, overrides) {
  // Normalize: strip // and CS: prefixes for the client pattern
  let clean = pattern.replace(/^(CS:)?(\/\/)?/, "");
  const key = clean.toLowerCase();

  if (clientsMap.has(key)) {
    const existing = clientsMap.get(key);
    if (!existing.defaultCategory && defaultCategory) {
      existing.defaultCategory = defaultCategory;
    }
    if (overrides) {
      for (const [type, cat] of Object.entries(overrides)) {
        if (!existing.overrides[type]) {
          existing.overrides[type] = cat;
        }
      }
    }
  } else {
    clientsMap.set(key, {
      pattern: clean,
      defaultCategory: defaultCategory || null,
      overrides: overrides ? { ...overrides } : {},
    });
  }
}

// ---- 1. IMG Clients → all entries, default=null, Image override ----
const imgCat = dict.categories.find((c) => c.name === "IMG Clients");
if (imgCat) {
  for (const word of imgCat.words) {
    addClient(word, null, { Image: "IMG Clients" });
  }
  // Empty the word list (category stays as a color reference)
  imgCat.words = [];
  console.log("IMG Clients: migrated, word list emptied.");
}

// ---- 2. GIU Clients Exact → actual client identifiers only ----
const giuClientPatterns = [
  "ATT",
  "Abel-Andcole",
  "Brother-Au",
  "Gelighting",
  "LG",
  "Macys",
  "anaconda",
  "bhphoto*",
  "booking.com",
  "canadiantire-Ca",
  "cuisinart",
  "liquorland-au",
  "lynch*",
  "napoleongrills",
  "straighttalk",
  "tracfone-wireless",
];
for (const p of giuClientPatterns) {
  addClient(p, "GIU Clients Exact");
}
console.log(`GIU Clients Exact: copied ${giuClientPatterns.length} client names.`);

// ---- 3. RET Exact → brand abbreviations ----
const retExactBrands = ["ELF", "GE", "HP", "MEC", "UA", "ego", "elf"];
for (const p of retExactBrands) {
  addClient(p, "RET Exact");
}
console.log(`RET Exact: copied ${retExactBrands.length} brand names.`);

// ---- 4. RET / CR / Rx → recognizable retailer/brand names ----
// Conservative selection: single-word names clearly identifiable as retailers
// or brands that could appear as BV client identifiers.
// The user can add more via the options UI.
const retRetailers = [
  "4knines", "academy", "albertson", "aldi", "amazon", "amway",
  "anthropologie", "argos", "asda", "ashley", "asos", "asus",
  "autozone", "bass", "bcf", "bestbuy", "bondi", "bonds", "boots",
  "bosch", "breville", "briscoe", "brooks", "burpee", "callaway",
  "cb2", "champion", "chewy", "clinique", "clorox", "coleman",
  "colgate", "columbia", "contigo", "converse", "crocs", "cvs",
  "dell", "dewalt", "dickies", "dillard", "dior", "dollarama",
  "dsw", "dunelm", "dunkin", "dyson", "ebay", "electrolux",
  "elemis", "etsy", "eucerin", "everlane", "express", "faherty",
  "ferguson", "fingerhut", "footlocker", "ford", "fossil",
  "gamestop", "garnier", "ghd", "gillette", "givenchy", "gnc",
  "graco", "grainger", "gucci", "haier", "hexclad", "hibbett",
  "hisense", "hoka", "honda", "hsn", "igloo", "ikea", "jbhifi",
  "jbl", "jcrew", "jockey", "joann", "kmart", "kogan", "kuhl",
  "lazada", "lenovo", "lidl", "logitech", "lowes", "lululemon",
  "madewell", "makita", "matalan", "mecca", "meijer", "michaels",
  "milani", "milwaukee", "mitchum", "morrison", "motorola", "nars",
  "neutrogena", "nike", "ninja", "nissan", "nyx", "officeworks",
  "olaplex", "olay", "orvis", "otterbox", "overstock", "pandora",
  "patagonia", "pendleton", "petco", "philips", "polaris",
  "poshmark", "primark", "publix", "qvc", "rawlings", "rcwilley",
  "reebok", "rei", "revlon", "ridgid", "rimmel", "roomba", "ross",
  "ryobi", "safeway", "saks", "salomon", "samsonite", "samsung",
  "saucony", "sears", "shimano", "shiseido", "skims", "staples",
  "stihl", "subaru", "suzuki", "tatcha", "temu", "tesco", "thule",
  "toro", "toshiba", "traeger", "tumi", "ulta", "vizio", "wacoal",
  "weber", "wiggle", "worx", "yamaha", "yeti", "zwilling",
];
for (const p of retRetailers) {
  addClient(p, "RET / CR / Rx");
}
console.log(`RET / CR / Rx: copied ${retRetailers.length} retailer names.`);

// ---- Build final clients array ----
dict.clients = Array.from(clientsMap.values()).sort((a, b) =>
  a.pattern.toLowerCase().localeCompare(b.pattern.toLowerCase())
);

// ---- Write back ----
fs.writeFileSync(dictPath, JSON.stringify(dict, null, 2) + "\n");
console.log(
  `\nMigration complete. ${dict.clients.length} client entries created.`
);
console.log("IMG Clients category kept (empty) as color reference.");
console.log(
  "GIU Clients Exact, RET Exact, RET / CR / Rx words left in place for review text matching."
);
