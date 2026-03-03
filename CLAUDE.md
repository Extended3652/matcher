# CMS Highlighter — Developer Reference

Chrome MV3 extension that highlights words/phrases by category on
Bazaarvoice CMS pages, and color-codes the client name in the navbar
based on configurable per-client rules.

Target sites (see `manifest.json` `host_permissions`):
- `https://cms.bazaarvoice.com/*`
- `https://workbench.bazaarvoice.com/*`
- `http://minotaur:8124/*`

---

## File Map

```
extension/
  manifest.json         MV3 manifest
  background.js         Service worker: context menu, storage init
  content.js            Page script: DOM walking, highlighting, client highlight
  matcher-core.js       Pure matching engine (MatcherEngine global, no DOM/Chrome)
  popup.html/.js        Extension popup UI
  options.html/.js      Full dictionary editor (options page)
  highlight.css         Styles injected into CMS pages

cms-fake/
  index.html            Local fake CMS page for manual testing

tools/
  matcher.js            CLI wrapper around matcher-core logic
  convert.js            Dictionary conversion util
  test_assertions.js    Assertion helpers
  test_real.js          Integration tests
```

---

## Dictionary Data Model

Stored in `chrome.storage.local` under the key `dictionary`.

```jsonc
{
  "ignoreList": ["word", "CS://ExactCS"],
  "categories": [
    {
      "id": "uuid-string",
      "name": "Category Name",
      "color": "#FFFF00",       // highlight background
      "fColor": "#000000",      // highlight foreground
      "enabled": true,
      "words": ["walmart", "//target", "CS:HP"]
    }
  ],
  "clients": [
    {
      "pattern": "Walmart*",          // glob, case-insensitive
      "defaultCategory": "Retail",    // null = no highlight
      "overrides": {
        "Image": "Retail-Image",      // content-type overrides
        "Profile": null
      }
    }
  ]
}
```

Other `storage.local` keys: `enabled` (bool), `contextExact` (bool),
`contextCaseSensitive` (bool).

---

## Word Entry Syntax

Parsed by `matcher-core.js` `parseWordEntry()`:

| Syntax          | Meaning                                      |
|-----------------|----------------------------------------------|
| `walmart`       | Substring, case-insensitive                  |
| `//walmart`     | Exact (whole-word), case-insensitive         |
| `CS:walmart`    | Substring, case-sensitive                    |
| `CS://walmart`  | Exact, case-sensitive                        |
| `LIT:foo*bar`   | `*`/`?` treated as literals (no wildcard)    |
| `amazon*`       | Wildcard at end                              |
| `*etailer`      | Wildcard at start                            |
| `sh*t`          | Wildcard in middle (stays in-token)          |
| `took * days`   | Wildcard spanning words                      |
| `" elf "`       | Boundary spaces (require whitespace around)  |

Prefixes combine: `CS:` must come before `//` (e.g. `CS://HP`).

---

## Popup Design (locked)

**Dimensions:** 360 px wide, no fixed height.

**Layout (top to bottom):**

1. **Header** — `#2c3e50` background, white text `"CMS Highlighter"`,
   `Options` button (`.top-btn`) + master toggle (`.toggle-switch`) on the right.

2. **Stats bar** — `#ecf0f1` bg, 12 px text, `border-bottom: 1px solid #ddd`.
   Text: `N highlights | N categories | ON/OFF`.

3. **Client banner** `#clientBanner` — shown only when a client name is
   detected on the active tab; hidden otherwise.

   - Container: `padding: 8px 12px; font-size: 13px; border-bottom: 1px solid #ddd`
   - **Known client** (matched in `dict.clients`):
     `background: #e8f4fd; border-bottom: 1px solid #bee3f8`
     Shows client name + category `<select>`. No add button.
   - **Unknown client** (not in `dict.clients`):
     `background: #fff8e1; border-bottom: 1px solid #ffe082`
     Shows `⚠ <name>` + category `<select>` + green `+ Add client` button.
   - **Row 1 elements:** `#bannerClientName` (flex:1, truncated) +
     `#bannerCatSelect` (max-width:140px, bg-colored by selected cat) +
     `#bannerAddBtn` (hidden when client is known).
   - **Divider:** `<hr id="bannerDivider">` —
     `border: none; border-top: 1px solid #ddd; margin: 6px 0`
     (display:none until a mentions row is needed).
   - **Mentions row:** `<div id="bannerMentionsRow">` —
     `gap:8px; align-items:center; flex-wrap:wrap; margin-top:4px`
     Contains label `"Mentions category:"` + `#bannerMentionsCatSelect`.
     (display:none by default).

