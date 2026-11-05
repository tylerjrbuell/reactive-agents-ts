#!/usr/bin/env python3
"""Per-iteration tool-call drop audit for H3 trace dirs.

For each trace: per iteration, count native tool calls the model emitted
(llm-exchange response.toolCalls) against tool-call-start events the kernel
ran. Events are deduped by seq (timed-out cells write every event twice).

Usage: python3 -I call-drop-audit.py <trace-root> [task-substring]
Prints one line per trace: task/run, total emitted, total executed, and the
per-iteration emitted:executed pairs where they differ.
"""
import glob
import json
import os
import sys
from collections import defaultdict


def audit(path):
    ev = {}
    with open(path) as fh:
        for line in fh:
            if not line.strip():
                continue
            e = json.loads(line)
            ev.setdefault(e.get("seq"), e)
    emitted = defaultdict(int)
    executed = defaultdict(int)
    for k in sorted(x for x in ev if x is not None):
        e = ev[k]
        if e.get("kind") == "llm-exchange" and e.get("purpose") == "think":
            calls = (e.get("response") or {}).get("toolCalls") or []
            emitted[e.get("iter")] += len(calls)
        elif e.get("kind") == "tool-call-start":
            executed[e.get("iter")] += 1
    return emitted, executed


def main():
    root = sys.argv[1]
    sub = sys.argv[2] if len(sys.argv) > 2 else ""
    for f in sorted(glob.glob(os.path.join(root, "**", "*.jsonl"), recursive=True)):
        if sub and sub not in f:
            continue
        emitted, executed = audit(f)
        diffs = [
            f"it{i}:{emitted[i]}>{executed.get(i, 0)}"
            for i in sorted(emitted)
            if emitted[i] > executed.get(i, 0)
        ]
        rel = os.path.relpath(f, root)
        parts = rel.split(os.sep)
        label = "/".join(parts[-3:-1]) if len(parts) >= 3 else rel
        print(f"{label:28} emitted={sum(emitted.values()):3} executed={sum(executed.values()):3} drops={' '.join(diffs) or '-'}")


if __name__ == "__main__":
    main()
