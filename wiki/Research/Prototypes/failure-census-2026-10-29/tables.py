#!/usr/bin/env python3
"""Render markdown tables from out/summary.json + out/runs.jsonl (run census.py first)."""
import json, os, collections, sys
d = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
s = json.load(open(d + "/summary.json"))
rs = [json.loads(l) for l in open(d + "/runs.jsonl")]
n = len(rs)
print(f"## Flag x model (real runs, n={n})\n")
print("| rule | FM / proposal | cluster | runs | % | by model (top) | examples |\n|---|---|---|---|---|---|---|")
for k, v in sorted(s["byFlag"]["real"].items(), key=lambda kv: -kv[1]["runs"]):
    if v["runs"]:
        bm = ", ".join(f"{m} {c}" for m, c in list(v["byModel"].items())[:4])
        print(f"| {k} | {v['fm']} | {v['cluster']} | {v['runs']} | {v['pct']} | {bm} | {', '.join(v['examples'][:2])} |")
print("\n## Per-origin signal effectiveness (real)\n")
print("| origin | opened | rendered | never rendered | no signalId | effects |\n|---|---|---|---|---|---|")
for o, c in s["signalEffectiveness"]["real"].items():
    ef = {k[7:]: v for k, v in c.items() if k.startswith("effect:")}
    print(f"| {o} | {c.get('opened',0)} | {c.get('rendered',0)} | {c.get('never_rendered',0)} | {c.get('no_id',0)} | {ef} |")
print("\n## Root mechanism x model (real)\n")
print("| root | runs | models |\n|---|---|---|")
for k, v in s["roots"]["real"].items():
    print(f"| {k} | {v} | {s['rootsByModel']['real'][k]} |")
