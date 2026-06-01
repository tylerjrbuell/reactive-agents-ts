// File: tests/strategies/postcondition-seed-default-on.test.ts
//
// Runner-level regression guard for the PostCondition SEED at runner.ts:250.
//
// The #7 ship (bc5737a1) flipped the three CONSUMING gates to default-on
// (`!== "0"`) but left the runner SEED on `=== "1"`, so in the DEFAULT (unset)
// regime `state.meta.postConditions` was never seeded and the terminal
// hard-stop in terminate.ts (the only consumer with NO re-derive fallback) was
// INERT — an exhausted/forced path could force-deliver a FALSE success (the
// exact hole #7 exists to close; terminate.ts:95-97). The seed flip to `!== "0"`
// fixed it.
//
// The warden's unit test (terminate.post-conditions.test.ts) seeds meta
// DIRECTLY, so reverting runner.ts:250 leaves it green — it does NOT guard the
// SEED. This test runs the real `runKernel` setup in each regime and inspects
// the seeded set directly: it goes RED if runner.ts:250 ever regresses to
// `=== "1"`. Inspecting the seed (not end-to-end status) deliberately avoids the
// arbitrator self-heal + required-tool-enforcement confounds that make a
// behavioral assertion non-discriminating for the seed specifically.
//
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Effect } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { runKernel } from "../../src/kernel/loop/runner.js";
import {
  transitionState,
  type ThoughtKernel,
} from "../../src/kernel/state/kernel-state.js";

// Trivial kernel: terminates on the first call. The seed at runner.ts:250 runs
// during runKernel setup, BEFORE the loop, so the returned state already carries
// (or omits) the seeded conditions regardless of kernel behavior.
const doneKernel: ThoughtKernel = (state) =>
  Effect.succeed(
    transitionState(state, {
      status: "done",
      output: "done",
      iteration: state.iteration + 1,
    }),
  );

// A task with a HIGH-PRECISION literal deliverable path → deriveConditions emits
// ArtifactProduced('./out.md') + ToolCalled('file-write'). (No requiredTools, so
// this is independent of required-tool enforcement.)
const DELIVERABLE_TASK = "Write a report to the file ./out.md";

const runSeed = () =>
  Effect.runPromise(
    runKernel(doneKernel, { task: DELIVERABLE_TASK }, {
      maxIterations: 1,
      strategy: "test",
      kernelType: "test",
    }).pipe(Effect.provide(TestLLMServiceLayer())),
  );

describe("PostCondition seed is default-on (runner.ts:250 regression guard)", () => {
  const PRIOR = process.env.RA_POST_CONDITIONS;
  beforeEach(() => {
    delete process.env.RA_POST_CONDITIONS;
  });
  afterEach(() => {
    if (PRIOR === undefined) delete process.env.RA_POST_CONDITIONS;
    else process.env.RA_POST_CONDITIONS = PRIOR;
  });

  it("DEFAULT (unset): seeds state.meta.postConditions from the deliverable task", async () => {
    // If runner.ts:250 regresses to `=== "1"`, the seed will NOT fire by default
    // and this assertion goes RED — the precise guard the warden's unit test lacks.
    const state = await runSeed();
    const conditions = state.meta.postConditions;
    expect(conditions).toBeDefined();
    expect(conditions!.length).toBeGreaterThan(0);
    // The derived set must include the literal artifact deliverable.
    const hasArtifact = conditions!.some(
      (c) => c.kind === "ArtifactProduced" && c.path.endsWith("out.md"),
    );
    expect(hasArtifact).toBe(true);
  });

  it("OPT-OUT (RA_POST_CONDITIONS=0): does NOT seed — byte-identical legacy", async () => {
    process.env.RA_POST_CONDITIONS = "0";
    const state = await runSeed();
    expect(state.meta.postConditions).toBeUndefined();
  });
});
