---
name: harness-improvement-loop
description: Self-contained framework harness improvement loop. Runs instrumented agent probes, analyzes real runtime output to pinpoint harness weaknesses, and produces a templated actionable improvement report each pass. Use at the start of a harness improvement session. The fix phase uses agent-tdd separately.
user-invocable: true
---

# Harness Improvement Loop

## Purpose

This skill drives harness improvement from **actual framework output** — not from reading code alone. The loop is:

```
Orient → Instrument → Probe → Analyze → Report → Loop
```

Each pass produces a structured improvement report grounded in observed runtime behavior. Reports accumulate across passes. The fix phase (implementing improvements) is handled separately by `agent-tdd` + `reactive-feature-dev`.

**Report template:** `.agents/skills/harness-improvement-loop/REPORT-TEMPLATE.md`
Copy it to `harness-reports/improvement-report-YYYYMMDD-N.md` at the start of each pass and fill it in with real probe data.

## What "the Harness" Means

The harness is every system that sits between a task string and a high-quality final answer:

| Component | Location |
|-----------|----------|
| Kernel loop | `packages/reasoning/src/strategies/kernel/kernel-runner.ts` |
| Phase pipeline | `packages/reasoning/src/strategies/kernel/phases/` (think, act, guard, context-builder) |
| Kernel utilities | `packages/reasoning/src/strategies/kernel/utils/` (termination-oracle, quality-utils, auto-checkpoint, output-synthesis, task-intent, tool-capabilities) |
| Reasoning strategies | `packages/reasoning/src/strategies/` (adaptive, reactive, plan-execute-reflect, tree-of-thought) |
| Provider adapters | `packages/llm-provider/src/adapters/` |
| Context pressure system | `packages/reasoning/src/context/` (context-profile, profile-resolver) |
| Trace infrastructure | `packages/trace/src/` (recorder, layer, replay, events) — typed JSONL trace capture |
| Intervention dispatcher | `packages/reactive-intelligence/src/controller/` (dispatcher, handlers/, patch-applier) |

The builder, tools, memory, MCP, and UI layers are **out of scope**. Focus on kernel → strategy → output.

---

## Phase 1: Orient (Do Not Skip)

Read these in order before running probes. Understanding current state prevents misdiagnosing results.

```bash
# Architecture and recent changes
cat AGENTS.md | head -120
git log --oneline -20

# Kernel runner — the main loop
cat packages/reasoning/src/strategies/kernel/kernel-runner.ts

# Four phases
cat packages/reasoning/src/strategies/kernel/phases/think.ts
cat packages/reasoning/src/strategies/kernel/phases/act.ts
cat packages/reasoning/src/strategies/kernel/phases/guard.ts
cat packages/reasoning/src/strategies/kernel/phases/context-builder.ts

# Key decision-making utilities
cat packages/reasoning/src/strategies/kernel/utils/termination-oracle.ts
cat packages/reasoning/src/strategies/kernel/utils/quality-utils.ts
cat packages/reasoning/src/strategies/kernel/utils/auto-checkpoint.ts
cat packages/reasoning/src/strategies/kernel/utils/output-synthesis.ts
cat packages/reasoning/src/strategies/kernel/utils/task-intent.ts

# Context pressure thresholds
cat packages/reasoning/src/context/context-profile.ts
```

**Record before proceeding:** current maxIterations defaults, context pressure thresholds (local/mid/large/frontier), quality score thresholds, termination conditions. You will need these to evaluate whether probe output is a bug or expected behavior.

---

## Phase 2: Instrument (Probe Runner Setup)

### Available scripts

- **`.agents/skills/harness-improvement-loop/scripts/harness-probe.ts`** — Runs all 5 probes, writes per-probe JSONL and a pass summary JSON. Uses Ollama by default (`qwen2.5:7b`). Override with `PROBE_MODEL=<name>` env var.
- **`.agents/skills/harness-improvement-loop/scripts/harness-probe-analyze.ts`** — Analyzes a JSONL probe file and extracts structured metrics.
- **`.agents/skills/harness-improvement-loop/scripts/harness-probe-confirm.ts`** — Runs targeted confirmation probes for specific weaknesses.
- **`.agents/skills/harness-improvement-loop/scripts/harness-probe-wide.ts`** — Runs the full wide-scan probe suite.
- **`.agents/skills/harness-improvement-loop/scripts/harness-evolve.ts`** — Analyzes all probes, updates loop-state.json, generates next-pass candidates.

