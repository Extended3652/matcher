from pathlib import Path

p = Path("options.js")
s = p.read_text(encoding="utf-8")

has_load_fn = "function load(" in s
has_init_fn = "function init(" in s
has_load_call = "load();" in s
has_init_call = "init();" in s

print("has_load_fn:", has_load_fn)
print("has_init_fn:", has_init_fn)
print("has_load_call:", has_load_call)
print("has_init_call:", has_init_call)

if has_load_fn:
    print("OK: function load() exists. No change needed.")
    raise SystemExit(0)

if not has_load_call:
    print("Did not find load(); call. Not changing anything.")
    raise SystemExit(0)

if has_init_fn:
    # Replace only the last occurrence of load(); to avoid touching any other text.
    idx = s.rfind("load();")
    if idx == -1:
        print("Unexpected: rfind failed.")
        raise SystemExit(1)
    s2 = s[:idx] + "init();" + s[idx + len("load();"):]
    p.write_text(s2, encoding="utf-8")
    print("Patched: replaced final load(); with init();")
    raise SystemExit(0)

print("No function load() and no function init(). Need manual fix.")
raise SystemExit(2)
