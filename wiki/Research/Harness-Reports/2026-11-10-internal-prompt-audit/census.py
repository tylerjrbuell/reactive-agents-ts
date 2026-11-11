#!/usr/bin/env python3
"""Zero-token prompt-surface census over RA trace JSONL.

Usage: python3 census.py <dir-or-file>... > out.json
"""
import json, os, re, sys, difflib
from collections import defaultdict, Counter

def files(paths):
    for p in paths:
        if os.path.isfile(p):
            yield p
        else:
            for root, _, fs in os.walk(p):
                for f in fs:
                    if f.endswith(".jsonl"):
                        yield os.path.join(root, f)

def family(model):
    m = (model or "").lower()
    for k, fam in [("claude", "anthropic"), ("haiku", "anthropic"), ("sonnet", "anthropic"), ("opus", "anthropic"),
                   ("gpt", "openai"), ("o3", "openai"), ("o4", "openai"),
                   ("gemini", "gemini"), ("gemma", "gemma"), ("grok", "xai"),
                   ("qwen", "qwen"), ("cogito", "cogito"), ("llama", "llama"), ("mimo", "mimo"),
                   ("deepseek", "deepseek"), ("mistral", "mistral"), ("granite", "granite"),
                   ("phi", "phi"), ("bonsai", "bonsai"), ("test", "test"), ("mock", "test"), ("scenario", "test")]:
        if k in m:
            return fam
    return "other:" + m[:20]

def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out = []
        for p in content:
            if isinstance(p, dict):
                out.append(p.get("text") or "")
            elif isinstance(p, str):
                out.append(p)
        return "".join(out)
    return ""

MENU = re.compile(r"(which (of these|one|would you)|would you like|do you want me|let me know (if|which|what)|shall i|should i (proceed|start)|what would you like|how would you like|please (specify|clarify|confirm|provide))", re.I)
ARG_ERR = re.compile(r"missing required parameter|unknown parameter|invalid (argument|parameter|input)|expected \w+, got|input validation error|invalid uuid|Unknown action", re.I)
GENERIC_RECOVERY = re.compile(r"Try an alternative approach or use a different tool", re.I)
NARRATION = re.compile(r"^(i will|i'll|let me|now i|first,? i|next,? i|i need to|i am going to|i'm going to)", re.I)

runs = {}
def run(rid):
    if rid not in runs:
        runs[rid] = {"model": None, "provider": None, "tier": None, "origin": None, "file": None,
                     "think": [], "toolEnds": [], "status": None, "terminatedBy": None, "output": None,
                     "signals": [], "guards": Counter()}
    return runs[rid]

for path in files(sys.argv[1:]):
    try:
        fh = open(path, "r", errors="replace")
    except OSError:
        continue
    with fh:
        for line in fh:
            if '"kind"' not in line:
                continue
            try:
                e = json.loads(line)
            except Exception:
                continue
            k = e.get("kind"); rid = e.get("runId")
            if not rid:
                continue
            r = run(rid)
            if r["file"] is None:
                r["file"] = path
            if k == "run-started":
                r["model"] = e.get("model"); r["provider"] = e.get("provider"); r["origin"] = e.get("origin")
            elif k == "projection-rendered":
                r["tier"] = r["tier"] or e.get("tier")
            elif k == "llm-exchange":
                if r["model"] is None:
                    r["model"] = e.get("model"); r["provider"] = e.get("provider")
                if not (e.get("purpose") == "think" or e.get("requestKind") == "stream"):
                    continue
                msgs = e.get("messages") or []
                last_user = ""
                for m in reversed(msgs):
                    if m.get("role") == "user":
                        last_user = text_of(m.get("content")); break
                guidance = []
                gi = last_user.find("Guidance:\n")
                if gi >= 0:
                    for ln in last_user[gi + 10:].split("\n"):
                        if ln.startswith("- "):
                            guidance.append(ln[2:])
                        elif ln.strip() == "":
                            continue
                        else:
                            break
                resp = e.get("response") or {}
                r["think"].append({
                    "iter": e.get("iter"),
                    "sys": len(e.get("systemPrompt") or ""),
                    "sysText": e.get("systemPrompt") or "",
                    "msgChars": sum(len(text_of(m.get("content"))) for m in msgs),
                    "nMsgs": len(msgs),
                    "tools": e.get("toolSchemaNames") or [],
                    "guidance": guidance,
                    "tailHasOutstanding": "Outstanding requirements:" in last_user,
                    "content": resp.get("content") or "",
                    "toolCalls": [tc.get("name") for tc in (resp.get("toolCalls") or []) if isinstance(tc, dict)],
                    "tokensIn": resp.get("tokensIn"), "tokensOut": resp.get("tokensOut"),
                })
            elif k == "tool-call-end":
                r["toolEnds"].append({"tool": e.get("toolName"), "ok": e.get("ok"), "error": e.get("error") or ""})
            elif k == "run-completed":
                r["status"] = e.get("status"); r["terminatedBy"] = e.get("terminatedBy"); r["output"] = e.get("output") or ""
            elif k == "harness-signal-injected":
                r["signals"].append(e.get("origin"))
            elif k == "guard-fired":
                r["guards"][f'{e.get("guard")}:{e.get("outcome")}'] += 1

