#!/usr/bin/env python3
"""Per-think-turn census keyed on the guidance the turn carried.

For each think turn: which guidance kinds (by prefix) rode on it, whether the
model called a tool, ended (end_turn), and whether an end_turn text is a
menu/question back to the user. Grouped by model family.

Usage: python3 nudge.py <dir>...
"""
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
                   ("bonsai", "bonsai"), ("nemotron", "nemotron"), ("test", "test"), ("mock", "test")]:
        if k in m:
            return fam
    return "other"

def text_of(c):
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "".join((p.get("text") or "") if isinstance(p, dict) else str(p) for p in c)
    return ""

MENU = re.compile(r"(which (of these|one|would you)|would you like|do you want me|let me know|shall i|should i (proceed|start)|what would you like|how would you like|or i can)", re.I)

KINDS = [
    ("finish:no-contract", "You have tool results above"),
    ("finish:required-satisfied", "Required tool calls are satisfied"),
    ("must-still-call", "You must still call"),
    ("required-pending", "REQUIRED tools not yet called"),
    ("exit-gate-deny", "Not finished yet. Still outstanding"),
    ("env-update", "Environment update since your last turn"),
    ("recovery-required", "Recovery required"),
    ("loop", "Loop detected"),
    ("dup-gather", "Duplicate gather detected"),
    ("todo-plan", "Call todo to add each step"),
]

def kinds_of(lines):
    ks = set()
    for g in lines:
        hit = False
        for k, pre in KINDS:
            if pre in g:
                ks.add(k); hit = True
        if not hit:
            ks.add("other")
    return ks

runs = defaultdict(lambda: {"model": None, "think": [], "ok": 0, "origin": None})
for path in files(sys.argv[1:]):
    with open(path, errors="replace") as fh:
        for line in fh:
            if '"run-started"' in line:
                try:
                    e = json.loads(line); r = runs[e["runId"]]; r["model"] = e.get("model"); r["origin"] = e.get("origin")
                except Exception:
                    pass
                continue
            if '"llm-exchange"' not in line or '"requestKind":"stream"' not in line:
                continue
            try:
                e = json.loads(line)
            except Exception:
                continue
            r = runs[e["runId"]]
            r["model"] = r["model"] or e.get("model")
            msgs = e.get("messages") or []
            guidance = []
            for m in msgs[-2:]:
                t = text_of(m.get("content"))
                gi = t.find("Guidance:\n")
                if m.get("role") == "user" and gi >= 0:
                    guidance += [ln[2:] for ln in t[gi + 10:].split("\n") if ln.startswith("- ")]
            # whole-tail text for exit-gate denials (rendered as harness_signal steps, not Guidance)
            tail = " ".join(text_of(m.get("content")) for m in msgs[-3:])
            resp = e.get("response") or {}
            r["think"].append({"iter": e.get("iter"), "g": guidance, "tail": tail,
                               "calls": [t.get("name") for t in (resp.get("toolCalls") or []) if isinstance(t, dict)],
                               "stop": resp.get("stopReason"), "content": resp.get("content") or "",
                               "nTools": len(e.get("toolSchemaNames") or []),
                               "nToolMsgs": sum(1 for m in msgs if m.get("role") == "tool")})

table = defaultdict(Counter)
examples = defaultdict(list)
for rid, r in runs.items():
    fam = family(r["model"])
    for i, t in enumerate(r["think"]):
        ks = kinds_of(t["g"])
        if "Not finished yet. Still outstanding" in t["tail"]:
            ks.add("exit-gate-deny")
        if not ks:
            ks = {"none"}
        for k in ks:
            c = table[(fam, k)]
            c["turns"] += 1
            if t["calls"]:
                c["called"] += 1
            elif t["nTools"] > 0:
                c["endedWithToolsOffered"] += 1
                if MENU.search(t["content"][-500:]) or t["content"].rstrip().endswith("?"):
                    c["menuBack"] += 1
                    if len(examples[(fam, k)]) < 5:
                        examples[(fam, k)].append(f"{rid}@{t['iter']}")
                if k.startswith("finish") and t["nToolMsgs"] <= 1:
                    c["endedAfter<=1ToolResult"] += 1
            else:
                c["endedNoTools"] += 1

fams = sorted({f for f, _ in table})
for k in ["none"] + [k for k, _ in KINDS] + ["other"]:
    print(f"## {k}")
    for f in fams:
        c = table.get((f, k))
        if not c or f == "test":
            continue
        print(f"  {f:10s} turns={c['turns']:5d} called={c['called']:5d} ended(tools offered)={c['endedWithToolsOffered']:4d} menuBack={c['menuBack']:4d} ended<=1res={c['endedAfter<=1ToolResult']:4d} ex={examples.get((f, k), [])[:3]}")
