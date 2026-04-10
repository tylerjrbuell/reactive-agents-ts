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

## What "the Harness" Means

The harness is every system that sits between a task string and a high-quality final answer:

| Component | Location |
|-----------|----------|
| Kernel loop | `packages/reasoning/src/strategies/kernel/kernel-runner.ts` |
| Phase pipeline | `packages/reasoning/src/strategies/kernel/phases/` (think, act, guard, context-builder) |
| Kernel utilities | `packages/reasoning/src/strategies/kernel/utils/` (termination-oracle, quality-utils, auto-checkpoint, output-synthesis, task-intent, tool-capabilities) |
| Reasoning strategies | `packages/reasoning/src/strategies/` (adaptive, reactive, plan-execute-reflect, tree-of-thought) |
| Provider adapters | `packages/reasoning/src/strategies/kernel/utils/tool-capabilities.ts` + `packages/llm-provider/src/adapters/` |
| Context pressure system | `packages/reasoning/src/context/` (context-profile, profile-resolver) |
| Output quality gate | Quality scoring in `quality-utils.ts`, `output-synthesis.ts` |

The builder, tools, memory, MCP, and UI layers are **out of scope** for this skill. Focus on kernel → strategy → output.

---

## Phase 1: Orient (Do Not Skip)

Read these files in order before running any probes. Understanding current state prevents misdiagnosing probe results.

```bash
# 1. Architecture and recent changes
cat AGENTS.md | head -120
git log --oneline -20

# 2. Kernel runner — the main loop
cat packages/reasoning/src/strategies/kernel/kernel-runner.ts

# 3. Four phases
cat packages/reasoning/src/strategies/kernel/phases/think.ts
cat packages/reasoning/src/strategies/kernel/phases/act.ts
cat packages/reasoning/src/strategies/kernel/phases/guard.ts
cat packages/reasoning/src/strategies/kernel/phases/context-builder.ts

# 4. Key utilities driving decisions
cat packages/reasoning/src/strategies/kernel/utils/termination-oracle.ts
cat packages/reasoning/src/strategies/kernel/utils/quality-utils.ts
cat packages/reasoning/src/strategies/kernel/utils/auto-checkpoint.ts
cat packages/reasoning/src/strategies/kernel/utils/output-synthesis.ts
cat packages/reasoning/src/strategies/kernel/utils/task-intent.ts

# 5. Context pressure configuration
cat packages/reasoning/src/context/context-profile.ts
```

Record: current maxIterations defaults, context pressure thresholds, quality score thresholds, termination conditions.

---

## Phase 2: Instrument (Probe Runner Setup)

Create a probe runner script. This captures structured output for analysis.

```typescript
// scripts/harness-probe.ts
import { ReactiveAgents } from "@reactive-agents/runtime";

const PROBES = [
  {
    id: "trivial-1step",
    strategy: "reactive",
    maxIterations: 5,
    task: "What is 12 × 15?",
    expectation: "Completes in 1 iteration, no tool calls",
  },
  {
    id: "multistep-research",
    strategy: "plan-execute-reflect",
    maxIterations: 15,
    task: "Find 3 key differences between React Server Components and Client Components. Cite the reason each matters.",
    expectation: "Plans, searches web, synthesizes with citations, stops when complete",
  },
  {
    id: "tool-heavy",
    strategy: "adaptive",
    maxIterations: 12,
    task: "Search for the latest TypeScript release notes and extract the 5 most impactful new features.",
    expectation: "Calls web-search once or twice, extracts cleanly, does not over-search",
  },
  {
    id: "context-pressure",
    strategy: "plan-execute-reflect",
    maxIterations: 20,
    task: "Research the history of functional programming languages from LISP to today. Cover at least 8 languages with dates and key innovations.",
    expectation: "Auto-checkpoint fires at context pressure threshold. Does not truncate mid-synthesis.",
  },
  {
    id: "termination-quality",
    strategy: "adaptive",
    maxIterations: 10,
    task: "Explain the CAP theorem and give a real-world example of each trade-off.",
    expectation: "Terminates when output quality gate passes. Does not continue after a good answer.",
  },
];

async function runProbe(probe: typeof PROBES[0]) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`PROBE: ${probe.id} | strategy: ${probe.strategy}`);
  console.log(`TASK: ${probe.task}`);
  console.log(`EXPECT: ${probe.expectation}`);
  console.log("=".repeat(60));

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

  console.log(`\n--- RESULT ---`);
  console.log(`Success: ${result.success}`);
  console.log(`Iterations used: ${result.metadata?.iterations ?? "?"} / ${probe.maxIterations}`);
  console.log(`Duration: ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`Cost: $${result.cost?.total.toFixed(4) ?? "?"}`);
  console.log(`Output length: ${result.output.length} chars`);
  console.log(`\nOutput preview:\n${result.output.slice(0, 300)}...`);

  await agent.dispose();
  return { probe, result, durationMs };
}

