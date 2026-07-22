# Wave C.1 — RunLedger Convergence (C1, Slices 1–3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the RunLedger the canonical run record readers actually consume — enforce the steps≡ledger equivalence invariant in the kernel, re-base the trust receipt onto ledger queries, and give the ledger a live EventBus tap so stream + `run_events` journal receive canonical entry events.

**Architecture:** Three sequential slices. Slice 1 pins the existing dual-emit (steps→ledger at the `transitionState` chokepoint) with a property test + tightened CI gate + a ratification decision doc amending 09-C1's literal "steps becomes a projection" wording to the equivalence-invariant form (owner-approved 2026-07-22 — the shipped projection is deliberately lossy; full inversion would bloat the ledger/codec against its own high-value-facts design). Slice 2 closes the write-only `runLedger` boundary: every strategy forwards its ledger, and the receipt's tool-call + deliverable evidence reads ledger entries first (steps fallback preserved). Slice 3 adds `onLedgerAppend` to `KernelHooks`, fired at the runner iteration boundary from the ledger-length diff; the engine bridge publishes a new `LedgerEntryAppended` AgentEvent, which the existing `journal.ts` subscription persists to `run_events` for free and `execute-stream.ts` projects at `density:"full"` (mirrors the B5 `PhaseStarted` precedent).

**Tech Stack:** TypeScript strict, Effect-TS, Bun test runner, bash CI guard scripts.

## Global Constraints

- Canonical rulings honored: 09-UNIFIED-PROGRAM C1 spirit ("no second store"); deviation from its literal steps-projection wording is ratified by the decision doc in Task 3 (owner decision 2026-07-22).
- Definition of done per DEBT-REGISTER §6: declaration + non-test writer + non-test reader + **a mutation test that goes red when the wiring is cut**. Prose does not discharge tasks.
- No `any` casts; `unknown` + guards or proper types (project clean-types rule).
- Every `bun test` invocation uses an explicit `--timeout 15000` (agent-tdd rule; prevents hung Effect fibers masquerading as passes).
- All shell commands run through `rtk` where supported (`rtk git ...`, `rtk grep ...`).
- No Co-Authored-By trailers in commits.
- `bash scripts/check-ledger-writes.sh` must exit 0 after every task.
- Existing suites stay green: `bun test packages/reasoning --timeout 15000` and `bun test packages/runtime --timeout 15000` after each task; full `bun test` before final commit.
- Ratchet law: no new declaration without writer + reader + red-on-cut test (DEBT-REGISTER §1).

## File Structure

| File | Role in this plan |
|---|---|
| `packages/reasoning/src/kernel/state/kernel-state.ts` | `transitionState` chokepoint (dual-emit at ~:1201); `KernelHooks` interface (~:985); TODO(C-final) comment at :524 to amend |
| `packages/reasoning/src/kernel/ledger/step-projection.ts` | steps→entries mapping; header TODO to amend |
| `packages/reasoning/src/kernel/ledger/equivalence.test.ts` | NEW — property test pinning ledger ≡ projection(steps) |
| `scripts/check-ledger-writes.sh` | tighten: forbid direct `steps` array mutation outside the chokepoint |
| `wiki/Decisions/2026-07-22-c1-equivalence-invariant.md` | NEW — ratification decision doc |
| `packages/reasoning/src/kernel/loop/runner.ts` | fire `onLedgerAppend` from ledger-length diff; `buildKernelHooks` import at :24 |
| `packages/reasoning/src/kernel/state/kernel-hooks.ts` | `buildKernelHooks(eventBus)` — add `onLedgerAppend` bridge |
| `packages/reasoning/src/strategies/*.ts` | kernel strategies forward `runLedger` in `extraMetadata` (plan-execute :611/:1424 + blueprint :700 already do) |
| `packages/runtime/src/builder/helpers.ts` | `deriveReceiptToolCalls` (:213), `deriveReceiptDeliverables` (:176) — ledger-first evidence |
| `packages/core/src/services/event-bus.ts` | `AgentEvent` union (:47) — add `LedgerEntryAppended` |
| `packages/runtime/src/engine/execute-stream.ts` | project `LedgerEntryAppended` at `density:"full"` |

**Interfaces already shipped that this plan consumes (do not re-create):**
- `RunLedger = readonly LedgerEntry[]`, `LedgerEntry` (9-kind union), `LedgerEntryKind`, `appendEntries`, `entriesOfKind`, `ledgerSize` — `packages/reasoning/src/kernel/ledger/run-ledger.ts`
- `projectStepsToLedger(ledger, newSteps, iteration): RunLedger`, `stepToEntries(step, iteration)` — `.../ledger/step-projection.ts`
- `ReActKernelResult.state: KernelState` (carries `.ledger`) — `kernel-state.ts:1323`
- `recordToolDispatch(led, {...})` mint + `ledgerSink: Ref<RunLedger>` config — `.../ledger/emit.ts:41`, `tool-observe.ts:461`
- `buildKernelHooks(eventBus: MaybeService<EventBusInstance>): KernelHooks` — `kernel-state.ts` types + `kernel-hooks.ts:46`
- `journal.ts:85` (`store.appendRunEvent(runId, seq, JSON.stringify(event))`) — persists every bus event it subscribes to; no change needed for Slice 3 persistence

---

## Slice 1 — Equivalence invariant (kernel authority pinned)

### Task 1: Property test — ledger ≡ projection(steps)

**Files:**
- Create: `packages/reasoning/src/kernel/ledger/equivalence.test.ts`

