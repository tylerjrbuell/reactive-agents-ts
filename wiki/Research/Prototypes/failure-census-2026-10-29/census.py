#!/usr/bin/env python3
"""Deterministic failure-mode classifier over Reactive Agents trace JSONL.

Usage:  python3 census.py [--out DIR] [--include-synthetic]
Reads every source in load.SOURCES (dedupes by runId), classifies each run with
rule-based flags over trace events (NO LLM), and writes:
  DIR/runs.jsonl     one feature/flag record per run
  DIR/summary.json   aggregates (flag x model, clusters, terminatedBy, tokens...)
Re-run any time; the rules are the only judgment, and they are listed in RULES.
"""
import argparse, collections, json, os, re, statistics, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load import iter_runs, is_real

META_TOOLS = {"todo", "final-answer", "recall", "find", "brief", "pulse", "context-status",
              "checkpoint", "discover-tools", "get-skill-section", "task-complete"}

# rule id -> (description, FM id or PROPOSED id, cluster, degrading?)
RULES = {
 "R01_shaped_toolcall_reprompt": ("unresolved-tool-call-guard fired (shape-reprompt/tools-withheld/terminated)", "FM-A2", "PROTOCOL", True),
 "R02_text_toolcall_in_content": ("llm reply carried a tool call as text/JSON in content, no native toolCalls", "FM-A2", "PROTOCOL", True),
 "R03_repeat_identical_call": (">=2 identical (tool,args) non-meta calls in one run", "FM-B1", "PROTOCOL", True),
 "R04_todo_add_repeat": ("todo action=add repeated (>=2 adds, or 'duplicate' skip result) instead of progressing", "P-FM-1", "PROTOCOL", True),
 "R05_no_progress_streak": (">=3 consecutive iterations evidenceDelta==0 with requirements outstanding", "FM-D1/FM-B2", "GUARD", True),
 "R06_low_delta_guard_terminal": ("low_delta_guard terminated the run", "FM-D2", "GUARD", True),
 "R07_stall_deliverable_terminal": ("stall_deliverable guard delivered a fallback", "P-FM-2", "FALLBACK", True),
 "R08_harness_synthesis_or_deliverable": ("terminatedBy harness_synthesis / harness_deliverable (fallback deliverable site)", "P-FM-2", "FALLBACK", True),
 "R09_verifier_success_mismatch": ("status=success but terminal verifier verified=false or a failed check; or failure with verified=true", "FM-E1", "VERIFY", True),
 "R10_continuation_intent_output": ("final output ends in future-tense intent ('I will now...') = not a deliverable", "P-FM-3", "FALLBACK", True),
 "R10b_continuation_verifier_missed": ("R10 hit while verifier check output-not-continuation-intent passed", "P-FM-3", "VERIFY", True),
 "R11_scaffold_leak_output": ("output contains harness scaffold/handoff/tool-error text", "FM-E2", "FALLBACK", True),
 "R12_htg_fired": ("head-truncation-guard fired", "FM-F1", "BUDGET", False),
 "R12b_htg_dropped_tools": ("head-truncation-guard dropped tool schemas", "P-FM-4", "BUDGET", True),
 "R12c_htg_small_prompt": ("head-truncation-guard fired on a prompt < 25% of num_ctx (output budget ate the window)", "P-FM-4", "BUDGET", True),
 "R13_strategy_switch": ("strategy switched mid-run", "FM-D2", "HISTORY", False),
 "R13b_switch_no_recover": ("strategy switched and run still ended failure/degraded", "FM-D2", "HISTORY", True),
 "R14_success_requirement_outstanding": ("status=success but last assessment requirementsOutstanding>0 / ledger requirement not satisfied", "P-FM-5", "VERIFY", True),
 "R15_todo_unfinished": ("todo/checklist items added, none ever closed (no done/inferred) by run end", "P-FM-1", "PROTOCOL", True),
 "R16_plan_only_violation": ("task says plan-only/do not carry out, but non-meta tool executed", "P-FM-6", "GUIDANCE", True),
 "R17_actreminder_premature_final": ("actReminder 'give final answer now' rendered while only meta-tools used and requirements outstanding", "P-FM-7", "GUIDANCE", True),
 "R18_guidance_stack_pileup": ("errorRecovery+loopDetected+requiredToolsPending rendered together", "P-FM-7", "GUIDANCE", True),
 "R19_tool_error_schema_arg": ("tool error: missing/unknown parameter, enum, unknown tool, invalid JSON args", "FM-A2/FM-B1", "PROTOCOL", True),
 "R19b_tool_error_env": ("tool error: ENOENT/path traversal/service down/exit code (environment, not protocol)", "FM-B1", "ENV", False),
 "R20_terminal_llm_error": ("terminatedBy llm_error", "-", "BUDGET", True),
 "R21_max_iterations_or_budget": ("terminatedBy max_iterations/budget_exceeded", "FM-B2/FM-D1", "BUDGET", True),
 "R22_abstained": ("terminatedBy abstained (honest give-up; often intentional probe)", "FM-E1", "FALLBACK", False),
 "R23_empty_output_success": ("success with empty/whitespace output", "FM-E1", "FALLBACK", True),
 "R24_window_numctx_mismatch": ("projection window != HTG num_ctx (budget resolvers disagree)", "P-FM-4", "BUDGET", True),
 "R25_arbitrator_gate_redirect": ("arbitrator applyGroundedTerminalGate redirected a terminal", "FM-D1", "GUARD", False),
 "R26_repeated_failure_guard": ("iterate-pass repeated-identical-failure signal", "FM-B1", "GUARD", False),
 "R27_no_run_completed": ("trace has no run-completed (crash / interrupted / still running)", "-", "ENV", False),
 "R28_compaction_or_truncation": ("compaction-marker / result-truncated seen (history replay lossy)", "FM-F1", "HISTORY", False),
 "R35_no_tool_engagement": ("failure with >=2 iterations and zero tool calls (model never engaged tools)", "FM-A1/FM-A2", "PROTOCOL", True),
 "R29_guidance_conflict_same_think": ("contradictory guidance co-rendered in one think (execute-vs-stop; tools dropped while tool required; plan-only vs go/stop nudge)", "P-FM-7", "GUIDANCE", True),
 "R30_signal_never_rendered": ("harness signal opened but never rendered into any prompt (silent)", "P-FM-8", "GUIDANCE", False),
 "R31_signal_unclassified": ("signal-effect ambiguous/unobserved (instrumentation gap)", "P-FM-8", "GUIDANCE", False),
 "R32_signal_ignored_or_contradicted": ("rendered signal ignored/contradicted by the model", "P-FM-8", "GUIDANCE", True),
 "R33_signal_without_id": ("harness-signal-injected without signalId (older emitter; effect untraceable)", "P-FM-8", "GUIDANCE", False),
 "R34_called_tool_not_visible": ("model called a tool absent from every tool-surface-resolved.visible", "FM-A2", "PROTOCOL", True),
}

