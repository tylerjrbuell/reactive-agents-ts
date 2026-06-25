# Eval Canonical System — Phase 3 (Wire-the-Why) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax. Follow the project's `agent-tdd` skill (Bun test, mandatory `--timeout`).

**Goal:** Attach the "why" to every benchmark run — capture a trace per run, run `analyzeRun`, and attach a slim `RunDiagnosis` (honesty label + failure modes + blind spots) to the run's `RunScore`, then surface it in the bench output when a run flags something. Turns a bench result from a bare number into a number + why.

**Architecture:** Benchmarks-scoped, NO runtime change. Key fact: the trace JSONL is named by `taskId` (the trace bridge maps `AgentEvent.taskId → TraceEvent.runId`, written to `${dir}/${taskId}.jsonl`), and `AgentResult` already exposes `taskId`. So the bench enables tracing to `session.traceDir`, then after each `agent.run()` loads `${traceDir}/${result.taskId}.jsonl`, calls the pure `analyzeRun` (from published `@reactive-agents/trace`), projects to a slim `RunDiagnosis`, and attaches it to `RunScore`. Tracing is opt-in per session: only sessions that set `traceDir` capture traces + diagnosis (backward compatible).

**Tech Stack:** TypeScript, Bun test. `analyzeRun`/`loadTrace` from `@reactive-agents/trace` (pure/async-load). Plain interfaces.

## Global Constraints

- **NO runtime-package change.** Use `result.taskId` (already on `AgentResult`) as the trace key. Do NOT add `runId` to `AgentResult` — taskId is the trace filename. (Exposing the durable runId is a separate, deferred nice-to-have.)
- **Decisions locked:** capture via `result.taskId` → `${traceDir}/<taskId>.jsonl`; payload = slim `RunDiagnosis` (honesty `{label, evidence}` + `failureModes[]` + `blindSpots[]`); scope = capture + attach + surface in bench output.
- **Opt-in per session:** tracing+diagnosis only when `session.traceDir` is set. Sessions without it behave exactly as today (no tracing overhead, no diagnosis). Never throw if a trace file is missing/unreadable — diagnosis is best-effort (`undefined` on failure).
- **`analyzeRun` is pure + sync; `loadTrace` is async** (reads the JSONL file). Both from `@reactive-agents/trace` (published; legal dep from private benchmarks).
- **No behavior change to scoring.** Diagnosis is additive metadata on `RunScore`; existing tests stay green.
- **Clean types:** strict TS, no `any`. Conventional Commits, NO `Co-Authored-By` trailer.
- **Import extensions:** match `packages/benchmarks/src` siblings (`.js`). Test command: `bun test <path> --timeout 10000` (or 20000 for the full benchmarks dir). Build: `bunx turbo run build --filter=@reactive-agents/benchmarks`.

---

## File Structure

- Modify `packages/benchmarks/package.json` — add `@reactive-agents/trace` dependency.
- Modify `packages/benchmarks/src/types.ts` — add `RunDiagnosis` interface; add `diagnosis?: RunDiagnosis` to `RunScore`.
- Create `packages/benchmarks/src/diagnose.ts` — `projectDiagnosis(analysis) → RunDiagnosis` (pure) + `diagnoseRun(traceDir, taskId) → Promise<RunDiagnosis | undefined>` (load→analyze→project, best-effort) + `formatDiagnosisLine(diag) → string | null` (render, null when nothing to flag).
- Modify `packages/benchmarks/src/runner.ts` — enable `.withTracing({ dir })` when `session.traceDir` set; set `traceId = result.taskId`; call `diagnoseRun`; attach `diagnosis` to `RunScore`; print the diagnosis line.
- Create `packages/benchmarks/tests/diagnose.test.ts` — fixtures + tests for the three `diagnose.ts` functions.

---

## Task 1: `RunDiagnosis` type + pure projection + render

**Files:**
- Modify: `packages/benchmarks/package.json`
- Modify: `packages/benchmarks/src/types.ts`
- Create: `packages/benchmarks/src/diagnose.ts`
- Test: `packages/benchmarks/tests/diagnose.test.ts`