async function main() {
  // Create output directory
  await Bun.write("./harness-reports/.gitkeep", "");

  for (const probe of PROBES) {
    await runProbe(probe);
  }

  console.log("\n✅ All probes complete. JSONL logs in ./harness-reports/");
}

main().catch(console.error);
```

Run it:

```bash
mkdir -p harness-reports
bun run scripts/harness-probe.ts 2>&1 | tee harness-reports/probe-run-$(date +%Y%m%d-%H%M).txt
```

---

## Phase 3: Analyze Output

For each probe, answer these questions from the live output and JSONL logs. This is the core diagnostic work.

### Termination quality

- Did the agent stop **when it had a good answer** or did it keep going unnecessarily?
- Did it hit `maxIterations` on a task that should have terminated early?
- Did `final-answer` get called at the right moment or too early / too late?

Signals in output: `TerminationOracle` decisions, quality scores logged by `quality-utils`, any "max iterations reached" messages.

### Loop efficiency

- Were any tool calls **repeated** with identical arguments? (loop detector should catch this)
- Did the agent call multiple tools when one would have been sufficient?
- Were there "thought" iterations with no tool call? (stuck in reflection without action)

Signals: repeated `ToolCallStart` events for same tool+args, iterations with 0 tool calls between `think` events.

### Context pressure behavior

- Did `auto-checkpoint` fire? At what context ratio?
- After auto-checkpoint, did the agent **correctly resume** with preserved state?
- Did context pressure cause the output to be truncated or summarized prematurely?

Signals: `CheckpointSave` events in the stream, context ratio in think phase logs, any "context window approaching limit" events.

### Output synthesis quality

- Is the final output **well-formed** for the task type (structured answer, cited, complete)?
- Did the output quality gate pass or get bypassed?
- For plan-execute-reflect: did the reflect phase actually improve the output?

Signals: `OutputSynthesis` events, quality scores in debug output, reflect phase content.

### Strategy selection (adaptive only)

- Did `adaptive` strategy pick the right underlying strategy for each task?
- Did it switch strategies mid-run? Was the switch justified?

Signals: strategy selection log at run start, any mid-run strategy switch events.

### Tool capability signals

- Were tool descriptions in the LLM's tool schemas clear enough to drive correct selection?
- Did the agent call `checkpoint` when it should? (`context-pressure` probe especially)

---

## Phase 4: Report Generation

After each probe run, generate this report. Save to `harness-reports/improvement-report-YYYYMMDD-N.md` where N increments with each pass.

```markdown
# Harness Improvement Report — {DATE} Pass {N}

## Probe Run Summary

| Probe | Strategy | Iterations Used / Max | Duration | Cost | Pass? |
|-------|----------|----------------------|----------|------|-------|
| trivial-1step | reactive | ? / 5 | ?s | $? | ✅/❌ |
| multistep-research | plan-execute-reflect | ? / 15 | ?s | $? | ✅/❌ |
| tool-heavy | adaptive | ? / 12 | ?s | $? | ✅/❌ |
| context-pressure | plan-execute-reflect | ? / 20 | ?s | $? | ✅/❌ |
| termination-quality | adaptive | ? / 10 | ?s | $? | ✅/❌ |