4. **Search bar** — `#f3f6f8` bg, full-width input, `border-bottom: 1px solid #ddd`.

5. **Category list** `#catList` — `max-height: 520px; overflow-y: auto`.

**Category row `.cat-item`:**
- Rounded-square swatch (`.cat-accent`): 20×20 px, `border-radius: 7px`.
  Click opens native color picker.
- Hamburger grip (`.cat-grip` ☰): drag handle for reorder.
- Category name (`.cat-name`): bold, truncated.
- Word count (`.cat-count`): right-aligned, 11 px, `#999`.
- Toggle switch (`.toggle-switch`): 40×22 px pill, green `#27ae60` when on.
- Click row body to open/close inline editor drawer.

**Category editor drawer `.cat-editor`:**
- In-list search input.
- Add input + `Add` button + `Exact` / `CS` checkboxes.
- Hint line: `"Tip: click to edit, Shift+click to remove, Alt+click to move."`
- Word list (`.word-list`): max-height 220 px, scrollable.
  - **Click** a word row → inline edit (Enter save, Esc cancel).
  - **Shift+click** → remove with `window.confirm`.
  - **Alt+click** → modal picker to move entry to another category.

**Ignore List** appears as the first item in the category list with a gray
(`#d1d5db`) swatch and no toggle.

---

## Content Script Behavior

- Runs at `document_idle` on matching CMS pages.
- Blocked on routes containing `/modstatus` or `/guidelinesMod` (hash-based).
- Compiles the dictionary once via `MatcherEngine.compileAll(dict)`.
- Walks `TreeWalker` text nodes; skips `SCRIPT/STYLE/TEXTAREA/INPUT/SELECT/NOSCRIPT`
  and already-processed parents (`data-cms-hl-processed`).
- Highlights via `<span class="cms-hl" data-hl-cat="...">` with inline
  `backgroundColor`/`color` from the category.
- `MutationObserver` debounces DOM changes (80 ms) and re-highlights new nodes.
- Client name read from `.navbar-inner .client-name`; content type from
  `.navbar-inner .decisionAreaLabel`.
- Client highlight applied directly to the `.client-name` element
  (inline style + `data-client-hl` attribute), removed on clear.

**Messages handled by content script:**
| action          | description                              |
|-----------------|------------------------------------------|
| `toggle`        | Enable/disable and re-run highlighting   |
| `refresh`       | Re-read storage and re-run highlighting  |
| `getStats`      | Returns `{highlights, enabled, cats}`    |
| `getClientName` | Returns `{clientName}`                   |

---

## Background Service Worker

- Builds a right-click context menu: one item per category + Ignore List
  entry, with toggleable `Exact` and `Case-sensitive` flags.
- Menu rebuilds are serialized (queue flag) to avoid duplicate-id errors.
- On `onInstalled`: seeds storage from `default_dictionary.json` if no
  categories exist yet.
- Inserts words alphabetically (binary search, strips `CS:` and `//`
  prefixes for sort key).

---

## Local Testing

Open `cms-fake/index.html` in a browser (or serve locally) to get a page
that mimics the CMS client/content-type selectors without needing VPN
access to the real CMS.

The extension must be loaded unpacked from the `extension/` directory in
`chrome://extensions` with Developer Mode on.

---

## Key Invariants / Conventions

- All word lists are kept **alphabetically sorted** (binary insert).
  Never `push()` directly into `ignoreList` or `cat.words`.
- `renderClientBanner()` clones the `<select>` node each call to prevent
  listener accumulation (the module-level const becomes stale after the
  first clone; always re-query by ID inside the function).
- `saveDictionary()` writes to storage and calls `updateStats()` but does
  **not** call `refreshActiveTab()` — callers that need a page refresh must
  invoke it separately (popup does this on some paths; context menu always
  does it).
- Category colors stored as hex strings (`#RRGGBB`). Foreground color
  (`fColor`) defaults to `#000000` when absent.
- The `enabled` flag on a category is respected at **compile time** in
  `MatcherEngine.compileAll` — disabled categories are skipped entirely,
  no runtime check needed.