### Setup

```bash
mkdir -p harness-reports
cp .agents/skills/harness-improvement-loop/REPORT-TEMPLATE.md \
   harness-reports/improvement-report-$(date +%Y%m%d)-1.md
```

Create the probe runner:

The probe runner and all supporting scripts live in `.agents/skills/harness-improvement-loop/scripts/`. Run them directly from the project root:

Key configuration at the top of the file — the only things you should need to change:

```typescript
const PROBE_MODEL = "qwen2.5:7b"; // local Ollama model, no API cost
// Override at runtime: PROBE_MODEL=cogito:8b bun run .agents/skills/harness-improvement-loop/scripts/harness-probe.ts

// Each probe: { id, strategy, maxIterations, task, expectation }
// Edit PROBES[] to add domain-specific tasks or adjust iteration budgets
```

The script:
- Runs 5 probes sequentially (trivial-1step → termination-quality)
- Writes per-probe JSONL to `harness-reports/probe-{id}.jsonl`
- Writes a summary JSON to `harness-reports/probe-summary-{datetime}.json`
- Streams live debug output to console during each run

To run all probes with live output captured:

```bash
bun run .agents/skills/harness-improvement-loop/scripts/harness-probe.ts 2>&1 | tee harness-reports/probe-run-$(date +%Y%m%d-%H%M).txt
```

### Adapting the probe script for better output

The 5 default probes are a starting baseline. Whenever the default probes don't exercise the specific behavior you're investigating, edit `.agents/skills/harness-improvement-loop/scripts/harness-probe.ts` directly. The script is a first-class artifact — updating it is expected and required to get actionable results.

**When to adapt:**
- A weakness from the report isn't exercised by any default probe — add a probe that directly triggers it
- A probe's task is too easy/hard for the current model — adjust the task or `maxIterations`
- You want to re-run a single probe after a fix — comment out the others or add a `--probe` CLI flag
- The default tasks don't represent your actual workload — replace with domain-specific tasks

**Targeted single-probe run** (fastest feedback loop after a fix):

```typescript
// In harness-probe.ts: temporarily filter PROBES to run just the failing one
const PROBES: ProbeConfig[] = [
  // comment out others, or:
].filter((p) => p.id === "termination-quality");
```

Or add a quick CLI filter at the bottom of `main()`:

```typescript
const targetId = process.argv[2]; // bun run .agents/skills/harness-improvement-loop/scripts/harness-probe.ts termination-quality
const toRun = targetId ? PROBES.filter((p) => p.id === targetId) : PROBES;
```

**Improving task specificity:** if a probe's `expectation` field doesn't match what you're testing, change it — the expectation is what you paste into the report's "Expected behavior" field. A mismatched expectation produces a misleading report.

**After adapting:** run the modified script, confirm live output matches the new expectation, then restore any removed probes before the next full-pass run.

---

## Phase 2b: Trace-Based Observability

Probes use `.withTracing()` — the typed `TraceEvent` JSONL pipeline — as the primary observability mechanism. This replaced `.withObservability()` in v0.10. Traces land in `.reactive-agents/traces/<runId>.jsonl` and carry typed events across kernel, entropy, intervention, and run lifecycle.

### Builder config for probes

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("qwen2.5:7b")
  .withReasoning({ defaultStrategy: "adaptive", maxIterations: 12 })
  .withReactiveIntelligence()      // enables intervention dispatcher
  .withTracing({ dir: ".reactive-agents/traces" })
  .build()
```

The trace dir is created automatically. Each run writes one `<runId>.jsonl` file.

### TraceEvent kinds (what lands in the JSONL)

| kind | When | Key fields |
|------|------|-----------|
| `run-started` | run open | `runId`, `model`, `provider` |
| `run-completed` | run close | `status: "success"\|"failure"`, `totalTokens`, `durationMs` |
| `entropy-scored` | each iteration | `composite`, `sources.{token,structural,semantic,behavioral,contextPressure}` |
| `decision-evaluated` | each RI decision | `decisionType`, `confidence`, `reason` |
| `intervention-dispatched` | handler fires | `decisionType`, `patchKind`, `cost`, `telemetry` |
| `intervention-suppressed` | suppression gate | `decisionType`, `reason` (below-entropy-threshold / below-iteration-threshold / mode-advisory / ...) |
| `strategy-switched` | strategy change | `from`, `to`, `reason` |

### Reading traces

**CLI — human inspection:**
```bash
# Timeline with entropy, interventions, strategy switches
rax trace inspect .reactive-agents/traces/<runId>.jsonl

