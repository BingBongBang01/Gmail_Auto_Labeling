# analyze_gmail_features.py
import re
import os

bg_path = r"c:\Users\thk\Documents\GitHub\Gmail_Auto_Labeling\Gmaillabeler\background.js"
with open(bg_path, "r", encoding="utf-8") as f:
    bg_code = f.read()

# Find major comments or sections in background.js
print("=== Major Sections in background.js ===")
for match in re.finditer(r'//\s*[-=]{5,}\s*([^\n]+)', bg_code):
    print(f"- {match.group(1).strip()}")

# Find all async functions and top-level functions in background.js
print("\n=== Functions in background.js ===")
funcs = re.findall(r'^(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(', bg_code, re.M)
print(f"Total functions in background.js: {len(funcs)}")
for i in range(0, len(funcs), 4):
    print(", ".join(funcs[i:i+4]))

# Find message actions in background.js
print("\n=== Message Handlers in background.js (request.action) ===")
actions = re.findall(r'request\.action\s*===\s*["\']([^"\']+)["\']', bg_code)
for a in set(actions):
    print(f"- {a}")