LAST_INTENT_RE = re.compile(r"^(?:\W*)(?:(?:Now|Next|Then|First|Okay|OK),?\s+)?(?:I(?:'ll| will| am going to| shall)\b|Let me\b(?! know)|Let's\b)", re.I)
CONT_RE = re.compile(r"(\bI(?:'ll| will| am going to| shall)\s+(?:now |next |then |proceed to )?\w+|\b(?:Let me|Let's)\s+(?:now |first )?\w+|\b(?:Next|Now|Then),?\s+I(?:'ll| will)\b)", re.I)
SCAFFOLD_RE = re.compile(r"Strategy Switch Handoff|Previous strategy:|\[Tool error|Recovery guidance|head-truncation-guard|pendingGuidance|Guidance:|<tool_call>|\"tool_calls\"|harness_|\[harness", re.I)
TOOLJSON_RE = re.compile(r"[\"']?(?:name|tool|function)[\"']?\s*:\s*[\"']([\w\-/]+)[\"'][^{}]{0,80}[\"']?(?:arguments|args|parameters|input)[\"']?\s*:", re.S)
PLAN_ONLY_RE = re.compile(r"plan first and do not carry out|do not (?:carry out|execute|perform) any step|plan[- ]only", re.I)
ERR_SCHEMA = re.compile(r"Missing required parameter|Unknown parameter|must be one of|not found\. Available tools|Tool \"[^\"]+\" not found|invalid (?:json|argument)|Parameter \"", re.I)
ERR_ENV = re.compile(r"ENOENT|EISDIR|EACCES|Path traversal|not running|failed with exit|Refusing to write|timed out|ECONN|401|403|404|rate limit", re.I)


def err_class(txt):
    t = txt or ""
    if re.search(r"Missing required parameter", t): return "missing-required-param"
    if re.search(r"Unknown parameter", t): return "unknown-param-name"
    if re.search(r"must be one of", t): return "enum-violation"
    if re.search(r"not found\. Available tools|Tool \"[^\"]+\" not found", t): return "hallucinated-tool-name"
    if re.search(r"Refusing to write", t): return "write-guard-refusal(invalid-content)"
    if re.search(r"ENOENT|EISDIR", t): return "path-not-found"
    if re.search(r"Path traversal", t): return "path-traversal-block"
    if re.search(r"not running|ECONN|timed out", t): return "service-unavailable"
    if re.search(r"failed with exit", t): return "cli-exit-nonzero"
    if re.search(r"Sub-agent", t): return "subagent-failed"
    return "other"


