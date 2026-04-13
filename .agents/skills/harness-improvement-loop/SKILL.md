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

## Phase 2b: Observability — Getting Actionable Output

The probe runner script produces two output streams that the analysis phase depends on. Both must be configured before running probes. If either is missing, the jq extraction commands in Phase 3 will return empty or misleading results.

### The two output streams

| Stream | Config | What it produces |
|--------|--------|-----------------|
| **Live console** | `verbosity: "debug", live: true` | Real-time phase traces, tool calls, quality scores, strategy decisions — lets you watch the loop in progress and catch obvious problems (infinite loops, wrong strategy selection) before reading JSONL |
| **JSONL file** | `file: "./harness-reports/probe-{id}.jsonl"` | Structured event log for post-run jq analysis — every kernel event with timestamps, token counts, context ratios, quality scores, tool call payloads |

Both are required. Live console without JSONL = you can watch but can't extract metrics. JSONL without live = you can't diagnose problems during a long run.

### Observability builder config

The probe runner already sets this correctly. When writing custom probes or debugging, use:

```typescript
// Use local Ollama model — no API cost for harness probing
const agent = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel({ model: "qwen2.5:7b" }) // or PROBE_MODEL from harness-probe.ts
  .withReasoning({ defaultStrategy: "adaptive", maxIterations: 12 })
  .withObservability({
    verbosity: "debug",   // emits full phase traces + quality scores + context ratios
    live: true,           // streams events to console in real time (do not omit — buffered output arrives too late)
    logModelIO: true,     // logs full system prompts and model responses (auto-enabled at "debug")
    file: "./harness-reports/probe-trivial-1step.jsonl",  // structured event capture
  })
  .build();
```

### What each setting produces

**`verbosity: "debug"`** — the only level that emits all fields needed for analysis:
- Phase entry/exit: `{ event: "phase", phase: "think"|"act"|"guard", iteration: N }`
- Strategy decisions: `{ event: "strategy_selected", strategy: "reactive"|"adaptive"|..., reason: "..." }`
- Quality scores: `{ event: "quality_check", score: 0.0–1.0, dimension: "...", iteration: N }`
- Context pressure: `{ event: "context_ratio", ratio: 0.0–1.0, tokens_used: N, tokens_max: N }`
- Termination: `{ event: "terminated", reason: "final-answer"|"maxIterations"|"quality-threshold"|"...", iterations: N }`

At `"verbose"` or lower, quality scores and context ratios are omitted — the jq commands in Phase 3 will return no data.

