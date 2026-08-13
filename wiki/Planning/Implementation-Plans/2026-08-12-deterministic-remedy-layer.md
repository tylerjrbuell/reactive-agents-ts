# Deterministic Remedy Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the four-layer deterministic remedy mechanism specced at
`2026-08-12-agentic-overhaul-program.md` §6b — the harness stops asking the model to
call `recall()`, stop repeating a tool, or self-judge an incomplete enumeration, and
instead computes those decisions itself from `RunContract`/`RunLedger`/`RunAssessment`
data it already has.

**Architecture:** Four additive layers riding the existing meta-loop DAG
(`RunContract → RunLedger → RunAssessment → Control → Actuators → Projector`), each
filling an empty or half-wired slot rather than adding a new box: (A) an enumeration
hint on `RequirementSpec`, (B) a `requirementProgress` map on `RunAssessment` fed by a
new `result-truncated` ledger fact, (C) a stall-indexed render budget in
`project-results.ts`, (D) two new `ControlProposal` emitters routed through the
existing `resolveControlPlane` total order.

**Tech Stack:** TypeScript, Effect-TS (`Effect.gen`), Bun test runner, `packages/reasoning`.

## Global Constraints

- Every requirement/deliverable/contract shape stays additive — `RequirementKind`
  (closed 4-set) and `ControlAction` (closed 7-set) are NOT extended; new behavior
  rides new optional fields and the existing `coverage`/`loop` `RemedyKind`s.
- Every task ships a red-on-cut test: write the failing test, watch it fail for the
  right reason, implement, watch it pass.
- No task changes behavior on a contract/assessment that has no enumeration hint and
  no truncation history — byte-identical output for every task shape this program has
  already measured (09 §2 lift-rule discipline; a silent regression here reopens FM-3's
  own instrument-integrity lesson).
- Full regression suite (`bun test` in `packages/reasoning`) must stay green after
  every task, not just the new test file.
- This plan builds Phase 6 code. Per the governing plan's Standing Rule 1 (WIP = 1)
  and §1 (Phase 0 blocking), do not START executing this plan until Phase 0 (branch
  merge) has landed and the Phase 1 owner call is made — filing/reviewing the plan
  itself is not code.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/reasoning/src/kernel/ledger/run-ledger.ts` | Modify: add `ResultTruncatedEntry` to the `LedgerEntry` union |
| `packages/reasoning/src/kernel/ledger/emit.ts` | Modify: add `recordResultTruncation()` emitter, mirrors `recordCompactionMarker` |
| `packages/reasoning/src/kernel/capabilities/reason/think.ts` | Modify: mint the ledger fact from `trace.messages` after projection (`:496` neighborhood) |
| `packages/reasoning/src/kernel/contract/run-contract.ts` | Modify: `EnumerationHint` type + `RequirementSpec.enumeration` + classifier in `compileRunContract` |
| `packages/reasoning/src/kernel/assessment/assess.ts` | Modify: `requirementProgress` field on `RunAssessment`, computed from `result-truncated` ledger entries |
| `packages/reasoning/src/assembly/stages/project-results.ts` | Modify: escalated budget for stalled load-bearing refs |
| `packages/reasoning/src/kernel/control/emitters.ts` | Modify: `proposeFromEnumerationIncomplete()` |
| `packages/reasoning/src/kernel/control/abstention-proposal.ts` | Modify: `enumerationIncompleteProposal()` wrapper, mirrors `inLoopAbstentionProposal` |
| `packages/reasoning/src/kernel/capabilities/act/guard.ts` | Modify: `repetitionGuard`'s nudge text becomes stall/escalation-aware (`:265` neighborhood) |
| `packages/reasoning/src/kernel/loop/iterate-pass.ts` | Modify: wire `enumerationIncompleteProposal` alongside the existing `inLoopAbstentionProposal` calls (3 sites: `:1060`, `:1210`, `:1453`) |

---

## Task 1: Ledger — `result-truncated` fact

**Files:**
- Modify: `packages/reasoning/src/kernel/ledger/run-ledger.ts:161-176` (add entry type + union member)
- Modify: `packages/reasoning/src/kernel/ledger/emit.ts:90-118` (add emitter, right after `recordCompactionMarker`)
- Modify: `packages/reasoning/src/kernel/capabilities/reason/think.ts:496-512` (mint the fact)
- Test: `packages/reasoning/tests/kernel/ledger/emit.test.ts` (new `describe` block, alongside the existing `compaction-marker` tests at `:78-97`)

**Interfaces:**
- Consumes: `MessageTrace` (`packages/reasoning/src/assembly/trace.ts:3-14`) — already carries `projection: "full" | "preview+ref" | "cleared"` and `ref?: string` per rendered message, computed by `project-results.ts:112-134`. No new computation, only new persistence.
- Produces: `recordResultTruncation(ledger, truncatedRefs: readonly string[], iteration: number): RunLedger` — Task 3 (assess.ts) reads this via `entriesOfKind(ledger, "result-truncated")`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/reasoning/tests/kernel/ledger/emit.test.ts — new describe block
import { recordResultTruncation } from "../../../src/kernel/ledger/emit.js";
import { entriesOfKind } from "../../../src/kernel/ledger/run-ledger.js";

describe("recordResultTruncation (FM-17 layer 1)", () => {
  it("records a result-truncated fact enumerating the truncated refs", () => {
    const ledger = recordResultTruncation([], ["res_abc123"], 2);
    const facts = entriesOfKind(ledger, "result-truncated");
    expect(facts.length).toBe(1);
    expect(facts[0]).toMatchObject({ iteration: 2, truncatedRefs: ["res_abc123"] });
  });

  it("no-ops when nothing was truncated", () => {
    const ledger = recordResultTruncation([], [], 2);
    expect(entriesOfKind(ledger, "result-truncated").length).toBe(0);
  });

  it("de-dupes against the most recent identical truncated-ref set", () => {
    let ledger = recordResultTruncation([], ["res_abc123"], 2);
    ledger = recordResultTruncation(ledger, ["res_abc123"], 3);
    expect(entriesOfKind(ledger, "result-truncated").length).toBe(1);
    ledger = recordResultTruncation(ledger, ["res_abc123", "res_def456"], 4);
    expect(entriesOfKind(ledger, "result-truncated").length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/reasoning && bun test tests/kernel/ledger/emit.test.ts -t "result-truncated"`
