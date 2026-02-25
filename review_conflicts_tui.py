#!/usr/bin/env python3
import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

try:
    import curses
    HAS_CURSES = True
except Exception:
    HAS_CURSES = False


IGNORE_KEYS = [
    "ignoreList",
    "ignore_list",
    "ignore",
    "ignored",
    "ignoreWords",
    "ignore_words",
]

HEX_RE = re.compile(r"^#?[0-9a-fA-F]{6}$")
ANSI_RESET = "\x1b[0m"


# ----------------------------
# IO
# ----------------------------

def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)

def write_json(path: Path, obj: Any) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)

def append_jsonl(path: Path, obj: Dict[str, Any]) -> None:
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


# ----------------------------
# Normalization
# ----------------------------

def normalize_text(s: str) -> str:
    s = str(s).strip()
    s = re.sub(r"\s+", " ", s)
    return s.lower()


# ----------------------------
# Structure helpers
# ----------------------------

def extract_categories_root(data: Any) -> Tuple[str, List[Dict[str, Any]]]:
    if isinstance(data, list):
        return "list", data
    if isinstance(data, dict) and "categories" in data and isinstance(data["categories"], list):
        return "object", data["categories"]
    raise ValueError("Unrecognized structure. Expected list root, or object with 'categories' list.")

def find_ignore_list_container(data: Any) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    if not isinstance(data, dict):
        return None, None
    for k in IGNORE_KEYS:
        if k in data and isinstance(data[k], list):
            return data, k
    return None, None


# ----------------------------
# Indexing
# ----------------------------

def build_category_word_index(categories: List[Dict[str, Any]]) -> Dict[str, Set[int]]:
    idx: Dict[str, Set[int]] = {}
    for ci, cat in enumerate(categories):
        if not isinstance(cat, dict):
            continue
        words = cat.get("words", [])
        if not isinstance(words, list):
            continue
        for w in words:
            key = normalize_text(w)
            idx.setdefault(key, set()).add(ci)
    return idx

def intercategory_duplicates(categories: List[Dict[str, Any]]) -> List[Tuple[str, List[int]]]:
    idx = build_category_word_index(categories)
    items = [(w, sorted(list(cset))) for (w, cset) in idx.items() if len(cset) >= 2]
    items.sort(key=lambda t: t[0])
    return items


# ----------------------------
# Mutations
# ----------------------------

def remove_norm_with_capture(values: List[Any], norm_target: str) -> Tuple[List[Any], List[Any]]:
    kept = []
    removed = []
    for v in values:
        if normalize_text(v) == norm_target:
            removed.append(v)
        else:
            kept.append(v)
    return kept, removed

def remove_from_category_norm(categories: List[Dict[str, Any]], ci: int, norm_word: str) -> int:
    cat = categories[ci]
    words = cat.get("words", [])
    if not isinstance(words, list):
        return 0
    kept, removed = remove_norm_with_capture(words, norm_word)
    cat["words"] = kept
    return len(removed)

def remove_from_all_categories(categories: List[Dict[str, Any]], present_in: List[int], norm_word: str) -> int:
    total = 0
    for ci in present_in:
        total += remove_from_category_norm(categories, ci, norm_word)
    return total

def add_to_ignore(ignore_container: Dict[str, Any], ignore_key: str, norm_word: str) -> bool:
    lst = ignore_container.get(ignore_key, [])
    if not isinstance(lst, list):
        return False
    existing = set(normalize_text(x) for x in lst)
    if norm_word in existing:
        return False
    lst.append(norm_word)
    ignore_container[ignore_key] = lst
    return True

def remove_from_ignore_norm(ignore_container: Dict[str, Any], ignore_key: str, norm_word: str) -> int:
    lst = ignore_container.get(ignore_key, [])
    if not isinstance(lst, list):
        return 0
    kept, removed = remove_norm_with_capture(lst, norm_word)
    ignore_container[ignore_key] = kept
    return len(removed)


# ----------------------------
# Category display + colors
# ----------------------------

def hex_to_rgb(hex_color: str) -> Optional[Tuple[int, int, int]]:
    if not isinstance(hex_color, str):
        return None
    s = hex_color.strip()
    if not HEX_RE.match(s):
        return None
    if s.startswith("#"):
        s = s[1:]
    try:
        r = int(s[0:2], 16)
        g = int(s[2:4], 16)
        b = int(s[4:6], 16)
        return (r, g, b)
    except ValueError:
        return None

def cat_name(categories: List[Dict[str, Any]], idx: int) -> str:
    cat = categories[idx]
    return str(cat.get("name", f"cat_{idx}"))