# Side-by-side stats comparison (e.g. RI on vs off)
rax trace compare .reactive-agents/traces/<run-a>.jsonl .reactive-agents/traces/<run-b>.jsonl
```

**Script — structured analysis:**
```typescript
import { loadTrace, traceStats } from "@reactive-agents/trace"
const trace = await loadTrace(".reactive-agents/traces/<runId>.jsonl")
const stats = traceStats(trace)
// stats: { totalEvents, iterations, interventionsDispatched, interventionsSuppressed,
//           maxEntropy, toolCalls, durationMs, totalTokens }
```

**Entropy AUC across a corpus:**
```bash
bun run scripts/validate-entropy.ts .reactive-agents/traces/
# Prints AUC (max-entropy → failure), success rate, interpretation guide
```

### Signals to watch for

- `maxEntropy > 0.7` and `interventionsDispatched = 0` → dispatcher suppression or no-handler gap
- `status: "failure"` with `iterations = maxIterations` → agent did not self-terminate
- `strategy-switched` absent when expected → strategy routing not triggering
- `intervention-suppressed` with `reason: "below-entropy-threshold"` repeatedly → suppression threshold too high for probe model
- `contextPressure` climbing fast before iter 6 → context pressure building faster than expected

---

## Phase 3: Analyze Output

Use `rax trace inspect` and `harness-probe-analyze.ts` as the primary analysis tools. The output of these commands fills the "Observed behavior" and "Evidence" fields in the report.

### Primary: trace inspect

```bash
# Per-run timeline — entropy, interventions, strategy switches
rax trace inspect .reactive-agents/traces/<runId>.jsonl

# Compare two runs side-by-side (e.g. RI enabled vs disabled)
rax trace compare .reactive-agents/traces/<run-a>.jsonl .reactive-agents/traces/<run-b>.jsonl
```

### Primary: probe analysis script

```bash
# Structured metric extraction (uses real TraceEvent schema)
bun run .agents/skills/harness-improvement-loop/scripts/harness-probe-analyze.ts \
  .reactive-agents/traces/<runId>.jsonl

# All probes + metric registry
bun run .agents/skills/harness-improvement-loop/scripts/harness-probe-analyze.ts --registry
```

### Termination quality

```bash
# Did run hit maxIterations or self-terminate?
jq 'select(.kind == "run-completed") | {status, totalTokens, durationMs}' \
  .reactive-agents/traces/<runId>.jsonl

# Entropy progression — was composite rising toward the end?
jq 'select(.kind == "entropy-scored") | {iter, composite, sources}' \
  .reactive-agents/traces/<runId>.jsonl
```

### Intervention dispatcher activity

```bash
# Did the dispatcher fire?
jq 'select(.kind == "intervention-dispatched") | {iter, decisionType, patchKind}' \
  .reactive-agents/traces/<runId>.jsonl

# What was suppressed and why?
jq 'select(.kind == "intervention-suppressed") | {iter, decisionType, reason}' \
  .reactive-agents/traces/<runId>.jsonl
```

### Strategy selection

```bash
# Did strategy switch occur?
jq 'select(.kind == "strategy-switched") | {iter, from, to, reason}' \
  .reactive-agents/traces/<runId>.jsonl

# Decision types evaluated this run
jq 'select(.kind == "decision-evaluated") | {iter, decisionType, confidence, reason}' \
  .reactive-agents/traces/<runId>.jsonl
```

### Cross-probe comparison

```bash
# Stats summary across all traces in a dir
bun run scripts/validate-entropy.ts .reactive-agents/traces/
# Prints AUC, success rate, per-run entropy vs outcome

# Compare probe summary JSON (still written by harness-probe.ts)
jq -s '[.[] | {id: .id, iters: .iterationsUsed, cost: .costUsd, quality: .qualityScore}]' \
  harness-reports/probe-summary-*.json | jq '.[-1]'
