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
  manifest.json      — Chrome extension manifest
  background.js      — service worker / storage helpers
  content.js         — page-level highlighter injected into CMS tabs
  matcher-core.js    — shared pattern-matching engine
  highlight.css      — highlight styles injected into CMS pages
  options.html       — dictionary editor UI
  options.js         — dictionary editor logic
  popup.html         — browser-action popup UI
  popup.js           — popup logic
  utils.js           — shared helpers (sortKey, insertAlphabetically, clientGlobToRegex)
tools/               — standalone Node scripts (seeding, testing)
cms-fake/            — local CMS mock for manual testing
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
- **#8 Storage quota** — dictionary is ~7MB vs 10MB Chrome limit; should warn at 80%
- **#11** No ESLint/Prettier
- **#12** Magic numbers (debounce delays, chunk sizes) should be named constants
- **#13** Callback nesting in background.js could use async/await
- **#14** options.js (1510 lines) and popup.js (1188 lines) could be split into modules
- **#15** No integration/e2e tests (only unit tests for matcher engine)
- **#16** Accessibility: confirm() dialogs, missing ARIA roles on modals, color-only highlights
- **#17** Inconsistent error logging (mix of console.error/warn/silent)
- **#18** .gitignore missing node_modules/, .env, OS temp files
- **#19** No dark mode support
- **#20** escHtml uses 4 chained .replace() calls instead of single-pass
