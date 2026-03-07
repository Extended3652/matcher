# CMS Highlighter — Claude Context

## What this project is
A Chrome extension (Manifest V3) that highlights words and phrases by category on BazaarVoice CMS pages. Users manage a dictionary of categories/words and per-client overrides; the content script walks the DOM and wraps matches in colored `<span>` elements in real time.

## File map

| File | Role |
|------|------|
| `extension/manifest.json` | MV3 manifest — host permissions, content script injection order |
| `extension/background.js` | Service worker: context menu build, alphabetical insert, default dictionary seed on install, broadcasts `{action:"refresh"}` to all tabs on dictionary storage changes |
| `extension/matcher-core.js` | Pure matching engine (no DOM/Chrome APIs): compiles dictionary to regex chunks, resolves overlapping matches via `pickBetterOverlap` |
| `extension/content.js` | DOM walker, highlight renderer, MutationObserver, message handler (`toggle` / `refresh` / `getStats` / `getClientName`) |
| `extension/options.js` | Full dictionary editor (categories, words, clients, ignore list, import/export) |
| `extension/popup.js` | Quick panel: master toggle, category toggles, inline word editing, drag-to-reorder, client banner with override selector |
| `extension/highlight.css` | Styles for `.cms-hl` spans — do not change without asking |
| `tools/` | Dev utilities: `convert.js` (HighlightThis import), `matcher.js` (standalone test runner), `test_assertions.js`, `test_real.js` |
| `cms-fake/index.html` | Local test page simulating the CMS |

## Architecture notes

### Data flow — saving a change
```
options page / popup / context menu
  └─ chrome.storage.local.set({dictionary})
       └─ background.js: storage.onChanged
            ├─ buildContextMenu()
            └─ chrome.tabs.sendMessage({action:"refresh"}) → all tabs
                 └─ content.js: reload dict, removeAllHighlights(), highlightAll()
```

### Dictionary schema
```js
{
  ignoreList: string[],
  categories: [{ id, name, color, fColor, enabled, words: string[] }],
  clients: [{
    pattern: string,          // glob, matched against navbar client name
    defaultCategory: string|null,
    overrides: { Image, Profile, Question, Comment },  // per-content-type category
    mentionCategory: string|null,
    aliases: string[],
    includePatternInContent: bool,
    note: string
  }]
}
```

### Word entry syntax (matcher-core.js)
- `walmart` — substring, case-insensitive
- `//walmart` — whole-word, case-insensitive
- `CS:walmart` — substring, case-sensitive
- `CS://walmart` — whole-word, case-sensitive
- `amazon*` / `*etailer` / `sh*t` — wildcard
- `took * days` — wildcard spanning tokens

### Content script key behaviours
- `MARKER_ATTR` (`data-cms-hl-processed`) on a parent element means it has been rendered; `getTextNodes()` skips its children to avoid double-processing.
- On `refresh` message, `removeAllHighlights()` clears all spans AND all `MARKER_ATTR` markers before re-running.
- MutationObserver debounce is 80 ms. `characterData` mutations clear `MARKER_ATTR` on the parent before queuing so SPA in-place text updates are caught.
- Route guard disables highlighting on `/modstatus` and `/guidelinesMod` hash routes.

## Important constraints
- **Do not change any visual/CSS design** (`highlight.css`, inline styles on `.cms-hl` spans, client-name badge styles) without asking first.
- Extension targets Chrome MV3 only — no `chrome.extension` APIs, no `background.persistent`.
- `matcher-core.js` must stay free of DOM and Chrome API dependencies (used in `tools/` tests too).
- `tabs` permission is NOT in the manifest — `chrome.tabs.query` works in MV3 without it for the basic query used here.

## Dev workflow
- Load `extension/` as an unpacked extension in Chrome (`chrome://extensions` → Load unpacked).
- Test matching logic standalone: `node tools/matcher.js` or `node tools/test_assertions.js`.
- Local CMS simulation: open `cms-fake/index.html` directly in Chrome (extension must be loaded).
- Branch naming: `claude/<description>-<sessionId>`.
- Always push to the feature branch; never push to `master` without a PR.
