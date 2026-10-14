// Run: bun test packages/runtime/tests/partial-outstanding-not-success.test.ts --timeout 15000
/**
 * Wave 5 FOLD (W5 kernel review, Important 2): the W5.1 contract-coverage cap
 * ships result `partial` + `metadata.outstandingCriteria`, but the engine's
 * coarse mapping `partial + substantive output => success:true`
 * (execution-engine.ts, the reactive tolerance lane) let a tool-coverage S3
 * shape still report `success: true` to the user. The lift metric
 * ("S3 false-success -> 0") must reach the user-visible bit, not just the
 * verdict lane.
 *
 * Resolved invariant (chosen: envelope-authority, NOT blanket partial=>false):
 * success requires the terminal's envelope authority to support the claim:
 * a run whose contract evidence partition still names OUTSTANDING requirements
 * is not a success, whatever the prose. The documented partial+substantive
 * TOLERANCE lane (no declared contract, e.g. reactive partial with a usable
 * final string) is kept byte-identical: an uncapped partial with nothing
 * outstanding still succeeds. This keeps every non-contract run unchanged
 * while closing the false-success route the cap opened.
 *
 * Harness: the stubbed-ReasoningService engine pattern from
 * verification-retry-routes-through-kernel.test.ts (same Context key so the
 * engine's serviceOption resolves the stub).
 */
import { describe, it, expect } from "bun:test";
import { Context, Effect, Layer } from "effect";
import {
  ExecutionEngine,
  ExecutionEngineLive,
  LifecycleHookRegistryLive,
} from "../src/index.js";
import { defaultReactiveAgentsConfig, type ReactiveAgentsConfig } from "../src/types.js";
import { generateAgentId, generateTaskId, type Task } from "@reactive-agents/core";

type ExecuteParams = Record<string, unknown>;
type ExecuteResult = {
  output: unknown;
  status: string;
  steps?: readonly { id: string; type: string; content: string }[];
  metadata: Record<string, unknown>;
};

const ReasoningServiceStubTag = Context.GenericTag<{
  execute: (params: ExecuteParams) => Effect.Effect<ExecuteResult>;
}>("ReasoningService");

function task(input: string): Task {
  return {
    id: generateTaskId(),
    agentId: generateAgentId(),
    type: "query",
    input: { question: input },
    priority: "medium",
    status: "pending",
    metadata: { tags: [] },
    createdAt: new Date(),
  };
}

/** Run the stubbed engine once; return the TaskResult. */
async function runWithStubbedTerminal(
  terminal: ExecuteResult,
  overrides?: Partial<ReactiveAgentsConfig>,
) {
  const stubReasoning = {
    execute: () => Effect.succeed(terminal),
  };
  const MockReasoning = Layer.succeed(ReasoningServiceStubTag, stubReasoning);
  const hookLayer = LifecycleHookRegistryLive;
  const config = defaultReactiveAgentsConfig("agent-partial-fold", {
    ...overrides,
  });
  const engineLayer = ExecutionEngineLive(config).pipe(Layer.provide(hookLayer));
  const testLayer = Layer.mergeAll(hookLayer, engineLayer, MockReasoning);

  return Effect.runPromise(
    Effect.gen(function* () {
      const engine = yield* ExecutionEngine;
      return yield* engine.execute(task("what does the coverage-capped run ship?"));
    }).pipe(Effect.provide(testLayer)),
  );
}

const SUBSTANTIVE =
  "The report lists Widget 1200, Gadget 800 and Gizmo 500 units shipped this quarter.";

describe("Contract-outstanding partial must not map to success (W5 fold)", () => {
  it("RED-ON-CUT: partial + substantive output + outstandingCriteria => success:false", async () => {
    const result = await runWithStubbedTerminal({
      output: SUBSTANTIVE,
      status: "partial",
      steps: [{ id: "s1", type: "thought", content: "answered from memory" }],
      metadata: {
        cost: 0,
        tokensUsed: 40,
        stepsCount: 1,
        outstandingCriteria: ["tool:file-read"],
      },
    });
    // At HEAD the coarse bit is true (partial + substantive tolerance lane);
    // after the fold the outstanding partition vetoes it.
    expect(result.success).toBe(false);
    // The cap evidence must REACH the user (it was silently dropped at the
    // engine boundary before this fold, alongside the success flip).
    expect((result.metadata as Record<string, unknown>).outstandingCriteria).toEqual([
      "tool:file-read",
    ]);
  }, 15000);

  it("tolerance lane unchanged: uncapped partial + substantive, nothing outstanding => success:true", async () => {
    const result = await runWithStubbedTerminal({
      output: SUBSTANTIVE,
      status: "partial",
      steps: [{ id: "s1", type: "thought", content: "kernel did not reach done" }],
      metadata: { cost: 0, tokensUsed: 40, stepsCount: 1 },
    });
    expect(result.success).toBe(true);
  }, 15000);

  it("regression: completed terminal stays success:true byte-identically", async () => {
    const result = await runWithStubbedTerminal({
      output: SUBSTANTIVE,
      status: "completed",
      steps: [{ id: "s1", type: "thought", content: "done" }],
      metadata: { cost: 0, tokensUsed: 40, stepsCount: 1 },
    });
    expect(result.success).toBe(true);
  }, 15000);
});