def cat_colors(categories: List[Dict[str, Any]], idx: int) -> Tuple[str, str]:
    cat = categories[idx]
    return (str(cat.get("color", "") or ""), str(cat.get("fColor", "") or ""))


# ----------------------------
# Curses color mapping (approx to 256)
# ----------------------------

def rgb_to_256(r: int, g: int, b: int) -> int:
    def to_6(x: int) -> int:
        return int(round(x / 255 * 5))
    ri, gi, bi = to_6(r), to_6(g), to_6(b)
    return 16 + 36 * ri + 6 * gi + bi

def init_curses_colors_for_categories(categories: List[Dict[str, Any]]) -> Dict[int, int]:
    pair_map: Dict[int, int] = {}
    if not curses.has_colors():
        return pair_map

    curses.start_color()
    try:
        curses.use_default_colors()
    except Exception:
        pass

    next_pair = 1
    for ci in range(len(categories)):
        bg_hex, fg_hex = cat_colors(categories, ci)
        bg_rgb = hex_to_rgb(bg_hex)
        fg_rgb = hex_to_rgb(fg_hex)
        if bg_rgb is None and fg_rgb is None:
            continue

        fg = -1
        bg = -1
        if fg_rgb is not None:
            fg = rgb_to_256(*fg_rgb)
        if bg_rgb is not None:
            bg = rgb_to_256(*bg_rgb)

        if fg != -1:
            fg = max(0, min(255, fg))
        if bg != -1:
            bg = max(0, min(255, bg))

        try:
            curses.init_pair(next_pair, fg, bg)
            pair_map[ci] = next_pair
            next_pair += 1
        except Exception:
            continue

        if next_pair >= 250:
            break

    return pair_map


# ----------------------------
# Decisions log resume support
# ----------------------------

def decision_key(obj: Dict[str, Any]) -> Optional[str]:
    t = obj.get("type")
    if t == "inter":
        return f"inter::{obj.get('word')}"
    return None

def load_done_keys(log_path: Path) -> Set[str]:
    done: Set[str] = set()
    if not log_path.exists():
        return done
    try:
        with log_path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                k = decision_key(obj)
                if k:
                    done.add(k)
    except OSError:
        pass
    return done


# ----------------------------
# Apply approval helper
# ----------------------------

def prompt(msg: str) -> str:
    try:
        return input(msg)
    except KeyboardInterrupt:
        print("\nCancelled.")
        sys.exit(2)

def confirm_cli(msg: str) -> bool:
    ans = prompt(msg + " (y/N) ").strip().lower()
    if not ans:
        return False
    return ans == "y"

def require_approval(apply: bool, yes: bool, phrase: str) -> None:
    if not apply:
        return
    if yes:
        return
    print("")
    print("You requested --apply, so I need explicit approval.")
    print(f"Type exactly: {phrase}")
    entered = prompt("> ").strip("\n")
    if entered != phrase:
        print("Approval phrase did not match. No changes applied.")
        sys.exit(2)


# ----------------------------
# TUI core
# ----------------------------

def build_options(categories: List[Dict[str, Any]], present_in: List[int], ignore_available: bool) -> List[Dict[str, Any]]:
    opts: List[Dict[str, Any]] = []
    for ci in present_in:
        opts.append({"kind": "cat", "ci": ci, "label": f"{ci+1}) {cat_name(categories, ci)}"})
    if ignore_available:
        opts.append({"kind": "ignore", "label": "IGNORE (move to ignore list, remove from all categories)"})
    opts.append({"kind": "drop", "label": "DROP (remove from all categories and ignore list)"})
    return opts

def option_to_dest(opt: Dict[str, Any]) -> Dict[str, Any]:
    if opt["kind"] == "cat":
        return {"dest": "cat", "ci": opt["ci"]}
    if opt["kind"] == "ignore":
        return {"dest": "ignore"}
    return {"dest": "drop"}