Expected: FAIL — `recordResultTruncation` is not exported from `emit.js`, and `"result-truncated"` is not a valid `LedgerEntry.kind`.

- [ ] **Step 3: Add the entry type**

In `packages/reasoning/src/kernel/ledger/run-ledger.ts`, right after `CompactionMarkerEntry` (currently `:161-169`):

```typescript
/**
 * A tool result was rendered as `preview+ref` this iteration — the model did NOT
 * see it in full (FM-17). Carries the ENUMERATION of truncated refs so assess()
 * can compute per-requirement stall without re-deriving from raw trace data.
 */
export interface ResultTruncatedEntry extends LedgerEntryBase {
  readonly kind: "result-truncated";
  readonly truncatedRefs: readonly string[];
}
```

Add `ResultTruncatedEntry` to the `LedgerEntry` union (the `| CompactionMarkerEntry` line and its neighbors, `:172-179` area) — append `| ResultTruncatedEntry` in the same list.

- [ ] **Step 4: Add the emitter**

In `packages/reasoning/src/kernel/ledger/emit.ts`, right after `recordCompactionMarker` (ends `:118`):

```typescript
/**
 * Record which tool-result refs rendered as `preview+ref` this iteration
 * (FM-17 layer 1). De-duped against the most recent `result-truncated` entry —
 * projection re-runs every render, so an identical truncated set would
 * otherwise append a redundant fact each turn.
 */
export function recordResultTruncation(
  ledger: RunLedger | undefined,
  truncatedRefs: readonly string[],
  iteration: number,
): RunLedger {
  if (truncatedRefs.length === 0) return ledger ?? [];
  const base = ledger ?? [];
  const last = [...base].reverse().find((e) => e.kind === "result-truncated");
  if (last && last.kind === "result-truncated") {
    const prev = last.truncatedRefs;
    if (prev.length === truncatedRefs.length && prev.every((r, i) => r === truncatedRefs[i])) {
      return base;
    }
  }
  return appendEntry(base, {
    kind: "result-truncated",
    iteration,
    truncatedRefs: [...truncatedRefs],
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/reasoning && bun test tests/kernel/ledger/emit.test.ts -t "result-truncated"`
Expected: PASS (3 tests)

- [ ] **Step 6: Wire the mint site in think.ts**

In `packages/reasoning/src/kernel/capabilities/reason/think.ts`, immediately after the existing compaction-marker block (the one ending around `:512`, which reads `trace.compaction`), add a sibling block reading `trace.messages` instead:

```typescript
    // ── FM-17 layer 1: record the result-truncated fact ─────────────────────
    // Mirrors the compaction-marker block above but reads per-MESSAGE projection
    // (project-results.ts), not the whole-thread compaction outcome — a result
    // can be individually truncated on a turn where compaction never ran.
    const truncatedRefs = trace.messages
      .filter((m) => m.projection === "preview+ref" && m.ref !== undefined)
      .map((m) => m.ref as string);
    if (truncatedRefs.length > 0) {
      state = transitionState(state, {
        ledger: recordResultTruncation(state.ledger, truncatedRefs, state.iteration),
      });
    }
```

Add the import: `import { recordResultTruncation } from "../../ledger/emit.js";` (alongside the existing `recordCompactionMarker` import at the top of `think.ts`).

- [ ] **Step 7: Run the full reasoning suite**

Run: `cd packages/reasoning && bun test`
Expected: PASS, no regressions (this step is purely additive — `truncatedRefs.length === 0` is the default case for every existing test fixture, so `recordResultTruncation` no-ops everywhere except the new test).

- [ ] **Step 8: Commit**

```bash
git add packages/reasoning/src/kernel/ledger/run-ledger.ts packages/reasoning/src/kernel/ledger/emit.ts packages/reasoning/src/kernel/capabilities/reason/think.ts packages/reasoning/tests/kernel/ledger/emit.test.ts
git commit -m "feat(kernel): mint result-truncated ledger fact from per-message projection (FM-17 layer 1)"
```

---

## Task 2: Contract — enumeration hint on `RequirementSpec`

**Files:**
- Modify: `packages/reasoning/src/kernel/contract/run-contract.ts:56-63` (`RequirementSpec`), `:285-292` (the "answer" floor requirement)
- Test: `packages/reasoning/tests/kernel/contract/run-contract.test.ts` (new `describe` block, alongside the existing FM-15 blocks)