```

**Note on legacy jq patterns:** older versions of this skill used event schemas like `{event: "ThinkStart"}`, `{qualityScore: ...}`, `{contextRatio: ...}`. Those fields do not exist in the v0.10 TraceEvent schema. Always use `harness-probe-analyze.ts` or the jq patterns above (keyed on `.kind`) — do not adapt the legacy jq patterns.

---

## Phase 3b: Intervention Dispatcher Verification

When probing with `.withReactiveIntelligence()` enabled, verify the dispatcher is actually firing — not just evaluating decisions in advisory mode.

```bash
# Quick check: did any intervention get dispatched?
jq 'select(.kind == "intervention-dispatched")' .reactive-agents/traces/<runId>.jsonl | wc -l

# Full dispatcher activity for a run
jq 'select(.kind == "intervention-dispatched" or .kind == "intervention-suppressed") | {kind, iter, decisionType, .reason, .patchKind}' \
  .reactive-agents/traces/<runId>.jsonl
```

**Expected for a loop-prone probe (iter ≥ 3, composite ≥ 0.55):**
- At least one `intervention-dispatched` with `decisionType: "early-stop"` or `"temp-adjust"`
- No `intervention-suppressed` with `reason: "below-entropy-threshold"` on high-entropy runs

**If only suppressed events appear:**
- `below-entropy-threshold` → model's entropy never crossed 0.55 composite; adjust probe task to be more loop-prone
- `below-iteration-threshold` → firing before iteration 2; expected on fast-terminating probes
- `mode-advisory` → decision type is configured advisory-only (expected for `human-escalate`, `prompt-switch`)
- `no-handler` → handler not registered; check `defaultInterventionRegistry` in `handlers/index.ts`

**Check capability manifest sync:**
```bash
bun run scripts/check-capabilities.ts
# Expected: "Capability manifest in sync (6 dispatched handlers)"
```

---

## Phase 4: Fill the Report

Open `harness-reports/improvement-report-YYYYMMDD-N.md` (copied from `REPORT-TEMPLATE.md`).

Fill sections in this order:
1. Session Header — model, cost, focus area, changes since last pass
2. Probe Run Summary table — from `probe-summary-*.json`
3. Baseline Metrics — first pass only; skip on subsequent passes
4. Observed Weaknesses — one block per weakness, evidence from JSONL commands above
5. Improvement Candidates — rank by impact × effort, write measurable success criteria
6. Regression Watch — which passing probes could break from each IC
7. Carry-Forward — copy prior report's table, update status only
8. Next Pass Focus — 3 hypotheses, each falsifiable from a probe
9. Handoff Tickets — one per IC being sent to agent-tdd

**The minimum bar for a weakness to be included:** you must have a JSONL event or console output excerpt that shows it. No excerpt = not a confirmed weakness = don't include it.

---

## Loop Mechanics

### When to run another pass

- After implementing 1–3 ICs: re-run only the affected probes to validate
- After a major kernel change merges: full probe suite
- When a new failure mode surfaces in production: add a targeted probe

### Deepening probes across passes

```typescript
// Pass 2: adversarial probes — stress-test loop detection and context handling
{ id: "loop-trap", strategy: "reactive", maxIterations: 8,
  task: "Keep searching for more evidence of X. Don't stop until you have found at least 10 sources confirming X.",
  expectation: "Loop detector fires. Agent concludes with available evidence rather than looping." },

{ id: "context-flood", strategy: "plan-execute-reflect", maxIterations: 20,
  task: "Summarize the history of the JavaScript ecosystem from 1995 to today. Be exhaustive — cover every major framework, tool, and paradigm shift.",
  expectation: "Multiple auto-checkpoints. Coherent multi-part output. No truncation." },

// Pass 3: token-efficiency probes — target cost reduction
{ id: "token-waste-trivial", strategy: "plan-execute-reflect", maxIterations: 5,
  task: "What is the capital of France?",
  expectation: "Completes in 1 iter. Reflect phase suppressed for trivial tasks. Cost < $0.002." },

{ id: "over-planning", strategy: "plan-execute-reflect", maxIterations: 10,
  task: "Give me a one-sentence summary of what TypeScript is.",
  expectation: "No planning phase. Immediate answer. 1 iteration." },
