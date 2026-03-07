# CMS Highlighter — Developer Notes

## What This Is
A Chrome extension (Manifest V3) that highlights words and phrases by category on BazaarVoice CMS pages. Supports substring, exact (whole-word), case-sensitive, wildcard, and boundary-space matching. Also highlights client names in the navbar based on configurable rules.

**Target pages** (set in `manifest.json` host_permissions):
- `https://cms.bazaarvoice.com/*`
- `https://workbench.bazaarvoice.com/*`
- `http://minotaur:8124/*`

---

## Project Layout

```
extension/
  manifest.json       # MV3 manifest
  background.js       # Service worker: context menu, storage init
  content.js          # DOM walking, highlight rendering, MutationObserver
  matcher-core.js     # Pure matching engine (browser module, window.MatcherEngine)
  popup.html/js       # Quick-access popup: toggle, per-category editor, client banner
  options.html/js     # Full dictionary editor: categories, ignore list, clients, import/export
  highlight.css       # Minimal highlight span styles

tools/
  matcher.js          # Identical matching engine, exported as Node.js module (for testing)
  test_assertions.js  # Unit + integration test suite — run with: node tools/test_assertions.js
  test_real.js        # Manual review runner against a sample dictionary
  convert.js          # One-time converter from legacy HighlightThis format

cms-fake/             # Ignore — local mock CMS for manual testing
```

---

## Running Tests

```bash
node tools/test_assertions.js   # 43 assertions, all should pass
node tools/test_real.js         # Visual output — compare to the "Notes:" on each review
```

There is no build step. Load `extension/` as an unpacked Chrome extension.

---

## Word Entry Syntax (matcher-core.js / matcher.js)

| Syntax | Meaning |
|--------|---------|
| `walmart` | Substring, case-insensitive |
| `//walmart` | Exact (whole-word), case-insensitive |
| `CS:walmart` | Substring, case-SENSITIVE |
| `CS://HP` | Exact + case-SENSITIVE |
| `LIT:test*file` | Literal `*` and `?` (no wildcard expansion) |
| `" elf "` | Boundary spaces: requires whitespace/punctuation around match |
| `amazon*` | Trailing wildcard |
| `*etailer` | Leading wildcard |
| `sh*t` | Middle wildcard (stays in-token) |
| `took * days` | Space-flanked wildcard (spans exactly one non-space token) |

Prefix order when combining: `CS:` first, then `//`, then `LIT:`. E.g. `CS://ATT`.

---

## Key Architecture Notes

### Matching engine (`matcher-core.js` / `matcher.js`)
- The two files are kept in sync manually. `matcher-core.js` is the browser build (IIFE, exports to `window.MatcherEngine`). `matcher.js` is the Node.js build (`module.exports`). The logic is identical.
- Words are compiled into RegExps at startup and on every `refresh`. Case-sensitive and case-insensitive words get separate RegExps (different flags: `gu` vs `giu`).
- Large categories are chunked at 120 alternations per RegExp to keep capture-group index scanning fast.
- Overlap resolution priority (highest to lowest): exact-contained-beats-wildcard-container → non-wildcard beats wildcard → category priority (list order) → longer match → earlier start.

### Content script (`content.js`)
- Walks text nodes with `TreeWalker`, skips `SCRIPT/STYLE/TEXTAREA/INPUT/SELECT/NOSCRIPT`, skips already-processed parents (`data-cms-hl-processed`).
- Uses a `MutationObserver` with an 80 ms debounce to handle SPA updates.
- Client-name highlight: reads `.navbar-inner .client-name`, matches against `dict.clients[].pattern` (glob), applies category color inline.
- Blocked route guard: disables all highlighting on `/modstatus` and `/guidelinesMod` hashes.

### Popup (`popup.js`)
- `saveDictionary()` writes to storage AND sends a `refresh` message to the active tab so highlights update immediately.
- The client banner clones DOM nodes to clear stale event listeners (pattern: clone → replaceChild → getElementById by id).
- Drag-to-reorder uses HTML5 drag events on `.cat-item[data-index]`.
- `openEditorKey` tracks which category drawer is open (`"ignore"` or `"cat:N"`).

### Background (`background.js`)
- Context menu is rebuilt on every storage change to `dictionary`, `contextExact`, or `contextCaseSensitive`.
- Builds are serialized via `menuBuildInProgress` / `menuBuildQueued` flags.
- On install, seeds storage from `default_dictionary.json` if no categories exist yet.

---

## Things to Keep in Mind

- **Don't edit the ignore list or category words directly in code** without discussing first. The user manages the dictionary through the UI.
- **Don't change design/colors/layout** without asking.
- **`cms-fake/` is for manual testing only** — ignore it in code reviews.
- The `//ELF\r` and `//AF\n` entries in dictionaries are intentional — trailing whitespace causes `parseWordEntry` to detect `boundaryAfter`, giving those entries a trailing word-boundary assertion. This is tested in `test_assertions.js`.
- The ignore list blocks any category match that **overlaps** with an ignore range (not just matches fully contained within it). This is intentional — it means a word like `" elf "` in the ignore list will also suppress `"from elf"` matches.
