/**
 * Max Iterations Enforcement Contract Tests
 *
 * Verifies that `ReactiveAgentsConfig.maxIterations` is honored by the REAL
 * production kernel arm — the config value must thread from the builder,
 * through `ExecutionEngine`, through the real `ReasoningService`, into the
 * kernel's arbitrator, and surface as a real termination reason.
 *
 * REDESIGN NOTE (2026-08-21, Move 1 dead-arm removal): this file previously
 * drove the now-dead inline agent loop directly via a mocked bare
 * `LLMService` layer, asserting on the inline-only `MaxIterationsError`
 * exception (`status:"max_iterations_reached"` does not exist on
 * `ReasoningResult` — the real shape is `"completed"|"failed"|"partial"`).
 * The kernel arm has no such exception type.
 *
 * Empirically confirmed real kernel-arm contract (this file's `bun test`
 * runs, cross-checked against `packages/reasoning/src/kernel/capabilities/
 * decide/arbitrator.ts`'s `"max-iterations"` intent branch):
 *
 *   - A genuine cap exhaustion is `terminatedBy:"max_iterations"` with
 *     `error: "Maximum iterations (N) exceeded"`.
 *   - If the tool calls along the way produced usable artifacts, the
 *     kernel's "non-authoritative termination → harness deliverable"
 *     promotion (`runner.ts` §8.5) synthesizes an answer from them and the
 *     run is graded `status:"completed"` (`success:true`) DESPITE
 *     `terminatedBy:"max_iterations"` — max_iterations is not, by itself,
 *     a guaranteed failure outcome. Proving genuine cap-triggered FAILURE
 *     therefore requires a tool that never produces a usable artifact (the
 *     scripted tool below always fails), which also has the nice property
 *     of matching this test's real intent: an agent stuck calling a broken
 *     tool must still be bounded by `maxIterations`.
 *   - Getting a genuine cap exhaustion at all (rather than an early
 *     graceful `end_turn`) requires VARYING tool-call args each turn: the
 *     kernel's `repetitionGuard` (`packages/reasoning/src/kernel/
 *     capabilities/act/guard.ts`) detects identical-args tool-call loops
 *     and cuts them off early — see `tool-loop-behavioral.test.ts`'s
 *     skipped `"agent exceeds max iterations when tool calls never
 *     terminate"` test and its note, which first scoped this exact
 *     problem. Each scripted turn below calls the loop tool with a
 *     distinct argument.
 *   - Two OTHER kernel guards can also intervene before the cap on a
 *     longer run — the token-delta diminishing-returns guard
 *     (`iterate-pass.ts`, tier default 500-token / 2-consecutive-low-delta
 *     threshold) and the "no-new-evidence" same-tool-name loop guard
 *     (`loop-detector.ts`, floor of 3 consecutive same-named-tool calls
 *     with no successful observation). Both only engage once several
 *     iterations have elapsed (`iteration >= 3`), so this file keeps
 *     `maxIterations` small (1-2) to stay unambiguously below either
 *     threshold and isolate the ONE mechanism under test.
 *
 * `agent.run()`'s throw contract on `terminatedBy:"max_iterations"` differs
 * by builder shape (`packages/runtime/src/reactive-agent.ts` ~line 830-869,
 * `BARE_BUILDER_THROWS_ON`):
 *   - bare builder (no `.withReasoning()`)      → run() REJECTS (throws
 *     `ExecutionError`, preserving the pre-Move-1 inline-arm contract for
 *     legacy bare-builder callers).
 *   - explicit `.withReasoning(...)` builder     → run() RESOLVES with
 *     `result.success === false`, `result.terminatedBy === "max_iterations"`
 *     (the kernel's own long-standing contract, unchanged by Move 1).
 * Both shapes are covered below.
 */

import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { ReactiveAgents } from "../src/builder.js";

function makeToolDef(name: string) {
  return {
    name,
    description: `Tool ${name}`,
    parameters: [
      {
        name: "input",
        type: "string" as const,
        description: "Input",
        required: true,
      },
    ],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
  };
}

/** N scripted tool-call turns, each with a DISTINCT arg so the kernel's
 * repetition guard doesn't short-circuit the loop before the cap. */
function varyingLoopTurns(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    toolCall: { name: "loop-tool", args: { input: `loop-${i + 1}` } },
  }));
}

/**
 * `loop-tool` always FAILS. A tool that succeeds gives the kernel a usable
 * artifact to synthesize into a "completed" answer even after
 * `terminatedBy:"max_iterations"` (see the module doc-comment) — an
 * always-failing tool has no such rescue, so a genuine cap exhaustion
 * surfaces as a real failure end-to-end.
 */
function makeLoopTools(calls: string[]) {
  return {
    tools: [
      {
        definition: makeToolDef("loop-tool"),
        handler: (args: Record<string, unknown>) => {
          calls.push(args.input as string);
          return Effect.fail(new Error("loop-tool always fails"));
        },
      },
    ],
  };
}

