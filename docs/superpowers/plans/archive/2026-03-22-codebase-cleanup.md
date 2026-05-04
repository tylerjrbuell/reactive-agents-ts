# Codebase Cleanup & Developer Experience — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve developer and AI-agent experience by extracting the execution engine's phases into focused modules, cleaning up loose ends from kernel optimization, and updating documentation to match current state.

**Architecture:** The execution engine (2,809 lines) is the primary target — its phases are extracted into focused modules that receive both the `ExecutionContext` and an `ExecutionState` bag (per-execution mutable state: task, toolCallLog, entropyLog, etc.). The `think` phase is a special case with setup/teardown lifecycle (EventBus subscription), and memory-flush dispatch logic stays in the orchestrator. Realistic target: ~800-1,000 lines after extraction (streaming backend + result assembly remain). Secondary work cleans up telemetry notice, skill synthesis TODOs, and documentation.

**Tech Stack:** TypeScript, Effect-TS, bun:test

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/runtime/src/phases/types.ts` | `ExecutionPhase` interface, `PhaseContext` type, phase registry types |
| `packages/runtime/src/phases/bootstrap.ts` | Phase 1: memory bootstrap, metrics init |
| `packages/runtime/src/phases/guardrail.ts` | Phase 2: input scanning (injection, PII, toxicity) |
| `packages/runtime/src/phases/strategy-select.ts` | Phase 3: strategy selection + cost routing |
| `packages/runtime/src/phases/think.ts` | Phase 4: reasoning execution (ReAct kernel dispatch) |
| `packages/runtime/src/phases/act-observe.ts` | Phase 5-6: tool execution + observation (tightly coupled) |
| `packages/runtime/src/phases/verify.ts` | Phase 7: verification quality gating |
| `packages/runtime/src/phases/memory-flush.ts` | Phase 8: proportional memory flush + debrief |
| `packages/runtime/src/phases/complete.ts` | Phase 9-10: cost tracking, audit, completion |
| `packages/runtime/src/phases/index.ts` | Phase registry, `runPhases()` orchestrator |
| `packages/runtime/tests/phases/bootstrap.test.ts` | Unit tests for bootstrap phase |
| `packages/runtime/tests/phases/memory-flush.test.ts` | Unit tests for proportional flush logic |

### Modified Files

| File | What Changes |
|------|-------------|
| `packages/runtime/src/execution-engine.ts` | Collapse from ~2,809 → ~800-1,000 lines — imports phases, wires guardedPhase, delegates to phase modules (streaming backend + result assembly remain) |
| `packages/reactive-intelligence/src/sensor/entropy-event-subscriber.ts` | Fix telemetry notice to respect `telemetry: false` config |
| `CLAUDE.md` | Update test counts (2,676), add kernel optimization to project status |
| `packages/reactive-intelligence/src/learning/skill-synthesis.ts` | Wire 3 remaining TODOs |

---

## Task 1: Define Phase Types & Registry Interface

**Files:**
- Create: `packages/runtime/src/phases/types.ts`

- [ ] **Step 1: Create the phase types file**

First, read `packages/runtime/src/types.ts` to find the existing `LifecyclePhase` type — reuse it instead of redefining.

```typescript
import type { Effect } from "effect";
import type { ExecutionContext, ReactiveAgentsConfig, LifecyclePhase } from "../types.js";
import type { RuntimeErrors } from "../errors.js";
import type { Task } from "@reactive-agents/core";

/** Reuse the existing phase name type from types.ts. */
export type PhaseName = LifecyclePhase;

/**
 * Per-execution mutable state accumulated during the run.
 * This is NOT on ExecutionContext — it's outer-scope state
 * created once per execute() call and shared across phases.
 */
export interface ExecutionState {
  readonly task: Task;
  readonly executionStartMs: number;
  cacheHit: boolean;
  readonly toolCallLog: { toolName: string; durationMs: number; success: boolean }[];
  readonly entropyLog: { composite: number; trajectory?: { shape: string } }[];
}

/**
 * Services available to phase handlers.
 * Each field is optional — phases check presence before use.
 */
