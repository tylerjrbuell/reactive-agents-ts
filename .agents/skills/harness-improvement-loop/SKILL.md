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

```bash
mkdir -p harness-reports
cp .agents/skills/harness-improvement-loop/REPORT-TEMPLATE.md \
   harness-reports/improvement-report-$(date +%Y%m%d)-1.md
```

Create the probe runner:

```typescript
// scripts/harness-probe.ts
import { ReactiveAgents } from "@reactive-agents/runtime";
import { writeFileSync, mkdirSync } from "fs";

interface ProbeConfig {
  id: string;
  strategy: string;
  maxIterations: number;
  task: string;
  expectation: string;
}

interface ProbeResult {
  id: string;
  strategy: string;
  maxIterationsAllowed: number;
  iterationsUsed: number | null;
  success: boolean;
  outputLength: number;
  durationMs: number;
  costUsd: number | null;
  qualityScore: number | null;
  contextPeakRatio: number | null;
  duplicateToolCalls: number;
  wastedIterations: number;
  outputPreview: string;
}

const PROBES: ProbeConfig[] = [
  {
    id: "trivial-1step",
    strategy: "reactive",
    maxIterations: 5,
    task: "What is 12 × 15?",
    expectation: "1 iteration, no tool calls, immediate final-answer",
  },
  {
    id: "multistep-research",
    strategy: "plan-execute-reflect",
    maxIterations: 15,
    task: "Find 3 key differences between React Server Components and Client Components. Cite why each difference matters.",
    expectation: "Plans, searches once or twice, synthesizes with citations, terminates with reflect pass",
  },
  {
    id: "tool-heavy",
    strategy: "adaptive",
    maxIterations: 12,
    task: "Search for the latest TypeScript release notes and extract the 5 most impactful new features.",
    expectation: "1–2 web-search calls, no duplicate queries, clean extraction",
  },
  {
    id: "context-pressure",
    strategy: "plan-execute-reflect",
    maxIterations: 20,
    task: "Research the history of functional programming languages from LISP to today. Cover at least 8 languages with dates and key innovations for each.",
    expectation: "Auto-checkpoint fires before context limit. State is preserved. Output is coherent.",
  },
  {
    id: "termination-quality",
    strategy: "adaptive",
    maxIterations: 10,
    task: "Explain the CAP theorem and give a concrete real-world example of each of the three trade-offs.",
    expectation: "Early termination when quality gate passes. Does not exhaust maxIterations.",
  },
];

async function runProbe(probe: ProbeConfig): Promise<ProbeResult> {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`PROBE: ${probe.id} | strategy: ${probe.strategy} | maxIter: ${probe.maxIterations}`);
  console.log(`TASK:   ${probe.task}`);
  console.log(`EXPECT: ${probe.expectation}`);
  console.log("=".repeat(70));

  const agent = await ReactiveAgents.create()
    .withProvider("anthropic")
    .withReasoning({
      defaultStrategy: probe.strategy as any,
      maxIterations: probe.maxIterations,
    })
    .withTools({ allowedTools: ["web-search", "http-get", "checkpoint", "final-answer"] })
    .withObservability({
      verbosity: "debug",
      live: true,
      logModelIO: true,
      file: `./harness-reports/probe-${probe.id}.jsonl`,
    })
    .build();

  const start = Date.now();
  const result = await agent.run(probe.task);
  const durationMs = Date.now() - start;

  await agent.dispose();

  // Extract metrics from JSONL after run
  const metrics = extractMetricsFromJsonl(`./harness-reports/probe-${probe.id}.jsonl`);

  const probeResult: ProbeResult = {
    id: probe.id,
    strategy: probe.strategy,
    maxIterationsAllowed: probe.maxIterations,
    iterationsUsed: result.metadata?.iterations ?? metrics.iterations,
    success: result.success,
    outputLength: result.output.length,
    durationMs,
    costUsd: result.cost?.total ?? null,
    qualityScore: metrics.finalQualityScore,
    contextPeakRatio: metrics.contextPeakRatio,
    duplicateToolCalls: metrics.duplicateToolCalls,
    wastedIterations: metrics.wastedIterations,
    outputPreview: result.output.slice(0, 400),
  };

  console.log(`\n--- RESULT ---`);
  console.log(`Success:          ${probeResult.success}`);
  console.log(`Iterations:       ${probeResult.iterationsUsed} / ${probe.maxIterations}`);
  console.log(`Wasted iters:     ${probeResult.wastedIterations}`);
  console.log(`Duplicate calls:  ${probeResult.duplicateToolCalls}`);
  console.log(`Context peak:     ${probeResult.contextPeakRatio != null ? (probeResult.contextPeakRatio * 100).toFixed(1) + "%" : "?"}`);
  console.log(`Quality score:    ${probeResult.qualityScore ?? "?"}`);
  console.log(`Duration:         ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`Cost:             $${probeResult.costUsd?.toFixed(4) ?? "?"}`);
  console.log(`\nOutput preview:\n${probeResult.outputPreview}`);

  return probeResult;
}