PII_RE = re.compile(r"\+?\d{10,}")


def redact(t):
    return PII_RE.sub("<redacted-number>", t) if isinstance(t, str) else t


def canon(a):
    try: return json.dumps(a, sort_keys=True)
    except Exception: return str(a)


def tier_of(evs, provider):
    for e in evs:
        if e["kind"] == "entropy-scored" and e.get("modelTier"): return e["modelTier"]
        if e["kind"] == "projection-rendered" and e.get("tier"): return e["tier"]
    return "local" if provider == "ollama" else ("frontier" if provider else "unknown")


# Root-mechanism assignment: UPSTREAM mechanisms win over downstream symptoms.
# order matters; first matching rule is the root, the rest become symptoms.
ROOT_ORDER = [
 ("R16_plan_only_violation", "GUIDANCE/posture: plan-only instruction not enforced (tools executed)"),
 ("R29_guidance_conflict_same_think", "GUIDANCE: contradictory signals co-rendered"),
 ("R12c_htg_small_prompt", "BUDGET: output budget vs num_ctx resolver (small prompt lost tools)"),
 ("R24_window_numctx_mismatch", "BUDGET: window/num_ctx resolvers disagree"),
 ("R12b_htg_dropped_tools", "BUDGET: tool surface shrunk by head-truncation-guard"),
 ("R01_shaped_toolcall_reprompt", "PROTOCOL: tool call emitted as text/shape (healing/reprompt path)"),
 ("R02_text_toolcall_in_content", "PROTOCOL: tool call emitted as text/shape (healing/reprompt path)"),
 ("R34_called_tool_not_visible", "PROTOCOL: model called a tool not on the surface"),
 ("R19_tool_error_schema_arg", "PROTOCOL: arg/schema errors (param names, required, enum, unknown tool)"),
 ("R04_todo_add_repeat", "PROTOCOL/bookkeeping: model-owned todo/checklist (add repeated, never closed)"),
 ("R15_todo_unfinished", "PROTOCOL/bookkeeping: model-owned todo/checklist (add repeated, never closed)"),
 ("R03_repeat_identical_call", "PROTOCOL: identical call repeated (no state change fed back)"),
 ("R35_no_tool_engagement", "TOOL-ENGAGEMENT: zero tool calls over >=2 iterations (FM-A1/A2)"),
 ("R13b_switch_no_recover", "HISTORY: strategy switch did not recover"),
 ("R05_no_progress_streak", "GUARD: no-progress loop reached a guard"),
 ("R17_actreminder_premature_final", "GUIDANCE: 'give final answer now' before any evidence tool"),
 ("R18_guidance_stack_pileup", "GUIDANCE: error+loop+required-tools stack in one think"),
 ("R21_max_iterations_or_budget", "BUDGET: iteration/token cap hit"),
 ("R20_terminal_llm_error", "PROVIDER: llm_error"),
 ("R07_stall_deliverable_terminal", "FALLBACK-DELIVERABLE: stall guard fallback"),
 ("R08_harness_synthesis_or_deliverable", "FALLBACK-DELIVERABLE: harness synthesis/deliverable"),
 ("R10_continuation_intent_output", "FALLBACK-DELIVERABLE: continuation sentence delivered as answer"),
 ("R11_scaffold_leak_output", "FALLBACK-DELIVERABLE: scaffold text delivered"),
 ("R23_empty_output_success", "FALLBACK-DELIVERABLE: empty output marked success"),
 ("R14_success_requirement_outstanding", "VERIFY/terminal: success with requirement outstanding"),
 ("R09_verifier_success_mismatch", "VERIFY/terminal: status vs verifier disagree"),
 ("R22_abstained", "ABSTAIN: honest give-up"),
]


def root_cause(out, f):
    hits = [(k, d) for k, d in ROOT_ORDER if k in f]
    degraded = out["status"] == "failure" or any(RULES[k][3] for k in f if k in RULES)
    if not hits:
        return (("UNCLASSIFIED: failed with no rule hit (instrument gap)" if out["status"] == "failure" else None), [])
    return hits[0][1], [k for k, _ in hits[1:]]