**Interfaces:**
- Consumes: `transitionState` (exported from `kernel-state.ts` — verify export with `rtk grep -n "export function transitionState" packages/reasoning/src/kernel/state/kernel-state.ts`; if internal, test through the exported state-transition wrapper the kernel tests already use — see `run-ledger-state.test.ts` for the established harness), `projectStepsToLedger`, `makeStep` (same helper `step-projection.ts` tests use).
- Produces: the invariant test later tasks must keep green.

- [ ] **Step 1: Write the failing-capable property test**

```typescript
// packages/reasoning/src/kernel/ledger/equivalence.test.ts
//
// C1 equivalence invariant (ratified 2026-07-22, wiki/Decisions/
// 2026-07-22-c1-equivalence-invariant.md): after ANY sequence of
// transitionState appends, state.ledger is byte-equal to re-projecting the
// full steps[] history from scratch. This is the pinned form of 09-C1's
// "steps becomes a projection" — authority lives in the equivalence, not in
// a physical write-direction flip.
import { describe, expect, test } from "bun:test";
import { projectStepsToLedger } from "./step-projection.js";
// Import the same transition harness run-ledger-state.test.ts uses:
import { transitionState, initialKernelState } from "../state/kernel-state.js";
import type { ReasoningStep } from "../../types/index.js";

const step = (
  type: ReasoningStep["type"],
  content: string,
  metadata?: Record<string, unknown>,
): ReasoningStep =>
  ({ id: `s-${content}`, type, content, timestamp: 0, ...(metadata ? { metadata } : {}) }) as ReasoningStep;

describe("C1 equivalence invariant", () => {
  test("incremental dual-emit equals from-scratch projection", () => {
    let state = initialKernelState({ task: "t" } as never); // use the real init the sibling test uses
    const script: ReasoningStep[][] = [
      [step("thought", "think-1")],
      [
        step("action", "file-read(a.txt)", {
          toolCall: { id: "c1", name: "file-read", arguments: { path: "a.txt" } },
          toolCallId: "c1",
        }),
      ],
      [
        step("observation", "contents-of-a", {
          toolCallId: "c1",
          observationResult: { success: true, toolName: "file-read" },
        }),
      ],
      [step("harness_signal", "budget-nudge")],
    ];
    let iteration = 0;
    for (const newSteps of script) {
      iteration += 1;
      state = transitionState(state, {
        steps: [...state.steps, ...newSteps],
        iteration,
      });
      // Invariant: incremental ledger ≡ full re-projection (per-iteration is
      // approximated by re-walking the recorded (steps, iteration) script).
      let expected = projectStepsToLedger(undefined, script[0], 1);
      for (let i = 1; i < iteration; i += 1) {
        expected = projectStepsToLedger(expected, script[i], i + 1);
      }
      expect(state.ledger).toEqual(expected);
    }
  });

  test("red-on-cut: a steps append that bypasses derivation breaks equivalence", () => {
    // Simulate the drift the invariant exists to catch: steps grow but ledger
    // does not. This documents WHAT failure looks like; the production guard
    // is the first test + check-ledger-writes.sh.
    let state = initialKernelState({ task: "t" } as never);
    state = transitionState(state, {
      steps: [
        step("action", "file-read(a.txt)", {
          toolCall: { id: "c1", name: "file-read", arguments: { path: "a.txt" } },
          toolCallId: "c1",
        }),
      ],
      iteration: 1,
    });
    const bypassed = { ...state, steps: [...state.steps, step("action", "file-read(b.txt)")] };
    const reprojected = projectStepsToLedger(
      undefined,
      bypassed.steps,
      1,
    );
    expect(bypassed.ledger).not.toEqual(reprojected);
  });
});
```

Note: exact import names (`transitionState`, `initialKernelState`) must match what `run-ledger-state.test.ts` imports — copy its imports verbatim; the invariant logic above is the deliverable.

- [ ] **Step 2: Run — expect the first test GREEN (dual-emit already holds), second GREEN**

Run: `bun test packages/reasoning/src/kernel/ledger/equivalence.test.ts --timeout 15000`
Expected: PASS. If test 1 FAILS, that is a live equivalence bug — stop, report, fix the chokepoint before proceeding (this is the audit value of the test).

- [ ] **Step 3: Prove red-on-cut** — temporarily comment out the `projectStepsToLedger` call inside `transitionState` (kernel-state.ts ~:1209), rerun, confirm test 1 goes RED, restore.

Run: `bun test packages/reasoning/src/kernel/ledger/equivalence.test.ts --timeout 15000`
Expected after cut: FAIL on test 1. Restore the line; PASS again.

- [ ] **Step 4: Commit**

```bash
rtk git add packages/reasoning/src/kernel/ledger/equivalence.test.ts
rtk git commit -m "test(ledger): pin C1 equivalence invariant — ledger ≡ projection(steps) at the chokepoint"
```

### Task 2: Tighten check-ledger-writes.sh — steps mutate only via the chokepoint