function extractMetricsFromJsonl(path: string): {
  iterations: number | null;
  finalQualityScore: number | null;
  contextPeakRatio: number | null;
  duplicateToolCalls: number;
  wastedIterations: number;
} {
  try {
    const lines = Bun.file(path).toString().trim().split("\n").filter(Boolean);
    const events = lines.map((l) => JSON.parse(l));

    // Quality score: last event with a quality score field
    const qualityEvents = events.filter((e) => e.qualityScore != null);
    const finalQualityScore = qualityEvents.at(-1)?.qualityScore ?? null;

    // Context peak: max contextRatio seen across all think events
    const contextRatios = events.filter((e) => e.contextRatio != null).map((e) => e.contextRatio);
    const contextPeakRatio = contextRatios.length > 0 ? Math.max(...contextRatios) : null;

    // Iteration count: count ThinkStart events
    const iterations = events.filter((e) => e.event === "ThinkStart" || e.phase === "think").length || null;

    // Duplicate tool calls: count ToolCallStart events with same name+args seen >1 time
    const toolCallKeys = events
      .filter((e) => e.event === "ToolCallStart")
      .map((e) => `${e.toolName}::${JSON.stringify(e.args)}`);
    const seen = new Set<string>();
    let duplicateToolCalls = 0;
    for (const key of toolCallKeys) {
      if (seen.has(key)) duplicateToolCalls++;
      seen.add(key);
    }

    // Wasted iterations: think events with no tool call and no final-answer in same iteration
    // Simplified: think events immediately followed by another think event
    let wastedIterations = 0;
    for (let i = 0; i < events.length - 1; i++) {
      const curr = events[i];
      const next = events[i + 1];
      if (
        (curr.event === "ThinkStart" || curr.phase === "think") &&
        (next.event === "ThinkStart" || next.phase === "think")
      ) {
        wastedIterations++;
      }
    }

    return { iterations, finalQualityScore, contextPeakRatio, duplicateToolCalls, wastedIterations };
  } catch {
    return { iterations: null, finalQualityScore: null, contextPeakRatio: null, duplicateToolCalls: 0, wastedIterations: 0 };
  }
}

async function main() {
  mkdirSync("harness-reports", { recursive: true });

  const results: ProbeResult[] = [];
  for (const probe of PROBES) {
    const result = await runProbe(probe);
    results.push(result);
  }

  // Write summary JSON for easy cross-pass comparison
  writeFileSync(
    `harness-reports/probe-summary-${new Date().toISOString().slice(0, 16).replace("T", "-")}.json`,
    JSON.stringify(results, null, 2),
  );

  console.log("\n✅ All probes complete.");
  console.log("   JSONL logs: harness-reports/probe-{id}.jsonl");
  console.log("   Summary:    harness-reports/probe-summary-*.json");
  console.log("   Fill in:    harness-reports/improvement-report-*.md");
}

main().catch(console.error);
```

Run:

```bash
bun run scripts/harness-probe.ts 2>&1 | tee harness-reports/probe-run-$(date +%Y%m%d-%H%M).txt
```

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
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
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
bun run scripts/harness-probe.ts 2>&1 | tee harness-reports/probe-run-$(date +%Y%m%d-%H%M).txt
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
- **Do not add new probes mid-pass.** Log them under Next Pass Focus and run them next time.