def curses_review_loop(
    stdscr,
    dupes: List[Tuple[str, List[int]]],
    categories: List[Dict[str, Any]],
    ignore_container: Optional[Dict[str, Any]],
    ignore_key: Optional[str],
    ignore_available: bool,
    done_keys: Set[str],
    log_path: Path,
) -> List[Dict[str, Any]]:
    curses.curs_set(0)
    stdscr.nodelay(False)
    stdscr.keypad(True)

    pair_map = init_curses_colors_for_categories(categories)

    decisions_this_run: List[Dict[str, Any]] = []
    total = len(dupes)

    # state for per-word screen
    idx = 0
    while idx < total:
        word, present_in = dupes[idx]
        key = f"inter::{word}"

        if key in done_keys:
            idx += 1
            continue

        present_in = [ci for ci in present_in if 0 <= ci < len(categories)]
        if len(present_in) < 2:
            obj = {"type": "inter", "word": word, "action": "skip", "reason": "present_in<2"}
            append_jsonl(log_path, obj)
            decisions_this_run.append(obj)
            done_keys.add(key)
            idx += 1
            continue

        recommended_keep = min(present_in)
        options = build_options(categories, present_in, ignore_available)

        # initial cursor and selection on recommended category
        pos = 0
        chosen = 0
        for i, opt in enumerate(options):
            if opt.get("kind") == "cat" and opt.get("ci") == recommended_keep:
                pos = i
                chosen = i
                break

        # selection screen loop for this word
        while True:
            stdscr.erase()
            h, w = stdscr.getmaxyx()

            header = [
                f"[{idx+1}/{total}] Word: {word}",
                "Pick ONE destination. Space selects. Enter confirms. q skips.",
                "",
            ]
            y = 0
            for line in header:
                if y < h:
                    stdscr.addnstr(y, 0, line, w - 1)
                y += 1

            list_top = y
            list_h = max(1, h - list_top - 2)

            if len(options) <= list_h:
                start = 0
            else:
                start = max(0, min(pos - (list_h // 2), len(options) - list_h))
            end = min(len(options), start + list_h)

            # draw options
            for row_i, opt_i in enumerate(range(start, end)):
                opt = options[opt_i]
                is_cursor = (opt_i == pos)
                is_selected = (opt_i == chosen)

                cursor_mark = ">" if is_cursor else " "
                sel_mark = "[X]" if is_selected else "[ ]"
                label = opt["label"]

                yrow = list_top + row_i
                if yrow >= h:
                    continue

                # prefix always normal
                prefix = f"{cursor_mark} {sel_mark} "
                stdscr.addnstr(yrow, 0, prefix, w - 1)

                x = len(prefix)

                if opt.get("kind") == "cat":
                    ci = opt["ci"]
                    pair_no = pair_map.get(ci)
                    if pair_no:
                        stdscr.addnstr(yrow, x, label, max(0, w - 1 - x), curses.color_pair(pair_no))
                    else:
                        attr = curses.A_BOLD if is_cursor else curses.A_NORMAL
                        stdscr.addnstr(yrow, x, label, max(0, w - 1 - x), attr)
                else:
                    attr = curses.A_BOLD if is_cursor else curses.A_NORMAL
                    stdscr.addnstr(yrow, x, label, max(0, w - 1 - x), attr)

            # footer
            footer = "Keys: Up/Down move  Space select  Enter confirm  q skip"
            stdscr.addnstr(h - 1, 0, footer, w - 1)

            stdscr.refresh()

            ch = stdscr.getch()
            if ch in (curses.KEY_UP, ord("k")):
                pos = max(0, pos - 1)
            elif ch in (curses.KEY_DOWN, ord("j")):
                pos = min(len(options) - 1, pos + 1)
            elif ch == ord(" "):
                chosen = pos
            elif ch in (ord("q"), ord("Q"), 27):
                obj = {"type": "inter", "word": word, "action": "skip"}
                append_jsonl(log_path, obj)
                decisions_this_run.append(obj)
                done_keys.add(key)
                idx += 1
                break
            elif ch in (curses.KEY_ENTER, 10, 13):
                # confirm screen inside curses
                chosen_opt = options[chosen]
                dest = option_to_dest(chosen_opt)

                while True:
                    stdscr.erase()
                    h2, w2 = stdscr.getmaxyx()

                    lines = [
                        f"[{idx+1}/{total}] Word: {word}",
                        "",
                    ]

                    # show destination line with category coloring if applicable
                    if dest["dest"] == "cat":
                        ci = dest["ci"]
                        lines.append("Destination:")
                        lines.append("")
                        lines.append(f"  category {ci+1}) {cat_name(categories, ci)}")
                    elif dest["dest"] == "ignore":
                        lines.append("Destination:")
                        lines.append("")
                        lines.append("  IGNORE")
                    else:
                        lines.append("Destination:")
                        lines.append("")
                        lines.append("  DROP")

                    lines.append("")
                    lines.append("Apply? y = apply, n = skip, b = back to selection")

                    yy = 0
                    for line in lines:
                        if yy < h2:
                            stdscr.addnstr(yy, 0, line, w2 - 1)
                        yy += 1

                    # colorize the destination category line if needed
                    if dest["dest"] == "cat":
                        ci = dest["ci"]
                        pair_no = pair_map.get(ci)
                        if pair_no:
                            # redraw the category line with color
                            # It is line index 4 in the above build (0-based)
                            cat_line_y = 4
                            if cat_line_y < h2:
                                stdscr.addnstr(cat_line_y, 0, f"  category {ci+1}) {cat_name(categories, ci)}", w2 - 1, curses.color_pair(pair_no))

                    stdscr.refresh()
                    ch2 = stdscr.getch()

                    if ch2 in (ord("b"), ord("B")):
                        # back to selection loop
                        break
                    if ch2 in (ord("n"), ord("N")):
                        obj = {"type": "inter", "word": word, "action": "skip"}
                        append_jsonl(log_path, obj)
                        decisions_this_run.append(obj)
                        done_keys.add(key)
                        idx += 1
                        # exit this word
                        ch2 = None
                        break
                    if ch2 in (ord("y"), ord("Y")):
                        # Apply in-memory edits — handle each destination separately
                        # so we only touch the ignore list when the destination requires it.

                        if dest["dest"] == "cat":
                            keep_ci = dest["ci"]
                            remove_from = [ci for ci in present_in if ci != keep_ci]
                            removed_from_categories = 0
                            for ci in remove_from:
                                removed_from_categories += remove_from_category_norm(categories, ci, word)
                            # Remove from ignore if present (keep in category takes precedence)
                            removed_from_ignore = 0
                            if ignore_available and ignore_container is not None and ignore_key is not None:
                                removed_from_ignore = remove_from_ignore_norm(ignore_container, ignore_key, word)

                            obj = {
                                "type": "inter",
                                "word": word,
                                "action": "set_category",
                                "kept_category": keep_ci,
                                "removed_from_categories": removed_from_categories,
                                "removed_from_ignore": removed_from_ignore,
                            }
                            append_jsonl(log_path, obj)
                            decisions_this_run.append(obj)
                            done_keys.add(key)
                            idx += 1
                            ch2 = None
                            break

                        if dest["dest"] == "ignore":
                            removed_from_categories = remove_from_all_categories(categories, present_in, word)
                            added = False
                            if ignore_available and ignore_container is not None and ignore_key is not None:
                                added = add_to_ignore(ignore_container, ignore_key, word)

                            obj = {
                                "type": "inter",
                                "word": word,
                                "action": "set_ignore",
                                "removed_from_categories": removed_from_categories,
                                "added_to_ignore": bool(added),
                            }
                            append_jsonl(log_path, obj)
                            decisions_this_run.append(obj)
                            done_keys.add(key)
                            idx += 1
                            ch2 = None
                            break

                        # drop: remove from all categories and from ignore
                        removed_from_categories = remove_from_all_categories(categories, present_in, word)
                        removed_from_ignore = 0
                        if ignore_available and ignore_container is not None and ignore_key is not None:
                            removed_from_ignore = remove_from_ignore_norm(ignore_container, ignore_key, word)
                        obj = {
                            "type": "inter",
                            "word": word,
                            "action": "set_drop",
                            "removed_from_categories": removed_from_categories,
                            "removed_from_ignore": removed_from_ignore,
                        }
                        append_jsonl(log_path, obj)
                        decisions_this_run.append(obj)
                        done_keys.add(key)
                        idx += 1
                        ch2 = None
                        break

                # if we applied or skipped, we break out to next word
                if key in done_keys:
                    break

    return decisions_this_run


# ----------------------------
# Summary
# ----------------------------

def print_summary(decisions: List[Dict[str, Any]], proposed_path: Path, log_path: Path) -> None:
    changed = [d for d in decisions if d.get("action") in ("set_category", "set_ignore", "set_drop")]
    skipped = [d for d in decisions if d.get("action") == "skip"]

    removed_from_categories = sum(int(d.get("removed_from_categories", 0)) for d in changed)
    removed_from_ignore = sum(int(d.get("removed_from_ignore", 0)) for d in changed)
    added_to_ignore = sum(1 for d in changed if d.get("action") == "set_ignore" and d.get("added_to_ignore", False))

    print("")
    print("== Summary ==")
    print(f"Decisions written (this run): {len(decisions)} (log: {log_path})")
    print(f"Proposed file: {proposed_path}")
    print("")
    print(f"Changed: {len(changed)}")
    print(f"Skipped: {len(skipped)}")
    print(f"Removed from categories (total entries): {removed_from_categories}")
    print(f"Removed from ignore (total entries): {removed_from_ignore}")
    print(f"Added to ignore (unique adds): {added_to_ignore}")

    preview_n = 25
    if changed:
        print("")
        print(f"Change preview (first {min(preview_n, len(changed))}):")
        for d in changed[:preview_n]:
            w = d.get("word")
            action = d.get("action")
            if action == "set_category":
                ci = d.get("kept_category")
                print(f"- {w} -> category {ci+1}")
            elif action == "set_ignore":
                print(f"- {w} -> ignore")
            elif action == "set_drop":
                print(f"- {w} -> drop")
        if len(changed) > preview_n:
            print(f"... plus {len(changed) - preview_n} more")


# ----------------------------
# Main
# ----------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description="Exclusive destination reviewer (category OR ignore OR drop) with in-TUI confirmation.")
    ap.add_argument("--in", dest="in_path", required=True, help="Input JSON backup")
    ap.add_argument("--out", dest="out_path", default=None, help="Output path when applying (optional)")
    ap.add_argument("--proposed", dest="proposed_path", default=None, help="Always write proposed JSON here")
    ap.add_argument("--log", dest="log_path", default=None, help="Always write decision log here (jsonl)")
    ap.add_argument("--apply", action="store_true", help="Enable applying at end (still requires approval phrase unless --yes)")
    ap.add_argument("--yes", action="store_true", help="Skip approval prompt (still requires --apply)")
    ap.add_argument("--resume", action="store_true", help="Skip items already present in the decisions log")
    ap.add_argument("--limit", type=int, default=0, help="Only process first N items (debug)")

    args = ap.parse_args()

    in_path = Path(args.in_path).expanduser()
    if not in_path.exists():
        print(f"Input file not found: {in_path}", file=sys.stderr)
        sys.exit(1)

    data = load_json(in_path)
    mode, categories = extract_categories_root(data)

    if mode == "object":
        new_data = dict(data)
        new_categories = [dict(c) if isinstance(c, dict) else c for c in categories]
        new_data["categories"] = new_categories
    else:
        new_categories = [dict(c) if isinstance(c, dict) else c for c in categories]
        new_data = new_categories

    ignore_container, ignore_key = (None, None)
    if mode == "object":
        ignore_container, ignore_key = find_ignore_list_container(new_data)
    ignore_available = (ignore_container is not None and ignore_key is not None)

    proposed_path = Path(args.proposed_path).expanduser() if args.proposed_path else in_path.with_suffix(in_path.suffix + ".exclusive.proposed.json")
    log_path = Path(args.log_path).expanduser() if args.log_path else in_path.with_suffix(in_path.suffix + ".exclusive.decisions.jsonl")
    out_path = Path(args.out_path).expanduser() if args.out_path else in_path

    done_keys: Set[str] = load_done_keys(log_path) if args.resume else set()

    dupes = intercategory_duplicates(new_categories)
    if args.limit and args.limit > 0:
        dupes = dupes[: args.limit]

    print("")
    print("== Exclusive conflict review (inter-category duplicates) ==")
    print("Rule: each word ends up in exactly one place: ONE category, ignore, or nowhere.")
    print(f"Input:    {in_path}")
    print(f"Proposed: {proposed_path}")
    print(f"Log:      {log_path}")
    print("")

    decisions_this_run: List[Dict[str, Any]] = []

    use_tui = HAS_CURSES and sys.stdout.isatty()
    if use_tui:
        decisions_this_run = curses.wrapper(
            curses_review_loop,
            dupes,
            new_categories,
            ignore_container,
            ignore_key,
            ignore_available,
            done_keys,
            log_path,
        )
    else:
        print("No curses TUI available in this environment.")
        print("Run from a real terminal, or tell me if you want a non-curses UI.")
        sys.exit(2)

    # Save proposed always
    if mode == "object":
        new_data["categories"] = new_categories
    else:
        new_data = new_categories

    write_json(proposed_path, new_data)
    print("")
    print(f"Wrote proposed file: {proposed_path}")
    print("No changes applied yet.")

    print_summary(decisions_this_run, proposed_path, log_path)

    if args.apply:
        print("")
        if not confirm_cli(f"Apply the proposed changes now to: {out_path}?"):
            print("Not applied.")
            return

        phrase = f"APPLY {in_path.name}"
        require_approval(apply=True, yes=args.yes, phrase=phrase)
        write_json(out_path, new_data)
        print(f"Applied changes to: {out_path}")
    else:
        print("")
        print("To apply, rerun with --apply (and optionally --out). Example:")
        print(f"  python3 review_conflicts_tui.py --in {in_path} --out {in_path}.cleaned.json --apply --resume")


if __name__ == "__main__":
    main()