export interface PhaseServices {
  readonly obs: any;       // ObsLike — narrow structural type from execution-engine.ts
  readonly eb: any;        // EbLike — narrow structural type from execution-engine.ts
  readonly config: ReactiveAgentsConfig;
  readonly state: ExecutionState;
  readonly guardedPhase: <E>(
    ctx: ExecutionContext,
    phase: PhaseName,
    body: (ctx: ExecutionContext) => Effect.Effect<ExecutionContext, E>,
  ) => Effect.Effect<ExecutionContext, E | RuntimeErrors>;
}

/**
 * A standard execution phase.
 * Takes context + services, returns updated context.
 */
export interface ExecutionPhase {
  readonly name: PhaseName;
  readonly run: (
    ctx: ExecutionContext,
    services: PhaseServices,
  ) => Effect.Effect<ExecutionContext, RuntimeErrors>;
  /** If true, phase is skipped when its service dependency is absent. */
  readonly optional?: boolean;
}

/**
 * A phase with setup/teardown lifecycle (e.g., think phase needs
 * EventBus subscription before run and unsubscription after).
 */
export interface LifecyclePhase extends ExecutionPhase {
  readonly setup?: (services: PhaseServices) => Effect.Effect<void, RuntimeErrors>;
  readonly teardown?: (services: PhaseServices) => Effect.Effect<void, RuntimeErrors>;
}
```

**Note:** The `think` phase uses the `LifecyclePhase` variant because it subscribes to `ReasoningStepCompleted` events before running and must unsubscribe after. Other phases use the simpler `ExecutionPhase` interface.

- [ ] **Step 2: Create index barrel**

Create `packages/runtime/src/phases/index.ts`:

```typescript
export * from "./types.js";
```

- [ ] **Step 3: Commit**

```
git add packages/runtime/src/phases/types.ts packages/runtime/src/phases/index.ts
git commit -m "feat(runtime): add execution phase types and registry interface"
```

---

## Task 2: Extract Bootstrap Phase

**Files:**
- Create: `packages/runtime/src/phases/bootstrap.ts`
- Create: `packages/runtime/tests/phases/bootstrap.test.ts`

- [ ] **Step 1: Read the bootstrap section of execution-engine.ts**

Read `packages/runtime/src/execution-engine.ts` lines 516-578 to understand the full bootstrap logic (memory bootstrap, metrics init, episodic loading).

- [ ] **Step 2: Write the failing test**

Create `packages/runtime/tests/phases/bootstrap.test.ts` with tests that verify:
- Bootstrap returns context with updated `phase: "bootstrap"`
- When memory service is absent, bootstrap still succeeds (no-op)
- Bootstrap populates `semanticContext` and `episodicContext` when memory is present

- [ ] **Step 3: Extract bootstrap into its own module**

Create `packages/runtime/src/phases/bootstrap.ts` — move the bootstrap body from the execution engine into an exported `bootstrapPhase: ExecutionPhase` constant. Import the memory service types it needs.

- [ ] **Step 4: Run tests**

Run: `cd packages/runtime && bun test tests/phases/bootstrap.test.ts`
Expected: All pass.

- [ ] **Step 5: Update index.ts**

Add `export * from "./bootstrap.js";` to `packages/runtime/src/phases/index.ts`.

- [ ] **Step 6: Commit**

```
git add packages/runtime/src/phases/bootstrap.ts packages/runtime/src/phases/index.ts packages/runtime/tests/phases/bootstrap.test.ts
git commit -m "feat(runtime): extract bootstrap phase into focused module"
```

---

## Task 3: Extract Memory-Flush Phase (with Proportional Pipeline Fix)

**Files:**
- Create: `packages/runtime/src/phases/memory-flush.ts`
- Create: `packages/runtime/tests/phases/memory-flush.test.ts`

This is the highest-value extraction — it contains the proportional pipeline logic that showed issues in benchmarks (memory-flush still 1-2s on trivial tasks).

- [ ] **Step 1: Read the memory-flush section of execution-engine.ts**

Read lines ~2151-2280 to understand the current flush logic, complexity classification, and debrief gating.

- [ ] **Step 2: Write failing tests for proportional pipeline**

Tests should verify:
- `classifyComplexity(1, undefined, 0, "final_answer")` returns `"trivial"`
- `classifyComplexity(2, { composite: 0.3 }, 1, "end_turn")` returns `"moderate"`
- `classifyComplexity(5, { composite: 0.6 }, 4, "max_iterations")` returns `"complex"`
- Trivial tasks skip memory flush entirely (mock verifies flush not called)
- Moderate tasks fork flush as daemon (non-blocking)
- Complex tasks block on flush

- [ ] **Step 3: Extract memory-flush into its own module**

Move `classifyComplexity` and the memory-flush body into `packages/runtime/src/phases/memory-flush.ts`. Export:
- `classifyComplexity` — pure function (for testing and orchestrator use)
- `memoryFlushPhase: ExecutionPhase` — the flush body itself

**IMPORTANT:** The three-way dispatch (skip/fork/block based on complexity) stays in the orchestrator, NOT in the phase. The orchestrator calls `classifyComplexity` using data from `PhaseServices.state` (toolCallLog, entropyLog), then either skips the phase, forks it as a daemon, or blocks on it. The phase module only contains the flush logic itself.

Also verify that `classifyComplexity` receives correct metadata. Check how `iterationCount`, `toolCallCount`, `terminatedBy`, and `latestEntropyScore` are extracted from the context. If they're not being threaded correctly, fix the threading — this is likely why trivial tasks still show 1-2s flush times.

- [ ] **Step 4: Run tests**

Run: `cd packages/runtime && bun test tests/phases/memory-flush.test.ts`
Expected: All pass.

- [ ] **Step 5: Update index.ts and commit**

```
git add packages/runtime/src/phases/memory-flush.ts packages/runtime/src/phases/index.ts packages/runtime/tests/phases/memory-flush.test.ts
git commit -m "feat(runtime): extract memory-flush phase with proportional pipeline fix"
```

---

## Task 4: Extract Remaining Phases

**Files:**
- Create: `packages/runtime/src/phases/guardrail.ts`
- Create: `packages/runtime/src/phases/strategy-select.ts`
- Create: `packages/runtime/src/phases/think.ts`
- Create: `packages/runtime/src/phases/act-observe.ts`
- Create: `packages/runtime/src/phases/verify.ts`
- Create: `packages/runtime/src/phases/complete.ts`

Each phase follows the same pattern as Tasks 2-3: read the section, extract into a module exporting an `ExecutionPhase`, update the index.

- [ ] **Step 1: Extract guardrail phase** (lines ~580-640)
- [ ] **Step 2: Extract strategy-select phase** (lines ~640-967)
- [ ] **Step 3: Extract think phase** (lines ~967-1206) — the largest phase, includes reasoning dispatch. **Use `LifecyclePhase` interface** with `setup` (subscribe to `ReasoningStepCompleted` events) and `teardown` (unsubscribe). The pre-think logic (tool-schema fetching, adaptive filtering, cache check at lines 866-967) should be part of the think module since it's logically think-phase setup, not inter-phase orchestration.
- [ ] **Step 4: Extract act-observe phase** (lines ~1206-1369) — note: the `act`/`observe` guardedPhase calls at lines 1206-1211 are stubs (`Effect.succeed(c)`). The real post-think work (episodic memory bridging, experience logging, cache store at lines 1140-1204) is what needs extraction. Clarify naming: this is "post-think processing", not tool execution (tools run inside the kernel).
- [ ] **Step 5: Extract verify phase** (lines ~1935-2030)
- [ ] **Step 6: Extract complete phase** (lines ~2285-2400) — includes cost-track, audit, result assembly
- [ ] **Step 7: Update all exports in phases/index.ts**
- [ ] **Step 8: Run full test suite**

Run: `bun test`
Expected: All 2,676+ tests pass.

- [ ] **Step 9: Commit**

```
git add packages/runtime/src/phases/
git commit -m "feat(runtime): extract all execution phases into focused modules"
```

---

## Task 5: Collapse Execution Engine to Orchestrator

**Files:**
- Modify: `packages/runtime/src/execution-engine.ts`

- [ ] **Step 1: Replace inline phase bodies with imports**

The execution engine should now import each phase and call them through `guardedPhase`. Replace the inline `Effect.gen(function*() { ... })` bodies with calls to the extracted phase modules.

The structure becomes:
```typescript
// Phase 1: Bootstrap
ctx = yield* guardedPhase(ctx, "bootstrap", (c) => bootstrapPhase.run(c, services));
// Phase 2: Guardrail
ctx = yield* guardedPhase(ctx, "guardrail", (c) => guardrailPhase.run(c, services));
// ... etc
```

- [ ] **Step 2: Remove dead code**

After extraction, remove all the inline phase bodies, unused imports, and any helper functions that were moved to phase modules.

- [ ] **Step 3: Verify line count reduction**

Target: `execution-engine.ts` should be ~800-1,000 lines (from ~2,809). The streaming backend (`executeStream`, Queue/forkDaemon infrastructure), result assembly (debrief, telemetry, tool stats), and inter-phase state setup remain in the engine.

- [ ] **Step 4: Run full test suite**

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```
git add packages/runtime/src/execution-engine.ts
git commit -m "refactor(runtime): collapse execution engine to phase orchestrator (~2800 → ~500 lines)"
```

---

## Task 6: Fix Telemetry Notice

**Files:**
- Modify: `packages/reactive-intelligence/src/sensor/entropy-event-subscriber.ts` or the telemetry client initialization

- [ ] **Step 1: Find where the notice is emitted**

Search for `"Reactive Intelligence telemetry enabled"` in the codebase. The notice should only print when `telemetry: true` in the config.

- [ ] **Step 2: Add config check**

Wrap the notice in a condition that checks the actual telemetry config value.

- [ ] **Step 3: Run tests**

Run: `bun test`
Expected: All pass. No telemetry notice in test output when telemetry is false.

- [ ] **Step 4: Commit**

```
git add <modified file>
git commit -m "fix(reactive-intelligence): suppress telemetry notice when telemetry is disabled"
```

---

## Task 7: Wire Skill Synthesis TODOs

**Files:**
- Modify: `packages/reactive-intelligence/src/learning/skill-synthesis.ts`

- [ ] **Step 1: Read the file and locate the 3 TODOs**

Lines 68-71 have three TODOs for wiring `promptTemplateId`, `systemPromptTokens`, and `compressionEnabled`.

- [ ] **Step 2: Trace the call chain to understand available data**

`extractSkillFragment()` is called from the telemetry/learning pipeline. Trace back from the call site to find:
- Where `promptTemplateId` comes from (Thompson Sampling bandit arm selection)
- Where `systemPromptTokens` comes from (kernel state post-reasoning)
- Where `compressionEnabled` comes from (controller config)

This is a multi-file change — the call site may need additional parameters threaded through from the kernel runner or telemetry client. Read `packages/reactive-intelligence/src/learning/` and `packages/reactive-intelligence/src/telemetry/` to map the data flow.

- [ ] **Step 3: Run tests**

Run: `cd packages/reactive-intelligence && bun test`
Expected: All pass.

- [ ] **Step 4: Commit**

```
git add packages/reactive-intelligence/src/learning/skill-synthesis.ts
git commit -m "fix(reactive-intelligence): wire remaining skill synthesis config fields"
```

---

## Task 8: Update Documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update test counts and project status**

Update the test count from `2,491` to `2,676` (or current count). Add kernel optimization to the project status changelog. Update the package description for `reasoning` to mention the termination oracle.

- [ ] **Step 2: Add phase extraction to architecture section if completed**

If Tasks 1-5 are done, add a note about the phase registry pattern in the architecture section.

- [ ] **Step 3: Commit**

```
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with current test counts and kernel optimization status"
```

---

## Task 9: Integration Verification

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: All 2,676+ tests pass.

- [ ] **Step 2: Run build**

Run: `bun run build`
Expected: All 22 packages build successfully.

- [ ] **Step 3: Spot-check execution engine line count**

Run: `wc -l packages/runtime/src/execution-engine.ts`
Expected: 400-600 lines (down from 2,809).

- [ ] **Step 4: Commit any fixes**

```
git add <specific files>
git commit -m "fix: integration fixes for codebase cleanup"
```
