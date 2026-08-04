# execution-engine.ts Final Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `packages/runtime/src/execution-engine.ts` from 2358 LOC to ~1200 LOC by extracting the remaining post-execution and pre-execution inline blocks into focused modules, while making targeted code-quality improvements that the broad sweep makes economical.

**Architecture:** The W23 step 6a sequence already extracted the agent-loop body (think/act/observe/harness-hooks/verification-quality-gate). Remaining inline blocks fall into three buckets that the advisor explicitly flagged as different concerns: (1) **Post-execution phases** — Phase 6/7 inline scaffolding (~75 LOC); (2) **Run finalization** — debrief synthesis (~242 LOC), telemetry RunReport (~146 LOC), local learning (~103 LOC), agent/task completion events (~80 LOC); (3) **Pre-execution dispatchers** — bootstrap post-processing (~140 LOC), pre-agent-loop setup (~91 LOC). Each bucket has clean closure boundaries and is independent of the others, so all can be parallelized to subagents.

**Tech Stack:** TypeScript / Effect-TS / Bun test runner. New modules live under `packages/runtime/src/engine/` following the established W23 pattern.

---

## Sequence labels

Per advisor guidance — these are NOT agent-loop concerns and should not be labeled `6a-N` (which would mislead future readers). Use:

| Sequence | Concern | Tasks |
|---|---|---|
| **W24-A** (post-exec phases) | Phase 6/7 inline scaffolding | T1, T2 |
| **W24-B** (run finalization) | Debrief, telemetry, learning, completion events | T3, T4, T5, T6 |
| **W24-C** (pre-exec dispatchers) | Bootstrap post-processing, pre-loop setup | T7, T8 |
| **W24-D** (intra-loop iteration guards) | Inline-direct-LLM iteration scaffolding | T9 |
| **W24-E** (improvements / quality) | Targeted cleanups while in the code | T10, T11, T12 |

T1–T9 are extraction tasks (same pattern as 6a). T10–T12 are improvements that benefit from the broad code sweep.

## Closure-boundary inventory

| Block | Current line range | LOC | Closure deps (passed via Deps) |
|---|---|---|---|
| Phase 6 VERIFY summary log | 1311-1346 | 36 | `ctx`, `config.enableVerification`, `obs`, `isNormal` |
| Phase 7 MEMORY_FLUSH dispatch | 1369-1395 | 27 | `ctx`, `entropyLog`, `toolCallLog`, `runGuardedPhase`, `memoryFlush`, `deps` (PhaseDeps) |
| Debrief synthesis | 1475-1716 | 242 | `ctx`, `task`, `config`, `eb`, `obs`, `executionStartMs`, `result` (in-progress), `errorsFromLoop`, `executionSucceeded`, `terminatedByRaw`, `dialectObserved`, `rr` (reasoning result), and several memory/store services |
| Entropy metrics + Telemetry RunReport | 1717-1874 | 158 | `ctx`, `task`, `config`, `entropyLog`, `toolCallLog`, `result`, `taskCategory`, `dialectObserved`, plus `TelemetryClientImpl`, `lookupModelFn`, telemetry-enrichment helpers |
| Local Learning (calibration/bandit/skill store) | 1875-1932 | 58 | `ctx`, `config`, `result`, `lastLearningResult`, `entropyLog`, `loadObservations`, `ProceduralMemoryService` |
| Record outcome for applied skill | 1933-1978 | 45 | `ctx`, `config`, `terminatedByRaw`, `errorsFromLoop`, `lastLearningResult`, `ProceduralMemoryService`, `skillFragmentToProceduralEntry` |
| Lifecycle completion + token/cost/completion events + non-live mode | 1980-2074 | 95 | `ctx`, `task`, `config`, `eb`, `result`, `executionStartMs`, `entropyLog`, `ObservableLogger` |
| Bootstrap post-processing (skills + summary + tip + snapshot) | 717-851 | 135 | `ctx`, `task`, `config`, `eb`, `obs`, `runtime`, `cachedToolDefs`, several skill stores |
| Pre-loop dispatchers + cache check | 853-944 | 91 | `ctx`, `task`, `config`, `runGuardedPhase`, `guardrail`, `costRoute`, `strategySelect`, `deps`, plus tool-classifier helpers |
| Iteration guards (inline-direct-LLM loop) | 1102-1176 | 75 | `ctx`, `config`, `eb`, `obs`, `checkLifecycle`, `BehavioralContractService`, `BehavioralContractViolationError`, `CostService` |

