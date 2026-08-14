# Phase 4 — One Terminal Outcome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix FM-4 (duplicated terminal-outcome computation across `run()`/`runStream()`, and a second verifier overwriting a more specific rejection reason) and FM-5 (`Effect.forkDaemon` detaches stream termination from its caller, and `terminate()`'s abort signal has no reader in the kernel loop) — plus the kernel synthesis-backfill bug the empty-output invariant tests trace to the same neighborhood. Gate: run/stream parity + red-on-cut termination test.

**Architecture:** No new `RunOutcome` type is introduced — C7 ("09-UNIFIED-PROGRAM.md" §3) is satisfied by making outcome *computation* single-owner, not by threading a new schema through the kernel. The kernel already owns `status`/`terminatedBy`/`output` via `terminate.ts`/`arbitrator.ts`; this plan unifies the two downstream re-derivation sites that compute `toolCalls`/`deliverables`/`goalAchieved`/`TrustReceipt` from `TaskResult`, fixes verifier-overwrite ordering at the result boundary, gives `terminate()`'s abort a real reader in the loop, and removes the daemon fork.

**Tech Stack:** TypeScript, Effect-TS, Bun test.

## Global Constraints

- No test in this repo may require live cloud-provider credits (Anthropic/OpenAI/Gemini). Use `.withReplayLLM()` or `.withTestScenario()` for any new test needing a scripted LLM response — never `.withLayers()` for LLMService (see `builder.ts`'s `withLayers()` doc, fixed 2026-08-13, commit `d58636ff`).
- `arbitrator.ts` is the kernel-internal canonical producer of terminal state (upstream, single-owner per `terminate.ts`'s own header). Do NOT refactor it as part of this plan — the original FM-4 framing grouping it with the two downstream sites was wrong; it was verified during scoping (2026-08-13) that it's the producer, not a third re-deriver.
- Every architectural invariant gate script (`scripts/check-*.sh`, 9 scripts) must stay green after each task.
- Run `bunx turbo run typecheck --filter=@reactive-agents/reasoning` / `--filter=@reactive-agents/runtime` from repo root for typecheck verification — bare `bun run typecheck` inside a package skips the monorepo build graph and produces false-positive cascades from stale dist typings.

---

### Task 1: Single outcome-computation helper for `run()` and `runStream()`

**Files:**
- Create: `packages/runtime/src/engine/finalize/derive-outcome.ts`
- Modify: `packages/runtime/src/reactive-agent.ts:1478-1626`
- Modify: `packages/runtime/src/engine/execute-stream.ts:535-814`
- Test: `packages/runtime/tests/derive-outcome.test.ts` (new)
- Test: `packages/runtime/tests/run-stream-parity.test.ts` (new)

**Interfaces:**
- Consumes: `TaskResult` (existing type — has `.metadata.reasoningSteps`, `.terminatedBy`, `.success`, `.output`, `.metadata.runLedger`, `.metadata.cacheHit`, `.metadata.verifierVerdict`).
- Produces: `deriveTaskOutcome(taskResult: TaskResult, ctx: { task: string; requiredTools?: string[]; taskContract?: unknown; modelId?: string; now?: number }): TaskOutcome`, where
  ```ts
  export interface TaskOutcome {
    toolCalls: ReturnType<typeof deriveReceiptToolCalls>;
    deliverables: ReturnType<typeof deriveReceiptDeliverables>;
    goalAchieved: boolean;
    receipt: TrustReceipt;
  }
  ```
  Both `reactive-agent.ts` and `execute-stream.ts` call this ONE function instead of each independently calling `deriveReceiptDeliverables`/`resolveGoalAchieved`/`computeTrustReceipt`/`deriveReceiptToolCalls`/`deriveInterventionsFromSteps` in sequence.

**Background:** Confirmed by exploration (2026-08-13): `reactive-agent.ts:1499-1609` and `execute-stream.ts:646-690` call the *identical* four helpers (`deriveReceiptDeliverables`, `resolveGoalAchieved`, `computeTrustReceipt`, `deriveReceiptToolCalls`) on two independently-obtained `TaskResult` objects from two different call paths (`run()` vs `runStream()`). This is duplication, not two disagreeing algorithms — but because each path computes/receives its own `TaskResult`, the two computations CAN diverge in practice, and nothing asserts they don't.

- [ ] **Step 1: Write the failing parity test**

```ts
// packages/runtime/tests/run-stream-parity.test.ts
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";

describe("run/stream terminal-outcome parity", () => {
  it("run() and runStream() agree on terminatedBy, goalAchieved, and receipt verdict for the same scenario", async () => {
    const scenario = [{ text: "FINAL ANSWER: 4" }];

    const runAgent = await ReactiveAgents.create().withTestScenario(scenario).build();
    const streamAgent = await ReactiveAgents.create().withTestScenario(scenario).build();
    try {
      const runResult = await runAgent.run("What is 2 + 2?");

      let streamResult: { terminatedBy?: string; goalAchieved?: boolean; receipt?: { verdict?: string } } = {};
      for await (const event of streamAgent.runStream("What is 2 + 2?")) {
        if (event.type === "completed") {
          streamResult = {
            terminatedBy: event.terminatedBy,
            goalAchieved: event.goalAchieved,
            receipt: event.receipt,
          };
        }
      }

      expect(streamResult.terminatedBy).toBe(runResult.terminatedBy);
      expect(streamResult.goalAchieved).toBe(runResult.goalAchieved);
      expect(streamResult.receipt?.verdict).toBe(runResult.receipt?.verdict);
    } finally {
      await runAgent.dispose();
      await streamAgent.dispose();
    }
  }, 20000);
});
```

Adjust the `StreamCompletedEvent` field names to whatever `execute-stream.ts:559-601` actually names them (`terminatedBy`, `goalAchieved`, `receipt` — confirm exact field names by reading that range before writing the test; do not guess).

- [ ] **Step 2: Run it to see current behavior**

Run: `cd packages/runtime && bun test tests/run-stream-parity.test.ts`
This may already pass by coincidence on a trivial scenario — that's fine, it's the regression harness for Step 5, not proof of a bug. Note the baseline result.

- [ ] **Step 3: Extract `deriveTaskOutcome`**

Read `reactive-agent.ts:1478-1626` and `execute-stream.ts:535-814` in full first. Write `derive-outcome.ts` by lifting the shared computation block verbatim (the four helper calls plus the assembly of `toolCalls`/`deliverables`/`goalAchieved`/`receipt`) out of `reactive-agent.ts` into the new file as `deriveTaskOutcome`. Keep the exact same helper call signatures — this is an extraction, not a rewrite.

- [ ] **Step 4: Wire both call sites to the extracted helper**

Replace the duplicated block in `reactive-agent.ts:1499-1609` with a call to `deriveTaskOutcome(r, { task, requiredTools, taskContract, modelId, now })`. Replace the duplicated block in `execute-stream.ts:646-690` with the same call using that path's equivalent inputs (`taskResult`, `task`, `config`).

- [ ] **Step 5: Add the direct unit test for `deriveTaskOutcome`**

```ts
// packages/runtime/tests/derive-outcome.test.ts
import { describe, it, expect } from "bun:test";
import { deriveTaskOutcome } from "../src/engine/finalize/derive-outcome.js";

describe("deriveTaskOutcome", () => {
  it("is a pure function of TaskResult + ctx — same input, same output", () => {
    const taskResult = {
      terminatedBy: "final_answer",
      success: true,
      output: "4",
      metadata: { reasoningSteps: [], runLedger: undefined, cacheHit: false, verifierVerdict: "pass" },
    } as unknown as Parameters<typeof deriveTaskOutcome>[0];
    const ctx = { task: "What is 2 + 2?" };

    const a = deriveTaskOutcome(taskResult, ctx);
    const b = deriveTaskOutcome(taskResult, ctx);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 6: Run both new tests + the full runtime suite**

Run: `cd packages/runtime && bun test tests/derive-outcome.test.ts tests/run-stream-parity.test.ts`
Expected: PASS.
Run: `cd packages/runtime && bun test 2>&1 | tail -8`
Expected: no new failures vs the pre-task baseline (1439 pass / 6 fail).

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/engine/finalize/derive-outcome.ts packages/runtime/src/reactive-agent.ts packages/runtime/src/engine/execute-stream.ts packages/runtime/tests/derive-outcome.test.ts packages/runtime/tests/run-stream-parity.test.ts
git commit -m "refactor(runtime): single terminal-outcome computation for run()/runStream() (FM-4 part 1)"
```

---

### Task 2: Result-boundary verifier must not overwrite a more specific rejection reason

**Files:**
- Modify: `packages/runtime/src/engine/finalize/result-verification.ts:73-151`
- Test: `packages/runtime/tests/result-boundary-verification.test.ts:35-81` (already exists, currently RED — do not rewrite the test, make it pass)

**Interfaces:**
- Consumes: whatever `verifyResultBoundary` already consumes today (`{ action, content, actionSuccess, task, priorSteps, terminal, toolsUsed, terminatedBy, requiredTools, grounding, fabricationGuard }`) plus one new field: the run's PRIOR rejection reason if one already exists (read from `metadata.verificationWarning` / equivalent kernel-set field — confirm the exact field name by reading `result-verification.ts`'s caller in `execution-engine.ts:1378` before implementing).
- Produces: same shape as today, with one behavior change (see Step 3).

**Background:** Confirmed by exploration (2026-08-13): the kernel's in-loop verifier catches `scaffold-leak` first and terminates the run failed with a specific reason. `verifyResultBoundary` then re-verifies the ALREADY-FAILED result independently; its own `action-success` check fails trivially (since success is already false), and this generic reason overwrites the kernel's specific one in `metadata.verificationWarning`. The verdict itself (reject) ends up correct by coincidence — both checks happen to reject — but the surfaced reason text is wrong. This is NOT the same defect as Task 1 (no duplication to unify) — it's an ordering/precedence bug: a less-informative second opinion must not clobber a more-informative first one.

- [ ] **Step 1: Confirm current red state**

Run: `cd packages/runtime && bun test tests/result-boundary-verification.test.ts 2>&1 | tail -30`
Expected: the "scaffold leak..." test fails with `verificationWarning` containing `"action-success"` instead of `"scaffold-leak"`.

- [ ] **Step 2: Read the call site**

Read `execution-engine.ts` around line 1378 (where `verifyResultBoundary` is called) and `result-verification.ts:73-151` in full. Identify exactly which field on the state/ctx already carries the kernel's own verification warning at the point `verifyResultBoundary` runs, and exactly which line inside `result-verification.ts` writes `metadata.verificationWarning` (or the equivalent field the caller assigns from `verifyResultBoundary`'s return).

