# CMS Highlighter — Claude Instructions

## Golden Rule
Make ONLY the change requested. Do not reorder HTML, rename IDs, restructure JS,
or "clean up" surrounding code unless explicitly asked. When in doubt, do less.

## Before Committing
1. Diff your changes and confirm you touched only the files/sections mentioned in the request.
2. Verify all element IDs listed below are still present and unchanged.
3. Verify no HTML sections were reordered unless reordering was the explicit task.

---

## Critical Element IDs (must never be renamed or removed)

### popup.html / popup.js
- `#masterToggle` — master on/off switch
- `#popupSearch` — search bar filtering categories and words
- `#catList` — scrollable category list
- `#stats` — dynamic highlight/category count display
- `#clientBanner` — client detection banner with quick-add
- `#btnOptions` — opens options page

### options.html / options.js
- `#newCatName`, `#newCatColor`, `#btnAddCat` — add-category form
- `#newClientPattern`, `#btnAddClient` — add-client form
- `#clientSearch` — client list search/filter
- `#clientShowing` — "Showing N" client count display
- `#btnExport`, `#btnImportHT`, `#btnImportJSON` — import/export buttons
- `#importFile` — hidden file input for imports

---

## UI Section Order (options.html) — do not reorder
1. Header
2. Message area (`#msg`)
3. Import/Export section
4. Clients section, in this order:
   a. Client count badge + description
   b. Add Client form (`.client-add-box`)
   c. Client search bar + "Showing N" (`.clients-topbar`)
   d. Client list (`.client-list`)
5. Categories section

## UI Section Order (popup.html) — do not reorder
1. Header (title, options button, master toggle)
2. Stats bar
3. Client banner
4. Search bar
5. Category list

---

## Features That Must Continue to Work

### Popup
- Drag-to-reorder categories (grip handle = priority order)
- Click category row → expand/collapse editor drawer
- Click word → inline edit; Shift+click → remove (confirm); Alt+click → move to another category
- Add word → inserted alphabetically
- Search bar filters all categories and words in real time
- Ignore list appears as grey pseudo-category; no drag handle

### Options Page
- Client pattern matching supports `*` and `?` wildcards
- Per-content-type overrides (Review, Image, Profile, Question, Comment)
- Client aliases (multi-line textarea, one per line)
- "Include client name as mention in content" checkbox
- Expand/collapse client cards
- Client search filters by pattern in real time
- Import JSON / HighlightThis backup / Export JSON

### Matcher Engine (matcher-core.js)
- Word prefixes: plain, `//` (exact), `CS:` (case-sensitive), `LIT:` (literal wildcards)
- Wildcards: `*`, `?`; escaped with `\*`, `\?`
- Category `enabled` flag respected at compile time
- Natural/numeric sorting for numbered items

### Storage
- All data persists in `chrome.storage.local`
- Export/import round-trips must be lossless

---

## File Map
| File | Purpose |
|------|---------|
| `extension/popup.html` + `popup.js` | 360px popup UI |
| `extension/options.html` + `options.js` | Full settings page |
| `extension/matcher-core.js` | Pure matching logic (no DOM) |
| `extension/content.js` | Page injection & highlighting |
| `extension/background.js` | Service worker |
| `cms-fake/index.html` | Fake CMS for manual highlight testing |
| `tools/test_real.js` | Test suite — run with Node to verify matcher |