## Observed Weaknesses

### [W1] {Weakness title} — Severity: high/medium/low

**Observed:** {What actually happened in the probe output}
**Expected:** {What should have happened}
**Evidence:** {Specific output excerpt or JSONL event that shows it}
**File(s):** {packages/reasoning/src/... line ~N}
**Hypothesis:** {Why this is happening based on code review}
**Impact:** {What tasks/users does this hurt}

### [W2] ...

## Improvement Candidates

Ordered by expected impact × implementation difficulty:

| ID | Weakness | Change Required | File | Effort | Risk |
|----|----------|----------------|------|--------|------|
| IC-1 | W1 | {Specific change} | {file:line} | S/M/L | low/med/high |
| IC-2 | ... | | | | |

## Regressions Watched

List probes that were passing before this run and what to protect:

- probe X was passing — any change to {component} risks breaking it

## Carry-Forward from Prior Reports

{Copy forward unresolved weaknesses from previous reports — do not lose context across passes}

## Next Pass Focus

{1-3 specific hypotheses to test in the next probe run, based on this report}
```

---

## Loop Mechanics

### When to iterate

Run another probe loop after:
- Implementing 1-3 improvement candidates (validate the fix worked)
- A major kernel change merges to the branch
- A new probe task reveals a previously unseen pattern

### Deepening the probes

As weaknesses are fixed, make probes harder:

```typescript
// Pass 1: simple probes (above)
// Pass 2: add adversarial probes
{
  id: "loop-trap",
  task: "Keep searching until you find evidence that X, then report Y",
  expectation: "Loop detector catches the trap, agent concludes with available evidence",
},
{
  id: "context-flood",
  task: "Summarize the full React documentation. Be comprehensive.",
  expectation: "Auto-checkpoint fires multiple times. Output is a coherent summary, not truncated.",
},
// Pass 3: cost-efficiency probes
{
  id: "token-waste",
  strategy: "plan-execute-reflect",
  maxIterations: 5,
  task: "What is the capital of France?",
  expectation: "Completes in 1 iteration with minimal tokens. Reflect phase does not fire for trivial tasks.",
},
```

### Report accumulation

Each report inherits the "Carry-Forward" section from the prior report. Never delete weakness entries — mark them `✅ FIXED (Pass N)` when resolved and confirmed by probe.

### Stop condition for a session

Stop when:
- All high-severity weaknesses in the current report are marked `✅ FIXED`
- OR the remaining weaknesses require architectural changes that need a separate planning session

---

## Handoff to Fix Phase

When a weakness has a clear improvement candidate, hand off to `agent-tdd`:

```
IC-1 from harness-improvement-report-20260410-1.md:

Weakness: Termination oracle does not fire early when quality score ≥ 0.90
File: packages/reasoning/src/strategies/kernel/utils/termination-oracle.ts
Change: Add early-exit path when quality score exceeds HIGH_CONFIDENCE_THRESHOLD before maxIterations
Test needed: Add test in packages/reasoning/tests/shared/termination-oracle.test.ts
  - Input: state with quality score 0.92, iteration 4 of 15
  - Expected: oracle returns "terminate" not "continue"
  - Current: oracle returns "continue" regardless of quality score before iteration limit
```

Give `agent-tdd` the weakness description, file path, specific change, and the expected test behavior. Do not implement fixes within this skill — that causes mixed concerns.

---

## Anti-Patterns

- **Do not improve from code reading alone.** If you haven't run probes, you're guessing. Run the probes first.
- **Do not fix while analyzing.** Complete the full probe → analyze → report cycle before touching any source file.
- **Do not skip the trivial-1step probe.** Regressions in the kernel loop often show up as 1-step tasks suddenly using 3 iterations.
- **Do not delete prior weakness entries from reports.** Accumulation is the point — losing history loses signal.
- **Do not expand probe scope mid-pass.** If you discover a new failure mode while analyzing, add it to "Next Pass Focus" rather than stopping to add a new probe now.
