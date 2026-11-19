// Run: bun test packages/runtime/tests/calibration-mode-forwarding.test.ts --timeout 15000
/**
 * Adaptive-harness audit (2026-11-19): `.withCalibration("skip")` must disable
 * calibration end to end. The runtime half: every ReasoningService.execute
 * request carries `calibrationMode` ("skip" only for an explicit skip), never a
 * resolved calibration object under skip, and `providerName`. The run-started
 * trace records the skip and the default-off act-or-answer source.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { loadTrace } from "@reactive-agents/trace";
import { generateAgentId, generateTaskId, type Task } from "@reactive-agents/core";
import { ReactiveAgents } from "../src";
import { ExecutionEngine, ExecutionEngineLive, LifecycleHookRegistryLive } from "../src/index";
import { defaultReactiveAgentsConfig, type ReactiveAgentsConfig } from "../src/types";
import { calibrationRequestFields } from "../src/engine/phases/agent-loop/setup/calibration";
import { makeModelCalibration } from "../src/testing/index";

const ROOT = mkdtempSync(join(tmpdir(), "ra-cal-mode-"));
const PRIOR = process.env.REACTIVE_AGENTS_TRACE_DIR;
beforeAll(() => {
  process.env.REACTIVE_AGENTS_TRACE_DIR = ROOT;
});
afterAll(() => {
  if (PRIOR === undefined) delete process.env.REACTIVE_AGENTS_TRACE_DIR;
  else process.env.REACTIVE_AGENTS_TRACE_DIR = PRIOR;
  rmSync(ROOT, { recursive: true, force: true });
});

const cal = makeModelCalibration({ modelId: "test-model" });

describe("calibrationRequestFields", () => {
  test("skip: mode skip, no calibration object even if one was resolved", () => {
    expect(calibrationRequestFields({ calibration: "skip" }, cal)).toEqual({ calibrationMode: "skip", calibration: undefined });
  });
  test("auto / object / unset: mode auto, resolved value unchanged", () => {
    expect(calibrationRequestFields({ calibration: "auto" }, cal)).toEqual({ calibrationMode: "auto", calibration: cal });
    expect(calibrationRequestFields({ calibration: cal }, cal)).toEqual({ calibrationMode: "auto", calibration: cal });
    expect(calibrationRequestFields({}, undefined)).toEqual({ calibrationMode: "auto", calibration: undefined });
  });
});

type ExecuteParams = Record<string, unknown>;
const ReasoningStubTag = Context.GenericTag<{ execute: (p: ExecuteParams) => Effect.Effect<unknown> }>("ReasoningService");

const task: Task = {
  id: generateTaskId(),
  agentId: generateAgentId(),
  type: "query",
  input: { question: "What is 2 + 2?" },
  priority: "medium",
  status: "pending",
  metadata: { tags: [] },
  createdAt: new Date(),
};

async function captureExecute(overrides: Partial<ReactiveAgentsConfig>): Promise<ExecuteParams> {
  const captured: ExecuteParams[] = [];
  const stub = {
    execute: (p: ExecuteParams) => {
      captured.push(p);
      return Effect.succeed({
        output: "4",
        status: "completed",
        steps: [{ id: "s1", type: "thought", content: "x" }],
        metadata: { cost: 0, tokensUsed: 1, stepsCount: 1 },
      });
    },
  };
  const config = defaultReactiveAgentsConfig("agent-cal-mode", {
    provider: "test",
    defaultModel: "gemma4:e4b",
    ...overrides,
  });
  const hooks = LifecycleHookRegistryLive;
  const layer = Layer.mergeAll(hooks, ExecutionEngineLive(config).pipe(Layer.provide(hooks)), Layer.succeed(ReasoningStubTag, stub));
  await Effect.runPromise(
    Effect.gen(function* () {
      const engine = yield* ExecutionEngine;
      yield* engine.execute(task);
    }).pipe(Effect.provide(layer)),
  );
  expect(captured.length).toBeGreaterThanOrEqual(1);
  return captured[0]!;
}

describe("engine forwards calibrationMode on the reasoning request", () => {
  test("skip: calibrationMode skip, no calibration object, providerName present", async () => {
    const req = await captureExecute({ calibration: "skip" });
    expect(req["calibrationMode"]).toBe("skip");
    expect(req["calibration"]).toBeUndefined();
    expect(req["providerName"]).toBe("test");
  });

  test("auto: calibrationMode auto with the resolved shipped calibration (unchanged)", async () => {
    const req = await captureExecute({ calibration: "auto" });
    expect(req["calibrationMode"]).toBe("auto");
    expect(req["calibration"]).toBeDefined();
    expect(req["providerName"]).toBe("test");
  });

  test("explicit ModelCalibration object: mode auto, the object is forwarded", async () => {
    const req = await captureExecute({ calibration: cal });
    expect(req["calibrationMode"]).toBe("auto");
    expect(req["calibration"]).toBe(cal);
  });
});

describe("builder -> run-started trace", () => {
  type StartedConfig = {
    builder: Record<string, unknown>;
    mechanisms: Record<string, unknown>;
    calibration?: { mode: string; tiers: readonly string[]; fields: Record<string, unknown> };
  };
  const runStarted = async (calibration: "auto" | "skip"): Promise<StartedConfig> => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .withModel("gemma4:e4b")
      .withCalibration(calibration)
      .withReasoning({ defaultStrategy: "reactive" })
      .build();
    const result = await agent.run("calibration mode pin");
    await agent.dispose();
    const started = (await loadTrace(result.metadata.tracePath!)).events.find((e) => e.kind === "run-started");
    if (started?.kind !== "run-started") throw new Error("no run-started");
    return started.config as StartedConfig;
  };

  test("withCalibration('skip') is recorded as skip with no resolved fields; actOrAnswerSource is default-off", async () => {
    const cfg = await runStarted("skip");
    expect(cfg.builder.calibration).toBe("skip");
    expect(cfg.calibration).toEqual({ mode: "skip", tiers: [], fields: {} });
    expect(cfg.mechanisms.actOrAnswerSource).toBe("default-off");
  }, 15000);

  test("auto records the resolved calibration fields", async () => {
    const cfg = await runStarted("auto");
    expect(cfg.calibration?.mode).toBe("auto");
    expect(Object.keys(cfg.calibration?.fields ?? {}).length).toBeGreaterThan(0);
  }, 15000);
});