---

## Test strategy

**These extractions are pure refactors with no new behavior.** TDD here means: re-running the existing test suite after each step. The existing tests pin behavior; if a test fails, the extraction broke parity. We don't write new tests for an extraction unless we discover a coverage gap (in which case file a follow-up).

**Verification command (used at every checkpoint):**
```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts && bun test
```
Expected baseline: `5032 pass / 26 skip / 0 fail` across 561 files.

**Site-string discipline:** New `emitErrorSwallowed` calls must use semantic anchors at the actual module path, e.g. `runtime/src/engine/finalize/debrief-synthesis.ts:emit-final-answer`. The structural test `tests/error-swallowed-wiring.test.ts` enforces uniqueness + format. Do NOT preserve `runtime/src/execution-engine.ts:NNNN` strings in extracted modules — that pattern was already cleaned up in the 6a sequence.

**Doc-comment policy:** When citing source location, use `Lifted from execution-engine.ts post-W23-6a-8 (2358-LOC checkpoint).` rather than line-number ranges that rot. State the module's role in 2-3 sentences.

---

## Files

### Created
- `packages/runtime/src/engine/phases/verify-summary-log.ts` — T1
- `packages/runtime/src/engine/phases/memory-flush-dispatch.ts` — T2
- `packages/runtime/src/engine/finalize/debrief-synthesis.ts` — T3
- `packages/runtime/src/engine/finalize/telemetry-emit.ts` — T4
- `packages/runtime/src/engine/finalize/local-learning.ts` — T5
- `packages/runtime/src/engine/finalize/run-finalize.ts` — T6
- `packages/runtime/src/engine/bootstrap/skill-postprocess.ts` — T7
- `packages/runtime/src/engine/phases/agent-loop/setup/pre-loop-dispatch.ts` — T8
- `packages/runtime/src/engine/phases/agent-loop/iteration-guards.ts` — T9

### Modified
- `packages/runtime/src/execution-engine.ts` — every task replaces an inline block with a function call
- `packages/runtime/src/engine/util.ts` — T11 (shared types)

---

## Subagent execution model

Each task (T1–T12) is dispatched to a fresh subagent with:

1. **Full task prompt** including: the task definition below, the current LOC, paths, the inline code to extract, expected closure-deps interface
2. **Pre-extraction read** — the subagent must read the current source range to confirm line numbers haven't shifted
3. **TDD-style verification** — run `bun test` before and after; reject if pre-fail or post-fail
4. **Single commit per task** with message `refactor(runtime): <one-line summary> (W24-X step Tn)`
5. **Reports back**: LOC delta, test counts before/after, the new file's role in one sentence

After each subagent finishes, the orchestrator runs `bun test` independently as a "trust but verify" check, then reviews the diff for: closure-dep correctness, site-string format, no behavior drift.

**Parallelism caveat:** T1–T9 touch the same file (`execution-engine.ts`) so they cannot run in parallel without merge conflicts. Run them **sequentially** — but each task is small enough (~5-15 minutes) that the sequence completes in 1-2 hours. Ordering: T1, T2, T9 (small/safe), T7, T8 (medium), T3, T4, T5, T6 (largest, latest). T10–T12 (improvements) can run after.

If isolation is a hard requirement, use `superpowers:using-git-worktrees` to give each subagent its own worktree, then merge — but that adds rebase overhead. For a 9-task sequence, sequential is faster.

---

## Tasks

### T1 (W24-A step 1): Extract Phase 6 VERIFY summary log

**Files:**
- Create: `packages/runtime/src/engine/phases/verify-summary-log.ts`
- Modify: `packages/runtime/src/execution-engine.ts:1311-1346`

- [ ] **Step 1: Read the current block to confirm boundaries**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
grep -n -F "// ── Phase 6: VERIFY" packages/runtime/src/execution-engine.ts
```

Expected: line near 1311. Confirm by reading 5 lines around it.

- [ ] **Step 2: Run baseline tests**

```bash
bun test 2>&1 | tail -5
```
Expected: `5032 pass / 26 skip / 0 fail`. Abort if anything else.

- [ ] **Step 3: Write `verify-summary-log.ts`**

```typescript
/**
 * Phase 6 VERIFY summary log.
 *
 * Verification may be fast (heuristics) or involve extra LLM calls when
 * useLLMTier is on; without this log line it looks like verify "did
 * nothing" in normal verbosity. Lifted from execution-engine.ts
 * post-W23-6a-8 (2358-LOC checkpoint).
 */
import { Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { ExecutionContext, ReactiveAgentsConfig } from "../../types.js";
import type { ObsLike } from "../runtime-context.js";

export interface VerifySummaryLogArgs {
  readonly ctx: ExecutionContext;
  readonly config: ReactiveAgentsConfig;
  readonly obs: ObsLike | null;
  readonly isNormal: boolean;
}

export const logVerifySummary = (
  args: VerifySummaryLogArgs,
): Effect.Effect<void, never> => {
  const { ctx, config, obs, isNormal } = args;
  return Effect.gen(function* () {
    if (!config.enableVerification || !obs || !isNormal) return;
    const vr = ctx.metadata.verificationResult as
      | {
          overallScore?: number;
          passed?: boolean;
          recommendation?: string;
          layerResults?: ReadonlyArray<{ passed?: boolean; layerName?: string }>;
        }
      | undefined;
    if (vr) {
      const failedLayers = (vr.layerResults ?? [])
        .filter((l) => l.passed === false)
        .map((l) => l.layerName ?? "?")
        .join(", ");
      const failHint = failedLayers.length > 0 ? ` | failed layers: ${failedLayers}` : "";
      yield* obs
        .info(
          `◉ [verify]     score=${(vr.overallScore ?? 0).toFixed(2)} passed=${String(vr.passed)} recommendation=${String(vr.recommendation ?? "?")}${failHint}`,
        )
        .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/verify-summary-log.ts:log-summary", tag: errorTag(err) })));
    } else {
      yield* obs
        .info(
          "◉ [verify]     skipped — VerificationService not in runtime (check createRuntime / .withVerification wiring)",
        )
        .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/verify-summary-log.ts:log-skipped", tag: errorTag(err) })));
    }
  });
};
```

- [ ] **Step 4: Wire import + call site**

In `packages/runtime/src/execution-engine.ts`, add after the existing engine-phases imports near line 60:
```typescript
import { logVerifySummary } from "./engine/phases/verify-summary-log.js";
```

Replace the inline `if (config.enableVerification) { ... }` block at lines 1315-1346 (the part AFTER `ctx = yield* runGuardedPhase(verify, ctx, deps);`) with:
```typescript
yield* logVerifySummary({ ctx, config, obs, isNormal });
```

- [ ] **Step 5: Run tests**

```bash
bun test 2>&1 | tail -5
```
Expected: `5032 pass / 26 skip / 0 fail`. Any deviation = abort and report.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/execution-engine.ts packages/runtime/src/engine/phases/verify-summary-log.ts
git commit -m "$(cat <<'EOF'
refactor(runtime): extract Phase 6 VERIFY summary log (W24-A step 1)

Phase 6 verifier-result summary log (~36 LOC) → engine/phases/
verify-summary-log.ts. The verify phase body itself was already extracted
in W23 (engine/phases/verify.ts); this lifts the summary log that runs
after the phase to surface verifier output at normal verbosity.

execution-engine.ts: 2358 → ~2326 LOC.
EOF
)"
```

---

### T2 (W24-A step 2): Extract Phase 7 MEMORY_FLUSH dispatch

**Files:**
- Create: `packages/runtime/src/engine/phases/memory-flush-dispatch.ts`
- Modify: `packages/runtime/src/execution-engine.ts:1369-1395`

- [ ] **Step 1: Read the current block**

```bash
grep -n -F "// ── Phase 7: MEMORY_FLUSH" packages/runtime/src/execution-engine.ts
```

- [ ] **Step 2: Run baseline tests** (as T1 step 2)

- [ ] **Step 3: Write `memory-flush-dispatch.ts`**

The dispatch logic is: compute task complexity → trivial skips, moderate forks daemon, complex runs blocking. Caller passes `runMemoryFlush: (ctx) => Effect<ctx>` callback so the module doesn't need PhaseDeps.

```typescript
/**
 * Phase 7 MEMORY_FLUSH dispatch.
 *
 * Computes task complexity from iteration count, latest entropy reading,
 * and tool-call log length, then dispatches the memoryFlush phase in one
 * of three modes: trivial (skip, mark agentState="flushing"), moderate
 * (fork daemon, fire-and-forget), complex (run blocking). Lifted from
 * execution-engine.ts post-W23-6a-8 (2358-LOC checkpoint).
 */
import { Effect } from "effect";
import type { ExecutionContext } from "../../types.js";
import { classifyComplexity } from "../util.js"; // hoisted in T10; pre-T10 use a re-export from execution-engine.ts

export interface MemoryFlushDispatchArgs {
  readonly ctx: ExecutionContext;
  readonly entropyLog: readonly { composite: number }[];
  readonly toolCallLog: readonly unknown[];
  readonly runMemoryFlush: (ctx: ExecutionContext) => Effect.Effect<ExecutionContext, never>;
}

export const dispatchMemoryFlush = (
  args: MemoryFlushDispatchArgs,
): Effect.Effect<ExecutionContext, never> => {
  const { entropyLog, toolCallLog, runMemoryFlush } = args;
  return Effect.gen(function* () {
    let ctx = args.ctx;
    const rrForComplexity = ctx.metadata.reasoningResult as { metadata?: { terminatedBy?: string; llmCalls?: number } } | undefined;
    const terminatedByForComplexity = (rrForComplexity?.metadata?.terminatedBy ?? "end_turn") as string;
    const latestEntropy = entropyLog.length > 0 ? entropyLog[entropyLog.length - 1] : undefined;
    const complexity = classifyComplexity(
      ctx.iteration,
      latestEntropy,
      toolCallLog.length,
      terminatedByForComplexity,
    );
    ctx = { ...ctx, metadata: { ...ctx.metadata, taskComplexity: complexity } };

    if (complexity === "trivial") {
      ctx = { ...ctx, agentState: "flushing" as const };
    } else if (complexity === "moderate") {
      yield* Effect.forkDaemon(runMemoryFlush(ctx));
    } else {
      ctx = yield* runMemoryFlush(ctx);
    }
    return ctx;
  }) as Effect.Effect<ExecutionContext, never>;
};
```

> **Note for T11:** `classifyComplexity` currently lives in execution-engine.ts. T11 hoists it to `execution-engine-helpers.ts` (or `engine/util.ts`). T2 depends on T11 — sequence T11 BEFORE T2, OR temporarily import it from execution-engine.ts and let T11 fix the import.

- [ ] **Step 4: Wire import + replace block**

```typescript
import { dispatchMemoryFlush } from "./engine/phases/memory-flush-dispatch.js";
```

Replace the inline block at 1369-1395 with:
```typescript
ctx = yield* dispatchMemoryFlush({
  ctx,
  entropyLog,
  toolCallLog,
  runMemoryFlush: (c) =>
    runGuardedPhase(memoryFlush, c, deps) as Effect.Effect<ExecutionContext, never>,
});
```

- [ ] **Step 5: Run tests** (must be green)

- [ ] **Step 6: Commit** with message `refactor(runtime): extract Phase 7 MEMORY_FLUSH dispatch (W24-A step 2)`.

---

### T3 (W24-B step 1): Extract debrief synthesis

**Files:**
- Create: `packages/runtime/src/engine/finalize/debrief-synthesis.ts`
- Modify: `packages/runtime/src/execution-engine.ts:1475-1716`

This is the largest single block (~242 LOC). It owns: FinalAnswerProduced event, debrief assembly via `synthesizeDebrief()`, debrief storage in DebriefStoreService, plus the path that publishes a synthetic debrief on partial/failed runs.

- [ ] **Step 1: Read the current block carefully**

```bash
sed -n '1475,1716p' packages/runtime/src/execution-engine.ts | wc -l
```
Expected: ~242 lines.

Then `Read` it in full to understand all closure deps. Pay special attention to:
- `result` is built progressively — note where it's first assigned vs read
- `executionSucceeded`, `terminatedByRaw`, `dialectObserved`, `rr` are all set in the prior block (1407-1474) and read here
- `errorsFromLoop` mutates as the block runs (look for `.push(...)`)

- [ ] **Step 2: Run baseline tests**

- [ ] **Step 3: Write the module**

Module signature:
```typescript
export interface DebriefSynthesisDeps {
  readonly ctx: ExecutionContext;
  readonly task: Task;
  readonly config: ReactiveAgentsConfig;
  readonly eb: EbLike | null;
  readonly obs: ObsLike | null;
  readonly result: TaskResult;
  readonly executionStartMs: number;
  readonly executionSucceeded: boolean;
  readonly terminatedByRaw: string;
  readonly dialectObserved: string;
  readonly errorsFromLoop: readonly { errorTag: string; phase: string; message: string }[];
  readonly rr: { /* the reasoning result shape — see line 1416 */ } | undefined;
}

export const synthesizeAndStoreDebrief = (
  deps: DebriefSynthesisDeps,
): Effect.Effect<void, never> => { /* ... */ };
```

The module returns `void` because debrief is best-effort and never blocks the result. All side-effects (event publishing, store write, log lines) happen via `Effect.catchAll` to swallow errors.

> **Implementation note:** Do NOT inline-rewrite the debrief synthesis logic. Copy the body verbatim, then replace the closure-captured variables with the destructured deps. This preserves byte-for-byte behavior. The module is large but mechanical.

- [ ] **Step 4: Wire import + replace block**

```typescript
import { synthesizeAndStoreDebrief } from "./engine/finalize/debrief-synthesis.js";
```

- [ ] **Step 5: Run tests** (must be green)

- [ ] **Step 6: Commit** with message `refactor(runtime): extract debrief synthesis (W24-B step 1)`.

---

### T4 (W24-B step 2): Extract telemetry RunReport emission

**Files:**
- Create: `packages/runtime/src/engine/finalize/telemetry-emit.ts`
- Modify: `packages/runtime/src/execution-engine.ts:1717-1874`

- [ ] **Step 1: Read the current block**
- [ ] **Step 2: Run baseline tests**
- [ ] **Step 3: Write the module**

Module owns: entropy metrics histogram + `TelemetryClientImpl.emitRunReport(...)` with all enrichment fields (trajectory fingerprint, abstract tools, convergence iter, peak context pressure, complexity, failure pattern, thought-to-action ratio, entropy variance/oscillation/composite/AUC).

```typescript
export interface TelemetryEmitDeps {
  readonly ctx: ExecutionContext;
  readonly task: Task;
  readonly config: ReactiveAgentsConfig;
  readonly result: TaskResult;
  readonly entropyLog: readonly { composite: number }[];
  readonly toolCallLog: readonly { toolName: string; success: boolean }[];
  readonly taskCategory: string;
  readonly dialectObserved: string;
  readonly obs: ObsLike | null;
}

export const emitTelemetryRunReport = (
  deps: TelemetryEmitDeps,
): Effect.Effect<void, never> => { /* ... */ };
```

- [ ] **Step 4: Wire + replace + tests + commit** as `refactor(runtime): extract telemetry RunReport emission (W24-B step 2)`.

---

### T5 (W24-B step 3): Extract local learning + record outcome

**Files:**
- Create: `packages/runtime/src/engine/finalize/local-learning.ts`
- Modify: `packages/runtime/src/execution-engine.ts:1875-1978`

These two blocks (Local Learning + Record Outcome) both touch `ProceduralMemoryService` and the `lastLearningResult` ref. Combine into one module.

- [ ] **Step 1: Read both blocks**
- [ ] **Step 2: Run baseline tests**
- [ ] **Step 3: Write the module**

```typescript
export interface LocalLearningDeps {
  readonly ctx: ExecutionContext;
  readonly config: ReactiveAgentsConfig;
  readonly result: TaskResult;
  readonly entropyLog: readonly { composite: number }[];
  readonly lastLearningResult: { /* shape from observations.ts */ } | null;
  readonly terminatedByRaw: string;
  readonly errorsFromLoop: readonly { errorTag: string; phase: string; message: string }[];
}

export const runLocalLearning = (
  deps: LocalLearningDeps,
): Effect.Effect<void, never> => { /* ... */ };
```

- [ ] **Step 4: Wire + replace + tests + commit** as `refactor(runtime): extract local learning + outcome record (W24-B step 3)`.

---

### T6 (W24-B step 4): Extract run finalization (events + metrics + non-live mode)

**Files:**
- Create: `packages/runtime/src/engine/finalize/run-finalize.ts`
- Modify: `packages/runtime/src/execution-engine.ts:1980-2074`

Owns: AgentCompleted event, TaskCompleted event, entropy trace attach, token/cost metrics emission, completion event emission, non-live mode console summary.

- [ ] **Step 1: Read the block**
- [ ] **Step 2: Run baseline tests**
- [ ] **Step 3: Write the module**

```typescript
export interface RunFinalizeDeps {
  readonly ctx: ExecutionContext;
  readonly task: Task;
  readonly config: ReactiveAgentsConfig;
  readonly eb: EbLike | null;
  readonly result: TaskResult;
  readonly executionStartMs: number;
  readonly entropyLog: readonly { composite: number }[];
  readonly executionSucceeded: boolean;
}

export const finalizeRun = (
  deps: RunFinalizeDeps,
): Effect.Effect<void, never> => { /* ... */ };
```

- [ ] **Step 4: Wire + replace + tests + commit** as `refactor(runtime): extract run finalization (W24-B step 4)`.

---

### T7 (W24-C step 1): Extract bootstrap skill post-processing

**Files:**
- Create: `packages/runtime/src/engine/bootstrap/skill-postprocess.ts`
- Modify: `packages/runtime/src/execution-engine.ts:717-851`

Owns: apply learned skills from procedural memory, apply skills from SkillResolver, log bootstrap summary, experience tip injection, MemorySnapshot publish for Cortex.

- [ ] **Step 1: Read the block carefully — multiple sub-sections, mutates ctx.metadata multiple times**

- [ ] **Step 2: Run baseline tests**

- [ ] **Step 3: Write the module**

The Deps include several store services (ProceduralMemoryService, ExperienceStore, MemoryService, SkillResolver). Module returns updated ctx.

- [ ] **Step 4: Wire + replace + tests + commit** as `refactor(runtime): extract bootstrap skill post-processing (W24-C step 1)`.

---

### T8 (W24-C step 2): Extract pre-loop dispatchers

**Files:**
- Create: `packages/runtime/src/engine/phases/agent-loop/setup/pre-loop-dispatch.ts`
- Modify: `packages/runtime/src/execution-engine.ts:853-944`

Owns: Phase 2 GUARDRAIL dispatch, Phase 3 COST_ROUTE + budget pre-flight, Phase 4 STRATEGY_SELECT, tool registry fetch + allowedTools warn + strategy summary, classifyTools setup, autoMaxCallsPerTool computation, semantic cache check.

The semantic cache check is already extracted (`checkSemanticCache`) — leave that call inline since the result tuple flows into `cacheHit` which is read by the agent-loop branch selector.

- [ ] **Step 1: Read the block**
- [ ] **Step 2: Run baseline tests**
- [ ] **Step 3: Write the module**

The output tuple includes: updated ctx, effectiveAllowedTools, effectiveRequiredTools, effectiveRequiredToolQuantities, classifiedRelevantTools, autoMaxCallsPerTool, cachedToolDefs.

- [ ] **Step 4: Wire + replace + tests + commit** as `refactor(runtime): extract pre-loop dispatchers (W24-C step 2)`.

---

### T9 (W24-D step 1): Extract iteration guards (inline-direct-LLM loop)

**Files:**
- Create: `packages/runtime/src/engine/phases/agent-loop/iteration-guards.ts`
- Modify: `packages/runtime/src/execution-engine.ts:1102-1176`

Owns: kill-switch check, behavioral-contract iteration check, per-iteration budget check, ExecutionLoopIteration event, iteration gauge.

The tricky part: the budget check sets `isComplete = true` and `break`s the outer while-loop. Module returns `{ ctx, shouldBreak: boolean }` so the caller can decide whether to break.

- [ ] **Step 1: Read the block**
- [ ] **Step 2: Run baseline tests**
- [ ] **Step 3: Write the module**

```typescript
export interface IterationGuardsDeps {
  readonly ctx: ExecutionContext;
  readonly config: ReactiveAgentsConfig;
  readonly eb: EbLike | null;
  readonly obs: ObsLike | null;
  readonly checkLifecycle: (taskId: string) => Effect.Effect<void, RuntimeErrors>;
}

export const runIterationGuards = (
  deps: IterationGuardsDeps,
): Effect.Effect<{ ctx: ExecutionContext; shouldBreak: boolean }, BehavioralContractViolationError | RuntimeErrors> => { /* ... */ };
```

- [ ] **Step 4: Wire + replace + tests + commit** as `refactor(runtime): extract per-iteration guards (W24-D step 1)`.

---

### T10 (W24-E step 1): Hoist `classifyComplexity` and other inline helpers

**Files:**
- Modify: `packages/runtime/src/engine/util.ts` (add functions)
- Modify: `packages/runtime/src/execution-engine.ts` (delete inline copies, add imports)

Helpers currently inline in execution-engine.ts that are pure functions and used by 1+ places:

| Helper | Current line | Used by |
|---|---|---|
| `classifyComplexity` | ~286 | execution-engine.ts (memory-flush dispatch — moves to T2) |
| `sanitizeOutput` | locate via grep | execution-engine.ts (post-Phase-10 result assembly) |
| any other small pure helpers in 100-300 range | grep `^function ` | (verify usage) |

- [ ] **Step 1: Inventory inline pure helpers**

```bash
grep -n "^function \|^const [a-z][A-Za-z]* = " packages/runtime/src/execution-engine.ts | head -20
```

- [ ] **Step 2: Move each pure helper to `engine/util.ts` with `export`**

Don't move helpers that capture closure state (e.g. anything that reads `runtime`, `eb`, `ks`, `hookRegistry`).

- [ ] **Step 3: Update execution-engine.ts to import from util**

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit** as `refactor(runtime): hoist pure helpers to engine/util (W24-E step 1)`.

---

### T11 (W24-E step 2): Type the `ExecutionContext.metadata` field properly

**Why:** The current `ctx.metadata` is `Record<string, unknown>`. Every read site uses `as any` casts to extract typed fields (`reasoningResult`, `verificationResult`, `lastResponse`, `pendingToolCalls`, etc.). This proliferates `(ctx.metadata as any)?.foo` throughout the extracted modules. A typed metadata shape eliminates ~40+ casts and surfaces real type errors.

**Files:**
- Modify: `packages/runtime/src/types.ts` — define `ExecutionContextMetadata` interface
- Modify: ~15 files in `engine/` — drop the `as any` casts where the fix is straight-forward

- [ ] **Step 1: Inventory current `ctx.metadata.X as Y` reads**

```bash
grep -rn "ctx.metadata\(.\| \)*as " packages/runtime/src/engine/ packages/runtime/src/execution-engine.ts | wc -l
```

- [ ] **Step 2: Define a typed metadata shape**

In `types.ts`:
```typescript
export interface ExecutionContextMetadata {
  // Reasoning path
  reasoningResult?: ExecutionReasoningResult;
  reasoningSteps?: readonly { id: string; type: string; content: string; metadata?: { toolUsed?: string; duration?: number; observationResult?: { success?: boolean; toolName?: string } } }[];
  stepsCount?: number;
  // Direct-LLM path
  lastResponse?: string;
  pendingToolCalls?: readonly unknown[];
  isComplete?: boolean;
  llmCalls?: number;
  // Verification
  verificationResult?: { passed?: boolean; overallScore?: number; recommendation?: string; layerResults?: ReadonlyArray<{ passed?: boolean; layerName?: string; details?: string }> };
  verificationRetryCount?: number;
  verificationFeedback?: string;
  // Skill / learning
  skillCatalogXml?: string;
  resolvedSkills?: readonly { name?: string; description?: string }[];
  appliedSkillId?: string;
  appliedSkillMeanEntropy?: number;
  // Cache
  cacheHit?: boolean;
  // Memory flush
  taskComplexity?: "trivial" | "moderate" | "complex";
  // Cortex / budget
  budgetExceeded?: boolean;
  // Free-form for hooks
  [key: string]: unknown;
}

export interface ExecutionContext {
  // ... existing fields
  metadata: ExecutionContextMetadata;
}
```

- [ ] **Step 3: Drop `as any` casts where the typed shape now suffices**

Don't be a perfectionist — leave hook-extension `as any` reads alone (those are user-defined). Target only the fields above.

- [ ] **Step 4: Run typecheck + tests**

```bash
bunx tsc --noEmit -p packages/runtime/tsconfig.json 2>&1 | head -30
bun test 2>&1 | tail -5
```

- [ ] **Step 5: Commit** as `refactor(runtime): type ExecutionContextMetadata; drop redundant casts (W24-E step 2)`.

---

### T12 (W24-E step 3): Hoist shared service tag declarations

**Why:** `Context.GenericTag<{ logEpisode: ... }>("MemoryService")` is inlined in 4+ places. `Context.GenericTag<{ record: ... }>("ExperienceStore")` is inlined in 2+ places. Same for the LLMService GenericTag in inline-think.ts and verification-think-retry.ts. These should be hoisted to a shared tags file.

**Files:**
- Create: `packages/runtime/src/engine/service-tags.ts`
- Modify: ~6 files that currently inline these tags

- [ ] **Step 1: Inventory inline GenericTag declarations**

```bash
grep -rn "Context.GenericTag<" packages/runtime/src/engine/ packages/runtime/src/execution-engine.ts | head -20
```

- [ ] **Step 2: Define shared tags**

```typescript
// engine/service-tags.ts
import { Context, Effect } from "effect";

export const MemoryServiceTag = Context.GenericTag<{
  logEpisode: (episode: unknown) => Effect.Effect<void>;
}>("MemoryService");

export const ExperienceStoreTag = Context.GenericTag<{
  record: (entry: unknown) => Effect.Effect<void>;
}>("ExperienceStore");

export const LLMServiceCompleteTag = Context.GenericTag<{
  complete: (req: unknown) => Effect.Effect<{
    content: string;
    toolCalls?: unknown[];
    stopReason: string;
    usage?: { totalTokens?: number; estimatedCost?: number };
  }>;
}>("LLMService");
```

- [ ] **Step 3: Replace inline declarations with imports**

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit** as `refactor(runtime): hoist shared GenericTag service declarations (W24-E step 3)`.

---

## Post-extraction review pass

After all 12 tasks are committed, the orchestrator runs a final accuracy review:

- [ ] **R1: Final test pass**
  ```bash
  bun test
  ```
  Expected: 5032 pass / 26 skip / 0 fail.

- [ ] **R2: Final LOC count**
  ```bash
  wc -l packages/runtime/src/execution-engine.ts
  ```
  Expected: ~1200 LOC (was 2358; estimated -1100).

- [ ] **R3: Diff review**
  ```bash
  git log --oneline main..HEAD
  ```
  Expected: 12 commits, each tagged `(W24-X step Tn)`. Each commit should have one new module + matching execution-engine.ts edits.

- [ ] **R4: Site-string uniqueness check**
  The `error-swallowed-wiring.test.ts` enforces this structurally; if it passed in R1, this is satisfied.

- [ ] **R5: Stale doc-comment scan**
  ```bash
  grep -rn "execution-engine.ts:[0-9]" packages/runtime/src/engine/
  ```
  Expected: zero matches. Any line-number references in extracted modules' doc comments should have been replaced with `Lifted from execution-engine.ts post-W23-6a-8` style.

- [ ] **R6: Independent reviewer pass via `superpowers:requesting-code-review`**

  Dispatch a code-review subagent with the full diff range. Brief: "Confirm 12 extractions preserve behavior. No new tests should fail. Flag any closure deps that look incorrectly typed, any site strings that violate the structural test, any inline behavior that was changed unintentionally."

- [ ] **R7: Update memory + commit final summary**

  Save a memory entry tagging the W24 sequence as complete with cumulative LOC delta. Commit a final summary doc to `wiki/Research/Debriefs/2026-05-08-execution-engine-final-decomposition-debrief.md`.

---

## Risk register

| Risk | Mitigation |
|---|---|
| **T3 (debrief synthesis) is large and has many closure deps** | If the Deps interface gets unwieldy (>15 fields), split into 2 modules: one for the publishing path (FinalAnswerProduced + DebriefStored events), one for the synthesis call. Decision goes in T3's commit message. |
| **T11 type-tightening surfaces real type errors that were masked by `as any`** | Treat each as an independent bug. Fix in T11 if the fix is small (<5 lines); otherwise file follow-up issues and use `as ExecutionContextMetadata[K]` to keep the cast explicit. Don't expand T11 scope. |
| **T2 depends on T11 (classifyComplexity hoist)** | Sequence T11 before T2 in the dispatch order. Or, T2 imports `classifyComplexity` from execution-engine.ts directly via re-export until T11 lands. |
| **A subagent's "report back" claims green tests but doesn't actually run them** | Orchestrator runs `bun test` independently after every task before reviewing. Trust but verify. |
| **Test count regresses** | Any task that drops `5032 pass` is rejected immediately. Full session abort if 2+ tasks regress — assume systemic mistake. |

---

## Why this plan

**Each task is small, mechanical, and verifiable.** The W23 6a sequence already validated this pattern across 8 commits: extract a coherent block, pass closure deps through a typed interface, run tests, commit. We're just continuing past the agent-loop boundary.

**Improvements (T10-T12) are cheap because we're already in the code.** Hoisting helpers, typing the metadata field, and consolidating GenericTag declarations all become economical when you've just touched 12 files in the engine. Doing them as a separate session would cost more than the actual changes.

**The post-extraction review pass is the failure-mode catch.** Subagents can lie about test results, get types wrong, or introduce behavior drift. R1-R6 are the trust-but-verify checks that catch this before we declare done.
