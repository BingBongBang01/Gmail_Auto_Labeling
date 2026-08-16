# extract_gmail_details.py
import re

with open(r"c:\Users\thk\Documents\GitHub\Gmail_Auto_Labeling\Gmaillabeler\background.js", "r", encoding="utf-8") as f:
    code = f.read()

# Let's inspect major groups of functions
# 1. Gmail API / REST interactions:
print("=== Gmail API Calls (gmailFetch) ===")
for match in re.finditer(r'gmailFetch\((.*?)\)', code):
    print(match.group(0)[:120])

# 2. Content scripts interactions:
print("\n=== Content scripts (content/ directory) ===")
for fname in ["content_main.js", "ui_detail_card.js", "ui_list_badge.js"]:
    p = rf"c:\Users\thk\Documents\GitHub\Gmail_Auto_Labeling\Gmaillabeler\content\{fname}"
    with open(p, "r", encoding="utf-8") as f:
        c = f.read()
        print(f"\n--- {fname} ({len(c)} bytes) ---")
        lines = c.splitlines()
        for line in lines[:25]:
            print(line)