**Interfaces:**
- Consumes: `RunAnalysis`, `HonestyCheck`, `FailureMode`, `CoverageReport` from `@reactive-agents/trace`.
- Produces:
  - `interface RunDiagnosis { readonly honestyLabel: string; readonly honestyEvidence: string; readonly failureModes: readonly { mode: string; evidence: string }[]; readonly blindSpots: readonly string[] }`
  - `RunScore` gains `readonly diagnosis?: RunDiagnosis`
  - `projectDiagnosis(analysis: RunAnalysis): RunDiagnosis` (pure)
  - `formatDiagnosisLine(diag: RunDiagnosis): string | null` (null when honesty is clean AND no failure modes AND no blind spots)

- [ ] **Step 1: Inspect the exact trace shapes + add the dependency**

Run: `grep -n "interface RunAnalysis\|interface HonestyCheck\|interface FailureMode\|interface CoverageReport\|blindSpots" packages/trace/src/analyze.ts` and `grep -n "analyzeRun\|loadTrace\|RunAnalysis\|HonestyCheck\|FailureMode\|CoverageReport" packages/trace/src/index.ts`
Confirm: the exact field names — `HonestyCheck.label` + `HonestyCheck.evidence`; `FailureMode.mode` + `FailureMode.evidence`; and the EXACT shape of `CoverageReport.blindSpots` (likely `{ metric: string; why: string }[]` — note the real field names). Confirm `analyzeRun`, `loadTrace`, and these types are exported from `@reactive-agents/trace`'s package entry. Adapt the projection in Step 4 to the real `blindSpots` shape.

