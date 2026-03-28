# CMS Highlighter — Claude Instructions

## Golden rule
Only touch files and elements explicitly mentioned in the request. Nothing else.

## HTML rules
- Never reorder sections in options.html or popup.html without being explicitly asked.
- Never rename or remove element IDs.
- Never add, remove, or reposition top-level `<div>` blocks as a side-effect of another change.

## Required section order — options.html (Clients section)
1. `.client-add-box` — Add Client form
2. `.clients-topbar` — search bar + showing count
3. `.client-list` — client cards

## Required section order — popup.html
1. Header / master toggle
2. Client banner (hidden by default)
3. Search bar (`#popupSearch`)
4. Category / word results

## Critical element IDs — options.html
- `#clientSearch` — client search input
- `#clientShowing` — "showing X of Y" label
- `#clientListBody` — rendered client cards
- `#newClientPattern` — Add Client: pattern field
- `#newClientReview` — Add Client: Review (Default) select
- `#newClientImage` — Add Client: Image override select
- `#newClientProfile` — Add Client: Profile override select
- `#newClientQuestion` — Add Client: Question override select
- `#newClientComment` — Add Client: Comment override select
- `#newClientMentionCategory` — Add Client: Mentions category select
- `#newClientNote` — Add Client: Note text input
- `#newClientAliases` — Add Client: Aliases textarea
- `#newClientIncludePatternInContent` — Add Client: "treat name as mention" checkbox
- `#btnAddClient` — Add Client submit button
- `#clientCount` — client count label in section heading
- `#catEditors` — category editor container
- `#newCatName`, `#newCatColor`, `#btnAddCat` — new category form
- `#btnExport`, `#btnImportHT`, `#btnImportJSON`, `#importFile` — import/export

## Critical element IDs — popup.html
- `#popupSearch` — search input
- `#bannerCatSelect` — banner category dropdown
- `#masterToggle` (or equivalent) — on/off switch

## Features that must keep working
- Drag-to-reorder categories and words
- Inline word editing (click to edit in the list)
- Wildcard patterns (* and ?) for client matching
- Import: HighlightThis backup + CMS Highlighter JSON
- Export: CMS Highlighter JSON
- Mentions / aliases per client (mentionCategory, aliases, includePatternInContent, note)
- Per-client colour overrides (Image, Profile, Question, Comment)
- Client search / filter
- Auto-fill Add Client form from active CMS tab

## Pre-commit checklist
1. Run `git diff --name-only` — confirm only the expected files changed.
2. Verify no IDs from the lists above were renamed or removed.
3. Verify no sections were reordered beyond what was requested.

## File map
```
extension/
  manifest.json             — Chrome extension manifest
  background.js             — service worker (async/await, context menu, storage)
  content.js                — page-level highlighter injected into CMS tabs
  matcher-core.js           — shared pattern-matching engine
  highlight.css             — highlight styles injected into CMS pages
  utils.js                  — shared helpers (log, escHtml, sortKey, insertAlphabetically, clientGlobToRegex)
  options.html              — dictionary editor UI (dark mode via CSS custom properties)
  options-state.js          — options: DOM refs, state, helpers, cache, load/save
  options-clients.js        — options: client CRUD, search, rendering
  options-categories.js     — options: category CRUD, word editing, color picker
  options-import-export.js  — options: JSON export, HighlightThis import
  options-init.js           — options: entry point (calls load())
  popup.html                — browser-action popup UI (dark mode via CSS custom properties)
  popup-state.js            — popup: DOM refs, state, helpers, client banner
  popup-categories.js       — popup: category/word rendering, drag-reorder, inline edit
  popup-init.js             — popup: loadState, master toggle, search, stats
tools/                      — standalone Node scripts (seeding, testing)
cms-fake/                   — local CMS mock for manual testing
```

## Session log — 2026-03-26 Comprehensive Code Review

### What was done
Full code review → 8 fixes implemented, tested (55 unit + 12 integration), merged to `main`:

| # | Fix | Files |
|---|-----|-------|
| 1 | Simplified popup client banner to single category select + Save/Update button; added missing client fields (aliases, includePatternInContent, note) | popup.html, popup.js |
| 2 | Prefix order: `CS:`, `//`, `LIT:` now work in any combination/order via while-loop | matcher-core.js |
| 3 | Pattern validation via new `MatcherEngine.validatePattern()` — shows error before saving invalid patterns | matcher-core.js, options.js, popup.js, options.html, popup.html |
| 4 | Context menu escapes `*` and `?` with backslash so selected text is literal | background.js |
| 5 | CSS color injection fix — `safeHexColor()` now used in `formatSummaryHtml()` | options.js |
| 7 | Cached `.navbar-inner .client-name` querySelector with `isConnected` invalidation | content.js |
| 9 | Fixed double render / editor-toggle-off after adding words in popup | popup.js |
| 10 | Duplicate/invalid edits now flash red border + tooltip instead of silent rejection | popup.js |

