#!/usr/bin/env python3
"""Pick turn-0 think exchanges per model; print system-prompt section skeleton + sizes."""
import json, os, sys, re
from collections import defaultdict

def files(paths):
    for p in paths:
        for root, _, fs in os.walk(p):
            for f in fs:
                if f.endswith(".jsonl"):
                    yield os.path.join(root, f)

per = defaultdict(list)
tiers = {}
for path in files(sys.argv[1:]):
    with open(path, errors="replace") as fh:
        for line in fh:
            if '"projection-rendered"' in line:
                try:
                    e = json.loads(line)
                    tiers.setdefault(e["runId"], e.get("tier"))
                except Exception:
                    pass
                continue
            if '"llm-exchange"' not in line or '"requestKind":"stream"' not in line:
                continue
            try:
                e = json.loads(line)
            except Exception:
                continue
            if e.get("iter") != 0:
                continue
            per[e.get("model")].append((e["runId"], e.get("systemPrompt") or "", e.get("toolSchemaNames") or [], e.get("messages") or [], e.get("systemPromptTruncated")))

def skeleton(sp):
    heads = []
    for ln in sp.split("\n"):
        if re.match(r"^(Environment:|You are|Available Tools|Required tools|Other available|Skills:|## |Goal:|RULES:|Tool index|Tools you|<|Prior context|Outstanding|# )", ln):
            heads.append(ln[:70])
    return heads

want = sys.argv[1:] and None
for model, xs in sorted(per.items(), key=lambda kv: -len(kv[1])):
    if len(xs) < 2:
        continue
    lens = sorted(len(x[1]) for x in xs)
    print(f"=== {model}  n={len(xs)}  sys p50={lens[len(lens)//2]} min={lens[0]} max={lens[-1]}  tier={tiers.get(xs[0][0])}")
    # show smallest + median skeleton
    xs_sorted = sorted(xs, key=lambda x: len(x[1]))
    for label, x in (("min", xs_sorted[0]), ("p50", xs_sorted[len(xs_sorted)//2])):
        print(f"  [{label}] run={x[0]} tools={len(x[2])} trunc={x[4]}")
        for h in skeleton(x[1]):
            print("     |", h)
