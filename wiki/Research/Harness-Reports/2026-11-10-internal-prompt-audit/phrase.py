#!/usr/bin/env python3
"""Count runs (per family) whose think-turn requests contain each internal phrase,
and what the model did on the first turn that carried it. Zero-token."""
import json, os, re, sys
from collections import defaultdict, Counter

PHRASES = {
    # source file : phrase marker
    "conversation-assembly.ts:256 finish nudge (no contract)": "You have tool results above",
    "conversation-assembly.ts REQUIRED_TOOLS_SATISFIED finish nudge": "Required tool calls are satisfied",
    "conversation-assembly.ts:204 must-still-call": "You must still call:",
    "conversation-assembly.ts:282 retry wrong tool name": "retry with the correct tool name shown in the system prompt",
    "guidance-channel.ts:171 requiredToolsPending": "REQUIRED tools not yet called",
    "guidance-channel.ts:153 loopDetected": "Loop detected: you are repeating",
    "guidance-channel.ts:184 evidenceGap": "claims not supported by tool results",
    "exit-gate.ts:545 deny": "Not finished yet. Still outstanding",
    "exit-gate.ts answer-turn variant": "Tools are not available on this turn: write the answer now",
    "standing-frame.ts:269 outstanding tail": "Outstanding requirements:",
    "standing-frame.ts withheld tail": "Requirements not yet satisfied:",
    "adapter.ts local continuationHint": "Your next step: call",
    "adapter.ts mid continuationHint": "Still needed:",
    "adapter.ts default continuationHint": "Call the next required tool now",
    "adapter.ts local qualityCheck": "Review your answer: does it fully address the task",
    "adapter.ts default qualityCheck": "Before giving your final answer, verify",
    "adapter.ts local errorRecovery (args)": "rejected its arguments",
    "adapter.ts local errorRecovery (generic)": "If the error points at an argument, fix it",
    "LEGACY recovery (removed)": "Try an alternative approach or use a different tool",
    "tool-observe.ts recovery suffix": "[Recovery guidance:",
    "think-guards.ts:200 not done yet": "Not done yet — you still need to call",
    "think-guards.ts:258 missing steps": "Not done yet — missing steps",
    "think-guards.ts:397 files not written": "not written yet",
    "think-guards.ts:458 diminishing returns": "diminishing returns",
    "unresolved-tool-call.ts:79 plain prose": "tool-call text that could not be executed",
    "unresolved-tool-call.ts:242 withheld call": "called a tool on a turn where tools were not available",
    "dispatch-think-response.ts:461 abstain": "You have not yet attempted the tools needed",
    "checklist-reminder.ts:33": "keep your todo list current",
    "checklist-reminder.ts:73": "Mark finished items done",
    "environment-update": "Environment update since your last turn",
    "recovery required (arbitrator/loop)": "Recovery required:",
    "dup gather": "Duplicate gather detected",
    "stall-deliverable.ts:79 escalation": "despite",
    "turn-guard-operations.ts:792 MUST call": "You MUST call",
    "STORED overflow marker": "[STORED:",
    "plan posture": "Planning only:",
}

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

runs = defaultdict(lambda: {"model": None, "turns": []})
for path in files(sys.argv[1:]):
    with open(path, errors="replace") as fh:
        for line in fh:
            if '"llm-exchange"' not in line or '"requestKind":"stream"' not in line:
                continue
            try:
                e = json.loads(line)
            except Exception:
                continue
            r = runs[e["runId"]]
            r["model"] = r["model"] or e.get("model")
            msgs = e.get("messages") or []
            whole = "\n".join(text_of(m.get("content")) for m in msgs)
            resp = e.get("response") or {}
            r["turns"].append((whole, bool(resp.get("toolCalls")), len(e.get("toolSchemaNames") or [])))

tbl = defaultdict(Counter)
famruns = Counter()
for rid, r in runs.items():
    fam = family(r["model"])
    if fam == "test":
        continue
    famruns[fam] += 1
    for label, ph in PHRASES.items():
        for whole, called, ntools in r["turns"]:
            if ph in whole:
                tbl[label][fam] += 1
                tbl[label]["_total"] += 1
                if called:
                    tbl[label]["_nextCalled"] += 1
                elif ntools:
                    tbl[label]["_nextEnded"] += 1
                break

print("runs per family:", dict(famruns))
for label, ph in PHRASES.items():
    c = tbl.get(label, Counter())
    fams = {k: v for k, v in c.items() if not k.startswith("_")}
    print(f"{label} | runs={c['_total']} | firstTurnCalled={c['_nextCalled']} ended={c['_nextEnded']} | {dict(sorted(fams.items()))}")