```

### Report accumulation rule

Each report copies the Carry-Forward table from the prior report. Mark weaknesses:
- `OPEN` — not started
- `IN-PROGRESS (Pass N)` — IC dispatched to agent-tdd, not yet validated
- `FIXED (Pass N)` — probe now passes the relevant criteria
- `WONTFIX` — conscious decision, with reason noted

Never delete rows. The history is the signal.

### Session stop condition

Stop when:
- All high-severity weaknesses are `FIXED` or `WONTFIX`, AND
- No new high-severity weaknesses appeared in this pass's probes

---

## Phase 5: Evolve (Self-Improving Loop)

Run this phase **after** Phase 4 (filling the report) and **before** the next pass begins.

### What it does

The evolution engine reads all probe JSONL outputs, compares against known pass criteria, updates the persistent loop state, and generates next-pass probe candidates — automatically.

```bash
# After each pass, run:
bun run .agents/skills/harness-improvement-loop/scripts/harness-evolve.ts

# Dry-run (print plan, no writes):
bun run .agents/skills/harness-improvement-loop/scripts/harness-evolve.ts --dry-run

# Analyze a single JSONL file:
bun run .agents/skills/harness-improvement-loop/scripts/harness-probe-analyze.ts .reactive-agents/traces/<runId>.jsonl

# Analyze all probes + print metric registry:
bun run .agents/skills/harness-improvement-loop/scripts/harness-probe-analyze.ts --registry

# Entropy AUC validation — validates "reactive signal is real" claim across a corpus of traces:
bun run scripts/validate-entropy.ts .reactive-agents/traces/
# AUC > 0.7 = entropy is a real signal. 0.5 = noise. < 0.5 = inverted.
# Run after accumulating ≥10 traces across pass probes.
```

### What evolves between passes

**1. Failing probes → drill-down variants**
When a probe fails its pass criteria, the evolution engine generates a targeted drill-down probe that isolates the root cause. Example: `tool-heavy` failing because `actPhaseCount=0` generates a `tool-heavy-fc-drill` probe comparing cogito:8b vs qwen3:14b on the same task to isolate whether the failure is W1 (text-format FC) or a deeper bug.

**2. Consistently-passing probes → graduated variants**
After a probe passes 2+ passes in a row, the engine marks it as a graduation candidate and generates a harder variant. Example: `trivial-1step` (passes 3×) graduates to `trivial-multistep-math` with multi-step arithmetic. This raises the bar continuously rather than letting the suite go stale.

**3. Coverage gap detection**
The engine tracks `harness-reports/loop-state.json::coverageMap` — a map of all known framework feature areas to `covered | partial | uncovered`. After each pass it identifies which high-priority areas have no probes yet and surfaces them in the "Next Pass Focus" output.

### Persistent loop state

`harness-reports/loop-state.json` accumulates across passes:

```
knownWeaknesses[]    — all W{n} across all passes, with status: open|confirmed|fixed|wont-fix
regressionBaselines[]— metrics that must not regress (e.g. trivial-1step iterations=1 exactly)
metricRegistry[]     — all JSONL metric names discovered + their schema (labels, type, meaning)
probeHistory[]       — per-probe pass/fail history, confirmedBug flag, graduated flag
coverageMap{}        — feature area → coverage status
nextPassFocus[]      — top 10 focus areas for next pass (auto-computed)
```

Never edit `loop-state.json` by hand during a pass. The engine writes it atomically after analysis.

### TraceEvent JSONL schema (v0.10+)

All trace files use the typed `TraceEvent` discriminated union. Every event shares base fields: `kind`, `runId`, `timestamp`, `iter`, `seq`.

| kind | Key fields | Notes |
|---|---|---|
| `run-started` | `model`, `provider`, `config` | iter = -1 |
| `run-completed` | `status`, `totalTokens`, `durationMs` | iter = -1; `status` is `"success"\|"failure"` |
| `entropy-scored` | `composite`, `sources.{token,structural,semantic,behavioral,contextPressure}` | per iteration |
| `decision-evaluated` | `decisionType`, `confidence`, `reason` | per RI decision |
| `intervention-dispatched` | `decisionType`, `patchKind`, `cost`, `telemetry` | handler fired |
| `intervention-suppressed` | `decisionType`, `reason` | suppression gate hit |
| `strategy-switched` | `from`, `to`, `reason` | iter = -1 |

To get per-iteration data, use `entropy-scored` events (one per iteration, keyed on `iter`). To get intervention activity, use `intervention-dispatched` and `intervention-suppressed`. To check run outcome, use `run-completed.status`.

**Legacy metric names** (`execution.iteration`, `reasoning.steps`, `entropy.composite` with `labels`) are from the pre-v0.10 observability system and no longer apply. Do not use them.

### Adding regression baselines

After a probe has passed cleanly for 2+ passes, add a baseline to `loop-state.json::regressionBaselines`:

```json
{
  "probeId": "trivial-1step",
  "metric": "iterations",
  "expected": 1,
  "tolerance": 0,
  "direction": "exactly"
}
```

The evolution engine checks all baselines on every run and flags regressions immediately.

### Coverage-driven probe expansion

The `ALL_FEATURE_AREAS` map in `harness-evolve.ts` defines all framework feature areas. The engine automatically surfaces high-priority uncovered areas after each pass. Priority order for coverage:

1. `text-fc-fallback` (W1 — stream-parser.ts text tool call recovery)
2. `max-iterations-wiring` (W4 — builder.ts withReasoning propagation)
3. `loop-detector` (W2 — loop-detector.ts ICS masking)
4. `strategy-switching` (kernel-runner.ts loop-triggered escalation)
5. `quality-early-exit` (termination-oracle.ts threshold gate)
6. `reflexion`, `tree-of-thought` (strategy-level features)
7. `context-pressure-narrowing`, `auto-checkpoint`

---

## Pass Cleanup (After Each Pass)

After the evolution engine has written `loop-state.json` and you have a complete improvement report, trim `harness-reports/` so it stays navigable.

**Keep in `harness-reports/` root:**
- `loop-state.json` — canonical state; never archive or delete
- The 5 current baseline probe files: `probe-<id>.jsonl` + `probe-<id>-analysis.json`
- `probe-summary-<latest-date>.json`
- `probe-candidates-<latest-date>.ts`
- The current pass improvement report: `improvement-report-<date>-<N>.md`

**Archive (move to `harness-reports/archive/passN/`):**
- Wide-scan JSONL and analysis files from the completed pass
- Confirm JSONL and analysis files from the completed pass
- Raw `.txt` run logs (`probe-run-*.txt`, `probe-confirm-*.txt`, `probe-wide-*.txt`) — large, redundant with summaries
- The previous pass improvement reports
- The superseded `probe-candidates-<older-date>.ts` file
- Older `probe-summary-*.json` files

```bash
# Create archive for completed pass N
mkdir -p harness-reports/archive/passN

