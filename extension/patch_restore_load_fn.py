from pathlib import Path

p = Path("options.js")
s = p.read_text(encoding="utf-8")

if "function load(" in s:
    print("load() already exists, not patching.")
    raise SystemExit(0)

marker = r"// ---------------------------------------------------------------------------\n    // Init"
idx = s.find(marker)
if idx == -1:
    print("Could not find Init marker block to insert before.")
    raise SystemExit(2)

load_fn = r'''
  // ---------------------------------------------------------------------------
  // Load / Save
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

  function saveDictionary(msg) {
    chrome.storage.local.set({ dictionary: currentDict }, () => {
      if (msg) showMsg(msg, "success");
    });
  }

'''

# If saveDictionary already exists elsewhere, do NOT duplicate it.
if "function saveDictionary(" in s:
    load_fn = load_fn.replace(load_fn.split("function saveDictionary",1)[0] + "function saveDictionary", "function saveDictionary")
    # remove the saveDictionary block entirely from load_fn
    # crude but safe: keep only load()
    load_only = r'''
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
    load_fn = load_only

s2 = s[:idx] + load_fn + s[idx:]
p.write_text(s2, encoding="utf-8")
print("Inserted load() function before Init.")
