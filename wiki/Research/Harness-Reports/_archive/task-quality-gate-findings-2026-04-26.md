# Task Quality Gate — First Run Findings (2026-04-26)

**Test:** 5 real-world synthesis tasks against gemma4:e4b with Sprint 3.3 architecture (Arbitrator, Verifier, ContextCurator section ON, recentObservationsLimit=5).

---

## Headline result

**Average composite quality: 35%** across 5 tasks. The single tool-less task scores 100%; every tool-based task scores ≤35%. **The framework's Synthesis trait is fundamentally broken for tasks that ingest tool output.**

```
task                          | composite | faith | format | complete | no-fabr | tokens
T1-knowledge-recall            | 100%      | 100%  | 100%   | 100%     | 100%    | 284   ← baseline works
T2-single-tool-synthesis       | 2%        | 7%    | 0%     | 0%       | 0%      | 15,431 ★ catastrophic
T3-selective-filter            | 35%       | 0%    | 30%    | 0%       | 100%    | 9,591
T4-multi-criteria              | 30%       | 0%    | 0%     | 0%       | 100%    | 14,939
T5-long-form-synthesis         | 9%        | 7%    | 20%    | 20%      | 0%      | 9,843  ★ catastrophic
```

---

## What's actually happening in the failed tasks

### Pattern 1: Tool-preview echo (T2, T5)

`result.output` is literally:
```
[recall result — compressed preview]
Type: Object(4 keys)
  key: _tool_result_1
  content: [{"id":47909226,"title":"Asahi Linux Progress Linux 7.0",...
  bytes: 2824
  truncated: false
  — full text is stored. Use recall("_tool_result_2") to retrieve.
```

**The agent isn't synthesizing — it's emitting the framework's own compressed-preview marker as its final answer.** The model sees `[STORED: _tool_result_1 | get-hn-posts]` in the conversation history and curator section, calls recall(), gets back ANOTHER preview marker (`recall("_tool_result_2")`), and emits that as the "answer."

### Pattern 2: Required-tool over-classification (T4)

```
Task incomplete — missing_required_tool: required tool(s) not called:
get-hn-posts×3 (1/3 satisfied).
required=[get-hn-posts×3 (1/3 satisfied)]
called=[get-hn-posts, recall]
terminatedBy=controller_early_stop:dispatcher_early_stop
```

The framework's required-tools classifier inferred that `get-hn-posts` should be called **3 times** for a "summarize 15 posts" task. One fetch returns all 15 posts. The classifier doesn't model "this tool returns a batch."

The Sprint 3.3 dispatcher-early-stop wiring then correctly converted the unfinished run to a controller-stopped exit — but the underlying issue is the classifier's over-specification.

### Pattern 3: The Verifier doesn't catch this