describe("withMaxIterations enforcement (real kernel arm)", () => {
  it("bare builder: throws with the configured cap value at maxIterations=1", async () => {
    const calls: string[] = [];
    const agent = await ReactiveAgents.create()
      .withName("max-iter-bare-1")
      .withMaxIterations(1)
      .withTestScenario(varyingLoopTurns(1))
      .withTools(makeLoopTools(calls))
      .build();

    let threw = false;
    let message = "";
    try {
      await agent.run("call the broken tool");
    } catch (e) {
      threw = true;
      message = (e as Error).message;
    } finally {
      await agent.dispose();
    }

    // A bare (no `.withReasoning()`) builder preserves the pre-Move-1
    // contract: `terminatedBy:"max_iterations"` re-throws at the run()
    // boundary (reactive-agent.ts `BARE_BUILDER_THROWS_ON`). Note: with no
    // usable tool output to synthesize, the run also trips the empty-output
    // invariant, which OVERWRITES the raw arbitrator message with a generic
    // "no verified deliverable" string before it reaches the caller — so
    // this test proves the throw itself, not the message text (see the
    // `.withReasoning()` case below for a structured, message-independent
    // proof that the CONFIGURED value is what determined the failure
    // point).
    expect(threw).toBe(true);
    expect(message.length).toBeGreaterThan(0);
  });

  it("withReasoning({ maxIterations }) builder: resolves (does not throw) with terminatedBy:\"max_iterations\" (IC-2 behavioral)", async () => {
    // Explicit .withReasoning() builders get the kernel's own long-standing
    // contract: a cap exhaustion is a graceful success:false result, not a
    // rejected promise (reactive-agent.ts BARE_BUILDER_THROWS_ON only
    // applies to bare builders). This also re-proves the W4 bug fix (IC-2):
    // withReasoning({ maxIterations }) must actually stop the loop at that
    // count, not just set the builder field (see the sync test below).
    const calls: string[] = [];
    const agent = await ReactiveAgents.create()
      .withName("max-iter-reasoning-2")
      .withReasoning({ maxIterations: 2 })
      .withTestScenario(varyingLoopTurns(2))
      .withTools(makeLoopTools(calls))
      .build();

    let result: Awaited<ReturnType<typeof agent.run>> | undefined;
    let threw = false;
    try {
      result = await agent.run("call the broken tool");
    } catch {
      threw = true;
    } finally {
      await agent.dispose();
    }

    expect(threw).toBe(false);
    expect(result).toBeDefined();
    expect(result!.success).toBe(false);
    expect((result as unknown as { terminatedBy?: string }).terminatedBy).toBe(
      "max_iterations",
    );
    expect(calls.length).toBeGreaterThan(0);
  }, 15000);

  it("withReasoning({ maxIterations }) builder: a smaller configured cap fails in fewer reasoning steps", async () => {
    // Structured, message-independent proof that the CONFIGURED value —
    // not a hardcoded number — determines the failure point: a run capped
    // at maxIterations=1 must record strictly fewer reasoning steps
    // (result.metadata.stepsCount) than an otherwise-identical run capped
    // at maxIterations=2, and both must fail with terminatedBy:
    // "max_iterations".
    async function runCapped(maxIterations: number) {
      const calls: string[] = [];
      const agent = await ReactiveAgents.create()
        .withName(`max-iter-cap-${maxIterations}`)
        .withReasoning({ maxIterations })
        .withTestScenario(varyingLoopTurns(maxIterations))
        .withTools(makeLoopTools(calls))
        .build();
      try {
        return await agent.run("call the broken tool");
      } finally {
        await agent.dispose();
      }
    }

    const small = await runCapped(1);
    const large = await runCapped(2);

    expect((small as unknown as { terminatedBy?: string }).terminatedBy).toBe(
      "max_iterations",
    );
    expect((large as unknown as { terminatedBy?: string }).terminatedBy).toBe(
      "max_iterations",
    );
    expect(small.success).toBe(false);
    expect(large.success).toBe(false);
    expect(large.metadata.stepsCount).toBeGreaterThan(small.metadata.stepsCount);
  }, 15000);

  it("withReasoning({ maxIterations: 2 }) propagates to _maxIterations on the builder (IC-2)", () => {
    // Reproduces the W4 bug: withReasoning() stores options.maxIterations in
    // _reasoningOptions but never assigns it to _maxIterations.
    // withMaxIterations(2) correctly sets _maxIterations; withReasoning({ maxIterations: 2 }) must too.
    const builder = ReactiveAgents.create()
      .withName("ic2-test")
      .withReasoning({ maxIterations: 2 });

    // Before fix: _maxIterations is the default (not 2) → test fails.
    // After fix: _maxIterations === 2 → test passes.
    expect((builder as any)._maxIterations).toBe(2);
  });

  it("normal completion does not throw when the model produces a real final answer", async () => {
    // Sanity check: the OPPOSITE condition — the model ends cleanly with no
    // tool calls, so the loop must complete well under the cap.
    const agent = await ReactiveAgents.create()
      .withName("max-iter-completion")
      .withMaxIterations(5)
      .withTestScenario([{ text: "FINAL ANSWER: Task is done." }])
      .build();

    let result: Awaited<ReturnType<typeof agent.run>> | undefined;
    try {
      result = await agent.run("say hello");
    } finally {
      await agent.dispose();
    }

    expect(result?.success).toBe(true);
  });
});
