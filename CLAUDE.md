# Matcher / CMS Highlighter — Claude Notes

## What this project is

A Chrome extension that highlights content-moderation text (reviews, questions, answers) by matching it against a configurable dictionary. Designed for use on Bazaarvoice CMS sites. No npm, no bundler, no framework — pure vanilla JavaScript.

## Running tests

```bash
node tools/test_assertions.js   # unit tests (exit 1 on failure)
node tools/test_real.js         # integration test with real dictionary (manual review)
```

There is no test framework. Tests use plain console output. Always run `test_assertions.js` after touching the matching engine.

## Architecture

### Dual matching engine (keep in sync!)

The matching logic lives in **two files that must stay identical** (modulo wrapper):

| File | Used by |
|------|---------|
| `tools/matcher.js` | Node.js tests and tooling |
| `extension/matcher-core.js` | Chrome extension (IIFE, exposes `window.MatcherEngine`) |

When you change one, change the other. The only difference is the module wrapper: `module.exports` vs `window.MatcherEngine`.

### Key files

- `tools/matcher.js` — core matching engine (Node module)
- `extension/matcher-core.js` — same engine, browser wrapper
- `extension/content.js` — DOM walker, span injection, mutation observer
- `extension/background.js` — service worker, context menu, storage, default seeding
- `extension/popup.js` — main dictionary UI (add/edit/remove/reorder words)
- `extension/options.js` — settings page, client definitions, backup/restore
- `tools/test_assertions.js` — authoritative test suite
- `tools/convert.js` — converts old HighlightThis backup JSON to current format
- `cms-fake/index.html` — standalone fake CMS page for manual testing

## Word entry syntax

Defined at the top of `matcher.js`. Quick reference:

| Syntax | Meaning |
|--------|---------|
| `walmart` | substring match |
| `//walmart` | whole-word exact match |
| `CS:walmart` | case-sensitive substring |
| `CS://walmart` | case-sensitive whole-word |
| `LIT:test*file` | literal asterisk (no glob) |
| `amazon*` | leading/trailing/middle wildcard |
| `sh*t` | mid-word wildcard |
| `took * days` | space-surrounded `*` = any single word |
| ` elf ` | spaces force word-boundary anchors |
| `?` | single character wildcard |

## Overlap resolution

When two matches overlap, `pickBetterOverlap()` decides which wins:
1. Exact (`//word`) beats non-exact
2. Higher category priority wins
3. Longer match wins
4. Earlier position wins

Ignore-list suppression only fires when a match is **fully contained** within an ignore range (partial overlaps are allowed through).

## Regex compilation details

- Patterns are chunked (120 per regex) to keep alternation fast
- Case-sensitive and case-insensitive patterns compile into separate regex instances
- The `u` flag is used throughout for `\p{P}` Unicode punctuation support

## Loading the extension

1. Go to `chrome://extensions/`
2. Enable Developer mode
3. Load unpacked → select `extension/`

No build step required.

## Converting an old dictionary

```bash
node tools/convert.js path/to/HighlightThis_backup.json
# writes tools/converted_dictionary.json
```

## Branch conventions

Feature branches follow the pattern `claude/description-SessionID`. Push to the branch specified at session start; never push to main without a PR.

## Things to watch out for

- **Always sync both engine files** (`matcher.js` ↔ `matcher-core.js`) — the test suite only covers the Node version.
- `test_assertions.js` is the source of truth for expected matching behavior. Add a test before fixing a matching bug.
- `?` wildcard matches a single non-whitespace character (does not cross word boundaries).
- `*` surrounded by spaces (`took * days`) matches exactly one word token.
- The ignore list uses exact-range containment, not substring suppression.
