import re
from pathlib import Path

p = Path("options.html")
s = p.read_text(encoding="utf-8")

# Inject CSS once
if "client-box-header" not in s:
  css = """
<style>
/* Add Client section: clear delineation between Header vs Mentions */
.client-box{
  border:1px solid #d9d9d9;
  border-radius:10px;
  padding:12px 14px;
  margin:12px 0;
}
.client-box-title{
  font-weight:700;
  color:#222;
  margin:0 0 10px 0;
}
.client-box-header{ background:#f7fbff; }
.client-box-mentions{ background:#fbfbfb; }
.client-box .hint{
  font-size:12px;
  color:#666;
  margin-top:-6px;
  margin-bottom:10px;
}
</style>
"""
  if "</head>" not in s:
    raise SystemExit("options.html missing </head>, aborting.")
  s = s.replace("</head>", css + "\n</head>")

# Prevent double-wrapping
if "data-add-client-boxes" in s:
  print("Add Client boxes already present, no changes made.")
  p.write_text(s, encoding="utf-8")
  raise SystemExit(0)

# Open Header box before Client Name label (fallback: before newClientPattern input)
m_client_label = re.search(r'(\s*<label[^>]*>\s*Client Name\s*</label>\s*)', s, flags=re.I)
m_client_input = re.search(r'(\s*<input[^>]*\bid="newClientPattern"\b[^>]*>\s*)', s, flags=re.I)

header_open = """
<div class="client-box client-box-header" data-add-client-boxes="1">
  <div class="client-box-title">Header (CMS header)</div>
  <div class="hint">These settings affect the client name shown in the CMS header.</div>
"""

if m_client_label:
  s = s[:m_client_label.start()] + header_open + s[m_client_label.start():]
elif m_client_input:
  s = s[:m_client_input.start()] + header_open + s[m_client_input.start():]
else:
  raise SystemExit("Could not find Client Name label or newClientPattern input to anchor header box.")

# Start Mentions box at existing Mentions section title or Mentions: Category label
m_mentions_title = re.search(r'\s*<div\s+class="client-section-title">\s*Mentions\s*\(review/body content\)\s*</div>\s*', s, flags=re.I)
m_mentions_label = re.search(r'(\s*<label[^>]*>\s*Mentions:\s*Category\s*</label>\s*)', s, flags=re.I)

mentions_open = """
</div>

<div class="client-box client-box-mentions">
  <div class="client-box-title">Mentions (review/body content)</div>
  <div class="hint">These settings affect highlights inside the review/body text (not the CMS header).</div>
"""

if m_mentions_title:
  s = s[:m_mentions_title.start()] + mentions_open + s[m_mentions_title.end():]
elif m_mentions_label:
  s = s[:m_mentions_label.start()] + mentions_open + s[m_mentions_label.start():]
else:
  raise SystemExit("Could not find Mentions title or Mentions: Category label to anchor mentions box.")

# Close Mentions box right before the Add Client button
m_btn = re.search(r'(\s*<button[^>]*\bid="btnAddClient"\b[^>]*>)', s, flags=re.I)
if not m_btn:
  raise SystemExit('Could not find id="btnAddClient" to close mentions box.')

s = s[:m_btn.start()] + "\n</div>\n\n" + s[m_btn.start():]

p.write_text(s, encoding="utf-8")
print("Patched Add Client section into Header + Mentions boxes.")