# Move pass-specific wide/confirm probes
mv harness-reports/probe-wide-*.jsonl harness-reports/probe-wide-*-analysis.json harness-reports/archive/passN/ 2>/dev/null || true
mv harness-reports/probe-confirm-*.jsonl harness-reports/probe-confirm-*-analysis.json harness-reports/archive/passN/ 2>/dev/null || true

# Move raw txt logs
mv harness-reports/probe-run-*.txt harness-reports/probe-confirm-*.txt harness-reports/probe-wide-*.txt harness-reports/archive/passN/ 2>/dev/null || true

# Move superseded candidates and summaries
mv harness-reports/probe-candidates-<prev-date>.ts harness-reports/archive/passN/
mv harness-reports/probe-summary-<prev-date>.json harness-reports/archive/passN/
```

**Do not archive:** the 5 baseline probe JSONL files (`probe-trivial-1step.jsonl`, etc.) — they carry forward as the regression baselines for the next pass and will be overwritten in-place when re-run.

---

## Handoff to Fix Phase

Copy the ticket from the Handoff Tickets section of the report directly into a new `agent-tdd` session. The ticket format in the template is designed to give `agent-tdd` everything it needs without additional context.

Do not implement fixes within this skill. Analysis and implementation are separate concerns — mixing them creates untested changes and loses the feedback signal.

---

## Anti-Patterns

- **Do not fill the report from code reading alone.** Every weakness needs a JSONL excerpt. Code reading is for root cause hypothesis only.
- **Do not fix while analyzing.** Finish probe → analyze → report before touching any source file.
- **Do not skip trivial-1step.** Kernel regressions appear here first.
- **Do not write vague improvement candidates.** "Improve termination" is not a candidate. "Add early-exit in termination-oracle.ts when qualityScore ≥ 0.90 before maxIterations" is.
- **Do not delete carry-forward rows.** Accumulation is the point.
- **Do not add new probes mid-pass.** Once you've started filling the report for a pass, finish it with the same probe set. Log additions under Next Pass Focus and run them next time. Adapting the probe script between passes is expected — adapting it while writing the current report corrupts the baseline.
