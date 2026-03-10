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
tools/               — standalone Node scripts (seeding, testing)
cms-fake/            — local CMS mock for manual testing
```
