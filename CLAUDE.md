# CMS Highlighter — Claude Context

## What this is
A Chrome extension (Manifest v3) that highlights words and phrases by category
on BazaarVoice CMS pages. Users configure a dictionary of categories + words,
and per-client rules that control which category is used based on the client
name and content type currently shown in the CMS.

---

## File map

```
extension/
  manifest.json         MV3 config; host permissions lock to BV CMS domains
  background.js         Service worker: context menu, storage init, seeding
  matcher-core.js       Pure matching engine (v6); no DOM, no Chrome APIs
  content.js            Content script: DOM walk, span injection, client HL
  highlight.css         Styles for .cms-hl spans
  options.html          Dictionary editor UI (all CSS is embedded in <style>)
  options.js            Options page logic (~1250 lines)
  popup.html            Popup UI (360px wide, all CSS embedded)
  popup.js              Popup logic (~1200 lines)
  icons/                16/48/128px PNGs

tools/                  Node.js utilities (not loaded by extension)
  matcher.js            Node-compatible copy of matcher-core.js
  convert.js            HighlightThis backup → CMS Highlighter JSON converter
  test_assertions.js    Unit test suite (run with: node tools/test_assertions.js)
  test_real.js          Real-world smoke tests

cms-fake/index.html     Mock CMS page for manual testing in browser
```

---

## Storage schema (`chrome.storage.local`)

```js
{
  enabled: boolean,               // global on/off toggle
  contextExact: boolean,          // right-click "Add as exact" toggle
  contextCaseSensitive: boolean,  // right-click "Case-sensitive" toggle
  dictionary: {
    ignoreList: string[],         // words that suppress all highlighting
    categories: Category[],
    clients: Client[],
  }
}
```

### Category
```js
{
  id: string,           // "cat_" + Date.now()
  name: string,
  color: string,        // hex background (e.g. "#FF9900")
  fColor: string,       // hex foreground (e.g. "#000000")
  enabled: boolean,
  words: string[],      // sorted alphabetically (see Word Entry Syntax)
}
```

### Client
```js
{
  pattern: string,               // glob against CMS client name (* and ?)
  defaultCategory: string|null,  // used for Review and any unmatched type
  overrides: {                   // per content-type overrides (omit = inherit default)
    Image?: string,
    Profile?: string,
    Question?: string,
    Comment?: string,
  },
  mentionCategory: string|null,  // category for client-name mentions in CONTENT
  aliases: string[],             // extra patterns matched as mentions (wildcards OK)
  includePatternInContent: boolean, // if true, main pattern also used as mention
  note: string,                  // freeform; not used for matching
}
```

---

## Word entry syntax (matcher-core.js)

| Prefix/syntax     | Meaning                                      |
|-------------------|----------------------------------------------|
| `walmart`         | Substring, case-insensitive                  |
| `//walmart`       | Exact whole-word, case-insensitive           |
| `CS:walmart`      | Substring, case-SENSITIVE                    |
| `CS://walmart`    | Exact whole-word, case-SENSITIVE             |
| `LIT:wa*mart`     | Literal (treat `*`/`?` as plain chars)       |
| `" elf "`         | Boundary spaces (require whitespace/punct)   |
| `amazon*`         | Wildcard — zero or more non-whitespace chars |
| `*etailer`        | Wildcard at start                            |
| `took * days`     | `*` between spaces = exactly one token       |
| `?`               | Any single character (including whitespace)  |
| `\*`, `\?`        | Escaped — treated as literal `*` or `?`      |

Words in each category are sorted alphabetically (stripping CS: and // for sort
key). `insertAlphabetically` uses binary search in both `background.js` and
`options.js`.

---

## Client matching — how it works

1. **Header highlight** (`content.js → applyClientHighlight`):
   - Reads client name from `.navbar-inner .client-name`
   - Reads content type from `.navbar-inner .decisionAreaLabel`
   - Content types: `Image`, `Profile`, `Question`, `Comment`, `Default`
   - Matches client name against `client.pattern` globs (case-insensitive)
   - Picks category: type-specific override → `defaultCategory` → no highlight
   - Applies background/foreground color directly to the `.client-name` element

2. **Mention matching** (stored on client but engine not yet wired in content.js):
   - `mentionCategory` — the category to use when the client name appears in
     body text (everywhere except the `.client-name` header element)
   - `aliases` — additional glob patterns that also count as client mentions
   - `includePatternInContent` — whether the main `pattern` itself is also a
     mention matcher (default `true`)

---

## Options page layout (locked in)

The options page (`options.html` + `options.js`) has three sections:

1. **Import / Export** — JSON in/out; HighlightThis backup import
2. **Clients** — Add/edit/delete client entries
   - Add client form: Pattern + Review + 4 override dropdowns (Image, Profile,
     Question, Comment), then **`<hr class="client-section-divider">`**, then
     Client mentions dropdown + Client aliases textarea
   - Each client card in the list expands to show the same two-part layout
     (overrides grid / divider / mentions block)
3. **Categories** — Add/edit/delete categories; each has a word list textarea
   and a quick-add input. "Ignore List" is the first card (always at top).

The HTML has **all CSS embedded** in a `<style>` block at the top of
`options.html`. There is no external stylesheet for the options page.

Key CSS classes to know:
- `.client-add-grid` — 2-column grid used in both add form and edit cards
- `.client-edit-grid` — same grid layout inside expanded client cards
- `.client-section-divider` — `<hr>` between overrides block and mentions block
- `.client-mentions-wrap` — wrapper div around the mentions grid in edit cards
- `.client-add-box` — the "Add client" form container
- `.client-body.open` — expanded state of a client card

---

## CMS DOM selectors relied upon

| Selector                               | What it contains          |
|----------------------------------------|---------------------------|
| `.navbar-inner .client-name`           | Active client name        |
| `.navbar-inner .decisionAreaLabel`     | Content type label        |

---

## No build process

Pure vanilla JS/HTML/CSS. Load the `extension/` folder directly in Chrome via
"Load unpacked". No npm, no bundler, no transpilation.

Running tests: `node tools/test_assertions.js`

---

## Branch convention

Feature branches follow the pattern: `claude/<description>-<sessionId>`

Always push to the designated feature branch. Never push directly to `master`
or `main` without explicit instruction.

---

## Hosts

```
https://cms.bazaarvoice.com/*
https://workbench.bazaarvoice.com/*
http://minotaur:8124/*          ← local dev server
```