- [ ] **Step 3: Add precedence — don't overwrite an existing specific reason with a generic one**

At the call site (or inside `verifyResultBoundary`'s return-assembly, whichever owns the write), change the assignment so that IF a verification warning already exists on the incoming state AND the new one duplicates a strictly less-informative generic category (e.g. `action-success` failing solely because `actionSuccess` was already `false`), the EXISTING (kernel-set) warning is preserved instead of being replaced. Concretely: skip re-running the `action-success` check (or discard its resulting message) when `actionSuccess` is already `false` on entry — that check exists to catch a *first* discovery of failure, not to re-explain an already-known one. Do not change the verdict-capping logic (verdict/receipt fields) — only the message text precedence.

- [ ] **Step 4: Run the test**

Run: `cd packages/runtime && bun test tests/result-boundary-verification.test.ts 2>&1 | tail -20`
Expected: all 3 tests PASS, including `verificationWarning` now containing `"scaffold-leak"`.

- [ ] **Step 5: Run the full runtime suite**

Run: `cd packages/runtime && bun test 2>&1 | tail -8`
Expected: 1 fewer failure than the Task 1 baseline; no new failures.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/engine/finalize/result-verification.ts
git commit -m "fix(runtime): result-boundary verifier preserves the kernel's specific rejection reason (FM-4 part 2)"
```

---

### Task 3: Kernel synthesis backfill must not defeat the empty-output honesty checks

**Files:**
- Modify: `packages/reasoning/src/kernel/loop/runner.ts` (the §9 "harness-assembled output always attempts synthesis" site — locate it: `grep -n "always attempts synthesis" packages/reasoning/src/kernel/loop/runner.ts`)
- Test: `packages/runtime/tests/engine-empty-output-invariant.test.ts:22-114` (already exists, currently RED — do not rewrite the assertions, make them pass)

**Interfaces:**
- Consumes: `state` at the point the §9 synthesis backfill runs (has `state.output`, `state.meta.terminatedBy`, the model's actual final-turn text).
- Produces: a state where, when the backfill fires (i.e. `state.output` is populated FROM a tool observation rather than from the model's own final-turn text), a distinguishing signal is set at the SAME site — not derived later from `terminatedBy === "harness_deliverable"` (a check confirmed, 2026-08-13, to never actually fire for this scenario: `deliverableTerminationReason` in `runner-helpers/deliverable.ts:211` and its call sites in `runner.ts:1070`/`stall-deliverable.ts`/`loop-resolution.ts` are gated on `state.meta.terminatedBy` already being in `nonFinalAnswerTerminations` (`end_turn`/`llm_end_turn`/`dispatcher-early-stop`/`low_delta_guard`) — a plain tool-call-then-empty-final-turn scenario does not necessarily land in that set before the §9 backfill runs).

**Background:** Both currently-red tests in `engine-empty-output-invariant.test.ts` trace, per their own inline comments (written during a prior session's triage, confirmed still accurate by this plan's 2026-08-13 exploration pass), to the same root cause: the kernel's §9 backfill populates `state.output` from a tool's normalized observation BEFORE the model's genuinely-empty final turn is ever evaluated as empty. Two downstream honesty checks both key off `state.output`'s emptiness or off `terminatedBy === "harness_deliverable"`, and both silently no-op because the precondition they check for never becomes true in this scenario:
1. `runner.ts:1333-1348`'s `onlyHarnessAuthorshipFailed` (should set `harnessAuthoredOutput: true`) — gates on `terminatedBy === "harness_deliverable"`, never true here.
2. `execution-engine.ts:1408`'s `emptyOutputFailure` branch (should produce a "no output" error) — gates on `!hasSubstantiveOutput` computed from `state.output`, never true here because the backfill already filled it.

- [ ] **Step 1: Confirm current red state**

Run: `cd packages/runtime && bun test tests/engine-empty-output-invariant.test.ts 2>&1 | tail -40`
Expected: test 1 fails on `harnessAuthoredOutput` being `undefined` instead of `true`; test 2 fails on error message being `"Reasoning failed"` instead of containing `"no output"`.

- [ ] **Step 2: Locate and read the §9 backfill site**

`grep -n "always attempts synthesis" packages/reasoning/src/kernel/loop/runner.ts` — read the surrounding ~40 lines. Confirm: does this site check whether the MODEL's own final turn was empty before backfilling from a tool observation? If yes, that boolean (call it `backfilledFromToolObservation` or similar — name it clearly) is what Step 3 needs to stamp.

- [ ] **Step 3: Stamp the distinguishing signal at the backfill site**

When the backfill fires (model's final turn was empty, output filled from a tool observation instead), set `state.meta.harnessAuthoredOutput = true` directly at this site via `transitionState` — do NOT rely on a downstream `terminatedBy` check to infer it. This makes `harnessAuthoredOutput` true unconditionally whenever the backfill actually ran, matching what the test expects (test 1: a verified deliverable exists, output is non-empty, and it should be labeled harness-authored).

For test 2 (no verified deliverable, no tool artifacts to backfill from): confirm the backfill does NOT fire in this scenario (there's nothing to fill from) and `state.output` stays empty/null. If so, `execution-engine.ts:1408`'s `!hasSubstantiveOutput` check should already correctly read `state.output` as empty — re-run the test after Step 3's change alone before touching `execution-engine.ts`. If test 2 still fails after Step 3, read `execution-engine.ts:1400-1420` and fix whichever specific condition prevents `hasSubstantiveOutput` from being computed as `false` for a plain empty-string final turn with no tool calls at all.

- [ ] **Step 4: Run the tests**

Run: `cd packages/runtime && bun test tests/engine-empty-output-invariant.test.ts 2>&1 | tail -30`
Expected: both tests PASS.

- [ ] **Step 5: Run the full reasoning + runtime suites**

Run: `cd packages/reasoning && bun test 2>&1 | tail -8` — expected: still 2666+/0 (no regressions; this touches a widely-shared synthesis path, watch `output-quality-gate.test.ts` and `terminal-post-condition-gate.test.ts` specifically since they assert `harness_deliverable`/`harnessAuthoredOutput` behavior directly).
Run: `cd packages/runtime && bun test 2>&1 | tail -8` — expected: 2 fewer failures than Task 2's baseline.

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src/kernel/loop/runner.ts
git commit -m "fix(kernel): stamp harnessAuthoredOutput at the §9 synthesis backfill site, not downstream (FM-4/empty-output invariant)"
```

---

### Task 4: Remove the stream-execution daemon fork and give `terminate()`'s abort a reader

**Files:**
- Modify: `packages/runtime/src/engine/execute-stream.ts:811-814`
- Modify: `packages/reasoning/src/kernel/loop/iterate-pass.ts` (the `checkpoint()` call site, ~line 391, and the `RunControllerLike` consumption around it)
- Modify: `packages/runtime/src/run-controller.ts:247-251` (only if the checkpoint plumbing needs a new field/method — confirm in Step 2 before changing)
- Test: `packages/runtime/tests/stream-terminate-no-further-calls.test.ts` (new — the plan's own red-on-cut acceptance test, per `09-UNIFIED-PROGRAM.md` §7 Step 2: "terminate a stream, assert no subsequent provider call")

**Interfaces:**
- Consumes: `RunControllerLike` as already defined (has `checkpoint()`, `terminate()`, `stop()`).
- Produces: `checkpoint()` (or a new method alongside it, e.g. `isTerminated()`) that the kernel loop's iteration boundary reads and, if true, exits the loop immediately WITHOUT issuing another provider call — mirroring how `stop()`'s cooperative check already works today, per `iterate-pass.ts:391`.

**Background:** Confirmed by exploration (2026-08-13): `run-controller.ts`'s `terminate()` (:247-251) sets `_status = "terminated"` and calls `_abortController.abort()`, but nothing in `packages/reasoning/src/kernel/loop/runner.ts` or `iterate-pass.ts` reads `controller.signal`/`AbortSignal` at all — the ONLY kernel-side consumer of `RunControllerLike` is `checkpoint()`, which polls `_pausePromise`/`_stopRequested` (i.e. `stop()`, cooperative, IS observed). Calling `terminate()` on a stream today does not stop the underlying daemon-forked `execute(task)` call. This is two bugs, not one: (a) the daemon fork detaches the pipeline from the caller's scope, and (b) even without the fork, there is no reader for `terminate()`'s signal. Fixing only (a) does not make the red-on-cut test pass without also fixing (b).

- [ ] **Step 1: Write the failing red-on-cut test**

```ts
// packages/runtime/tests/stream-terminate-no-further-calls.test.ts
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";

describe("stream termination stops the run (FM-5)", () => {
  it("terminating a stream mid-run issues no further provider calls", async () => {
    let callCount = 0;
    const agent = await ReactiveAgents.create()
      .withTools({ builtins: ["file-write"] })
      .withTestScenario(
        Array.from({ length: 10 }, (_, i) => ({
          toolCall: { id: `t${i}`, name: "file-write", args: { path: `./fm5-test/${i}.txt`, content: "x" } },
        })),
      )
      .build();
    // If .withTestScenario() doesn't expose a call-count hook directly, wrap
    // .withReplayLLM() with a counting layer instead (same pattern as
    // model-routing-e2e.test.ts's makeCapturingLayer) -- confirm which is
    // available before writing this test for real.
    try {
      const handle = agent.runStream("write 10 files, one per tool call");
      let seen = 0;
      for await (const event of handle) {
        seen++;
        if (seen === 2) {
          await handle.terminate?.();
          // or whatever the actual RunHandle termination method is named --
          // confirm by reading run-controller.ts / the runStream() return type
          // before implementing.
          break;
        }
      }
      const countAtTermination = callCount;
      await new Promise((r) => setTimeout(r, 500));
      expect(callCount).toBe(countAtTermination);
    } finally {
      await agent.dispose();
    }
  }, 20000);
});
```

Before finalizing this test, read `run-controller.ts` and `execute-stream.ts`'s public `runStream()` return type to get the exact termination method name and the exact way to count provider calls without live credits (reuse the `.withReplayLLM()` counting-layer pattern already established this session in `model-routing-e2e.test.ts`).

- [ ] **Step 2: Read the plumbing**

Read `execute-stream.ts:800-820`, `run-controller.ts` in full, and `iterate-pass.ts:370-400`. Confirm exactly what `checkpoint()` currently checks and decide the minimal addition: either (a) `checkpoint()` also checks `_status === "terminated"` and throws/returns a sentinel the loop already treats as a stop signal, or (b) a new `isTerminated(): boolean` method the loop checks alongside its existing `stop()` check. Prefer (a) if `checkpoint()`'s existing return/throw contract can carry it without a new call site in the loop — minimize new surface.

- [ ] **Step 3: Wire `terminate()` into the loop's checkpoint**

Make the loop's per-iteration checkpoint call observe termination the same way it already observes `stop()`, so a terminated run exits before its next provider call.

- [ ] **Step 4: Remove the daemon fork**

Change `execute-stream.ts:811-814`'s `Effect.forkDaemon` to a fork that stays attached to the caller's scope (e.g. `Effect.fork` within the enclosing scope, or run un-forked if nothing downstream actually needs the fiber handle — check what currently reads the forked fiber's handle, if anything, before choosing).

- [ ] **Step 5: Run the new test**

Run: `cd packages/runtime && bun test tests/stream-terminate-no-further-calls.test.ts 2>&1 | tail -30`
Expected: PASS.

- [ ] **Step 6: Run the full runtime + reasoning suites**

Run: `cd packages/runtime && bun test 2>&1 | tail -8` and `cd packages/reasoning && bun test 2>&1 | tail -8`.
Expected: no new failures; runtime suite should now be down to the pre-existing unrelated 3 (Ollama timeout, WS-5b, protocol-roundtrip).

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/engine/execute-stream.ts packages/reasoning/src/kernel/loop/iterate-pass.ts packages/runtime/src/run-controller.ts packages/runtime/tests/stream-terminate-no-further-calls.test.ts
git commit -m "fix(runtime,kernel): terminate() aborts the stream's daemon fiber, not just its own controller (FM-5)"
```

---

### Task 5: Correct the plan record's own FM-4 framing + close out

**Files:**
- Modify: `wiki/Planning/Implementation-Plans/2026-08-12-agentic-overhaul-program.md:521-527` (FM-4 section)
- Modify: this plan file's own status section (add `## Status: ✅ SHIPPED` when done, matching the Deterministic Remedy Layer plan's convention)

**Background:** The overhaul program's FM-4 write-up named `arbitrator.ts` as a third independent reconstruction site alongside `reactive-agent.ts` and `execute-stream.ts`. Exploration during this plan's scoping (2026-08-13) confirmed that framing is wrong: `arbitrator.ts` is the kernel-internal canonical PRODUCER of terminal state (upstream, single-owner per `terminate.ts`'s header), not a third downstream re-deriver. The actual third site is `result-verification.ts`'s `verifyResultBoundary`, called from `execution-engine.ts:1378`. This must be corrected in the source document so a future reader (human or agent) doesn't re-plan a refactor of a 1,800-LOC file that was never the problem.

- [ ] **Step 1: Rewrite FM-4's text**

Replace the FM-4 section's site list with the corrected one: Site 1 = `reactive-agent.ts:1478-1626`, Site 2 = `execute-stream.ts:535-814` (same computation duplicated, not disagreeing algorithms), Site 3 = `result-verification.ts:73-151`'s `verifyResultBoundary` (a second verifier overwriting a more specific reason, not a duplicate reconstruction). Note `arbitrator.ts`'s actual role (canonical upstream producer) explicitly so it isn't miscategorized again.

- [ ] **Step 2: Mark this plan shipped**

Once Tasks 1-4 are reviewed and merged, add a `## Status: ✅ SHIPPED (2026-08-XX)` section to the top of this file summarizing what landed, mirroring `2026-08-12-deterministic-remedy-layer.md`'s closeout convention.

- [ ] **Step 3: Commit**

```bash
git add wiki/Planning/Implementation-Plans/2026-08-12-agentic-overhaul-program.md wiki/Planning/Implementation-Plans/2026-08-13-phase-4-one-terminal-outcome.md
git commit -m "docs(wiki): correct FM-4's site list (arbitrator.ts is the producer, not a third reconstruction) + close Phase 4 plan"
```

---

## Post-Phase-4 (explicitly NOT part of this plan)

Once Tasks 1-5 are merged and verified: run the benchmark comparison with vs. without the inline arm (Move 1's now-dead 1,579-LOC inline path), per the standing user instruction that this comparison must happen BEFORE Phase 3 (inline-arm deletion) proceeds, to determine whether any functionality is lost. Do not fold that benchmarking work into this plan — it depends on Phase 4's outcome-computation unification being stable first (a divergent inline-vs-kernel outcome comparison would be noise if run() and runStream() themselves still disagreed).
