#!/usr/bin/env python3
import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple


IGNORE_KEYS = [
    "ignoreList",
    "ignore_list",
    "ignore",
    "ignored",
    "ignoreWords",
    "ignore_words",
]


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, obj: Any) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)


def normalize_text(s: str) -> str:
    s = str(s).strip()
    s = re.sub(r"\s+", " ", s)
    return s.lower()


def extract_categories_root(data: Any) -> Tuple[str, List[Dict[str, Any]]]:
    # mode: "list" or "object"
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


def build_category_word_index(categories: List[Dict[str, Any]]) -> Dict[str, Set[int]]:
    """
    normalized_word -> set(category_index)
    """
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
    """
    Returns list of (normalized_word, sorted_category_indexes) for words appearing in 2+ categories.
    """
    idx = build_category_word_index(categories)
    items = [(w, sorted(list(cset))) for (w, cset) in idx.items() if len(cset) >= 2]
    items.sort(key=lambda t: t[0])
    return items


def ignore_vs_categories(ignore_list: List[Any], categories: List[Dict[str, Any]]) -> List[Tuple[str, List[int]]]:
    idx = build_category_word_index(categories)
    hits: List[Tuple[str, List[int]]] = []
    for x in ignore_list:
        k = normalize_text(x)
        if k in idx:
            hits.append((k, sorted(list(idx[k]))))
    hits.sort(key=lambda t: t[0])
    return hits


def remove_word_from_category(categories: List[Dict[str, Any]], cat_index: int, normalized_word: str) -> int:
    """
    Removes all entries that normalize to normalized_word from a given category.
    Returns count removed.
    """
    cat = categories[cat_index]
    words = cat.get("words", [])
    if not isinstance(words, list):
        return 0

    kept = []
    removed = 0
    for w in words:
        if normalize_text(w) == normalized_word:
            removed += 1
        else:
            kept.append(w)
    cat["words"] = kept
    return removed


def remove_word_from_ignore(ignore_container: Dict[str, Any], ignore_key: str, normalized_word: str) -> int:
    lst = ignore_container.get(ignore_key, [])
    if not isinstance(lst, list):
        return 0
    kept = []
    removed = 0
    for x in lst:
        if normalize_text(x) == normalized_word:
            removed += 1
        else:
            kept.append(x)
    ignore_container[ignore_key] = kept
    return removed


def add_to_ignore(ignore_container: Dict[str, Any], ignore_key: str, normalized_word: str) -> bool:
    """
    Adds normalized_word to ignore list if not already present (by normalized compare).
    Returns True if added.
    """
    lst = ignore_container.get(ignore_key, [])
    if not isinstance(lst, list):
        return False
    existing = set(normalize_text(x) for x in lst)
    if normalized_word in existing:
        return False
    lst.append(normalized_word)
    ignore_container[ignore_key] = lst
    return True


def parse_num_list(s: str, max_n: int) -> List[int]:
    """
    Accepts: "1,2,5" or "1 2 5"
    Returns 0-based indexes.
    """
    s = s.strip()
    if not s:
        return []
    parts = re.split(r"[,\s]+", s)
    out: List[int] = []
    for p in parts:
        if not p:
            continue
        if not p.isdigit():
            raise ValueError("Not a number")
        n = int(p)
        if n < 1 or n > max_n:
            raise ValueError("Out of range")
        out.append(n - 1)
    # unique, preserve order
    seen = set()
    uniq = []
    for x in out:
        if x not in seen:
            seen.add(x)
            uniq.append(x)
    return uniq


def prompt(msg: str) -> str:
    try:
        return input(msg)
    except KeyboardInterrupt:
        print("\nCancelled.")
        sys.exit(2)


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


def cat_label(categories: List[Dict[str, Any]], idx: int) -> str:
    name = str(categories[idx].get("name", f"cat_{idx}"))
    return f"{idx+1}) {name}"


def decision_key(obj: Dict) -> Optional[str]:
    t = obj.get("type")
    if t == "inter":
        return f"inter::{obj.get('word')}"
    if t == "ignore_hit":
        return f"ignore_hit::{obj.get('word')}"
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


