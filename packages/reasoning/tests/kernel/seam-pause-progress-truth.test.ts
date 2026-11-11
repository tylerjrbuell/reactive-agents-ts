/**
 * seam-pause-progress-truth.test.ts — observer-truth pins (Cortex QA 2026-11-11).
 *
 *   1. A run paused for approval (detach policy) publishes NO FinalAnswerProduced:
 *      the pause sentinel "Run paused — awaiting human approval." is not an answer.
 *      The pause itself still rides `rawTerminatedBy` / `awaitingApprovalFor`.
 *   2. ReasoningIterationProgress fires once per kernel iteration, 1-based, even
 *      when a tool turn spans two passes (think → acting, then act → iteration+1).
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBus, type AgentEvent } from "@reactive-agents/core";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { ToolService, createToolsLayer } from "@reactive-agents/tools";
import { executeReactive } from "../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope, buildRunEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import { runKernel } from "../../src/kernel/loop/runner.js";
import { transitionState, type ThoughtKernel } from "../../src/kernel/state/kernel-state.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";

const PRIOR_LAZY = process.env.RA_LAZY_TOOLS;
beforeAll(() => { process.env.RA_LAZY_TOOLS = "0"; });
afterAll(() => {
  if (PRIOR_LAZY === undefined) delete process.env.RA_LAZY_TOOLS;
  else process.env.RA_LAZY_TOOLS = PRIOR_LAZY;
});

type Recorded = Readonly<Record<string, unknown>> & { readonly _tag: string };
const record = (event: AgentEvent): Recorded => ({ ...event });

function recordingBus(): { events: Recorded[]; layer: Layer.Layer<EventBus> } {
  const events: Recorded[] = [];
  const bus: EventBus["Type"] = {
    publish: (event) => {
      events.push(record(event));
      return Effect.void;
    },
    subscribe: () => Effect.succeed(() => {}),
    on: () => Effect.succeed(() => {}),
  };
  return { events, layer: Layer.succeed(EventBus, bus) };
}

const tagged = (events: readonly Recorded[], tag: string) => events.filter((e) => e._tag === tag);

const addToolDef = {
  name: "add",
  description: "Add two numbers together",
  parameters: [
    { name: "a", type: "number" as const, description: "First number", required: true },
    { name: "b", type: "number" as const, description: "Second number", required: true },
  ],
  riskLevel: "low" as const,
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function" as const,
};

const testConfig = {
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: { maxIterations: 5, temperature: 0.7 },
  },
};

function runAdd(detach: boolean) {
  const { events, layer } = recordingBus();
  const llm = TestLLMServiceLayer([
    { match: "step by step", toolCall: { name: "add", args: { a: 2, b: 3 } } },
    { match: "Observation", text: "FINAL ANSWER: 5." },
  ]);
  const program = Effect.gen(function* () {
    const tools = yield* ToolService;
    yield* tools.register(addToolDef, (args) => Effect.succeed((args.a as number) + (args.b as number)));
    return yield* executeReactive({
      taskDescription: "Add the numbers 2 and 3",
      taskType: "computation",
      memoryContext: "",
      availableTools: ["add"],
      config: testConfig,
    });
  });
  const provided = program.pipe(Effect.provide(Layer.mergeAll(llm, createToolsLayer(), layer)));
  const run = detach
    ? provideTestEnvelope(provided, buildRunEnvelope({ approvalPolicy: { mode: "detach", tools: new Set(["add"]) } }))
    : provideTestEnvelope(provided);
  return Effect.runPromise(run).then((result) => ({ result, events }));
}

describe("paused run publishes no FinalAnswerProduced", () => {
  it("detach approval pause: zero FinalAnswerProduced, pause still carried on metadata", async () => {
    const { result, events } = await runAdd(true);
    const meta = result.metadata as { rawTerminatedBy?: string; awaitingApprovalFor?: { toolName: string } };
    expect(meta.rawTerminatedBy).toBe("awaiting-approval");
    expect(meta.awaitingApprovalFor?.toolName).toBe("add");
    expect(tagged(events, "FinalAnswerProduced")).toHaveLength(0);
  });

  it("control: the same run without a policy still publishes its final answer", async () => {
    const { events } = await runAdd(false);
    expect(tagged(events, "FinalAnswerProduced").length).toBeGreaterThanOrEqual(1);
  });
});

describe("ReasoningIterationProgress — once per iteration, 1-based", () => {
  it("N tool iterations spanning think+act passes emit exactly N events, iterations 1..N", async () => {
    const N = 3;
    // Two passes per iteration: think (status acting, no bump) then act
    // (action step appended, iteration + 1). The last act ends the run.
    const kernel: ThoughtKernel = (state) => {
      if (state.status === "thinking") return Effect.succeed(transitionState(state, { status: "acting" }));
      const next = state.iteration + 1;
      return Effect.succeed(
        transitionState(state, {
          status: next >= N ? "done" : "thinking",
          ...(next >= N ? { output: "finished" } : {}),
          iteration: next,
          steps: [...state.steps, makeStep("action", `probe-${next}()`, { toolUsed: `probe-${next}` })],
        }),
      );
    };
    const { events, layer } = recordingBus();
    await Effect.runPromise(
      runKernel(kernel, { task: "progress truth" }, { maxIterations: 10, strategy: "reactive", kernelType: "react" }).pipe(
        Effect.provide(Layer.merge(TestLLMServiceLayer(), layer)),
      ),
    );
    const progress = tagged(events, "ReasoningIterationProgress");
    expect(progress.map((e) => e.iteration)).toEqual([1, 2, 3]);
    expect(progress.map((e) => e.toolsThisStep)).toEqual([["probe-1"], ["probe-2"], ["probe-3"]]);
  });
});