def chain(r):
    """Causal chain text: saw -> did -> harness acted -> delivered."""
    f = r["flags"]
    saw = "tools=%s; guidance=%s" % (r.get("surfaceFirst"), ",".join(r.get("pgKeys") or []) or "none")
    did = "calls=%d (errors %s); iters=%s" % (r["toolCalls"], r["toolErrors"] or "none", r["iterations"])
    acted = "guards=%s; signals=%s" % (r["guards"] or "none", [(x["origin"].split("/")[-1], x["effect"]) for x in r["signals"]] or "none")
    deliv = "%s/%s: %s" % (r["status"], r["terminatedBy"], (r["output"] or "")[-160:].replace("\n", " "))
    return "- **%s** `%s` (%s) ROOT=%s | symptoms=%s\n  - saw: %s\n  - did: %s\n  - harness: %s\n  - delivered: %s" % (
        r["runId"], r["model"], r["source"], r["root"], r["symptoms"], saw, did, acted, deliv)


def classify(src, path, rid, evs):
    rs = next((e for e in evs if e["kind"] == "run-started"), {})
    rc = next((e for e in reversed(evs) if e["kind"] == "run-completed"), None)
    model, provider, task = rs.get("model"), rs.get("provider"), rs.get("task") or ""
    f = {}
    out = {"runId": rid, "source": src, "path": path, "model": model, "provider": provider,
           "tier": tier_of(evs, provider), "real": is_real(model, provider), "task": redact(task[:160]),
           "status": rc.get("status") if rc else None, "terminatedBy": rc.get("terminatedBy") if rc else None,
           "tokens": rc.get("totalTokens") if rc else None, "durationMs": rc.get("durationMs") if rc else None,
           "output": redact((rc.get("output") or "")[:600]) if rc else None}
    output = (rc.get("output") if rc else "") or ""
    snaps = [e for e in evs if e["kind"] == "kernel-state-snapshot"]
    out["iterations"] = max([e.get("iter", 0) for e in snaps] or [0])
    exch = [e for e in evs if e["kind"] == "llm-exchange"]
    out["llmCalls"] = len(exch)

    # --- tool calls
    calls = [e for e in evs if e["kind"] == "tool-call-end"]
    if not calls:
        for e in evs:
            if e["kind"] == "ledger-entry":
                for x in e["entries"]:
                    if x["kind"] == "tool-invocation":
                        calls.append({"toolName": x["toolName"], "args": x.get("args"), "ok": True})
    out["toolCalls"] = len(calls)
    cnt = collections.Counter((c["toolName"], canon(c.get("args"))) for c in calls if c["toolName"] not in META_TOOLS)
    if any(v >= 2 for v in cnt.values()):
        f["R03_repeat_identical_call"] = {"max": max(cnt.values()), "tools": sorted({k[0] for k, v in cnt.items() if v >= 2})}
    todo_adds = [c for c in calls if c["toolName"] == "todo" and (c.get("args") or {}).get("action") == "add"]
    dup_skip = [c for c in todo_adds if "duplicate" in str(c.get("result", "")).lower()]
    if len(todo_adds) >= 2 or dup_skip:
        f["R04_todo_add_repeat"] = {"adds": len(todo_adds), "dupSkips": len(dup_skip)}
    errs = collections.Counter()
    for c in calls:
        if c.get("ok") is False:
            errs[err_class(str(c.get("error")))] += 1
    out["toolErrors"] = dict(errs)
    schema_cls = {"missing-required-param", "unknown-param-name", "enum-violation", "hallucinated-tool-name"}
    if any(k in schema_cls for k in errs): f["R19_tool_error_schema_arg"] = {k: v for k, v in errs.items() if k in schema_cls}
    envn = {k: v for k, v in errs.items() if k not in schema_cls}
    if envn: f["R19b_tool_error_env"] = envn

    # --- shaped/text tool calls
    sigs = [e for e in evs if e["kind"] == "harness-signal-injected"]
    out["signalOrigins"] = dict(collections.Counter(s.get("origin") for s in sigs))
    shaped = [s for s in sigs if s.get("origin") == "unresolved-tool-call-guard"]
    if shaped: f["R01_shaped_toolcall_reprompt"] = {"kinds": [s.get("metadata", {}).get("kind") for s in shaped]}
    txt_hits = 0
    for e in exch:
        r = e.get("response") or {}
        if not r.get("toolCalls") and e.get("toolSchemaNames"):
            c = r.get("content") or ""
            m = TOOLJSON_RE.search(c)
            if m and m.group(1) in set(e["toolSchemaNames"]): txt_hits += 1
    if txt_hits: f["R02_text_toolcall_in_content"] = {"exchanges": txt_hits}

    # --- guards
    guards = [e for e in evs if e["kind"] == "guard-fired"]
    gcount = collections.Counter(g["guard"] if g["guard"] != "terminal_decision" else "terminal_decision:" + str(g.get("reason")) for g in guards)
    out["guards"] = dict(gcount)
    if any(g["guard"] == "low_delta_guard" for g in guards): f["R06_low_delta_guard_terminal"] = True
    if any(g["guard"] == "stall_deliverable" for g in guards):
        f["R07_stall_deliverable_terminal"] = next(g.get("metadata") for g in guards if g["guard"] == "stall_deliverable")
    if out["terminatedBy"] in ("harness_synthesis", "harness_deliverable"): f["R08_harness_synthesis_or_deliverable"] = out["terminatedBy"]
    if any("applyGroundedTerminalGate" in str(s.get("origin")) for s in sigs): f["R25_arbitrator_gate_redirect"] = sum("applyGroundedTerminalGate" in str(s.get("origin")) for s in sigs)
    if any("repeated-identical-failure" in str(s.get("origin")) for s in sigs): f["R26_repeated_failure_guard"] = True

    # --- progress
    per_iter = {}
    for e in evs:
        if e["kind"] == "assessment": per_iter[e["iter"]] = e
    streak = best = 0
    for it in sorted(per_iter):
        a = per_iter[it]
        if a.get("evidenceDelta", 0) == 0 and a.get("requirementsOutstanding", 0) > 0 and it > 0: streak += 1
        else: streak = 0
        best = max(best, streak)
    out["maxNoProgressStreak"] = best
    if best >= 3: f["R05_no_progress_streak"] = best
    last_assess = per_iter[max(per_iter)] if per_iter else None

    # --- terminal / verifier
    vv = [e for e in evs if e["kind"] == "verifier-verdict" and e.get("terminal")]
    lastv = vv[-1] if vv else None
    if rc and lastv:
        failed_checks = [c["name"] for c in lastv.get("checks", []) if c.get("passed") is False]
        if (out["status"] == "success" and lastv.get("verified") is False) or (out["status"] == "failure" and lastv.get("verified") is True):
            f["R09_verifier_success_mismatch"] = {"status": out["status"], "verified": lastv.get("verified"), "failed": failed_checks}
    if out["status"] == "success" and output.strip():
        tail = output.strip()[-300:]
        sents = [x.strip() for x in re.split(r"(?<=[.!?])\s+|\n+", tail) if x.strip()]
        lastS = sents[-1] if sents else ""
        if (LAST_INTENT_RE.search(lastS) and not re.search(r"let me know|I can help|I'll need a clear", lastS, re.I)) or output.strip().endswith(":"):
            f["R10_continuation_intent_output"] = lastS[-140:]
            ck = next((c for c in (lastv or {}).get("checks", []) if c["name"] == "output-not-continuation-intent"), None)
            if ck and ck.get("passed") is True: f["R10b_continuation_verifier_missed"] = True
    if output and SCAFFOLD_RE.search(output): f["R11_scaffold_leak_output"] = SCAFFOLD_RE.search(output).group(0)
    if out["status"] == "success" and rc and not output.strip(): f["R23_empty_output_success"] = True
    if out["terminatedBy"] == "llm_error": f["R20_terminal_llm_error"] = True
    if out["terminatedBy"] in ("max_iterations", "budget_exceeded"): f["R21_max_iterations_or_budget"] = out["terminatedBy"]
    if out["terminatedBy"] == "abstained": f["R22_abstained"] = True
    if not rc: f["R27_no_run_completed"] = True

    # --- requirements outstanding but success
    reqs = {}
    for e in evs:
        if e["kind"] == "ledger-entry":
            for x in e["entries"]:
                if x["kind"] == "requirement": reqs[x["requirementId"]] = x["status"]
    out["requirements"] = reqs
    # Ledger 'satisfied' transitions only exist in recent traces; older ones never log them -> instrument absent, skip.
    instrument_ok = any(v == "satisfied" for v in reqs.values())
    out["reqInstrument"] = instrument_ok
    unsat = [k for k, v in reqs.items() if v != "satisfied"]
    out["unsatisfiedReqs"] = unsat
    if instrument_ok and out["status"] == "success" and unsat:
        f["R14_success_requirement_outstanding"] = {"ledgerUnsatisfied": unsat, "lastAssessOutstanding": (last_assess or {}).get("requirementsOutstanding")}

    # --- HTG + window
    htg = [s for s in sigs if s.get("origin") == "head-truncation-guard"]
    wins = {e.get("window") for e in evs if e["kind"] == "projection-rendered"}
    if htg:
        f["R12_htg_fired"] = len(htg)
        dropped = sorted({t for s in htg for t in (s.get("metadata") or {}).get("droppedToolNames", [])})
        if dropped: f["R12b_htg_dropped_tools"] = dropped
        small = [s for s in htg if (s.get("metadata") or {}).get("correctedTokensBefore", 1e9) < 0.25 * (s.get("metadata") or {}).get("numCtx", 1)]
        if small:
            m = small[0]["metadata"]
            f["R12c_htg_small_prompt"] = {"promptTok": m["correctedTokensBefore"], "numCtx": m["numCtx"]}
        nc = {(s.get("metadata") or {}).get("numCtx") for s in htg}
        if wins and nc and any(w and n and w != n for w in wins for n in nc): f["R24_window_numctx_mismatch"] = {"window": sorted(w for w in wins if w), "numCtx": sorted(n for n in nc if n)}
    maxtoks = [e.get("maxTokens") for e in exch if e.get("maxTokens")]
    out["maxTokensMax"] = max(maxtoks) if maxtoks else None
    out["windows"] = sorted(w for w in wins if w)

    # --- strategy switches
    sw = [e for e in evs if e["kind"] == "strategy-switched"]
    if sw:
        f["R13_strategy_switch"] = [{"from": s["from"], "to": s["to"], "pattern": (re.match(r"pattern=(\S+)", s.get("reason", "")) or [None, "?"])[1] if re.match(r"pattern=(\S+)", s.get("reason", "")) else "?"} for s in sw]
        if out["status"] == "failure" or len(sw) >= 2: f["R13b_switch_no_recover"] = len(sw)
        # what reset: messagesCount/stepsCount right before vs after first switch
        pre = [s for s in snaps if s["seq"] < sw[0]["seq"]]
        post = [s for s in snaps if s["seq"] > sw[0]["seq"]]
        if pre and post:
            out["switchReset"] = {"msgBefore": pre[-1].get("messagesCount"), "msgAfter": post[0].get("messagesCount"),
                                  "stepsBefore": pre[-1].get("stepsCount"), "stepsAfter": post[0].get("stepsCount")}
    if any(e["kind"] == "ledger-entry" and any(x["kind"] in ("compaction-marker", "result-truncated") for x in e["entries"]) for e in evs):
        f["R28_compaction_or_truncation"] = True

    # --- todo/checklist
    adds = 0; closes = 0
    for e in evs:
        if e["kind"] == "ledger-entry":
            for x in e["entries"]:
                if x["kind"] == "checklist-item":
                    ch = x["change"]; op = ch.get("op")
                    if op == "add": adds += len(ch.get("items", []))
                    elif op in ("done", "complete", "check", "update", "remove"): closes += 1
        if e["kind"] == "checklist-inferred": closes += 1
    todo_done_calls = sum(1 for c in calls if c["toolName"] == "todo" and (c.get("args") or {}).get("action") in ("done", "complete", "check", "update"))
    closes += todo_done_calls
    out["todo"] = {"adds": adds, "closes": closes}
    if adds and closes == 0: f["R15_todo_unfinished"] = out["todo"]

    # --- plan-only
    if PLAN_ONLY_RE.search(task):
        out["planOnly"] = True
        bad = sorted({c["toolName"] for c in calls if c["toolName"] not in META_TOOLS})
        if bad: f["R16_plan_only_violation"] = bad

    # --- guidance
    pg_act = pg_pile = 0; used = set()
    for s in snaps:
        used = set(s.get("toolsUsed") or [])
        pgd = s.get("pendingGuidance") or {}
        if "actReminder" in pgd and used <= META_TOOLS and s.get("iter", 0) > 0: pg_act += 1
        if {"errorRecovery", "loopDetected", "requiredToolsPending"} <= set(pgd): pg_pile += 1
    if pg_act and (last_assess is None or last_assess.get("requirementsOutstanding", 0) > 0 or out["status"] != "success"): f["R17_actreminder_premature_final"] = pg_act
    if pg_pile: f["R18_guidance_stack_pileup"] = pg_pile


    # --- signal lifecycle (harness-signal-injected -> signal-rendered -> signal-effect)
    rend = {e.get("signalId"): e for e in evs if e["kind"] == "signal-rendered"}
    eff = {e.get("signalId"): e for e in evs if e["kind"] == "signal-effect"}
    sl = []
    for s_ in sigs:
        sid = s_.get("signalId")
        sl.append({"origin": re.sub(r":\d+.*$", "", str(s_.get("origin"))), "kind": s_.get("signalKind"), "iter": s_.get("iter"),
                   "rendered": bool(sid) and sid in rend, "renderedIn": rend[sid].get("renderedInIter") if sid in rend else None,
                   "section": rend[sid].get("renderedSection") if sid in rend else None,
                   "effect": ("no-signalId(untraceable)" if not sid else eff[sid]["response"] if sid in eff else ("never-rendered" if sid not in rend else "rendered-no-effect-event")),
                   "hasId": bool(sid), "preview": redact(str(s_.get("contentPreview"))[:100])})
    out["signals"] = sl
    out["signalTally"] = rc.get("signals") if rc else None
    # co-rendered sets per iteration: pendingGuidance keys + signals rendered/opened that iter
    co = collections.defaultdict(set)
    for sn in snaps:
        for k in (sn.get("pendingGuidance") or {}): co[sn.get("iter")].add("pg:" + k)
    for x in sl:
        co[x["renderedIn"] if x["renderedIn"] is not None else x["iter"]].add("sig:" + x["origin"].split("/")[-1])
    out["coRendered"] = {str(k): sorted(v) for k, v in co.items() if len(v) >= 2}
    conflicts = []
    for it, v in co.items():
        stop = {"pg:actReminder", "pg:qualityGateHint"} & v
        go = {"pg:requiredToolsPending", "pg:loopDetected", "sig:arbitrator.ts", "pg:gatherDedup"} & v
        if stop and go: conflicts.append({"iter": it, "kind": "execute-vs-stop", "set": sorted(v)})
        if "sig:head-truncation-guard" in v and ({"pg:requiredToolsPending", "sig:arbitrator.ts"} & v): conflicts.append({"iter": it, "kind": "tools-dropped-while-tool-required", "set": sorted(v)})
        if PLAN_ONLY_RE.search(task) and ({"pg:requiredToolsPending", "pg:actReminder"} & v): conflicts.append({"iter": it, "kind": "plan-only-vs-go/stop-nudge", "set": sorted(v)})
    if conflicts: f["R29_guidance_conflict_same_think"] = conflicts
    if sl and any(x["hasId"] and not x["rendered"] for x in sl): f["R30_signal_never_rendered"] = sum(x["hasId"] and not x["rendered"] for x in sl)
    if any(x["effect"] in ("ambiguous", "unobserved") for x in sl) or (out["signalTally"] and (out["signalTally"].get("ambiguous", 0) or out["signalTally"].get("unobserved", 0))):
        f["R31_signal_unclassified"] = True
    if any(x["effect"] in ("ignored", "contradicted") for x in sl): f["R32_signal_ignored_or_contradicted"] = [x["origin"] for x in sl if x["effect"] in ("ignored", "contradicted")]
    if sl and any(not x["hasId"] for x in sl): f["R33_signal_without_id"] = sum(not x["hasId"] for x in sl)

    # --- tool-surface vs what model then called; first-think view
    surf = [e for e in evs if e["kind"] == "tool-surface-resolved"]
    out["surfaceFirst"] = surf[0].get("visible") if surf else None
    called = [c["toolName"] for c in calls]
    vis_all = set(t for e in surf for t in e.get("visible", []))
    off = sorted({c for c in called if vis_all and c not in vis_all})
    if off: f["R34_called_tool_not_visible"] = off
    if out["status"] == "failure" and out["toolCalls"] == 0 and out["iterations"] >= 2: f["R35_no_tool_engagement"] = True
    out["flags"] = f
    out["root"], out["symptoms"] = root_cause(out, f)
    out["pgKeys"] = sorted({k for s in snaps for k in (s.get("pendingGuidance") or {})})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"))
    ap.add_argument("--include-synthetic", action="store_true", help="also write synthetic (test-model) runs to runs.jsonl")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    recs = [classify(*r) for r in iter_runs()]
    with open(os.path.join(a.out, "runs.jsonl"), "w") as fh:
        for r in recs:
            if r["real"] or a.include_synthetic: fh.write(json.dumps(r) + "\n")
    summ = {"generated": "see git", "corpus": {}, "byFlag": {}, "clusters": {}, "terminatedBy": {}}
    for label, sel in (("real", lambda r: r["real"]), ("synthetic", lambda r: not r["real"])):
        rs = [r for r in recs if sel(r)]
        n = len(rs)
        summ["corpus"][label] = {"runs": n, "bySource": dict(collections.Counter(r["source"] for r in rs)),
                                  "byModel": dict(collections.Counter(r["model"] for r in rs).most_common())}
        tb = collections.Counter(f"{r['status']}/{r['terminatedBy']}" for r in rs)
        summ["terminatedBy"][label] = dict(tb.most_common())
        flagrows = {}
        for rid, (desc, fm, cl, deg) in RULES.items():
            hit = [r for r in rs if rid in r["flags"]]
            bymodel = collections.Counter(r["model"] for r in hit)
            flagrows[rid] = {"desc": desc, "fm": fm, "cluster": cl, "degrading": deg, "runs": len(hit),
                             "pct": round(100 * len(hit) / n, 1) if n else 0, "byModel": dict(bymodel.most_common()),
                             "examples": [r["runId"] for r in hit[:4]]}
        summ["byFlag"][label] = flagrows
        # degraded = failure OR any degrading flag
        def degraded(r):
            return r["status"] == "failure" or any(RULES[k][3] for k in r["flags"] if k in RULES)
        deg = [r for r in rs if degraded(r)]
        cl = {}
        for c in sorted({v[2] for v in RULES.values()}):
            hit = [r for r in deg if any(RULES[k][2] == c and RULES[k][3] for k in r["flags"] if k in RULES)]
            cl[c] = {"degradedRunsTouched": len(hit), "pctOfAllRuns": round(100 * len(hit) / n, 1) if n else 0,
                     "pctOfDegraded": round(100 * len(hit) / len(deg), 1) if deg else 0}
        summ["clusters"][label] = {"degradedRuns": len(deg), "pctDegraded": round(100 * len(deg) / n, 1) if n else 0, "byCluster": cl}
        toks = [r["tokens"] for r in rs if r["tokens"]]
        if toks:
            toks.sort()
            summ.setdefault("tokens", {})[label] = {"n": len(toks), "median": statistics.median(toks), "p90": toks[int(0.9 * (len(toks) - 1))], "max": toks[-1], "total": sum(toks)}
        errs = collections.Counter()
        for r in rs:
            for k, v in r["toolErrors"].items(): errs[k] += v
        summ.setdefault("toolErrors", {})[label] = dict(errs.most_common())
        summ.setdefault("realByModelStatus", {})[label] = {}
    # per-model failure table for real runs
    pm = collections.defaultdict(lambda: collections.Counter())
    for r in recs:
        if r["real"]:
            pm[r["model"]]["runs"] += 1
            pm[r["model"]][f"status:{r['status']}"] += 1
            for k in r["flags"]: pm[r["model"]][k] += 1
    summ["realPerModel"] = {m: dict(c) for m, c in pm.items()}

    # chains for degraded real runs
    with open(os.path.join(a.out, "chains.md"), "w") as fh:
        fh.write("# Causal chains (auto-generated, real-model runs with a root mechanism)\n\n")
        for r in recs:
            if r["real"] and r["root"]: fh.write(chain(r) + "\n")
    roots = collections.defaultdict(collections.Counter)
    for lab, sel in (("real", True), ("synthetic", False)):
        rr = [r for r in recs if r["real"] == sel]
        c = collections.Counter(r["root"] for r in rr if r["root"])
        summ.setdefault("roots", {})[lab] = dict(c.most_common())
        # root by model
        bm = collections.defaultdict(collections.Counter)
        for r in rr:
            if r["root"]: bm[r["root"]][r["model"]] += 1
        summ.setdefault("rootsByModel", {})[lab] = {k: dict(v) for k, v in bm.items()}
        eff = collections.defaultdict(collections.Counter)
        for r in rr:
            for x in r["signals"]:
                eff[x["origin"]]["opened"] += 1
                eff[x["origin"]]["rendered" if x["rendered"] else ("never_rendered" if x["hasId"] else "no_id")] += 1
                eff[x["origin"]]["effect:" + x["effect"]] += 1
        summ.setdefault("signalEffectiveness", {})[lab] = {k: dict(v) for k, v in eff.items()}
        tally = collections.Counter()
        for r in rr:
            for k, v in (r["signalTally"] or {}).items(): tally[k] += v
        summ.setdefault("signalTallyRunCompleted", {})[lab] = dict(tally)
        co = collections.Counter(tuple(v) for r in rr for v in r["coRendered"].values())
        summ.setdefault("coRenderedSets", {})[lab] = [[list(k), n] for k, n in co.most_common(15)]
        cf = collections.Counter(x["kind"] for r in rr for x in r["flags"].get("R29_guidance_conflict_same_think", []))
        summ.setdefault("conflictKinds", {})[lab] = dict(cf)
    json.dump(summ, open(os.path.join(a.out, "summary.json"), "w"), indent=1)
    print(f"runs: real={summ['corpus']['real']['runs']} synthetic={summ['corpus']['synthetic']['runs']} -> {a.out}")

if __name__ == "__main__":
    main()