### Key architectural changes to remember
- **`matcher-core.js` is now loaded in options.html and popup.html** (for `MatcherEngine.validatePattern()`)
- **Popup banner is intentionally simple**: one `#bannerCatSelect` + Save/Update button only (user's explicit preference — no second select for name category)
- **`#bannerNameCatSelect` was removed** from popup.html

### Outstanding tech debt (not yet addressed)
- **#15** No integration/e2e tests (only unit tests for matcher engine)

## Session log — 2026-03-26 Tech Debt Batch

### What was done
Addressed 4 tech debt items, merged to `main`:

| # | Fix | Files |
|---|-----|-------|
| 8 | Storage quota warning — `checkStorageQuota()` using `chrome.storage.local.getBytesInUse()`; amber bar appears when usage ≥ 80% of 10 MB; runs on load and after every save/import | options.js, options.html |
| 12 | Magic numbers → named constants — 20 hardcoded numeric values extracted to `const` declarations at top of each IIFE | background.js, content.js, options.js, popup.js |
| 16 | Accessibility — replaced 3 `confirm()` calls with native `<dialog>` elements (`role="alertdialog"`, `aria-labelledby`, `aria-describedby`, focus management, Escape support); added `aria-label` + `title` to color swatches (`.client-swatch`, `.cat-accent`) | options.html, options.js, popup.html, popup.js |
| 18 | `.gitignore` expanded — added `node_modules/`, `.env`, `.DS_Store`, `Thumbs.db`, editor dirs, swap files | .gitignore |

### Key architectural changes to remember
- **`#confirmDialog`** is a `<dialog>` element in both options.html and popup.html; each JS file has its own `showConfirmDialog(title, body, okLabel)` returning a Promise
- **`#storageWarning`** is an alert bar in options.html, controlled by `checkStorageQuota()` in options.js
- **Named constants** live at the top of each file's IIFE (not in a shared file), e.g. `DICT_SAVE_DEBOUNCE_MS`, `NODE_BATCH_SIZE`, `STORAGE_QUOTA_BYTES`
- **`confirmRemove()` in popup.js** is now async (returns a Promise); callers use `.then()` instead of synchronous `if (!confirmRemove(...))`

## Session log — 2026-03-28 Tech Debt Batch 3

### What was done
Addressed 6 tech debt items (all remaining except #15):

| # | Fix | Files |
|---|-----|-------|
| 20 | Single-pass `escHtml` — moved to utils.js with regex + lookup map | utils.js |
| 17 | Consistent logging — `log.error/warn/debug` helper in utils.js; all files updated | utils.js, background.js, content.js, matcher-core.js, popup-*.js |
| 13 | async/await — background.js fully converted; promisified wrappers for `contextMenus.create` | background.js |
| 14 | File splitting — options.js → 5 files, popup.js → 3 files; old monoliths deleted | options-state.js, options-clients.js, options-categories.js, options-import-export.js, options-init.js, popup-state.js, popup-categories.js, popup-init.js, options.html, popup.html |
| 19 | Dark mode — CSS custom properties + `@media (prefers-color-scheme: dark)` in both HTML files; inline styles moved to CSS classes | options.html, popup.html |
| 11 | ESLint + Prettier — eslint.config.js (flat config), .prettierrc, npm scripts; all files formatted; 0 lint errors | eslint.config.js, .prettierrc, package.json, all JS files |

### Key architectural changes to remember
- **options.js and popup.js no longer exist** — replaced by split files loaded via `<script>` tags
- **Global-scope file splitting** — no ES modules, no bundler; files share state via top-level `let`/`const` and function declarations; ESLint `/* global */` comments declare cross-file references
- **utils.js is loaded everywhere** — by background.js via `importScripts`, by content.js via manifest content_scripts, by HTML pages via `<script>` tags
- **Dark mode follows OS preference** — no JS toggle; uses `:root` CSS custom properties overridden in `@media (prefers-color-scheme: dark)`; `highlight.css` is intentionally NOT themed (highlights on CMS pages use their own theme)
- **`#storageWarning` inline styles replaced** with `.storage-warning` CSS class in options.html
- **`#clientBanner` inline styles replaced** with `.client-banner`, `.banner-client-name`, `.save-btn` CSS classes in popup.html
- **ESLint flat config** (v10) — `/* exported */` directives not supported; `no-unused-vars` warnings for cross-file globals are expected
- **npm scripts**: `npm run lint`, `npm run lint:fix`, `npm run format`