META = {"brief", "find", "recall", "final-answer", "todo", "discover-tools", "activate-skill", "pulse", "checkpoint", "get-skill-section"}

agg = defaultdict(lambda: Counter())
sizes = defaultdict(list)
examples = defaultdict(list)
for rid, r in runs.items():
    if not r["think"]:
        continue
    fam = family(r["model"])
    a = agg[fam]
    a["runs"] += 1
    a["thinkTurns"] += len(r["think"])
    t0 = r["think"][0]
    sizes[(fam, r["tier"] or "?")].append((t0["sys"], len(t0["tools"]), t0["msgChars"]))
    # guidance accounting
    for t in r["think"]:
        if t["guidance"]:
            a["turnsWithGuidance"] += 1
        for g in t["guidance"]:
            key = g[:48]
            agg["__guidance_lines__"][key] += 1
        if t["tailHasOutstanding"]:
            a["turnsWithOutstandingTail"] += 1
    # menu-back: final think turn, no tool call, tools offered, question-shaped, no non-meta tool ran OK
    last = r["think"][-1]
    nonmeta_ok = [x for x in r["toolEnds"] if x["ok"] and x["tool"] not in META]
    if last["tools"] and not last["toolCalls"] and (MENU.search(last["content"][-600:]) or last["content"].rstrip().endswith("?")):
        a["menuBackFinal"] += 1
        if not nonmeta_ok:
            a["menuBackNoWork"] += 1
            if len(examples[("menu", fam)]) < 6:
                examples[("menu", fam)].append(rid)
    # required-tools guidance ignored on the following turn
    for i, t in enumerate(r["think"][:-0 or None]):
        for g in t["guidance"]:
            m = re.match(r"REQUIRED tools not yet called: (.+?)\. Call these", g)
            if m:
                a["reqGuidanceTurns"] += 1
                req = {x.strip() for x in m.group(1).split(",")}
                called = set(t["toolCalls"])
                if not (req & called):
                    a["reqGuidanceIgnored"] += 1
                    if len(examples[("reqIgnored", fam)]) < 6:
                        examples[("reqIgnored", fam)].append(rid)
            if g.startswith("Loop detected"):
                a["loopGuidanceTurns"] += 1
                nxt = r["think"][i + 1] if i + 1 < len(r["think"]) else None
                if nxt is not None and nxt["toolCalls"] and nxt["toolCalls"] == t["toolCalls"]:
                    a["loopGuidanceIgnored"] += 1
    # repeated narration across consecutive think turns
    for p, q in zip(r["think"], r["think"][1:]):
        if len(p["content"]) > 80 and len(q["content"]) > 80:
            if difflib.SequenceMatcher(None, p["content"][:800], q["content"][:800]).quick_ratio() > 0.9 and \
               difflib.SequenceMatcher(None, p["content"][:800], q["content"][:800]).ratio() > 0.9:
                a["repeatedNarration"] += 1
                if len(examples[("narr", fam)]) < 6:
                    examples[("narr", fam)].append(rid)
    for t in r["think"]:
        if t["toolCalls"] and NARRATION.match(t["content"].strip()):
            a["narrateThenCall"] += 1
        if not t["toolCalls"] and t["tools"] and NARRATION.match(t["content"].strip()) and len(t["content"]) < 400:
            a["narrateNoCall"] += 1
            if len(examples[("narrNoCall", fam)]) < 6:
                examples[("narrNoCall", fam)].append(rid)
    # argument errors / generic recovery text
    for x in r["toolEnds"]:
        if x["ok"] is False:
            a["toolErrors"] += 1
            if ARG_ERR.search(x["error"]):
                a["argErrors"] += 1
                if len(examples[("arg", fam)]) < 6:
                    examples[("arg", fam)].append(rid)
            if GENERIC_RECOVERY.search(x["error"]):
                a["genericRecoveryOnErr"] += 1
                if ARG_ERR.search(x["error"]):
                    a["genericRecoveryOnArgErr"] += 1
    if r["status"]:
        a["status:" + str(r["status"])] += 1

def pct(xs, q):
    xs = sorted(xs)
    if not xs:
        return None
    return xs[min(len(xs) - 1, int(q * len(xs)))]

out = {
    "runs": len(runs),
    "families": {k: dict(v) for k, v in agg.items() if k != "__guidance_lines__"},
    "guidanceLines": agg["__guidance_lines__"].most_common(40),
    "turn0Sizes": {f"{fam}|{tier}": {"n": len(v), "sysP50": pct([x[0] for x in v], .5), "sysP90": pct([x[0] for x in v], .9),
                                       "toolsP50": pct([x[1] for x in v], .5), "toolsMax": max(x[1] for x in v),
                                       "msgP50": pct([x[2] for x in v], .5)} for (fam, tier), v in sizes.items()},
    "examples": {f"{k[0]}|{k[1]}": v for k, v in examples.items()},
}
json.dump(out, sys.stdout, indent=1)