**Files:**
- Modify: `scripts/check-ledger-writes.sh` (append a second check after the existing append-API check)
- Test: `packages/testing/tests/enforcement-scripts.test.ts` (this suite auto-globs `scripts/check-*.sh` — verify with `rtk grep -n "check-ledger" packages/testing` and add a fixture case only if the auto-glob doesn't already execute the script)

**Interfaces:**
- Produces: CI failure on any direct `steps` array mutation in kernel code outside `kernel-state.ts` (the chokepoint) — the C-final tightening the script's own NOTE promises.

- [ ] **Step 1: Verify current tree is clean under the new rule (dry run)**

Run:
```bash
rtk grep -rnE '\.steps\.push\(|\.steps\[[^]]*\]\s*=|steps\.splice\(' packages/reasoning/src/kernel --include='*.ts' | grep -v test | grep -v 'state/kernel-state.ts'
```
Expected: no output. If hits appear, list them in the task report — each is a latent invariant breach; route them through `transitionState` patches first (each such fix is its own commit) before landing the guard.

- [ ] **Step 2: Append the new check to the script**

Add to the end of `scripts/check-ledger-writes.sh` (before the final exit/summary lines — match the style of the existing check):

```bash
# ── C-final tightening (Wave C.1, 2026-07-22) ────────────────────────────────
# steps[] is mutated ONLY via transitionState patches (the chokepoint that
# derives the ledger). Direct array mutation anywhere else in the kernel would
# grow steps without growing the ledger — exactly the drift the C1 equivalence
# invariant (equivalence.test.ts) pins. Ratified: wiki/Decisions/
# 2026-07-22-c1-equivalence-invariant.md
STEPS_MUTATIONS=$(grep -rnE '\.steps\.push\(|\.steps\[[^]]*\]\s*=|steps\.splice\(' \
  packages/reasoning/src/kernel --include='*.ts' \
  | grep -v '\.test\.ts' \
  | grep -v 'state/kernel-state\.ts' || true)
if [ -n "$STEPS_MUTATIONS" ]; then
  echo "FAIL: direct steps[] mutation outside the transitionState chokepoint:"
  echo "$STEPS_MUTATIONS"
  exit 1
fi
```

- [ ] **Step 3: Run the script + prove red-on-cut**

Run: `bash scripts/check-ledger-writes.sh`
Expected: exit 0.
Then add a scratch line `state.steps.push(x as never);` to any non-chokepoint kernel file, rerun, expect exit 1 with the offending line printed, remove the scratch line, rerun, exit 0.

- [ ] **Step 4: Run the enforcement-suite + commit**

Run: `bun test packages/testing --timeout 15000`
Expected: PASS (auto-glob executes the modified script).

```bash
rtk git add scripts/check-ledger-writes.sh
rtk git commit -m "ci(ledger): tighten single-writer gate — steps[] mutates only via the transitionState chokepoint"
```

### Task 3: Ratification decision doc + amend the two stale TODOs

**Files:**
- Create: `wiki/Decisions/2026-07-22-c1-equivalence-invariant.md`
- Modify: `packages/reasoning/src/kernel/ledger/step-projection.ts:9-12` (header TODO), `packages/reasoning/src/kernel/state/kernel-state.ts:524` (TODO comment)

**Interfaces:**
- Produces: the ratification record 09's conflict rule requires ("a needed change to a higher document is a ratification event, not an edit-in-passing").

- [ ] **Step 1: Write the decision doc**

```markdown
---
tags: [decision, ratification, wave-c, ledger]
date: 2026-07-22
status: RATIFIED (owner decision, 2026-07-22 planning session)
amends: wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md §3 C1 (wording only)
---

# C1 "steps becomes a projection" → equivalence invariant

## Decision
09-C1's literal wording — steps[] "becomes a ledger projection" — is satisfied
by the **equivalence-invariant form**, not a physical write-direction flip:

1. steps[] mutates ONLY via the `transitionState` chokepoint
   (`scripts/check-ledger-writes.sh`, tightened this wave).
2. `state.ledger ≡ projectStepsToLedger(steps history)` after every
   transition (`kernel/ledger/equivalence.test.ts`, red-on-cut).
3. The ledger is CANONICAL for all new readers (receipt, stream, journal —
   Wave C.1 slices 2–3). No new reader may scan steps[] when a ledger query
   answers the same question.

## Why not the literal flip
The shipped projection is deliberately lossy: thought/plan/reflection/critique
steps map to no entries ("not high-value ledger facts", step-projection.ts),
and tool results carry 240-char previews. A lossless inversion would require
full-content entry kinds — growing the ledger/codec ~5–10× on verbose runs,
burdening compaction, and contradicting the ledger's own design. The C1 goal
("no second store") is about READER convergence + a single write path; the
invariant delivers both.

## Consequences
- `TODO(C-final)` comments in step-projection.ts / kernel-state.ts are
  restated to point here (done this wave).
- 09 §3 C1 text stands as written; this doc is the binding interpretation
  (09 conflict rule: ratification event, not edit-in-passing).
- The literal flip may be revisited ONLY with bench evidence that a reader
  needs lossless thought/plan history from the ledger.
```

- [ ] **Step 2: Amend both TODO comments**

In `step-projection.ts`, replace lines 9–12:
```typescript
// C-final RESOLVED as the equivalence invariant (ratified 2026-07-22,
// wiki/Decisions/2026-07-22-c1-equivalence-invariant.md): steps[] stays the
// in-loop record, mutated only via the transitionState chokepoint; the ledger
// grows alongside it and equivalence.test.ts pins ledger ≡ projection(steps).
// The physical write-direction flip was declined (lossy-by-design projection;
// see the decision doc). The ledger is canonical for all NEW readers.
```

In `kernel-state.ts`, replace the line-524 TODO:
```typescript
   * C-final (2026-07-22): resolved as the equivalence invariant — see
   * wiki/Decisions/2026-07-22-c1-equivalence-invariant.md. Ledger is canonical
   * for readers; steps[] mutates only via this chokepoint.
```

- [ ] **Step 3: Verify + commit**

Run: `bun test packages/reasoning/src/kernel/ledger --timeout 15000 && bash scripts/check-ledger-writes.sh`
Expected: PASS, exit 0.

```bash
rtk git add wiki/Decisions/2026-07-22-c1-equivalence-invariant.md packages/reasoning/src/kernel/ledger/step-projection.ts packages/reasoning/src/kernel/state/kernel-state.ts
rtk git commit -m "docs(decision): ratify C1 equivalence invariant — amend stale C-final TODOs"
```

---

## Slice 2 — Receipt re-bases onto ledger queries

### Task 4: Every strategy forwards `runLedger`

**Files:**
- Modify: `packages/reasoning/src/strategies/reactive.ts`, `direct.ts`, `reflexion.ts`, `tree-of-thought.ts`, `code-action.ts`, `adaptive.ts` — wherever each builds its result `extraMetadata` (locate per file with `rtk grep -n "extraMetadata" <file>`; these are the same sites Wave 2 B2 touched for `terminatedBy`)
- Test: `packages/reasoning/tests/strategies/runledger-forwarding.test.ts` (create; mirror the structure of the existing B2 forwarding test — find it with `rtk grep -rln "deriveTerminatedBy" packages/reasoning/tests`)

**Interfaces:**
- Consumes: `ReActKernelResult.state.ledger` (kernel strategies); existing `ledgerRef` (`plan-execute.ts:205`, `blueprint.ts:160` — already forwarded at `plan-execute.ts:611/:1424`, `blueprint.ts:700`; leave untouched).
- Produces: `extraMetadata.runLedger: RunLedger` on EVERY strategy result — the field name `runLedger` matches what plan-execute/blueprint already emit. Slice-2 engine tasks rely on this exact key.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/reasoning/tests/strategies/runledger-forwarding.test.ts
//
// B2-class boundary pin (Wave C.1 slice 2): every strategy forwards the run's
// ledger as extraMetadata.runLedger. Without this, the engine's receipt
// re-base (helpers.ts) silently falls back to step-scanning for the
// strategies that "forgot" — the exact write-only-boundary disease B4 killed.
import { describe, expect, test } from "bun:test";
// Use the SAME strategy-invocation harness the existing B2 forwarding test
// uses (test provider, minimal task) — copy its setup verbatim, then assert:

// for each strategy result:
//   expect(result.extraMetadata?.runLedger).toBeDefined();
//   expect(Array.isArray(result.extraMetadata?.runLedger)).toBe(true);
//   // a run that executed ≥1 tool must carry ≥1 tool-invocation entry:
//   const kinds = (result.extraMetadata!.runLedger as { kind: string }[]).map(e => e.kind);
//   expect(kinds).toContain("tool-invocation");
```

The concrete harness (builder/provider setup, task fixtures, per-strategy loop) is copied from the existing B2 test file; the assertions above are the deliverable. Cover: reactive, direct, reflexion, tree-of-thought, code-action, adaptive, plan-execute, blueprint (the last two must pass BEFORE any code change — they already forward).

- [ ] **Step 2: Run — expect RED for the 6 kernel strategies, GREEN for plan-execute/blueprint**

Run: `bun test packages/reasoning/tests/strategies/runledger-forwarding.test.ts --timeout 15000`
Expected: FAIL (kernel strategies missing `runLedger`).

- [ ] **Step 3: Forward from each kernel strategy**

In each of the 6 files, at the site that builds `extraMetadata` from the kernel result (`result` is the `ReActKernelResult`), add one field:

```typescript
        extraMetadata: {
          // ...existing fields (terminatedBy, abstention, …) stay unchanged
          runLedger: result.state.ledger ?? [],
        },
```

For `adaptive.ts`: the fallback-merge path (adaptive.ts:290-305 area, Wave 2 §5.1) must forward the FINAL sub-strategy's `runLedger` — take it from `finalSubResult.extraMetadata?.runLedger`, and do not attempt cross-sub-strategy ledger merging in this task (seq collision; note it in the task report as a known limitation of adaptive fallback).

- [ ] **Step 4: Run — expect GREEN all 8**

Run: `bun test packages/reasoning/tests/strategies/runledger-forwarding.test.ts --timeout 15000`
Expected: PASS.

- [ ] **Step 5: Full reasoning suite + commit**

Run: `bun test packages/reasoning --timeout 15000 && bash scripts/check-ledger-writes.sh`
Expected: PASS, exit 0.

```bash
rtk git add packages/reasoning/src/strategies packages/reasoning/tests/strategies/runledger-forwarding.test.ts
rtk git commit -m "feat(strategies): forward runLedger across the result boundary from all 8 strategies"
```

### Task 5: `deriveReceiptToolCalls` reads the ledger first

**Files:**
- Modify: `packages/runtime/src/builder/helpers.ts:213-267` (`deriveReceiptToolCalls` + private `deriveFromSteps`)
- Modify: the two receipt-assembly call sites to pass the ledger — `packages/runtime/src/reactive-agent.ts` (buildRunTaskEffect) and `packages/runtime/src/engine/execute-stream.ts` (locate with `rtk grep -n "deriveReceiptToolCalls" packages/runtime/src`)
- Test: `packages/runtime/tests/receipt-ledger-rebase.test.ts` (create)

**Interfaces:**
- Consumes: `metadata.runLedger` (Task 4). Type it structurally in runtime (cross-package): `ReadonlyArray<{ kind: string; toolName?: string; toolCallId?: string; success?: boolean; args?: Readonly<Record<string, unknown>> }>` — runtime already consumes reasoning types this way at the B2 seam; match the existing import pattern (`rtk grep -n "runLedger\|ReasoningStep" packages/runtime/src/builder/helpers.ts` and follow whichever import style `ReasoningStep` uses).
- Produces: `deriveReceiptToolCalls(metadata)` unchanged signature; new behavior — when `metadata.runLedger` holds ≥1 `tool-invocation`, evidence derives from ledger pairs; steps fallback intact.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/runtime/tests/receipt-ledger-rebase.test.ts
import { describe, expect, test } from "bun:test";
import { deriveReceiptToolCalls } from "../src/builder/helpers.js";

const inv = (id: string, name: string, args?: Record<string, unknown>) =>
  ({ kind: "tool-invocation", toolCallId: id, toolName: name, ...(args ? { args } : {}) });
const res = (id: string, name: string, success: boolean) =>
  ({ kind: "tool-result", toolCallId: id, toolName: name, success });

describe("receipt tool-call evidence re-bases onto the ledger", () => {
  test("ledger pairs win over steps when present", () => {
    const out = deriveReceiptToolCalls({
      runLedger: [
        inv("c1", "file-read", { path: "a.txt" }),
        res("c1", "file-read", true),
        inv("c2", "file-write", { path: "b.txt" }),
        res("c2", "file-write", false),
      ],
      // steps deliberately CONTRADICT the ledger — ledger must win:
      reasoningSteps: [
        { type: "action", metadata: { toolCall: { id: "c9", name: "wrong-tool", arguments: {} } } },
      ],
    } as never);
    expect(out).toEqual([
      { name: "file-read", ok: true, target: JSON.stringify([["path", "a.txt"]]) },
      { name: "file-write", ok: false, target: JSON.stringify([["path", "b.txt"]]) },
    ]);
  });

  test("steps fallback intact when no ledger crosses", () => {
    const out = deriveReceiptToolCalls({
      reasoningSteps: [
        { type: "action", metadata: { toolCall: { id: "c1", name: "file-read", arguments: { path: "a.txt" } }, } },
        { type: "observation", metadata: { toolCallId: "c1", observationResult: { success: true } } },
      ],
    } as never);
    expect(out.length).toBe(1);
    expect(out[0]).toMatchObject({ name: "file-read", ok: true });
  });

  test("meta tools excluded from ledger path too (final-answer is not evidence)", () => {
    const out = deriveReceiptToolCalls({
      runLedger: [inv("c1", "final-answer"), res("c1", "final-answer", true)],
    } as never);
    expect(out).toEqual([]);
  });
});
```

(`target` expectation uses the exact `toolCallTarget` normalization at helpers.ts:200-211 — sorted-entries JSON.)

- [ ] **Step 2: Run — expect RED (`runLedger` ignored today)**

Run: `bun test packages/runtime/tests/receipt-ledger-rebase.test.ts --timeout 15000`
Expected: FAIL on tests 1 and 3.

- [ ] **Step 3: Implement ledger-first derivation**

In `helpers.ts`, extend the `metadata` parameter type of `deriveReceiptToolCalls` with:

```typescript
        readonly runLedger?: ReadonlyArray<{
            readonly kind: string
            readonly toolName?: string
            readonly toolCallId?: string
            readonly success?: boolean
            readonly args?: Readonly<Record<string, unknown>>
        }>
```

and change the body to:

```typescript
export function deriveReceiptToolCalls(
    metadata: /* extended type as above */
): ReadonlyArray<{ readonly name: string; readonly ok: boolean; readonly target?: string }> {
    const fromLedger = deriveFromLedger(metadata?.runLedger)
    if (fromLedger.length > 0) return fromLedger
    const fromSteps = deriveFromSteps(metadata?.reasoningSteps)
    if (fromSteps.length > 0) return fromSteps
    return (metadata?.receiptToolCalls ?? []).filter((tc) =>
        isSubstantiveReceiptTool(tc.name),
    )
}

function deriveFromLedger(
    ledger: /* runLedger type as above */ | undefined,
): ReadonlyArray<{ readonly name: string; readonly ok: boolean; readonly target?: string }> {
    if (!ledger || ledger.length === 0) return []
    const okByCallId = new Map<string, boolean>()
    for (const e of ledger) {
        if (e.kind === "tool-result" && typeof e.toolCallId === "string" && typeof e.success === "boolean") {
            okByCallId.set(e.toolCallId, e.success)
        }
    }
    const result: Array<{ name: string; ok: boolean; target?: string }> = []
    for (const e of ledger) {
        if (e.kind !== "tool-invocation" || !e.toolName) continue
        if (!isSubstantiveReceiptTool(e.toolName)) continue
        const ok = typeof e.toolCallId === "string" ? (okByCallId.get(e.toolCallId) ?? false) : false
        const target = toolCallTarget(e.args)
        result.push({ name: e.toolName, ok, ...(target !== undefined ? { target } : {}) })
    }
    return result
}
```

Then thread `runLedger` from strategy metadata into BOTH receipt-assembly call sites (`reactive-agent.ts` + `execute-stream.ts`): each already passes `reasoningSteps` from run metadata — pass `runLedger` from the same metadata object (it arrives via Task 4's `extraMetadata`; confirm the metadata key path with `rtk grep -n "reasoningSteps" packages/runtime/src/reactive-agent.ts` and mirror it).

- [ ] **Step 4: Run — expect GREEN; prove red-on-cut**

Run: `bun test packages/runtime/tests/receipt-ledger-rebase.test.ts --timeout 15000`
Expected: PASS.
Red-on-cut: comment out the `const fromLedger` block, rerun, test 1 FAILS (steps contradiction leaks through). Restore.

- [ ] **Step 5: Runtime suite + commit**

Run: `bun test packages/runtime --timeout 15000`
Expected: PASS.

```bash
rtk git add packages/runtime/src/builder/helpers.ts packages/runtime/src/reactive-agent.ts packages/runtime/src/engine/execute-stream.ts packages/runtime/tests/receipt-ledger-rebase.test.ts
rtk git commit -m "feat(receipt): tool-call evidence re-bases onto runLedger queries (steps fallback intact)"
```

### Task 6: Deliverable evidence prefers ledger `artifact` entries

**Files:**
- Modify: `packages/runtime/src/builder/helpers.ts:176-190` (`deriveReceiptDeliverables`) — add optional `runLedger` arg and pass through
- Modify: `computeDeliverableReport` (locate: `rtk grep -rn "export function computeDeliverableReport" packages/`) — accept optional artifact-entry evidence
- Test: extend `packages/runtime/tests/receipt-ledger-rebase.test.ts`

**Interfaces:**
- Consumes: ledger `artifact` entries `{ kind: "artifact", path, digest?, op?, toolCallId? }` (run-ledger.ts:78) riding `runLedger`.
- Produces: `deriveReceiptDeliverables({ ..., runLedger? })` — a declared deliverable counts `produced` when an `artifact` entry's `path` matches, BEFORE falling back to the step-scan.

- [ ] **Step 1: Write the failing test (extend the Task-5 file)**

```typescript
import { deriveReceiptDeliverables } from "../src/builder/helpers.js";

describe("deliverable evidence prefers ledger artifact entries", () => {
  test("artifact entry marks a declared deliverable produced without step evidence", () => {
    const out = deriveReceiptDeliverables({
      task: "Write the summary to out/report.md",
      taskContract: { deliverables: [{ path: "out/report.md" }] } as never,
      reasoningSteps: [], // NO step evidence — ledger alone must carry it
      output: "done",
      runLedger: [
        { kind: "artifact", path: "out/report.md", op: "write", toolCallId: "c1" },
      ] as never,
    });
    expect(out).toBeDefined();
    expect(out!.find((d) => d.path === "out/report.md")?.produced).toBe(true);
  });

  test("missing artifact still reports unproduced", () => {
    const out = deriveReceiptDeliverables({
      task: "Write the summary to out/report.md",
      taskContract: { deliverables: [{ path: "out/report.md" }] } as never,
      reasoningSteps: [],
      output: "done",
      runLedger: [] as never,
    });
    expect(out!.find((d) => d.path === "out/report.md")?.produced).toBe(false);
  });
});
```

(Adjust the `taskContract` fixture shape to the real `TaskContract` deliverable declaration — copy a fixture from the existing `computeDeliverableReport` tests, found via `rtk grep -rln "computeDeliverableReport" packages --include='*.test.ts'`. The assertion pair — ledger-only evidence produces / absence doesn't — is the deliverable.)

- [ ] **Step 2: Run — expect RED on test 1**

Run: `bun test packages/runtime/tests/receipt-ledger-rebase.test.ts --timeout 15000`

- [ ] **Step 3: Implement**

`deriveReceiptDeliverables` gains `readonly runLedger?: <same structural type as Task 5, plus path?: string; op?: string>` and passes artifact paths down:

```typescript
    const ledgerArtifacts = (args.runLedger ?? [])
        .filter((e) => e.kind === "artifact" && typeof (e as { path?: unknown }).path === "string")
        .map((e) => (e as unknown as { path: string }).path)
    const report = computeDeliverableReport(contract, args.reasoningSteps ?? [], args.output, {
        ...(ledgerArtifacts.length > 0 ? { artifactPaths: ledgerArtifacts } : {}),
    })
```

`computeDeliverableReport` gains an optional 4th param `opts?: { artifactPaths?: readonly string[] }`; inside its per-deliverable check, a deliverable whose declared path matches any `artifactPaths` entry (same path normalization the step-scan already applies — reuse its existing normalizer) is `produced: true` without step evidence. Keep every existing code path byte-identical when `opts` is absent.

- [ ] **Step 4: Run — GREEN; red-on-cut (remove the `artifactPaths` consultation, test 1 fails); restore**

Run: `bun test packages/runtime/tests/receipt-ledger-rebase.test.ts --timeout 15000` — PASS.

- [ ] **Step 5: Both call sites pass `runLedger` (same metadata thread as Task 5), full suites, commit**

Run: `bun test packages/runtime packages/reasoning --timeout 15000`
Expected: PASS.

```bash
rtk git add packages/runtime/src packages/runtime/tests/receipt-ledger-rebase.test.ts
rtk git commit -m "feat(receipt): deliverable evidence prefers ledger artifact entries over step re-scan"
```

---

## Slice 3 — Live tap: LedgerEntryAppended

### Task 7: `onLedgerAppend` hook fired from the runner iteration boundary

**Files:**
- Modify: `packages/reasoning/src/kernel/state/kernel-state.ts` (`KernelHooks` interface, ~:985)
- Modify: `packages/reasoning/src/kernel/state/kernel-hooks.ts` (`buildKernelHooks`, :46)
- Modify: `packages/reasoning/src/kernel/loop/runner.ts` (iteration loop — fire on ledger growth)
- Test: `packages/reasoning/src/kernel/ledger/ledger-tap.test.ts` (create)

**Interfaces:**
- Consumes: `LedgerEntry`, `ledgerSize` (run-ledger.ts).
- Produces: `KernelHooks.onLedgerAppend(state, entries: readonly LedgerEntry[]): Effect.Effect<void, never>`; `buildKernelHooks` publishes each batch to the bus as `{ _tag: "LedgerEntryAppended", ... }` (event type lands in Task 8; until then the bridge publishes through the same `publishReasoningStep`-style guarded path with the raw shape).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/reasoning/src/kernel/ledger/ledger-tap.test.ts
//
// Slice 3: the runner surfaces every ledger append batch through
// hooks.onLedgerAppend, at the iteration boundary, exactly once per entry
// (no double-publish across iterations).
import { describe, expect, test } from "bun:test";
// Use the SAME runKernel test harness the existing runner tests use (test
// provider, single tool task) — copy its setup; override hooks with a
// recording onLedgerAppend:

// const seen: LedgerEntry[] = [];
// hooks: { ...buildKernelHooks(noneBus), onLedgerAppend: (_s, entries) =>
//   Effect.sync(() => { seen.push(...entries); }) }
//
// After the run:
//   expect(seen.length).toBe(result.state.ledger.length);  // once each
//   expect(seen).toEqual([...result.state.ledger]);        // in seq order
```

- [ ] **Step 2: Run — RED (`onLedgerAppend` not a KernelHooks member)**

Run: `bun test packages/reasoning/src/kernel/ledger/ledger-tap.test.ts --timeout 15000`
Expected: compile FAIL.

- [ ] **Step 3: Implement**

`kernel-state.ts` — add to `KernelHooks`:

```typescript
  /**
   * Wave C.1 slice 3 — live ledger tap. Fired at the runner iteration
   * boundary with the entries appended since the previous firing (seq order,
   * exactly once). The engine bridge publishes these as LedgerEntryAppended
   * bus events; journal.ts persistence + stream projection ride that event.
   */
  readonly onLedgerAppend: (
    state: KernelState,
    entries: readonly import("../ledger/run-ledger.js").LedgerEntry[],
  ) => Effect.Effect<void, never>;
```

`kernel-hooks.ts` — implement in `buildKernelHooks` following the file's existing guarded-publish pattern:

```typescript
    onLedgerAppend: (state, entries) =>
      publishReasoningStep(eventBus, {
        _tag: "LedgerEntryAppended",
        agentId: state.agentId,
        taskId: state.taskId,
        entries,
        timestamp: Date.now(),
      } as never), // typed properly once Task 8 lands the AgentEvent variant; keep `never` cast OUT — use the same event-shape typing the sibling hooks use
```

(Follow the exact publish idiom of the sibling hooks in this file — same error-swallowing, same None handling. If sibling hooks build typed core events, mirror that; the `as never` note above means: do what the siblings do, no new cast pattern.)

`runner.ts` — in the iteration loop, after the state rebind at the end of each iteration (and once more after loop exit for terminal-transition entries):

```typescript
      // Wave C.1 slice 3 — live ledger tap (exactly-once per entry).
      if (state.ledger.length > publishedLedgerLen) {
        yield* hooks.onLedgerAppend(state, state.ledger.slice(publishedLedgerLen));
        publishedLedgerLen = state.ledger.length;
      }
```

with `let publishedLedgerLen = state.ledger?.length ?? 0;` initialized before the loop (resume: a durable-resumed kernel starts with a non-empty ledger; those entries were published in the prior process and must NOT re-publish).

Update every other `KernelHooks` literal in the tree (greppable: `rtk grep -rln "onThought" packages --include='*.ts'` and fix compile errors) — test harnesses gain the no-op `onLedgerAppend: () => Effect.void`.

- [ ] **Step 4: Run — GREEN; red-on-cut (comment the runner tap block, test fails on `seen.length`); restore**

Run: `bun test packages/reasoning/src/kernel/ledger/ledger-tap.test.ts --timeout 15000` — PASS.

- [ ] **Step 5: Full reasoning suite + commit**

Run: `bun test packages/reasoning --timeout 15000 && bash scripts/check-ledger-writes.sh`
Expected: PASS, exit 0.

```bash
rtk git add packages/reasoning/src/kernel
rtk git commit -m "feat(kernel): onLedgerAppend live tap — runner publishes ledger batches exactly-once per entry"
```

### Task 8: `LedgerEntryAppended` AgentEvent + stream projection + journal persistence pin

**Files:**
- Modify: `packages/core/src/services/event-bus.ts:47` (`AgentEvent` union — add variant)
- Modify: `packages/runtime/src/engine/execute-stream.ts` (project at `density:"full"` — mirror the B5 `PhaseStarted` projection shipped 2026-07-20; locate with `rtk grep -n "PhaseStarted" packages/runtime/src/engine/execute-stream.ts`)
- Test: `packages/runtime/tests/ledger-event-projection.test.ts` (create)

**Interfaces:**
- Consumes: Task 7's published event shape.
- Produces: `interface LedgerEntryAppendedEvent { readonly _tag: "LedgerEntryAppended"; readonly agentId: string; readonly taskId: string; readonly entries: ReadonlyArray<Record<string, unknown>>; readonly timestamp: number }` in the `AgentEvent` union (entries stay structurally typed in core — core must not import reasoning; matches how other cross-package payloads in this union are typed, check a sibling variant first); public stream chunk `{ type: "ledger-entry", entry, seq }` at `density:"full"`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/runtime/tests/ledger-event-projection.test.ts
//
// Slice 3 end-to-end: a run on the test provider with density:"full"
// (1) emits LedgerEntryAppended on the bus, (2) projects ledger-entry chunks
// on the public stream, (3) journal persistence: run_events rows containing
// the serialized LedgerEntryAppended events exist for a durable run.
//
// Copy the harness of the existing B5 phase-projection test (same file
// patterns: rtk grep -rln "PhaseStarted" packages/runtime/tests) — it already
// runs a streamed agent at density:"full" and collects chunks. Assertions:
//
//   const ledgerChunks = chunks.filter((c) => c.type === "ledger-entry");
//   expect(ledgerChunks.length).toBeGreaterThan(0);
//   // tool-using test run ⇒ at least the tool-invocation entry crossed:
//   expect(ledgerChunks.some((c) => (c.entry as { kind?: string }).kind === "tool-invocation")).toBe(true);
```

- [ ] **Step 2: Run — RED (no `ledger-entry` chunk type)**

Run: `bun test packages/runtime/tests/ledger-event-projection.test.ts --timeout 15000`

- [ ] **Step 3: Implement**

`event-bus.ts` — add the variant (exact style of sibling variants at :47ff):

```typescript
export interface LedgerEntryAppendedEvent {
  readonly _tag: "LedgerEntryAppended";
  readonly agentId: string;
  readonly taskId: string;
  /** Structurally-typed ledger entries (core cannot import reasoning). */
  readonly entries: ReadonlyArray<Record<string, unknown>>;
  readonly timestamp: number;
}
```

and add `| LedgerEntryAppendedEvent` to the `AgentEvent` union.

`execute-stream.ts` — beside the B5 `PhaseStarted`/`PhaseCompleted` projection, add:

```typescript
      case "LedgerEntryAppended": {
        if (density !== "full") return [];
        return event.entries.map((entry) => ({
          type: "ledger-entry" as const,
          entry,
          seq: typeof (entry as { seq?: unknown }).seq === "number" ? (entry as { seq: number }).seq : -1,
        }));
      }
```

(match the exact projection-function shape used by the B5 cases — array-return vs single-chunk emit — and add the `ledger-entry` chunk type to the same stream-types module the B5 chunks extended; find it via `rtk grep -rn "PhaseStarted" packages/runtime/src --include='*.ts' | grep -v test`).

Journal persistence needs NO new code (`journal.ts:85` serializes every subscribed event) — but pin it: extend the test with a durable-run case asserting `listRunEvents` rows include a `"LedgerEntryAppended"` payload (copy the durable-run harness from the existing journal tests: `rtk grep -rln "appendRunEvent\|listRunEvents" packages/runtime/tests`).

- [ ] **Step 4: Run — GREEN; red-on-cut (delete the `case "LedgerEntryAppended"`, stream test fails); restore**

Run: `bun test packages/runtime/tests/ledger-event-projection.test.ts --timeout 15000` — PASS.

- [ ] **Step 5: Full-suite gate + commit**

Run: `bun test --timeout 15000 && bash scripts/check-ledger-writes.sh && bunx turbo run build --force && bunx turbo run typecheck --force`
Expected: suites PASS, gate exit 0, build + strict typecheck green (typecheck is the release-blocking gate — `4cb2da3e` lesson).

```bash
rtk git add packages/core/src/services/event-bus.ts packages/runtime/src/engine packages/runtime/tests/ledger-event-projection.test.ts
rtk git commit -m "feat(events): LedgerEntryAppended — canonical live ledger feed on bus, stream (density:full), and run_events journal"
```

### Task 9: Register + docs close-out

**Files:**
- Modify: `wiki/Architecture/DEBT-REGISTER.md` (§3 — add Wave C.1 resolution note under the spine table; ratchet intact)
- Modify: `wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md` §7 status board (Wave C row → ◐ slices 1–3 shipped; engine-side entries + replay re-base = Wave C.2, deferred)
- Modify: `CHANGELOG.md` `[Unreleased]` — via a changeset if this rides a release (`release.ts:174` rule: curated notes MUST be a changeset, never hand-edit release sections)

**Interfaces:** none — documentation truth pass.

- [ ] **Step 1: DEBT-REGISTER note** — append below the §3 boundary table:

```markdown
**Wave C.1 (2026-07-22): C1 convergence slices 1–3.** Equivalence invariant ratified
([[../Decisions/2026-07-22-c1-equivalence-invariant|decision]]) — steps[] chokepoint-only
(gate tightened) + ledger ≡ projection pinned red-on-cut; all 8 strategies forward
`runLedger`; receipt tool-call + deliverable evidence re-based onto ledger queries
(steps fallback kept); `LedgerEntryAppended` live tap → bus + stream(density:full) +
run_events journal. DEFERRED to Wave C.2: engine-phase ledger entries (run_events as
pure ledger journal), llm-exchange/replay re-base (byte-sensitive seam).
```

- [ ] **Step 2: 09 §7 board row update** — in the 2026-07-22 current block, append:

```markdown
> Wave C.1 (slices 1–3) SHIPPED <date>: equivalence invariant + receipt re-base +
> LedgerEntryAppended live tap. Wave C.2 (engine-side entries, replay re-base) next.
```

- [ ] **Step 3: Changeset** (if releasing) + final verification + commit

Run: `bun test --timeout 15000 && bash scripts/check-ledger-writes.sh && bash scripts/check-orphans.sh`
Expected: all green.

```bash
rtk git add wiki CHANGELOG.md .changeset 2>/dev/null || rtk git add wiki
rtk git commit -m "docs(debt): Wave C.1 close-out — C1 slices 1-3 recorded, C.2 scope named"
```

---

## Self-Review (performed at write time)

1. **Spec coverage:** C1 slice 1 → Tasks 1–3; slice 2 → Tasks 4–6; slice 3 → Tasks 7–8; truth-pass → Task 9. Deferred (named, not silent): engine-phase entries, replay re-base → Wave C.2.
2. **Placeholder scan:** Tasks 1/4/8 instruct copying an EXISTING harness verbatim (named via grep) with complete assertions given — deliberate: fixtures live in sibling tests and duplicating them blind would rot; the deliverable logic is fully specified. No TBDs.
3. **Type consistency:** `runLedger` key matches plan-execute/blueprint's shipped field; `onLedgerAppend(state, entries)` consistent across Tasks 7–8; structural entry type consistent across Tasks 5–6.
4. **Known risks:** (a) Task 1 may FAIL green-run if a live equivalence bug exists — that is signal, handle before proceeding; (b) adaptive fallback ledger merging deliberately excluded (seq collision) and reported; (c) resumed runs must not re-publish prior entries — pinned in Task 7 via `publishedLedgerLen` init.