Sprint 3.2 wired `defaultVerifier.verify()` after every effector output. But the Verifier's checks are:
- action-success ✓ (tool call succeeded)
- non-empty-content ✓ (output isn't empty)
- (terminal-only checks)

**It doesn't check "is the output a tool-preview echo?" or "does the output match the requested format?" or "does the output cite real values from observations?"**

That's the layer the corpus-validation methodology was missing too. **Synthesis quality is the trait neither corpus nor verifier currently measures.**

---

## What the brain analogy says

(per North Star v3.0 design philosophy):

> "How would the human brain handle this task? Would it store an observation and recall it manually or would it make observations that get compressed and distilled into an experience that the agent's memory drives future output from?"

The brain's flow:
```
sensory input (full data)
  → working memory (full data, decayed by attention)
  → attention selects salient features (curator)
  → integration with task goal (reason)
  → output (synthesis)
```

What our framework does:
```
tool output (full data)
  → tool-execution.ts COMPRESSES → stores in scratchpad
  → only the [STORED: ...] marker enters the conversation
  → the model has to call recall() to "go fetch" the actual data
  → recall() returns ANOTHER compressed marker
  → model echoes the marker as its answer
```

**Recall as required navigation is a smell.** The brain doesn't make conscious decisions to "recall memory key _tool_result_3"; the relevant memory is automatically present when the task demands it.

---

## What needs to change (the architectural diagnosis)

The fix is **G-4 closure (full)** as North Star v3.0 §6.4 framed it — but the scope needs to be sharper than "delete the 3 compression systems." Specifically:

### 1. ContextCurator owns compression (not tool-execution)

Currently:
- `tool-execution.ts:723` compresses tool output to a `[STORED: ...]` marker before it ever reaches the kernel state
- The curator only sees the marker, can't show full content
- recall() exists to undo the compression manually

Target:
- `tool-execution.ts` stores FULL tool output in scratchpad and emits a full-content observation
- ContextCurator decides per-iteration whether to truncate, summarize, or include full
- Decision is a function of `(token budget remaining, observation salience to task, model tier)`
- recall() becomes ad-hoc (model can ask for an older observation it didn't get curator-included), not required

### 2. Verifier gains a synthesis-quality check

Pre-this-discovery the Verifier was: did action succeed + content non-empty + completion claim + grounding.

Add:
- **format-adherence** (when task specifies a format)
- **echo-detection** (output should not literally contain `[STORED:`, `[recall result`, `_tool_result_`, `compressed preview`)
- **emptiness-vs-substantiveness** (knowing 50 chars of "ok done" is not synthesis)

These checks fire BEFORE the Arbitrator returns exit-success. If the Verifier fails them, the Arbitrator converts to exit-failure (Verdict-Override pattern at the synthesis layer).

### 3. Required-tools classifier needs batch awareness

`inferRequiredTools` currently treats "summarize 15 posts" as needing 15 of the relevant tool. It should detect when a single tool call returns batched results.

This is a separate concern from G-4 but shows up immediately in T4. Worth addressing in a follow-up.

---

## What this means for the sprint plan

**Sprint 3.4 (per North Star v3.0) was Reflect/Sense extraction.** Based on this empirical evidence, **revise to:**

### Sprint 3.4 (REVISED) — G-4 closure: Curator owns compression

**Goal:** ContextCurator becomes the single owner of tool-output rendering decisions. Tool-execution stops compressing. recall() becomes ad-hoc only.

**Scope:**
1. `tool-execution.ts` — emit FULL tool output as observation content + scratchpad copy
2. `ContextCurator` — adds a `compressObservationsFor(state, profile)` decision function
3. ContextCurator section renders FULL or COMPRESSED based on decision
4. recall() handler stays available (ad-hoc retrieval) but kernel never requires it
5. New gate scenario: `cf-25-curator-owns-compression`

**Validation gate:**
- Re-run task-quality-gate.ts; target: average composite ≥ 70%
- T2 (single-tool-synthesis) target: ≥ 80% (current 2%)
- T5 (long-form) target: ≥ 60% (current 9%)
- No regression on T1 (knowledge-recall must stay 100%)
- Failure corpus stable or improving

**Critical:** if the gate doesn't move from 35% to ≥60% average, we diagnose before shipping more changes.

### Sprint 3.5 — Verifier synthesis-quality checks + Reflect extraction

After G-4 lands, the Verifier gets the new checks (format/echo/substantiveness). Then the original Sprint 3.4 (Reflect/Sense) follows.

### Sprint 3.6 — Required-tools classifier batch-awareness

T4's "get-hn-posts×3" classifier issue gets its own focused fix.

---

## Confidence-adjusted scoreboard

| Claim | Pre-Task-Gate confidence | Post-Task-Gate confidence |
|---|---|---|
| Sprint 3.3 closed G-5 architecturally | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ (still true) |
| Sprint 3.3 improved corpus 5/8 → 6/8 median | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ (still true) |
| Framework delivers production-quality synthesis | ⭐⭐⭐ (assumed) | ⭐ (BROKEN — 35% avg) |
| Curator section helps real tasks | ⭐⭐⭐⭐ (claimed) | ⭐ (it's there but compressed-preview defeats it) |
| recall() is ad-hoc, not required | ⭐⭐⭐ (assumed) | ⭐⭐ (model still calls it; framework still emits compression markers it has to navigate) |
| failure-corpus is sufficient validation | ⭐⭐⭐⭐ (assumed) | ⭐⭐ (Synthesis quality is uncovered) |

**Net:** structural sprint wins are real; behavioral synthesis quality is broken. The corpus methodology gave us a false sense of progress because it tested the wrong thing for real-world impact.

---

## What the user said that's exactly right

> "We should be thinking in terms of logical systems, how would the human brain or other cognitive systems handle this task? Would it store an observation and recall it manually or would it make observations that get compressed and distilled into an experience that the agent's memory then drives future output from? We should model our cognitive systems after known-good design. The recall path is a nice to have tool to allow ad-hoc recalling of memories or observations but it should not be required to get the answer right."

That diagnosis predicted everything this benchmark just measured. The framework is requiring the agent to navigate its own compression machinery instead of giving the agent attention-curated context the way the brain does.

---

## Next concrete action

1. **Don't ship anything else until this gate moves.** The corpus gate plus this task-quality gate together define "ready for v0.10.0."
2. **Sprint 3.4 (revised) — Curator owns compression** is the next work.
3. **Re-run task-quality-gate after every architectural change** — this is the new N=1 signal for synthesis quality (corpus stays for termination correctness).
4. **Run task-quality-gate against more models** (cogito:14b, qwen3:14b, anthropic if available) to verify the failure mode is architectural, not model-specific.
