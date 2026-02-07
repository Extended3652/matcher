import re
from pathlib import Path

p = Path("options.js")
s = p.read_text(encoding="utf-8")

if re.search(r'\bfunction\s+load\s*\(', s):
    print("load() already exists, not patching.")
    raise SystemExit(0)

m_call = list(re.finditer(r'^\s*load\(\);\s*$', s, flags=re.M))
if not m_call:
    print("Did not find a standalone load(); call. Not patching.")
    raise SystemExit(2)

insert_at = m_call[-1].start()

load_fn = r'''
  // ---------------------------------------------------------------------------
  // Load
  // ---------------------------------------------------------------------------
  function load() {
    chrome.storage.local.get(["dictionary"], (result) => {
      currentDict = result.dictionary || { ignoreList: [], categories: [], clients: [] };
      if (!Array.isArray(currentDict.ignoreList)) currentDict.ignoreList = [];
      if (!Array.isArray(currentDict.categories)) currentDict.categories = [];
      if (!Array.isArray(currentDict.clients)) currentDict.clients = [];

      renderIgnoreList();
      renderClients();
      renderCategories();
    });
  }

'''

# If saveDictionary is ALSO missing (rare), add it too.
if not re.search(r'\bfunction\s+saveDictionary\s*\(', s):
    load_fn += r'''
  function saveDictionary(msg) {
    chrome.storage.local.set({ dictionary: currentDict }, () => {
      if (msg) showMsg(msg, "success");
    });
  }

'''

s2 = s[:insert_at] + load_fn + s[insert_at:]
p.write_text(s2, encoding="utf-8")
print("Inserted load() (and saveDictionary if missing) right before the final load(); call.")
