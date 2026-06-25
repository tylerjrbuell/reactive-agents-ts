# Eval Canonical System — Phase 2 (Contract Unify + Dedup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Follow the project's `agent-tdd` skill (Bun test, mandatory `--timeout`).

**Goal:** Establish ONE canonical quality-dimension/score contract in `@reactive-agents/core` (the 10-dimension agentic taxonomy), have `benchmarks` adopt it (killing its duplicate `QualityDimension`/`DimensionScore`), and dedup the judge wire-contract — all type-only, with NO scoring-logic rewrite.

**Architecture:** `core` (published) gains a plain-interface `score-contract.ts` with `QualityDimension` (10) + `DimensionScore` + `CANONICAL_QUALITY_DIMENSIONS`. `benchmarks` re-exports those from core instead of declaring its own (its current shape already matches exactly). The judge wire-contract types get a single source of truth via a type-only export from `judge-server`, consumed by `benchmarks` — but ONLY if it stays type-only (no Effect runtime coupling across the HTTP boundary); otherwise the documented local mirror stays. `eval`'s 5 scorers + its own `DimensionScore` are **untouched** — eval's migration to the canonical taxonomy (fold relevance/completeness into accuracy, move safety to a guardrail check) is a scoring-logic change explicitly **deferred to a later phase**.

**Tech Stack:** TypeScript, Bun test. Plain interfaces in `core` (no Effect for the contract types). `import type` for type-only deduplication.

## Global Constraints

- **Decisions locked (do not re-litigate):** contract home = `@reactive-agents/core`; canonical taxonomy = benchmarks' existing **10** (`accuracy, reasoning, tool-mastery, memory-fidelity, loop-intelligence, resilience, efficiency, reliability, scope-discipline, honest-uncertainty`); `safety` and `relevance`/`completeness`/`cost-efficiency` are NOT added to the canonical 10 (safety → future guardrail check; rel/comp → accuracy rubric; cost-efficiency unifies under `efficiency`) — documented in the contract, not implemented here. Scope = **contract-unify + dedup only**, NO scoring-logic rewrite, eval untouched.
- **`DimensionScore` canonical shape:** `{ readonly dimension: QualityDimension; readonly score: number; readonly evidence?: string }` — uses `evidence?` (matches benchmarks today), NOT eval's `details?`.
- **No behavior change:** every existing `benchmarks` test (incl. the Phase 1 gate tests) must stay green. This is a type-identity refactor — the `DimensionScore` shape benchmarks gets from core is byte-identical to what it declares today.
- **Type-only across the HTTP boundary:** the judge-contract dedup (Task 3) must remain `import type`. If importing judge-server's contract types pulls Effect runtime types into benchmarks' plain/Promise code OR cannot be cleanly type-exported, STOP and leave the documented local mirror (report DONE_WITH_CONCERNS).
- **`core` is published; `benchmarks`/`judge-server` are private.** Adding scoring types to published `core` is intended. Do NOT add a `benchmarks`→`eval` or published→private dependency.
- **Import extensions:** match each package's existing convention (grep a sibling import first). `core` and `benchmarks` use `.js` relative imports.
- **Clean types:** strict TS, no `any`. Conventional Commits, NO `Co-Authored-By` trailer.
- **Test command:** `bun test --timeout 10000 <path>` from repo root. Build: `bunx turbo run build --filter=<pkg>`.

---

## File Structure