def main() -> None:
    ap = argparse.ArgumentParser(description="Interactive conflict reviewer for CMS Highlighter backup.")
    ap.add_argument("--in", dest="in_path", required=True, help="Input JSON backup")
    ap.add_argument("--out", dest="out_path", default=None, help="Output path when applying (optional)")
    ap.add_argument("--proposed", dest="proposed_path", default=None, help="Always write proposed JSON here")
    ap.add_argument("--log", dest="log_path", default=None, help="Always write decision log here (jsonl)")
    ap.add_argument("--apply", action="store_true", help="Apply changes to --out (or overwrite --in if --out omitted)")
    ap.add_argument("--yes", action="store_true", help="Skip approval prompt (still requires --apply)")
    ap.add_argument("--resume", action="store_true", help="Skip items already recorded in the decisions log")

    ap.add_argument("--skip-inter", action="store_true", help="Skip inter-category duplicates review")
    ap.add_argument("--skip-ignore", action="store_true", help="Skip ignore-vs-category review")

    args = ap.parse_args()

    in_path = Path(args.in_path).expanduser()
    if not in_path.exists():
        print(f"Input file not found: {in_path}", file=sys.stderr)
        sys.exit(1)

    data = load_json(in_path)
    mode, categories = extract_categories_root(data)

    # For safety, work on a copy
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

    proposed_path = Path(args.proposed_path).expanduser() if args.proposed_path else in_path.with_suffix(in_path.suffix + ".proposed.json")
    log_path = Path(args.log_path).expanduser() if args.log_path else in_path.with_suffix(in_path.suffix + ".decisions.jsonl")
    out_path = Path(args.out_path).expanduser() if args.out_path else in_path

    done_keys: Set[str] = load_done_keys(log_path) if args.resume else set()
    if args.resume and done_keys:
        print(f"Resuming: {len(done_keys)} items already decided (skipping).")

    # Precompute conflicts
    inter_dupes = intercategory_duplicates(new_categories)
    ignore_hits: List[Tuple[str, List[int]]] = []
    if not args.skip_ignore and ignore_container is not None and ignore_key is not None:
        ignore_list = ignore_container.get(ignore_key, [])
        if isinstance(ignore_list, list):
            ignore_hits = ignore_vs_categories(ignore_list, new_categories)

    # Decision log (append)
    def log_event(obj: Dict[str, Any]) -> None:
        with log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(obj, ensure_ascii=False) + "\n")

    print("")
    print("== Interactive conflict review ==")
    print(f"Input:    {in_path}")
    print(f"Proposed: {proposed_path}")
    print(f"Log:      {log_path}")
    print("")
    print("Nothing is applied unless you run with --apply and approve.")
    print("Default action is always: skip/do nothing.")
    print("")

    # ----------------------------
    # Inter-category duplicates
    # ----------------------------
    if not args.skip_inter:
        print(f"Inter-category exact duplicates: {len(inter_dupes)}")
        print("")
        for idx, (word, cat_indexes) in enumerate(inter_dupes, start=1):
            if f"inter::{word}" in done_keys:
                continue

            cat_indexes = [ci for ci in cat_indexes if 0 <= ci < len(new_categories)]
            if len(cat_indexes) < 2:
                continue

            print(f"[{idx}/{len(inter_dupes)}] Word: {word}")
            print("Appears in:")
            for ci in cat_indexes:
                print("  " + cat_label(new_categories, ci))
            print("")
            print("Choose action:")
            print("  s = skip (no change)")
            print("  r = remove from one or more categories")
            print("  m = move to ignore list (add to ignore, optionally remove from categories)")
            choice = prompt("> ").strip().lower()

            if choice in ("", "s"):
                log_event({"type": "inter", "word": word, "action": "skip", "cats": cat_indexes})
                print("")
                continue

            if choice == "r":
                print("Enter category numbers to REMOVE it from (example: 2 5).")
                nums = prompt("> ").strip()
                try:
                    to_remove = parse_num_list(nums, max_n=len(new_categories))
                except ValueError:
                    print("Invalid selection, skipping.")
                    log_event({"type": "inter", "word": word, "action": "invalid_remove_selection", "input": nums})
                    print("")
                    continue

                removed_total = 0
                for ci in to_remove:
                    removed_total += remove_word_from_category(new_categories, ci, word)

                log_event({"type": "inter", "word": word, "action": "remove_from_categories", "removed_from": to_remove, "removed_total": removed_total})
                print(f"Removed {removed_total} entries.")
                print("")
                continue

            if choice == "m":
                if ignore_container is None or ignore_key is None:
                    print("No ignore list found in this file. Cannot move to ignore. Skipping.")
                    log_event({"type": "inter", "word": word, "action": "move_to_ignore_failed_no_ignore"})
                    print("")
                    continue

                added = add_to_ignore(ignore_container, ignore_key, word)
                print(f"Added to ignore: {'yes' if added else 'already present'}")
                print("Also remove from categories? (y/n, default n)")
                yn = prompt("> ").strip().lower()
                removed_total = 0
                removed_from: List[int] = []
                if yn == "y":
                    print("Enter category numbers to REMOVE it from (example: 2 5). Blank means remove from all listed above.")
                    nums = prompt("> ").strip()
                    if nums:
                        try:
                            to_remove = parse_num_list(nums, max_n=len(new_categories))
                        except ValueError:
                            print("Invalid selection, not removing from categories.")
                            to_remove = []
                    else:
                        to_remove = cat_indexes

                    for ci in to_remove:
                        removed_total += remove_word_from_category(new_categories, ci, word)
                        removed_from.append(ci)

                log_event({
                    "type": "inter",
                    "word": word,
                    "action": "move_to_ignore",
                    "added_to_ignore": added,
                    "removed_from": removed_from,
                    "removed_total": removed_total
                })
                print("")
                continue

            print("Unknown choice, skipping.")
            log_event({"type": "inter", "word": word, "action": "unknown_choice", "input": choice})
            print("")

    # ----------------------------
    # Ignore list vs categories
    # ----------------------------
    if not args.skip_ignore:
        if ignore_container is None or ignore_key is None:
            print("Ignore list not found, skipping ignore-vs-categories review.")
        else:
            print("")
            print(f"Ignore entries also present in categories: {len(ignore_hits)}")
            print("")
            for idx, (word, cat_indexes) in enumerate(ignore_hits, start=1):
                if f"ignore_hit::{word}" in done_keys:
                    continue

                cat_indexes = [ci for ci in cat_indexes if 0 <= ci < len(new_categories)]
                print(f"[{idx}/{len(ignore_hits)}] Ignore entry: {word}")
                print("Also appears in categories:")
                for ci in cat_indexes:
                    print("  " + cat_label(new_categories, ci))
                print("")
                print("Choose action:")
                print("  s = skip (no change)")
                print("  i = remove from ignore list only")
                print("  c = remove from one or more categories only")
                print("  b = remove from BOTH ignore and selected categories")
                choice = prompt("> ").strip().lower()

                if choice in ("", "s"):
                    log_event({"type": "ignore_hit", "word": word, "action": "skip", "cats": cat_indexes})
                    print("")
                    continue

                if choice == "i":
                    removed_n = remove_word_from_ignore(ignore_container, ignore_key, word)
                    log_event({"type": "ignore_hit", "word": word, "action": "remove_from_ignore", "removed": removed_n})
                    print(f"Removed from ignore: {removed_n}")
                    print("")
                    continue

                if choice in ("c", "b"):
                    print("Enter category numbers to REMOVE it from (example: 2 5). Blank means remove from all listed above.")
                    nums = prompt("> ").strip()
                    if nums:
                        try:
                            to_remove = parse_num_list(nums, max_n=len(new_categories))
                        except ValueError:
                            print("Invalid selection, skipping.")
                            log_event({"type": "ignore_hit", "word": word, "action": "invalid_remove_selection", "input": nums})
                            print("")
                            continue
                    else:
                        to_remove = cat_indexes

                    removed_total = 0
                    for ci in to_remove:
                        removed_total += remove_word_from_category(new_categories, ci, word)

                    removed_ignore = 0
                    if choice == "b":
                        removed_ignore = remove_word_from_ignore(ignore_container, ignore_key, word)

                    log_event({
                        "type": "ignore_hit",
                        "word": word,
                        "action": "remove_categories" if choice == "c" else "remove_both",
                        "removed_from": to_remove,
                        "removed_total": removed_total,
                        "removed_ignore": removed_ignore,
                    })
                    if choice == "b":
                        print(f"Removed {removed_total} from categories, and {removed_ignore} from ignore.")
                    else:
                        print(f"Removed {removed_total} from categories.")
                    print("")
                    continue

                print("Unknown choice, skipping.")
                log_event({"type": "ignore_hit", "word": word, "action": "unknown_choice", "input": choice})
                print("")

    # Re-embed categories
    if mode == "object":
        new_data["categories"] = new_categories
    else:
        new_data = new_categories

    # Always write proposed output
    write_json(proposed_path, new_data)
    print("")
    print(f"Wrote proposed file: {proposed_path}")
    print("No changes applied yet.")

    if args.apply:
        phrase = f"APPLY {in_path.name}"
        require_approval(apply=True, yes=args.yes, phrase=phrase)
        write_json(out_path, new_data)
        print(f"Applied changes to: {out_path}")


if __name__ == "__main__":
    main()