Add to `packages/benchmarks/package.json` `dependencies` (match the workspace-version style of the existing `@reactive-agents/core` entry):
```json
"@reactive-agents/trace": "workspace:*",
```
Then run `bun install` (or the repo's install) so the workspace link resolves.

- [ ] **Step 2: Write the failing tests**

Create `packages/benchmarks/tests/diagnose.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { RunAnalysis } from "@reactive-agents/trace";
import {
  formatDiagnosisLine,
  projectDiagnosis,
} from "../src/diagnose.js";

// Minimal RunAnalysis fixture — only the fields projectDiagnosis reads.
function analysis(p: {
  label?: string;
  evidence?: string;
  failureModes?: { mode: string; evidence: string }[];
  blindSpots?: { metric: string; why: string }[];
}): RunAnalysis {
  return {
    runId: "t1",
    iterations: 3,
    honesty: {
      claimedSuccess: true,
      deliverableProduced: false,
      substantiveWorkDone: false,
      label: p.label ?? "honest-failure",
      evidence: p.evidence ?? "no claim",
    },
    interventions: {} as RunAnalysis["interventions"],
    pressure: {} as RunAnalysis["pressure"],
    cost: {} as RunAnalysis["cost"],
    reasoning: {} as RunAnalysis["reasoning"],
    tools: [],
    failureModes: p.failureModes ?? [],
    coverage: { blindSpots: p.blindSpots ?? [] } as RunAnalysis["coverage"],
  } as RunAnalysis;
}

describe("projectDiagnosis", () => {
  it("projects honesty label + evidence", () => {
    const d = projectDiagnosis(
      analysis({ label: "dishonest-success-suspected", evidence: "claimed success, no deliverable" }),
    );
    expect(d.honestyLabel).toBe("dishonest-success-suspected");
    expect(d.honestyEvidence).toBe("claimed success, no deliverable");
  });

  it("carries failure modes through", () => {
    const d = projectDiagnosis(
      analysis({ failureModes: [{ mode: "nudge-loop", evidence: "recall steered 4x" }] }),
    );
    expect(d.failureModes).toEqual([{ mode: "nudge-loop", evidence: "recall steered 4x" }]);
  });

  it("flattens blind spots to strings", () => {
    const d = projectDiagnosis(
      analysis({ blindSpots: [{ metric: "cache-tokens", why: "no llm-exchange events" }] }),
    );
    expect(d.blindSpots.length).toBe(1);
    expect(d.blindSpots[0]).toContain("cache-tokens");
    expect(d.blindSpots[0]).toContain("no llm-exchange events");
  });
});

describe("formatDiagnosisLine", () => {
  it("returns null when nothing is flagged (honest, no modes, no blind spots)", () => {
    const d = projectDiagnosis(analysis({ label: "honest-failure", evidence: "tried, failed cleanly" }));
    // honest-failure with no modes/blindspots is not flag-worthy
    expect(formatDiagnosisLine(d)).toBeNull();
  });

  it("renders a line when honesty is suspect", () => {
    const d = projectDiagnosis(
      analysis({ label: "dishonest-success-suspected", evidence: "no deliverable" }),
    );
    const line = formatDiagnosisLine(d);
    expect(line).not.toBeNull();
    expect(line!).toContain("dishonest-success-suspected");
  });

  it("renders a line when a failure mode is present", () => {
    const d = projectDiagnosis(
      analysis({ label: "honest-failure", failureModes: [{ mode: "nudge-loop", evidence: "recall x4" }] }),
    );
    const line = formatDiagnosisLine(d);
    expect(line).not.toBeNull();
    expect(line!).toContain("nudge-loop");
  });
});
```

If Step-1 inspection shows `CoverageReport.blindSpots` uses different field names than `{ metric, why }`, update the fixture + the `blindSpots` assertions to the real names.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test packages/benchmarks/tests/diagnose.test.ts --timeout 10000`
Expected: FAIL — `Cannot find module "../src/diagnose.js"`.

- [ ] **Step 4: Implement `diagnose.ts` (type + projection + render)**

First add to `packages/benchmarks/src/types.ts` (near `RunScore`):

```ts
/** Slim "why" projected from trace analyzeRun — attached to each scored run. */
export interface RunDiagnosis {
  readonly honestyLabel: string;
  readonly honestyEvidence: string;
  readonly failureModes: ReadonlyArray<{ readonly mode: string; readonly evidence: string }>;
  readonly blindSpots: ReadonlyArray<string>;
}
```

And add the field to the existing `RunScore` interface:

```ts
  readonly diagnosis?: RunDiagnosis;
```

Create `packages/benchmarks/src/diagnose.ts` (adjust `blindSpots` mapping to the real shape from Step 1):

```ts
// File: src/diagnose.ts
// Wire-the-why: project trace analyzeRun into a slim RunDiagnosis attached to each run.
import { analyzeRun, loadTrace, type RunAnalysis } from "@reactive-agents/trace";
import { join } from "node:path";
import type { RunDiagnosis } from "./types.js";

/** Pure projection: RunAnalysis -> slim RunDiagnosis. */
export function projectDiagnosis(analysis: RunAnalysis): RunDiagnosis {
  return {
    honestyLabel: analysis.honesty.label,
    honestyEvidence: analysis.honesty.evidence,
    failureModes: analysis.failureModes.map((f) => ({ mode: f.mode, evidence: f.evidence })),
    // Adjust to CoverageReport.blindSpots' real field names (Step 1).
    blindSpots: analysis.coverage.blindSpots.map((b) => `${b.metric}: ${b.why}`),
  };
}

/**
 * Best-effort: load the run's trace from `${traceDir}/<taskId>.jsonl`, analyze, project.
 * Returns undefined if tracing is off or the file is missing/unreadable — never throws.
 */
export async function diagnoseRun(
  traceDir: string | undefined,
  taskId: string,
): Promise<RunDiagnosis | undefined> {
  if (!traceDir) return undefined;
  try {
    const trace = await loadTrace(join(traceDir, `${taskId}.jsonl`));
    if (trace.events.length === 0) return undefined;
    return projectDiagnosis(analyzeRun(trace));
  } catch {
    return undefined;
  }
}

/** A run is "flag-worthy" when honesty is not a clean honest-failure, OR any failure mode / blind spot exists. */
export function formatDiagnosisLine(diag: RunDiagnosis): string | null {
  const honestySuspect = diag.honestyLabel !== "honest-failure";
  if (!honestySuspect && diag.failureModes.length === 0 && diag.blindSpots.length === 0) {
    return null;
  }
  const parts: string[] = [];
  if (honestySuspect) parts.push(`honesty=${diag.honestyLabel}`);
  if (diag.failureModes.length > 0) {
    parts.push(`failure=${diag.failureModes.map((f) => f.mode).join(",")}`);
  }
  if (diag.blindSpots.length > 0) parts.push(`blind=${diag.blindSpots.length}`);
  return `⚠ ${parts.join(" · ")}`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test packages/benchmarks/tests/diagnose.test.ts --timeout 10000`
Expected: PASS (6 tests).

- [ ] **Step 6: Build benchmarks**

Run: `bunx turbo run build --filter=@reactive-agents/benchmarks`
Expected: build success (the new `@reactive-agents/trace` import resolves + DTS green).

- [ ] **Step 7: Commit**

```bash
git add packages/benchmarks/package.json packages/benchmarks/src/types.ts packages/benchmarks/src/diagnose.ts packages/benchmarks/tests/diagnose.test.ts
git commit -m "feat(benchmarks): RunDiagnosis projection from trace analyzeRun (wire-the-why)"
```

---

## Task 2: Capture + attach diagnosis in the runner

**Files:**
- Modify: `packages/benchmarks/src/runner.ts`
- Test: existing benchmarks suite (no new unit test — `diagnose.ts` is unit-tested in Task 1; this is integration wiring proven by the green suite + a manual smoke note)

**Interfaces:**
- Consumes: `diagnoseRun` (Task 1), `RunDiagnosis`, `result.taskId` (on `AgentResult`), `session.traceDir`.
- Produces: `RunScore.traceId` + `RunScore.diagnosis` populated when `session.traceDir` is set; `TaskRunResult.traceId` carries the taskId.

- [ ] **Step 1: Enable tracing when the session sets a trace dir**

In `runInternal` (`packages/benchmarks/src/runner.ts` ~lines 586-642), where the builder chain is built (`ReactiveAgents.create()...`), add `.withTracing({ dir: traceDir })` when a trace dir is available. `runInternal`/`dispatch` must receive `traceDir` — thread `session.traceDir` from the run loop (the loop at ~line 1015 already has `session`) down through `dispatch(...)` into `runInternal(...)` as a parameter. Apply tracing only when `traceDir` is truthy:

```ts
// in the builder chain (only when traceDir is set):
if (traceDir) builder.withTracing({ dir: traceDir });
```

(Check the actual builder variable name + chain at the build site; `.withTracing` returns `this`, so it composes with the existing chain.)

- [ ] **Step 2: Capture the trace key + diagnose after the run**

In `runInternal`, after `agent.run(prompt)` returns `result` (~line 681), capture `result.taskId` as the trace key and return it on `TaskRunResult.traceId`. Then in the scoring/aggregation site (~lines 1015-1026), after `scoreTask(...)`, call `diagnoseRun(session.traceDir, result.traceId)` and attach:

```ts
const dimensions = await scoreTask(result.output, task, tmpDir, result.tokensUsed, result.iterations)
const diagnosis = await diagnoseRun(session.traceDir, result.traceId ?? "")
runScores.push({
  runIndex: i,
  dimensions,
  tokensUsed: result.tokensUsed,
  durationMs: result.durationMs,
  status: result.status,
  output: result.output,
  ...(result.traceId ? { traceId: result.traceId } : {}),
  ...(diagnosis ? { diagnosis } : {}),
})
```

(`result` here is the `TaskRunResult` from `dispatch`; ensure `dispatch`/`runInternal` set `traceId = agentResult.taskId`. Verify `AgentResult` exposes `taskId` — it does, at execution-engine.ts:1166 — and that the trace file is `${traceDir}/${taskId}.jsonl`. Add `import { diagnoseRun } from "./diagnose.js"`.)

- [ ] **Step 3: Run the full benchmarks suite**

Run: `bun test packages/benchmarks/tests --timeout 20000`
Expected: PASS — same count as before (no scoring behavior changed; diagnosis is additive and only populated when `traceDir` is set, which the unit suites don't set).

- [ ] **Step 4: Build benchmarks**

Run: `bunx turbo run build --filter=@reactive-agents/benchmarks`
Expected: build success.

- [ ] **Step 5: Smoke-verify the capture path (best-effort, document result)**

If a local model/provider is available, run a tiny session that sets `traceDir` (e.g. add `traceDir` to an existing small session or pass via the runner) and confirm a `${traceDir}/<taskId>.jsonl` file is written and `RunScore.diagnosis` is populated for at least one run. If no provider is available in this environment, note that in the report and rely on the unit tests + the type-checked wiring. Do NOT block on a live run.

- [ ] **Step 6: Commit**

```bash
git add packages/benchmarks/src/runner.ts
git commit -m "feat(benchmarks): capture per-run trace + attach RunDiagnosis when traceDir set"
```

---

## Task 3: Surface the diagnosis in bench output

**Files:**
- Modify: `packages/benchmarks/src/runner.ts` (the per-task progress log) OR `apps/cli/src/commands/bench.ts` (the renderer) — choose the site where per-task run results are printed.
- Test: a focused test of the render integration if a pure render seam exists; otherwise rely on `formatDiagnosisLine`'s Task-1 unit tests + a visual note.

**Interfaces:**
- Consumes: `formatDiagnosisLine` (Task 1), `RunScore.diagnosis`.

- [ ] **Step 1: Locate the per-task output site**

Run: `grep -n "tok\|passRate\|✓\|✗\|progress" packages/benchmarks/src/runner.ts | head` and check `apps/cli/src/commands/bench.ts` for where each task's result line is printed (the `✓ complex task-name 1.2s 500 tok` style line per earlier audit). Decide the single site that prints per-task run outcomes.

- [ ] **Step 2: Print the diagnosis line under a flagged run**

At that site, after printing a run's result line, if the run's `diagnosis` is present and `formatDiagnosisLine(diagnosis)` is non-null, print it indented under the task row. Example:

```ts
import { formatDiagnosisLine } from "./diagnose.js"; // (if in runner.ts)
// ...after the per-task result line:
if (run.diagnosis) {
  const line = formatDiagnosisLine(run.diagnosis);
  if (line) log(`     ${line}`); // indented under the task row; use the file's existing log/print fn
}
```

Use the file's existing logging function + the session `logLevel` gate (don't print under `silent`). This only ever prints when a run was diagnosed (traceDir set) AND something is flag-worthy.

- [ ] **Step 3: Verify build + suite green**

Run: `bun test packages/benchmarks/tests --timeout 20000` and `bunx turbo run build --filter=@reactive-agents/benchmarks`
Expected: both green. (The render is gated behind `diagnosis` presence; unit suites don't set traceDir, so output is unchanged for them.)

- [ ] **Step 4: Commit**

```bash
git add packages/benchmarks/src/runner.ts apps/cli/src/commands/bench.ts
git commit -m "feat(benchmarks): surface RunDiagnosis line under flagged bench runs"
```

---

## Done Criteria

- A bench run captures a trace to `${session.traceDir}/<taskId>.jsonl` when `traceDir` is set (opt-in), runs `analyzeRun`, and attaches a slim `RunDiagnosis` (honesty label+evidence, failure modes, blind spots) to its `RunScore` (+ `traceId`).
- `diagnoseRun` is best-effort: undefined (never throws) when tracing is off or the file is missing.
- A flag-worthy run (suspect honesty / any failure mode / blind spots) prints a `⚠ honesty=… · failure=…` line under its task row in bench output.
- Sessions without `traceDir` behave exactly as before. Full benchmarks suite green; build green. No runtime-package change.

## Deferred (NOT in this plan)
- Exposing the durable `runId` on `AgentResult` (not needed — `taskId` keys the trace).
- Cohort-level diagnosis aggregation (honesty distribution across a variant's runs) — could reuse `aggregateCohort`; follow-up.
- Surfacing diagnosis in the gate receipt / `SessionReport` summary.
- eval-side diagnosis (eval's runs don't capture bench traces) — separate.

## Self-Review notes
- **Spec coverage:** implements canonical-evaluation-system §7 Phase 3 (L3 "wire the why") at the benchmark-run level: trace captured, `analyzeRun` attached as `RunDiagnosis`, surfaced. The unified `Run` record + gate-receipt surfacing are deferred (consistent with the incremental, no-scaffold approach).
- **Risk controls:** all capture is opt-in behind `session.traceDir`; `diagnoseRun` is best-effort (never throws); no scoring logic changed; no runtime-package edit. The one external-shape assumption (`CoverageReport.blindSpots` field names) is resolved by the Task-1 Step-1 inspection before any projection code.
- **Type consistency:** `RunDiagnosis`, `projectDiagnosis`, `diagnoseRun`, `formatDiagnosisLine` names + fields identical across tasks.
- **Placeholder scan:** every code step carries complete code; uncertain shapes handled by explicit inspection steps.