**`live: true`** — sends each event to stdout as it fires, not buffered. Required when:
- Watching for infinite loops (you'll see iterations increment live)
- Confirming a probe terminates within expected iterations before it hits maxIterations
- Spotting strategy mismatches in real time

Omitting `live` (or setting `live: false`) means all output arrives after the run completes — you lose the ability to abort a runaway probe early.

**`logModelIO: true`** — logs the full system prompt and model response for each LLM call. This is the only way to diagnose prompt-quality issues (e.g., injected framing that nudges the model toward unnecessary tool calls, or missing context that causes extra iterations). Automatically enabled when `verbosity: "debug"`. Set explicitly if using a lower verbosity level but still need raw prompt inspection.

**`file: "./harness-reports/probe-{id}.jsonl"`** — one file per probe, named by probe ID. Each line is a JSON event object. This file is the input to every jq command in Phase 3. Without it, analysis is impossible. The probe runner script creates the `harness-reports/` directory automatically; if running manually, create it first.

### Reading live output during a run

The probe runner pipes everything through `tee`, so you see live output AND capture it to a text file simultaneously:

```
[think:1] strategy=reactive | context=12% | tools_available=4
[act:1]   tool=web-search | query="..." | duration=1.2s
[think:2] quality=0.91 | signal=high | novelty=low → terminating
[terminated] reason=quality-threshold | iterations=2 | cost=$0.003
```

Signals to watch for during a run:
- `strategy=reactive` on a multi-step task → strategy routing is wrong
- Iteration counter climbing past 5 on a trivial task → loop or quality threshold problem  
- `context=85%+` before iteration 8 → context pressure building faster than expected
- Same tool called twice with identical args → duplicate tool call (loop detector not firing)
- `reason=maxIterations` → agent did not self-terminate — this is always a failure on answerable questions

### Capturing the full output

The probe runner script already handles this:

```bash
bun run .agents/skills/harness-improvement-loop/scripts/harness-probe.ts 2>&1 | tee harness-reports/probe-run-$(date +%Y%m%d-%H%M).txt
```

`2>&1` captures both stdout (live events) and stderr (any errors or warnings from the SDK). The `.txt` file is the audit trail for the pass; the per-probe `.jsonl` files are the analysis inputs.

---

## Phase 3: Analyze Output

Use these extraction commands on the JSONL files. Run them after the probe script finishes. The output of these commands is what fills the "Observed behavior" and "Evidence" fields in the report.

### Termination quality

```bash
# When did final-answer fire relative to maxIterations?
jq 'select(.event == "FinalAnswer" or .event == "TerminationDecision")' \
  harness-reports/probe-termination-quality.jsonl

# What quality score triggered (or failed to trigger) termination?
jq 'select(.qualityScore != null) | {iter: .iteration, score: .qualityScore, decision: .terminationDecision}' \
  harness-reports/probe-termination-quality.jsonl

# Did it hit maxIterations?
jq -s 'map(select(.event == "ThinkStart")) | length' \
  harness-reports/probe-termination-quality.jsonl
```

### Loop efficiency (duplicate + wasted iterations)

```bash
# All tool calls with name and args — look for duplicates
jq 'select(.event == "ToolCallStart") | {tool: .toolName, args: .args}' \
  harness-reports/probe-tool-heavy.jsonl

# Think events with no subsequent tool call (wasted iterations)
# Look for consecutive ThinkStart events in the event stream
jq 'select(.event == "ThinkStart" or .event == "ToolCallStart" or .event == "FinalAnswer") | {event, iteration: .iteration}' \
  harness-reports/probe-multistep-research.jsonl
```

### Context pressure behavior

```bash
# Context ratio at each think phase — find peak and checkpoint trigger point
jq 'select(.contextRatio != null) | {iter: .iteration, ratio: .contextRatio, phase: .phase}' \
  harness-reports/probe-context-pressure.jsonl

# Did auto-checkpoint fire? When?
jq 'select(.event == "AutoCheckpoint" or .event == "CheckpointSave")' \
  harness-reports/probe-context-pressure.jsonl

# Was context restored after checkpoint?
jq 'select(.event == "CheckpointRestore" or .event == "ContextRestored")' \
  harness-reports/probe-context-pressure.jsonl
```

### Output synthesis quality

```bash
# Quality scores across the full run — see the progression
jq 'select(.qualityScore != null) | {iter: .iteration, score: .qualityScore, phase: .phase}' \
  harness-reports/probe-termination-quality.jsonl

# Reflect phase content — did it actually improve anything?
jq 'select(.phase == "reflect") | {iter: .iteration, input_length: (.input | length), output_length: (.output | length)}' \
  harness-reports/probe-multistep-research.jsonl

# OutputSynthesis events
jq 'select(.event == "OutputSynthesis")' \
  harness-reports/probe-termination-quality.jsonl
```

### Strategy selection (adaptive probes only)

```bash
# Which strategy did adaptive pick and when?
jq 'select(.event == "StrategySelected" or .event == "StrategySwitch")' \
  harness-reports/probe-tool-heavy.jsonl \
  harness-reports/probe-termination-quality.jsonl

# Task intent classification
jq 'select(.event == "TaskIntentClassified")' \
  harness-reports/probe-tool-heavy.jsonl
```

### Cross-probe comparison

```bash
# Compare iteration counts and costs across all probes
jq -s '[.[] | {id: .id, iters: .iterationsUsed, cost: .costUsd, quality: .qualityScore}]' \
  harness-reports/probe-summary-*.json | jq '.[-1]'
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
bun run .agents/skills/harness-improvement-loop/scripts/harness-probe-analyze.ts harness-reports/probe-tool-heavy.jsonl

# Analyze all probes + print metric registry:
bun run .agents/skills/harness-improvement-loop/scripts/harness-probe-analyze.ts --registry
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

### Correct JSONL metric schema

The probe analysis scripts use the real schema discovered from live runs:

| Metric name | Type | When emitted | Key labels |
|---|---|---|---|
| `execution.iteration` | gauge | once at end | `taskId` |
| `reasoning.steps` | counter | per kernel step (value=1) | `strategy`, `kernelPass` |
| `entropy.composite` | gauge | per iteration | `iteration`, `shape`, `confidence` |
| `execution.phase.count` | counter | per phase execution | `phase` |
| `execution.phase.duration_ms` | histogram | per phase | `phase` |
| `execution.tokens_used` | gauge | once at end | `taskId` |
| `execution.tool.execution` | counter | per tool call | — |

**Critical**: `execution.iteration` fires **once** at the end (not per-iteration). To get per-iteration data, use `entropy.composite` with `labels.iteration`, or count `reasoning.steps` records. The broken jq commands in Phase 3 above assume a per-event `{event: "ThinkStart"}` schema that does not exist — always use `harness-probe-analyze.ts` instead of raw jq.

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