**Interfaces:**
- Consumes: nothing new — reads task text already passed to `compileRunContract`.
- Produces: `RequirementSpec.enumeration?: EnumerationHint` — Task 3 (assess.ts) and Task 6 (`proposeFromEnumerationIncomplete`) both read `contract.requirements[].spec.enumeration`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/reasoning/tests/kernel/contract/run-contract.test.ts — new describe block
describe("compileRunContract — enumeration hint (FM-16 layer A)", () => {
  it("parses a literal count from enumerating task language", () => {
    const contract = compileRunContract(
      "Find and list all three episode names for season 1.",
    );
    const answer = contract.requirements.find((r) => r.id === "answer");
    expect(answer?.spec.enumeration).toEqual({ expectedCount: 3, itemShape: "list-entry" });
  });

  it("marks expectedCount unknown when the task enumerates without a literal count", () => {
    const contract = compileRunContract(
      "Research and find all the episode names and descriptions for season 1, list them in a table.",
    );
    const answer = contract.requirements.find((r) => r.id === "answer");
    expect(answer?.spec.enumeration).toEqual({ expectedCount: "unknown", itemShape: "table-row" });
  });

  it("omits the enumeration field for a non-list task (byte-identical contract)", () => {
    const contract = compileRunContract("What is the capital of France?");
    const answer = contract.requirements.find((r) => r.id === "answer");
    expect(answer?.spec.enumeration).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/reasoning && bun test tests/kernel/contract/run-contract.test.ts -t "enumeration hint"`
Expected: FAIL — `spec.enumeration` is `undefined` in all three cases (property doesn't exist yet).

- [ ] **Step 3: Add the type**

In `packages/reasoning/src/kernel/contract/run-contract.ts`, right before `RequirementSpec` (`:56`):

```typescript
/** How many distinct items a `question-answered` enumeration requirement expects. */
export interface EnumerationHint {
  /** A literal count parsed from the task text, or "unknown" when none is derivable. */
  readonly expectedCount: number | "unknown";
  readonly itemShape: "list-entry" | "table-row";
}
```

Add the field to `RequirementSpec`:

```typescript
export interface RequirementSpec {
  readonly description: string;
  readonly condition?: PostCondition;
  readonly acceptance: AcceptanceTier;
  /** Present only on enumeration-shaped `question-answered` requirements (FM-16). */
  readonly enumeration?: EnumerationHint;
}
```

- [ ] **Step 4: Add the classifier**

Add a pure helper right above `compileRunContract` (`:188`):

```typescript
const ENUMERATING_PATTERN = /\b(all|every|each|list(?:ing)?)\b/i;
const LITERAL_COUNT_PATTERN =
  /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i;
const WORD_TO_NUMBER: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const TABLE_PATTERN = /\btable\b/i;

/**
 * Deterministic classifier: does this task ask for an enumeration, and if so,
 * how many items and in what shape? Returns undefined for non-enumerating tasks
 * (FM-16 layer A) — additive, no behavior change for the common case.
 */
function classifyEnumeration(task: string): EnumerationHint | undefined {
  if (!ENUMERATING_PATTERN.test(task)) return undefined;
  const itemShape: EnumerationHint["itemShape"] = TABLE_PATTERN.test(task) ? "table-row" : "list-entry";
  const countMatch = task.match(LITERAL_COUNT_PATTERN);
  if (!countMatch) return { expectedCount: "unknown", itemShape };
  const raw = countMatch[1]!.toLowerCase();
  const n = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : WORD_TO_NUMBER[raw];
  return { expectedCount: n ?? "unknown", itemShape };
}
```

- [ ] **Step 5: Wire it into the "answer" floor requirement**

In `compileRunContract`, replace the floor requirement block (`:285-292`):

```typescript
  // 5. The question-answered FLOOR — always present. Guarantees a non-empty
  //    contract for every task (even a bare Q&A with no tools / files), and
  //    anchors "the answer must actually address the task" as a first-class
  //    requirement the checker / self-critique tier judges.
  const enumeration = classifyEnumeration(task);
  requirements.push({
    id: "answer",
    kind: "question-answered",
    spec: {
      description: "produce a substantive answer that addresses the task",
      acceptance: "self-critique",
      ...(enumeration !== undefined ? { enumeration } : {}),
    },
  });
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/reasoning && bun test tests/kernel/contract/run-contract.test.ts -t "enumeration hint"`
Expected: PASS (3 tests)

- [ ] **Step 7: Run the full contract test file + reasoning suite**

Run: `cd packages/reasoning && bun test tests/kernel/contract/run-contract.test.ts && bun test`
Expected: PASS, no regressions.

- [ ] **Step 8: Commit**

```bash
git add packages/reasoning/src/kernel/contract/run-contract.ts packages/reasoning/tests/kernel/contract/run-contract.test.ts
git commit -m "feat(kernel): enumeration hint on the answer requirement (FM-16 layer A)"
```

---

## Task 3: Assessment — `requirementProgress` (stall tracking)

**Files:**
- Modify: `packages/reasoning/src/kernel/assessment/assess.ts:101-109` (`RunAssessment`), `:408-422` (return statement)
- Test: `packages/reasoning/tests/assessment/requirement-progress.test.ts` (new file)

**Interfaces:**
- Consumes: `entriesOfKind(ledger, "result-truncated")` (Task 1); `contract.requirements[].spec.enumeration` (Task 2, to know which requirements are enumeration-shaped — only those get tracked, everything else is unchanged).
- Produces: `RunAssessment.requirementProgress: ReadonlyMap<string, { stallCount: number }>` — Task 4 (`project-results.ts`) and Task 5/6 (guard.ts, emitters.ts) both read this.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/reasoning/tests/assessment/requirement-progress.test.ts
import { describe, it, expect } from "bun:test";
import { assess } from "../../src/kernel/assessment/assess.js";
import { appendEntry, type RunLedger } from "../../src/kernel/ledger/run-ledger.js";
import { compileRunContract } from "../../src/kernel/contract/run-contract.js";

const budget = { iteration: 3, maxIterations: 20, tokensUsed: 0, costUsd: 0 };

describe("assess — requirementProgress (FM-17 layer 2)", () => {
  it("stallCount grows across consecutive iterations with a truncated result and no other progress", () => {
    const contract = compileRunContract("Find and list all the episode names for season 1.");
    let ledger: RunLedger = [];
    ledger = appendEntry(ledger, { kind: "result-truncated", iteration: 1, truncatedRefs: ["res_a"] });
    ledger = appendEntry(ledger, { kind: "result-truncated", iteration: 2, truncatedRefs: ["res_b"] });
    ledger = appendEntry(ledger, { kind: "result-truncated", iteration: 3, truncatedRefs: ["res_c"] });
    const result = assess(contract, ledger, budget);
    const progress = result.requirementProgress.get("answer");
    expect(progress?.stallCount).toBe(3);
  });

  it("stallCount is 0 for a requirement with no enumeration hint", () => {
    const contract = compileRunContract("What is the capital of France?");
    let ledger: RunLedger = [];
    ledger = appendEntry(ledger, { kind: "result-truncated", iteration: 1, truncatedRefs: ["res_a"] });
    const result = assess(contract, ledger, { ...budget, iteration: 1 });
    expect(result.requirementProgress.get("answer")).toBeUndefined();
  });

  it("stallCount resets to 0 on an iteration with no truncation", () => {
    const contract = compileRunContract("Find and list all the episode names for season 1.");
    let ledger: RunLedger = [];
    ledger = appendEntry(ledger, { kind: "result-truncated", iteration: 1, truncatedRefs: ["res_a"] });
    // iteration 2: no result-truncated entry — the model saw everything that turn.
    const result = assess(contract, ledger, { ...budget, iteration: 2 });
    expect(result.requirementProgress.get("answer")?.stallCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/reasoning && bun test tests/assessment/requirement-progress.test.ts`
Expected: FAIL — `result.requirementProgress` is `undefined` (property doesn't exist on `RunAssessment` yet).

- [ ] **Step 3: Add the field to `RunAssessment`**

In `packages/reasoning/src/kernel/assessment/assess.ts`, add after `RequirementAssessment` (`:44-48`):

```typescript
/** Per-requirement stall tracking (FM-17 layer 2) — enumeration-shaped requirements only. */
export interface RequirementProgress {
  /** Consecutive iterations ending at `currentIter` with a truncated result and no reset. */
  readonly stallCount: number;
}
```

Add the field to `RunAssessment` (`:101-109`):

```typescript
export interface RunAssessment {
  readonly requirements: RequirementAssessment;
  readonly deliverables: DeliverableAssessment;
  readonly evidenceDelta: number;
  readonly phase: RunPhase;
  readonly pace: PaceAssessment;
  readonly health: RunHealth;
  /** NEW (FM-17 layer 2) — stall tracking for enumeration-shaped requirements. */
  readonly requirementProgress: ReadonlyMap<string, RequirementProgress>;
}
```

- [ ] **Step 4: Compute it**

In `assess()`, right before the `return` statement (`:408`), add:

```typescript
  // ── requirementProgress (FM-17 layer 2) — enumeration-shaped requirements only.
  // stallCount = the trailing run of consecutive iterations, ending at currentIter,
  // that each recorded a `result-truncated` fact. A gap (an iteration with no
  // truncation) resets the count — the model saw everything that turn, so any
  // earlier stall is stale.
  const truncationEntries = entriesOfKind(ledger, "result-truncated");
  const truncatedIterations = new Set(truncationEntries.map((e) => e.iteration));
  const requirementProgress = new Map<string, { stallCount: number }>();
  for (const r of contract.requirements) {
    if (r.spec.enumeration === undefined) continue;
    let stallCount = 0;
    for (let iter = currentIter; iter >= 0; iter--) {
      if (!truncatedIterations.has(iter)) break;
      stallCount++;
    }
    requirementProgress.set(r.id, { stallCount });
  }
```

Add `requirementProgress` to the returned object (`:408-422`):

```typescript
  return {
    requirements: { satisfied, outstanding, blocked },
    deliverables: { produced, missing },
    evidenceDelta,
    phase,
    pace: { burnRatio, band },
    health: {
      recentFailures,
      consecutiveFailures,
      stuckSignals,
      iterationsSinceEvidence,
      failureArgVariety,
    },
    requirementProgress,
  };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/reasoning && bun test tests/assessment/requirement-progress.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Run the full reasoning suite**

Run: `cd packages/reasoning && bun test`
Expected: PASS. Check specifically for any test that does an exhaustive shape-equality match on `RunAssessment` (e.g. `toEqual` rather than `toMatchObject`) — those will need `requirementProgress: new Map()` added to their expected object. Grep first: `grep -rln "toEqual({" tests/assessment tests/assembly | xargs grep -l "RunAssessment\|assess("`.

- [ ] **Step 7: Commit**

```bash
git add packages/reasoning/src/kernel/assessment/assess.ts packages/reasoning/tests/assessment/requirement-progress.test.ts
git commit -m "feat(kernel): requirementProgress stall tracking on RunAssessment (FM-17 layer 2)"
```

---

## Task 4: Projection — Evidence Escalation budget

**Files:**
- Modify: `packages/reasoning/src/assembly/stages/project-results.ts:108-121`
- Modify: `packages/reasoning/src/assembly/project.ts` (only if `AssemblyCtx.contract` isn't already threaded to `projectResultsStage` — verify first, it's read by `standing-frame.ts` in the same pipeline per `project.ts:37-44`)
- Test: `packages/reasoning/tests/assembly/project-results.test.ts` (extend existing file)

**Interfaces:**
- Consumes: `c.assessment.requirementProgress` (Task 3); `c.contract.requirements[].spec.condition` (to match a ref's tool back to a requirement — see Step 3 below).
- Produces: nothing new downstream — this changes render output, which Task 5/6 do NOT consume directly (they read `requirementProgress` from assessment, not from the projected text).

- [ ] **Step 1: Write the failing test**

Read `packages/reasoning/tests/assembly/project-results.test.ts` first to match its existing `AssemblyCtx` fixture-building helper before writing this — the exact shape of `c.log`/`c.store` construction must match what's already there. Then add:

```typescript
// packages/reasoning/tests/assembly/project-results.test.ts — new test
it("escalates the render budget for a ref backing a stalled enumeration requirement (FM-17 layer 3)", () => {
  const bigResult = "x".repeat(5000); // exceeds any tier's default budget
  const ctx = buildCtx({ // use the file's existing fixture builder
    toolResults: [{ ref: "res_a", tool: "web-search", value: bigResult }],
    assessment: {
      requirementProgress: new Map([["answer", { stallCount: 2 }]]),
    } as any,
  });
  const result = projectResultsStage(ctx);
  const rendered = result.messages.find((m) => m.role === "tool_result");
  expect(rendered?.content.length).toBeGreaterThan(bigResult.length * 0.5); // escalated, not clipped to base budget
});
```

(Adjust the fixture-builder call to whatever helper the existing file actually exports — do not invent a new one; the point of Step 1 here is reading the existing file's pattern before writing, per this plan's own no-placeholder rule, since the exact helper name wasn't re-verified against the live file at plan-writing time.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/reasoning && bun test tests/assembly/project-results.test.ts -t "escalates the render budget"`
Expected: FAIL — budget is capped at `toolResultPreserveBudget`/`recencyBudgetChars` regardless of `stallCount`.

- [ ] **Step 3: Implement escalation**

In `packages/reasoning/src/assembly/stages/project-results.ts`, replace the budget computation (`:108-110`):

```typescript
      const ESCALATION_FACTOR = 1.5;
      const baseBudget = isLatest ? c.capability.recencyBudgetChars : c.capability.toolResultPreserveBudget;
      // FM-17 layer 3: widen the budget for a ref backing a stalled enumeration
      // requirement. Matched via the requirement's condition tool (tool-coverage
      // requirements only carry a ToolCalled condition naming the producing
      // tool) — the same matching primitive assess() already uses for
      // requirement satisfaction, not a new inference.
      const backingRequirement = c.contract?.requirements.find(
        (r) =>
          r.spec.enumeration !== undefined &&
          (r.spec.condition === undefined || (r.spec.condition.kind === "ToolCalled" && r.spec.condition.tool === call?.tool)),
      );
      const stallCount = backingRequirement
        ? (c.assessment?.requirementProgress.get(backingRequirement.id)?.stallCount ?? 0)
        : 0;
      const budget =
        stallCount > 0 ? Math.round(baseBudget * (1 + ESCALATION_FACTOR * stallCount)) : baseBudget;
```

This replaces the `const budget = isLatest ? ... : ...;` line. Everything below it (`if (fullText.length <= budget) ...`) is unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/reasoning && bun test tests/assembly/project-results.test.ts -t "escalates the render budget"`
Expected: PASS

- [ ] **Step 5: Run the full assembly test suite + reasoning suite**

Run: `cd packages/reasoning && bun test tests/assembly/ && bun test`
Expected: PASS, no regressions — `stallCount` is 0 for every existing fixture (none of them set `requirementProgress`), so `budget` falls through to the pre-existing `baseBudget` value unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src/assembly/stages/project-results.ts packages/reasoning/tests/assembly/project-results.test.ts
git commit -m "feat(assembly): Evidence Escalation — stall-indexed render budget (FM-17 layer 3)"
```

---

## Task 5: Guard — stall-aware repetition ceiling

**Files:**
- Modify: `packages/reasoning/src/kernel/capabilities/act/guard.ts:220-271` (`repetitionGuard`)
- Test: `packages/reasoning/tests/kernel/capabilities/act/guard.test.ts` (new file — no dedicated unit-test file for `guard.ts` exists today; the composed pipeline is exercised indirectly via `tests/strategies/kernel/phases/guard.test.ts`, but this task needs `repetitionGuard` importable and testable in isolation)

**Interfaces:**
- Consumes: `state.meta?.assessment?.requirementProgress` (Task 3).
- Produces: nothing new downstream — this only changes the guard's `observation` string and its `pass`/`fail` outcome on the escalation-exhausted branch.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/reasoning/tests/kernel/capabilities/act/guard.test.ts (new file)
import { describe, it, expect } from "bun:test";
import { repetitionGuard } from "../../../../src/kernel/capabilities/act/guard.js";
import type { KernelState, KernelInput } from "../../../../src/kernel/state/kernel-state.js";

function makeState(overrides: Partial<KernelState> = {}): KernelState {
  return {
    iteration: 3, steps: [], meta: {}, taskId: "t1",
    ...overrides,
  } as KernelState;
}

const tc = { name: "web-search", arguments: { query: "season 1 episodes" } } as any;
const input = { requiredToolQuantities: {}, nextMovesPlanning: { maxBatchSize: 4 } } as KernelInput;

function stateWithPriorCalls(n: number, stallCount: number): KernelState {
  const steps = Array.from({ length: n }, (_, i) => ({
    type: "action",
    metadata: { toolCall: { name: "web-search", arguments: { query: `q${i}` } } },
  }));
  return makeState({
    steps: steps as any,
    meta: { assessment: { requirementProgress: new Map([["answer", { stallCount }]]) } } as any,
  });
}

describe("repetitionGuard — stall-aware ceiling (FM-16 layer D-guard)", () => {
  it("does not block while stallCount is below the escalation-exhausted threshold", () => {
    const outcome = repetitionGuard(tc, stateWithPriorCalls(4, 1), input);
    expect(outcome.pass).toBe(true);
  });

  it("blocks with a requirement-naming nudge once stallCount exceeds the threshold", () => {
    const outcome = repetitionGuard(tc, stateWithPriorCalls(4, 5), input);
    expect(outcome.pass).toBe(false);
    if (!outcome.pass) {
      expect(outcome.observation).toContain("answer");
      expect(outcome.observation).not.toBe("⚠️ You have already called web-search 4 times. Stop repeating this tool. Use final-answer to respond now.");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/reasoning && bun test tests/kernel/capabilities/act/guard.test.ts`
Expected: FAIL on the second test — today's `repetitionGuard` blocks at the raw call-count threshold regardless of `stallCount`, and its nudge text never names a requirement id (it says "Stop repeating this tool" unconditionally). The first test passes today only by accident (both would currently block at 4 calls) — confirm this by running before Step 3, then proceed either way, since the point is the SECOND test's message content, which is the actual behavior change.

- [ ] **Step 3: Implement the stall-aware branch**

In `packages/reasoning/src/kernel/capabilities/act/guard.ts`, `repetitionGuard` currently blocks unconditionally once `priorCallsOfSameTool >= threshold` (`:230`) with a generic nudge (`:265`). Insert a stall check between the threshold check and the nudge construction:

```typescript
  // FM-16 layer D-guard: don't force a stop while escalation (FM-17 layer 3)
  // hasn't exhausted its widened budget yet — the model may not have actually
  // SEEN enough of the prior results to know it's done. Consult the SAME
  // stallCount the projector escalates on, so the two mechanisms agree by
  // construction. ESCALATION_EXHAUSTED mirrors project-results.ts's own
  // ESCALATION_FACTOR cadence — a stallCount this high means the ref has
  // already been rendered at (1 + 1.5*4) = 7x its base budget with no progress.
  const ESCALATION_EXHAUSTED = 4;
  const stalledRequirement = [...(state.meta?.assessment?.requirementProgress ?? new Map())]
    .find(([, p]) => p.stallCount > 0);
  if (stalledRequirement && stalledRequirement[1].stallCount < ESCALATION_EXHAUSTED) {
    return { pass: true };
  }
```

Place this immediately after the existing `if (priorCallsOfSameTool < threshold) return { pass: true };` line (`:230`) and before the converging-retry carve-out (`:232-245`) — order matters: a genuinely adapting retry (different args after failure) should still pass regardless of stall state, so the carve-out stays checked after this new branch, not before it, since both are independent "pass" reasons and either should short-circuit before the nudge is built.

Then update the nudge construction (`:257-265`) to name the stalled requirement when one exists:

```typescript
  const stallSuffix = stalledRequirement
    ? ` The harness has shown you everything it has on requirement "${stalledRequirement[0]}"; this line of evidence is exhausted.`
    : "";
  const nudge = `⚠️ You have already called ${tc.name} ${priorCallsOfSameTool} times. Stop repeating this tool.${missingHint}${stallSuffix}`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/reasoning && bun test tests/kernel/capabilities/act/guard.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full reasoning suite**

Run: `cd packages/reasoning && bun test`
Expected: PASS. `state.meta?.assessment` is `undefined` in the large majority of existing fixtures (guard tests predate the assessment wiring), so `requirementProgress` defaults to an empty map, `stalledRequirement` is `undefined`, and both new branches no-op — today's behavior is unchanged wherever no assessment is present. Any test that DOES construct `state.meta.assessment` without `requirementProgress` will now hit a `TypeError` on `.requirementProgress` being undefined — grep for these first: `grep -rln "meta:.*assessment" tests/ | xargs grep -l "assessment:"` and patch each fixture to add `requirementProgress: new Map()`.

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src/kernel/capabilities/act/guard.ts packages/reasoning/tests/kernel/capabilities/act/guard.test.ts
git commit -m "feat(kernel): stall-aware repetition ceiling — nudge waits for escalation to exhaust (FM-16 layer D-guard)"
```

---

## Task 6: Control — `enumeration-incomplete` proposal

**Files:**
- Modify: `packages/reasoning/src/kernel/control/emitters.ts` (new `proposeFromEnumerationIncomplete`, alongside `proposeFromForcedAbstention` at `:59`)
- Modify: `packages/reasoning/src/kernel/control/abstention-proposal.ts` (new `enumerationIncompleteProposal` wrapper, mirrors `inLoopAbstentionProposal` at `:89-97`)
- Modify: `packages/reasoning/src/kernel/loop/iterate-pass.ts` (wire the new proposal into the `proposals` array at all 3 existing `inLoopAbstentionProposal` call sites: `:1060`, `:1210`, `:1453`)
- Test: `packages/reasoning/tests/kernel/control/emitters.test.ts` (extend existing file — check it exists first: `find packages/reasoning/tests/kernel/control -iname "*.ts"`)

**Interfaces:**
- Consumes: `contract.requirements[].spec.enumeration` (Task 2); `assessment.requirementProgress` (Task 3).
- Produces: a `ControlProposal` with `action: "abstain"`, `remedy.kind: "coverage"` — consumed by the existing `resolveControlPlane` call at each of the 3 sites, no new consumer needed.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/reasoning/tests/kernel/control/emitters.test.ts — new describe block
import { proposeFromEnumerationIncomplete } from "../../../src/kernel/control/emitters.js";

describe("proposeFromEnumerationIncomplete (FM-16 layer D-control)", () => {
  it("proposes abstain when a numeric enumeration is provably short and stalled at exhaustion", () => {
    const proposal = proposeFromEnumerationIncomplete({
      horizonActive: true,
      requirement: { id: "answer", enumeration: { expectedCount: 3, itemShape: "list-entry" } } as any,
      itemsFound: 0,
      stallCount: 4,
    });
    expect(proposal?.action).toBe("abstain");
    expect(proposal?.remedy?.kind).toBe("coverage");
  });

  it("returns null when stallCount has not reached exhaustion", () => {
    const proposal = proposeFromEnumerationIncomplete({
      horizonActive: true,
      requirement: { id: "answer", enumeration: { expectedCount: 3, itemShape: "list-entry" } } as any,
      itemsFound: 0,
      stallCount: 1,
    });
    expect(proposal).toBeNull();
  });

  it("returns null when the profile is not long-horizon (OFF by default, matches every other emitter)", () => {
    const proposal = proposeFromEnumerationIncomplete({
      horizonActive: false,
      requirement: { id: "answer", enumeration: { expectedCount: 3, itemShape: "list-entry" } } as any,
      itemsFound: 0,
      stallCount: 10,
    });
    expect(proposal).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/reasoning && bun test tests/kernel/control/emitters.test.ts -t "proposeFromEnumerationIncomplete"`
Expected: FAIL — `proposeFromEnumerationIncomplete` is not exported.

- [ ] **Step 3: Implement the emitter**

In `packages/reasoning/src/kernel/control/emitters.ts`, add after `proposeFromForcedAbstention`:

```typescript
// ─── N. Enumeration-incomplete (FM-16/FM-14) ─────────────────────────────────

/**
 * A `question-answered` requirement with a numeric `enumeration.expectedCount`
 * that has genuinely stalled (escalation exhausted, per guard.ts's
 * ESCALATION_EXHAUSTED=4 threshold — kept in sync by convention, not import,
 * since guard.ts and this module are on different sides of the DAG) proposes an
 * honest `abstain` rather than letting the model reach `final-answer` and
 * fabricate the missing items (closes the exact FM-14 gap: `scratch.ts`
 * accepted a fabricated table with `confidence:"medium"` and zero verifier
 * involvement). `expectedCount:"unknown"` is deliberately NOT handled here —
 * an unverifiable count cannot support a confident "incomplete" claim either;
 * it stays the terminal gate's `AcceptanceTier` downgrade (FM-16's other half,
 * not this emitter's job).
 */
export function proposeFromEnumerationIncomplete(input: {
  readonly horizonActive: boolean;
  readonly requirement: { readonly id: string; readonly enumeration?: { readonly expectedCount: number | "unknown" } };
  readonly itemsFound: number;
  readonly stallCount: number;
}): ControlProposal | null {
  if (!input.horizonActive) return null;
  const expected = input.requirement.enumeration?.expectedCount;
  if (typeof expected !== "number") return null;
  const ESCALATION_EXHAUSTED = 4;
  if (input.stallCount < ESCALATION_EXHAUSTED) return null;
  if (input.itemsFound >= expected) return null;
  return {
    source: "enumeration-incomplete",
    action: "abstain",
    reason: `requirement "${input.requirement.id}" expects ${expected} items, found ${input.itemsFound}, no progress for ${input.stallCount} iterations`,
    confidence: "high",
    remedy: {
      kind: "coverage",
      detail: `${input.requirement.id}: ${input.itemsFound}/${expected} items found, evidence exhausted`,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/reasoning && bun test tests/kernel/control/emitters.test.ts -t "proposeFromEnumerationIncomplete"`
Expected: PASS (3 tests)

- [ ] **Step 5: Add the wrapper in abstention-proposal.ts**

In `packages/reasoning/src/kernel/control/abstention-proposal.ts`, add after `inLoopAbstentionProposal` (`:89-97`):

```typescript
import { proposeFromEnumerationIncomplete } from "./emitters.js";
import type { RunAssessment } from "../assessment/assess.js";
import type { RunContract } from "../contract/run-contract.js";

/**
 * The in-loop enumeration-incomplete abstain proposal (FM-16 layer D-control).
 * Checks every enumeration-shaped requirement on the contract; returns the
 * first one that qualifies (or null). Multiple simultaneous stalled
 * enumerations are rare enough that "first" is an acceptable tie-break —
 * `resolveControlPlane` only needs ONE abstain proposal to act.
 */
export function enumerationIncompleteProposal(
  contract: RunContract | undefined,
  assessment: RunAssessment | undefined,
  horizonActive: boolean,
): ControlProposal | null {
  if (contract === undefined || assessment === undefined) return null;
  for (const r of contract.requirements) {
    if (r.spec.enumeration === undefined) continue;
    const progress = assessment.requirementProgress.get(r.id);
    if (progress === undefined) continue;
    const proposal = proposeFromEnumerationIncomplete({
      horizonActive,
      requirement: { id: r.id, enumeration: r.spec.enumeration },
      itemsFound: 0, // v1: no per-item extraction yet — see plan note below
      stallCount: progress.stallCount,
    });
    if (proposal) return proposal;
  }
  return null;
}
```

**Note carried into the code as a comment, not hidden:** `itemsFound: 0` is a deliberate v1 simplification — Layer B (Task 3) tracks `stallCount` but not a real per-item extraction count (that requires a structured-extraction mechanism out of scope for this plan, flagged in §6b's design discussion). Practically this means the emitter currently fires "abstain" for ANY stalled numeric-count enumeration, not specifically a *partial* one distinguishable from a *zero-progress* one. This is still strictly better than FM-14's status quo (silent fabrication) and is the honest scope boundary — record it as an open follow-up, not a silent gap.

- [ ] **Step 6: Wire the 3 call sites in iterate-pass.ts**

At each of the 3 sites (`:1060`, `:1210`, `:1453`), immediately after the existing:

```typescript
              const { proposal: abstainProposal, forced } = inLoopAbstentionProposal(
                state, currentInput, requiredTools, currentOptions.maxIterations,
              );
```

add:

```typescript
              const enumProposal = enumerationIncompleteProposal(
                state.meta.runContract, state.meta.assessment, horizon !== undefined,
              );
```

and in the `proposals` array construction immediately below it, add:

```typescript
              if (enumProposal) proposals.push(enumProposal);
```

alongside the existing `if (abstainProposal) proposals.push(abstainProposal);` line. Add the import once at the top of `iterate-pass.ts`: `import { enumerationIncompleteProposal } from "../control/abstention-proposal.js";` (alongside the existing `inLoopAbstentionProposal` import).

- [ ] **Step 7: Run the full reasoning suite**

Run: `cd packages/reasoning && bun test`
Expected: PASS, no regressions. `enumerationIncompleteProposal` returns `null` whenever `state.meta.runContract` has no enumeration-shaped requirement (every existing test fixture), so `proposals` gains nothing new anywhere except a future test that deliberately constructs a stalled enumeration contract.

- [ ] **Step 8: Add an integration-shaped regression test named for `scratch.ts`**

```typescript
// packages/reasoning/tests/kernel/control/emitters.test.ts — final test in the new describe block
it("scratch.ts regression: a stalled 'find all episodes' contract proposes abstain, not silent continue", () => {
  const proposal = proposeFromEnumerationIncomplete({
    horizonActive: true,
    requirement: { id: "answer", enumeration: { expectedCount: "unknown", itemShape: "table-row" } },
    itemsFound: 0,
    stallCount: 6,
  });
  // expectedCount "unknown" (the scratch.ts case — no literal count in the task
  // text) is explicitly OUT of this emitter's scope per Step 3's doc comment —
  // asserting null here is the scope boundary, not a bug. The "unknown" case is
  // covered by the terminal gate's AcceptanceTier downgrade, not this emitter.
  expect(proposal).toBeNull();
});
```

Run: `cd packages/reasoning && bun test tests/kernel/control/emitters.test.ts`
Expected: PASS (4 tests in the new block). This test exists to make the scope boundary explicit and executable, not to claim `scratch.ts`'s specific failure is fixed by Task 6 alone — it is fixed by Task 4 (escalation, which removes truncation as a cause) plus the still-unbuilt terminal-gate `AcceptanceTier` downgrade for `expectedCount:"unknown"` that §6b's Layer D description names but this task does not implement (see Task 7 below).

- [ ] **Step 9: Commit**

```bash
git add packages/reasoning/src/kernel/control/emitters.ts packages/reasoning/src/kernel/control/abstention-proposal.ts packages/reasoning/src/kernel/loop/iterate-pass.ts packages/reasoning/tests/kernel/control/emitters.test.ts
git commit -m "feat(kernel): enumeration-incomplete abstain proposal for numeric-count stalls (FM-16 layer D-control)"
```

---

## Task 7 (follow-up, not required to close this plan): terminal-gate `AcceptanceTier` downgrade for `expectedCount:"unknown"`

Filed here rather than implemented: §6b's Layer D names a second half — a
`question-answered` requirement whose `enumeration.expectedCount` is `"unknown"`
(the actual `scratch.ts` case) should downgrade its `AcceptanceTier` from
`"self-critique"` to `"checker"` at the terminal gate, so a bare pattern-match
final-answer cannot silently pass an unverifiable exhaustiveness claim. This
requires locating the terminal gate's `AcceptanceTier` consumption (FM-9's own
register entry names `"checker"` as "unbacked" — no checker implementation
exists yet), which is FM-9's scope, not this plan's. Do not start it inside this
plan; file it as a dependency note on FM-9 instead.

---

## Self-Review

**Spec coverage against §6b:**
- Layer A (contract enumeration hint) → Task 2. ✓
- Layer B (assessment requirementProgress / stallCount, corrected trigger) → Tasks 1 + 3. ✓
- Layer C (Evidence Escalation render budget) → Task 4. ✓
- Layer D (`repetition-ceiling` + `enumeration-incomplete` proposals) → Tasks 5 + 6. ✓
- Terminal-gate `AcceptanceTier` downgrade for `expectedCount:"unknown"` → explicitly deferred to Task 7 / FM-9, not silently dropped.
- "Model-agnostic by construction" constraint from §6b → every task's inputs are ledger/contract/assessment fields, none read model text or tool compliance — verified per-task above.

**Placeholder scan:** no TBD/TODO markers; the two known scope limitations (Task 6's
`itemsFound: 0` v1 simplification, Task 7's deferral) are stated as explicit, tested
boundaries rather than hidden gaps — this is a documented scope call, not a placeholder.

**Type consistency:** `RequirementProgress.stallCount` (Task 3) is the one name used
everywhere downstream — Task 4 reads `requirementProgress.get(id)?.stallCount`, Task 5
reads the same, Task 6's `enumerationIncompleteProposal` reads the same. `EnumerationHint`
(Task 2) is the one shape used by Task 3's filter, Task 4's `backingRequirement` match,
and Task 6's `proposeFromEnumerationIncomplete` input — no renamed duplicates.

---

**Plan complete and saved to `wiki/Planning/Implementation-Plans/2026-08-12-deterministic-remedy-layer.md`.**

Not to be executed yet — blocked behind Phase 0 (branch merge) and the Phase 1 owner
call per this plan's own Global Constraints and the governing program's Standing Rule 1.
