// Run: bun test packages/reasoning/tests/kernel/loop/judgment-comprehend-shadow-wiring.test.ts --timeout 15000
//
// Task 10 (shadow-only) wiring test — `runKernel` fires the batched judgment
// comprehend-classification shadow unconditionally, every run, via
// `Effect.forkDaemon`. This must NEVER alter the kernel's real output/status
// (zero behavior change), must fire exactly once per `ask()` for a small tool
// roster, and must chunk into multiple `ask()` calls above CHUNK_CAP=30.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBusLive, EventBus } from "@reactive-agents/core";
import type { AgentEvent } from "@reactive-agents/core";
import { JudgmentService } from "@reactive-agents/judgment";
import type { JudgmentAnswers } from "@reactive-agents/judgment";
import { runKernel } from "../../../src/kernel/loop/runner.js";
import { transitionState, type ThoughtKernel } from "../../../src/kernel/state/kernel-state.js";

type ShadowEvent = Extract<AgentEvent, { _tag: "JudgmentShadow" }>;

/** Kernel that finishes immediately — isolates the runner's own pre-loop shadow wiring from kernel logic. */
const doneKernel: ThoughtKernel = (state) =>
  Effect.succeed(
    transitionState(state, {
      status: "done",
      output: "Paris",
      iteration: state.iteration + 1,
    }),
  );

let askCallCount = 0;

const fakeJudgmentAnswering = () => {
  askCallCount = 0;
  return Layer.succeed(JudgmentService, {
    ask: (input) => {
      askCallCount++;
      const answers: Record<string, unknown> = {};
      for (const id of Object.keys(input.questions)) {
        answers[id] =
          id === "complexity"
            ? { kind: "score", value: 0, probabilities: {}, confidence: 0.9, calibrated: true }
            : id === "output-format"
              ? { kind: "choice", value: "prose", probabilities: {}, confidence: 0.9, calibrated: true }
              : { kind: "noul", probability: 0.1 };
      }
      return Effect.succeed(answers as unknown as JudgmentAnswers<typeof input.questions>);
    },
  } satisfies JudgmentService["Type"]);
};

const runWithShadowCapture = async (
  availableToolSchemas: readonly { readonly name: string; readonly description: string; readonly parameters: readonly [] }[],
  withJudgment: boolean,
) => {
  const captured: ShadowEvent[] = [];
  const llmLayer = TestLLMServiceLayer();
  const judgmentLayer = withJudgment ? fakeJudgmentAnswering() : undefined;
  const baseLayer = judgmentLayer
    ? Layer.merge(Layer.merge(llmLayer, EventBusLive), judgmentLayer)
    : Layer.merge(llmLayer, EventBusLive);

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const eb = yield* EventBus;
      yield* eb.on("JudgmentShadow", (event) => Effect.sync(() => { captured.push(event); }));

      const kernelResult = yield* runKernel(
        doneKernel,
        { task: "What is the capital of France?", availableToolSchemas },
        { maxIterations: 10, strategy: "test", kernelType: "test" },
      );

      // Cooperatively yield so the forkDaemon shadow fiber (fake backend is
      // synchronous) settles before this Effect completes.
      yield* Effect.sleep("50 millis");

      return kernelResult;
    }).pipe(Effect.provide(baseLayer)),
  );

  return { result, captured };
};

describe("runKernel judgment comprehend shadow wiring (Task 10, shadow-only)", () => {
  it("zero behavior change: real kernel output/status identical with JudgmentService present", async () => {
    const { result } = await runWithShadowCapture([], true);
    expect(result.status).toBe("done");
    expect(result.output).toBe("Paris");
  }, 15000);

  it("zero behavior change: real kernel output/status identical with JudgmentService absent", async () => {
    const { result } = await runWithShadowCapture([], false);
    expect(result.status).toBe("done");
    expect(result.output).toBe("Paris");
  }, 15000);

  it("small tool roster (3 tools): single ask() call, one shadow event per question", async () => {
    const tools = [
      { name: "tool-a", description: "a", parameters: [] as const },
      { name: "tool-b", description: "b", parameters: [] as const },
      { name: "tool-c", description: "c", parameters: [] as const },
    ];
    const { captured } = await runWithShadowCapture(tools, true);

    expect(askCallCount).toBe(1);
    expect(captured.length).toBe(8); // 5 base + 3 tool nouls
    for (const e of captured) {
      expect(e.site).toBe("task-comprehension");
    }
  }, 15000);

  it("large tool roster (40 tools) above CHUNK_CAP=30: chunks into 2 ask() calls", async () => {
    const tools = Array.from({ length: 40 }, (_, i) => ({
      name: `tool-${i}`,
      description: `tool ${i}`,
      parameters: [] as const,
    }));
    const { captured } = await runWithShadowCapture(tools, true);

    expect(askCallCount).toBe(2);
    expect(captured.length).toBe(45); // 5 base + 40 tool nouls
  }, 15000);

  it("JudgmentService entirely absent: no shadow events, no crash", async () => {
    const { captured } = await runWithShadowCapture([], false);
    expect(captured.length).toBe(0);
  }, 15000);
});
