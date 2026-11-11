#!/usr/bin/env python3
"""Runs whose turn carrying the no-contract finish nudge ended (no tool call) after <=1 tool result.
Print family, run id, goal, the one tool called, and the ending text tail, for hand classification."""
import json, os, re, sys
from collections import defaultdict, Counter

def files(paths):
    for p in paths:
        for root, _, fs in os.walk(p):
            for f in fs:
                if f.endswith(".jsonl"):
                    yield os.path.join(root, f)

def family(model):
    m = (model or "").lower()
    for k, fam in [("claude", "anthropic"), ("gpt", "openai"), ("gemini", "gemini"), ("gemma", "gemma"),
                   ("grok", "xai"), ("qwen", "qwen"), ("cogito", "cogito"), ("llama", "llama"), ("mimo", "mimo"),
                   ("bonsai", "bonsai"), ("nemotron", "nemotron"), ("test", "test")]:
        if k in m:
            return fam
    return "other"

def text_of(c):
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "".join((p.get("text") or "") if isinstance(p, dict) else str(p) for p in c)
    return ""

MENU = re.compile(r"(which (of these|one|would you)|would you like|do you want me|let me know|shall i|what would you like|how would you like|or i can)", re.I)
seen = set()
rows = []
for path in files(sys.argv[1:]):
    with open(path, errors="replace") as fh:
        for line in fh:
            if '"llm-exchange"' not in line or '"requestKind":"stream"' not in line or "You have tool results above" not in line:
                continue
            try:
                e = json.loads(line)
            except Exception:
                continue
            if e["runId"] in seen:
                continue
            msgs = e.get("messages") or []
            last = text_of(msgs[-1].get("content")) if msgs else ""
            if "You have tool results above" not in last:
                continue
            seen.add(e["runId"])
            resp = e.get("response") or {}
            ntool = sum(1 for m in msgs if m.get("role") == "tool")
            called_tools = [text_of(m.get("content"))[:40] for m in msgs if m.get("role") == "assistant"]
            goal = ""
            sp = e.get("systemPrompt") or ""
            gi = sp.find("Goal: ")
            if gi >= 0:
                goal = sp[gi + 6: gi + 110].split("\n")[0]
            ended = not resp.get("toolCalls")
            rows.append((family(e.get("model")), e["runId"], e.get("iter"), ntool, ended,
                         bool(MENU.search((resp.get("content") or "")[-500:])), goal, " / ".join(called_tools)[:90],
                         (resp.get("content") or "").replace("\n", " ")[-160:]))

agg = defaultdict(Counter)
for fam, rid, it, nt, ended, menu, goal, ct, tail in rows:
    a = agg[fam]
    a["nudged"] += 1
    if ended:
        a["ended"] += 1
        if nt <= 1:
            a["ended<=1"] += 1
        if menu:
            a["endedMenu"] += 1
for fam, a in sorted(agg.items()):
    print(fam, dict(a))
print()
for r in rows:
    fam, rid, it, nt, ended, menu, goal, ct, tail = r
    if ended and nt <= 1 and fam in {"xai", "openai", "qwen", "gemma", "gemini", "anthropic", "cogito"}:
        print(f"{fam} {rid}@{it} tools={nt} menu={menu} goal={goal!r} calls={ct!r}\n    END: {tail!r}")