- Create `packages/core/src/contracts/score-contract.ts` — `QualityDimension`, `DimensionScore`, `CANONICAL_QUALITY_DIMENSIONS`, taxonomy doc.
- Modify `packages/core/src/index.ts` — export the score contract.
- Create `packages/core/tests/score-contract.test.ts` (or match core's existing test dir/convention) — guard the canonical 10.
- Modify `packages/benchmarks/src/types.ts` — replace local `QualityDimension` + `DimensionScore` with re-exports from core.
- Modify `packages/judge-server/src/index.ts` — re-export wire-contract data types from the package entry (Task 3, conditional).
- Modify `packages/benchmarks/src/judge.ts` — replace the local `JudgeRequest`/`JudgeResponse`/`JudgeLayerResult` mirror with `import type` from `@reactive-agents/judge-server` (Task 3, conditional).

---

## Task 1: Canonical score contract in core

**Files:**
- Create: `packages/core/src/contracts/score-contract.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/score-contract.test.ts` (match core's actual test location — check `packages/core` for an existing `tests/` or `__tests__/` dir and follow it)

**Interfaces:**
- Produces:
  - `type QualityDimension = "accuracy" | "reasoning" | "tool-mastery" | "memory-fidelity" | "loop-intelligence" | "resilience" | "efficiency" | "reliability" | "scope-discipline" | "honest-uncertainty"`
  - `interface DimensionScore { readonly dimension: QualityDimension; readonly score: number; readonly evidence?: string }`
  - `const CANONICAL_QUALITY_DIMENSIONS: readonly QualityDimension[]` (the 10, frozen)

- [ ] **Step 1: Inspect core's export + test conventions**

Run: `grep -n "contracts/" packages/core/src/index.ts | head` and `ls packages/core/tests packages/core/__tests__ 2>/dev/null` and `grep -rn "from \"\.\./" packages/core/src/contracts/task-contract.ts | head -1`
Purpose: confirm how `core/src/index.ts` re-exports contracts (e.g. `export * from "./contracts/task-contract.js"`), where core tests live, and the relative-import extension. Match these.

- [ ] **Step 2: Write the failing test**

Create `packages/core/tests/score-contract.test.ts` (adjust dir to match Step 1):

```ts
import { describe, expect, it } from "bun:test";
import { CANONICAL_QUALITY_DIMENSIONS } from "../src/contracts/score-contract.js";
import type { DimensionScore, QualityDimension } from "../src/contracts/score-contract.js";

describe("canonical quality dimensions", () => {
  it("is exactly the 10 agentic dimensions, in order", () => {
    expect(CANONICAL_QUALITY_DIMENSIONS).toEqual([
      "accuracy",
      "reasoning",
      "tool-mastery",
      "memory-fidelity",
      "loop-intelligence",
      "resilience",
      "efficiency",
      "reliability",
      "scope-discipline",
      "honest-uncertainty",
    ]);
  });

  it("does NOT include the deferred eval dims (safety/relevance/completeness/cost-efficiency)", () => {
    const set = new Set<string>(CANONICAL_QUALITY_DIMENSIONS);
    for (const d of ["safety", "relevance", "completeness", "cost-efficiency"]) {
      expect(set.has(d)).toBe(false);
    }
  });

  it("DimensionScore is structurally usable with a canonical dimension", () => {
    const s: DimensionScore = { dimension: "accuracy", score: 0.9 };
    const d: QualityDimension = "reasoning";
    expect(s.score).toBe(0.9);
    expect(d).toBe("reasoning");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test packages/core/tests/score-contract.test.ts --timeout 10000`
Expected: FAIL — `Cannot find module "../src/contracts/score-contract.js"`.

- [ ] **Step 4: Implement the contract**

Create `packages/core/src/contracts/score-contract.ts`:

```ts
// File: src/contracts/score-contract.ts
// Canonical quality-dimension + score contract (shared by eval/benchmarks/judge-server).
// Decision 2026-06-25: the agentic 10 are canonical. `safety` is a guardrail concern,
// not a quality dimension; `relevance`/`completeness` fold into the `accuracy` rubric;
// `cost-efficiency` unifies under `efficiency` (token-based). Those are intentionally
// excluded here and migrated in a later phase — see
// wiki/Architecture/Design-Specs/2026-06-24-canonical-evaluation-system.md.

/** The canonical agentic quality dimensions an agent run is scored on. */
export type QualityDimension =
  | "accuracy"
  | "reasoning"
  | "tool-mastery"
  | "memory-fidelity"
  | "loop-intelligence"
  | "resilience"
  | "efficiency"
  | "reliability"
  | "scope-discipline"
  | "honest-uncertainty";

/** A single dimension's score for one run. `evidence` is optional judge rationale. */
export interface DimensionScore {
  readonly dimension: QualityDimension;
  readonly score: number;
  readonly evidence?: string;
}

/** The canonical 10, frozen + ordered. Source of truth for the taxonomy. */
export const CANONICAL_QUALITY_DIMENSIONS: readonly QualityDimension[] = [
  "accuracy",
  "reasoning",
  "tool-mastery",
  "memory-fidelity",
  "loop-intelligence",
  "resilience",
  "efficiency",
  "reliability",
  "scope-discipline",
  "honest-uncertainty",
] as const;
```

- [ ] **Step 5: Export from core's package entry**

In `packages/core/src/index.ts`, add (matching the surrounding contract-export style + extension found in Step 1, e.g. alongside `export * from "./contracts/task-contract.js"`):

```ts
export * from "./contracts/score-contract.js";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test packages/core/tests/score-contract.test.ts --timeout 10000`
Expected: PASS (3 tests).

- [ ] **Step 7: Build core to confirm the new export is typecheck/DTS clean**

Run: `bunx turbo run build --filter=@reactive-agents/core`
Expected: build success.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/contracts/score-contract.ts packages/core/src/index.ts packages/core/tests/score-contract.test.ts
git commit -m "feat(core): canonical quality-dimension + score contract"
```

---

## Task 2: benchmarks adopts the core contract

**Files:**
- Modify: `packages/benchmarks/src/types.ts` (the `QualityDimension` decl ~lines 97-107 and `DimensionScore` decl ~lines 109-114)
- Test: existing benchmarks tests (no new test — this is a type-identity swap; the green suite IS the test)

**Interfaces:**
- Consumes: `QualityDimension`, `DimensionScore` from `@reactive-agents/core` (Task 1).
- Produces: `benchmarks/src/types.ts` re-exports the same two names (so every existing `from "../types.js"` import across benchmarks keeps resolving unchanged).

- [ ] **Step 1: Confirm shape identity**

Run: `grep -n "QualityDimension\|interface DimensionScore" packages/benchmarks/src/types.ts | head`
Confirm benchmarks' current `DimensionScore` is `{ readonly dimension: QualityDimension; readonly score: number; readonly evidence?: string }` and its `QualityDimension` union is exactly the 10 in the same set. (If the union differs from core's 10 in ANY member, STOP and report — the decision assumed identity.)

- [ ] **Step 2: Confirm benchmarks depends on core**

Run: `grep -n "@reactive-agents/core" packages/benchmarks/package.json`
Expected: present in `dependencies`. (It is — benchmarks already imports `ToolRequirement`/`PreFlightViolation` from core.)

- [ ] **Step 3: Replace the local declarations with re-exports**

In `packages/benchmarks/src/types.ts`, DELETE the local `export type QualityDimension = …` union and the local `export interface DimensionScore { … }` block, and replace BOTH with a single re-export near the top of the file (below the existing `import type { ... } from "@reactive-agents/core"` line, or add the names to it):

```ts
// Canonical quality taxonomy now lives in @reactive-agents/core (2026-06-25 unification).
export type { QualityDimension, DimensionScore } from "@reactive-agents/core";
```

Leave every OTHER type in `types.ts` (`RunScore`, `TaskVariantReport`, `DimensionRubric`, etc.) untouched — they reference `QualityDimension`/`DimensionScore` by name and now resolve to the core types.

- [ ] **Step 4: Run the full benchmarks suite (incl. the Phase 1 gate tests)**

Run: `bun test packages/benchmarks/tests --timeout 20000`
Expected: PASS — same count as before this task. The gate tests (`gate.test.ts`) exercise `DimensionScore` via fixtures; they must stay green, proving shape identity.

- [ ] **Step 5: Build benchmarks to confirm no type drift**

Run: `bunx turbo run build --filter=@reactive-agents/benchmarks`
Expected: build success (DTS green). If a type error surfaces (e.g. an `evidence` vs `details` mismatch, or a member the local union had that core's lacks), that is the real reconciliation gap — STOP and report it with the exact diff rather than widening core.

- [ ] **Step 6: Commit**

```bash
git add packages/benchmarks/src/types.ts
git commit -m "refactor(benchmarks): adopt canonical DimensionScore/QualityDimension from core"
```

---

## Task 3: Dedup the judge wire-contract (bounded — type-only or skip)

**Files:**
- Modify: `packages/judge-server/src/index.ts` (re-export wire-contract data types from the package entry)
- Modify: `packages/benchmarks/src/judge.ts` (replace the local mirror at ~lines 85-111 with `import type`)

**Interfaces:**
- Consumes: the wire-contract data types from `@reactive-agents/judge-server`.
- Produces: benchmarks' `judge.ts` uses the imported types; the local `interface JudgeRequest/JudgeResponse/JudgeLayerResult` mirror is deleted.

**Context:** benchmarks deliberately re-declares the contract (see the comment at `judge.ts:82-83`) because judge-server's package `exports` only surfaces `.`. This task makes judge-server export the *data types* so there is one source of truth. **It must remain type-only.** If the contract types are Effect-Schema-derived in a way that can't be cleanly `import type`'d as plain data shapes (e.g. importing them drags Effect types into benchmarks' plain code, or the package can't surface them without a runtime import), ABORT this task, restore the local mirror, and report DONE_WITH_CONCERNS — the documented local mirror at an HTTP boundary is an acceptable end state.

- [ ] **Step 1: Inspect judge-server's contract exports**

Run: `cat packages/judge-server/src/contract.ts` and `grep -n "export" packages/judge-server/src/index.ts`
Determine: does `contract.ts` export plain `type` aliases for `JudgeRequest`/`JudgeResponse`/`JudgeLayerResult`/`ReproducibilityMetadata` (e.g. `export type JudgeRequest = typeof JudgeRequestSchema.Type`), or only Schema `const`s? Does `index.ts` already re-export any of them? Decide if a clean type-only surface is possible. If `contract.ts` exposes only Schema consts whose `.Type` is plain-data (no Effect in the data shape), a `export type { ... }` re-export of the derived types is clean. If not, ABORT per Context.

- [ ] **Step 2: Re-export the data types from judge-server's entry**

In `packages/judge-server/src/index.ts`, add (using the actual type names found in Step 1):

```ts
export type {
  JudgeRequest,
  JudgeResponse,
  JudgeLayerResult,
  ReproducibilityMetadata,
} from "./contract.js";
```

If `contract.ts` does not currently export those as `type`s, first add the `export type` aliases there (derived from the Schemas, e.g. `export type JudgeResponse = typeof JudgeResponseSchema.Type`) — type-only, no runtime change.

- [ ] **Step 3: Replace benchmarks' local mirror with a type-only import**

In `packages/benchmarks/src/judge.ts`, delete the local `interface JudgeRequest { … }`, `interface JudgeLayerResult { … }`, and `interface JudgeResponse { … }` (lines ~85-111, and the now-stale sync comment at ~82-83), and add at the top with the other imports:

```ts
import type {
  JudgeLayerResult,
  JudgeRequest,
  JudgeResponse,
} from "@reactive-agents/judge-server";
```

Verify the imported `JudgeResponse.reproducibility` shape (`{ judgeModelSha; judgeCodeSha }`) matches how `judge.ts` reads it; if the judge-server type nests differently, adjust the read sites — do not change runtime behavior.

- [ ] **Step 4: Build both packages + run benchmarks tests**

Run: `bunx turbo run build --filter=@reactive-agents/judge-server --filter=@reactive-agents/benchmarks`
Then: `bun test packages/benchmarks/tests --timeout 20000`
Expected: builds succeed, all benchmarks tests green. If benchmarks now transitively requires Effect *types* that break its plain build, ABORT per Context (restore the mirror) and report.

- [ ] **Step 5: Commit (or report abort)**

If clean:
```bash
git add packages/judge-server/src/index.ts packages/judge-server/src/contract.ts packages/benchmarks/src/judge.ts
git commit -m "refactor(benchmarks): import judge wire-contract from judge-server (single source)"
```
If aborted: restore the local mirror, leave the `judge.ts:82-83` comment intact, and report DONE_WITH_CONCERNS explaining why the HTTP-boundary mirror stays.

---

## Done Criteria

- `@reactive-agents/core` exports the canonical `QualityDimension` (10) + `DimensionScore` + `CANONICAL_QUALITY_DIMENSIONS`, tested + built.
- `benchmarks` uses the core types (its duplicate declarations removed); full benchmarks suite incl. Phase 1 gate tests green; build green.
- Judge wire-contract has a single source of truth via type-only import — OR the documented HTTP-boundary mirror is consciously retained with a recorded reason.
- `eval` is UNCHANGED. No scoring-logic rewrite. No `benchmarks`→`eval` or published→private dependency added.

## Deferred to later phases (NOT in this plan)
- **eval's taxonomy migration:** fold relevance/completeness into the accuracy rubric, move safety to a guardrail check, unify cost-efficiency under efficiency, and have eval's `DimensionScore` adopt core's canonical type. (Scoring-logic change.)
- **eval reproducibility parity:** give eval's in-process judge the frozen SHA/runId metadata.
- **`rax eval gate` CLI + CI regression job + product facade** (canonical-system Phase 4).
- **Wire-the-why (L3):** attach `analyzeRun` diagnosis to every Run (canonical-system Phase 3).

## Self-Review notes
- **Spec coverage:** implements canonical-evaluation-system §7 Phase 2 ("one taxonomy / dedup the scorer") at the contract level, honoring the three locked decisions. The "one judge" + eval-side folding are deferred per the chosen scope (contract-unify + dedup only).
- **Type consistency:** `DimensionScore`/`QualityDimension`/`CANONICAL_QUALITY_DIMENSIONS` names + the `evidence?` field are identical across Tasks 1-3.
- **Risk controls:** Task 2 is a pure type-identity swap gated by the unchanged green suite; Task 3 is explicitly abortable to the existing documented mirror. Both Step-1 inspections catch shape drift before any edit.
- **Placeholder scan:** every code step carries complete code; uncertain internals (core export style, core test dir, judge-server contract type names) are handled by explicit inspection steps, not guesses.
