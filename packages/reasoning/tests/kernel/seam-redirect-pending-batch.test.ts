// Run: bun test packages/reasoning/tests/kernel/seam-redirect-pending-batch.test.ts --timeout 20000
//
// The kernel side of the RI tool-failure-redirect fix (lh-a0 baseline
// 2026-11-06, cogito lh-pipeline-stages r0, run 01M6REXPKJXWABQ9WB081BTBCR):
// two file-reads failed in ONE batch and counted as a 2-streak, and the
// observer evaluated the controller after the model's next think without
// saying which calls were about to run, so RI early-stopped a batch of 4
// file-writes that never called file-read.
//
// Pins:
//   (c) the streak counts batches (assistant turns), not results: two failed
//       results from one batch are streak 1;
//   (w) the observer hands the controller the names of the pending batch
//       (`pendingToolNames`) on the default runPass path, and omits the field
//       when no batch is pending.
//
// RED-ON-CUT (shown during the mission, then restored):
//   - drop the batch boundary in reflect/tool-failure-streak.ts: (c) fails
//     (streak 2 for one batch);
//   - drop the `pendingToolNames` spread in reflect/reactive-observer.ts: (w)
//     fails (no evaluation sees the pending file-write).
import { describe, it, expect } from "bun:test";
import { Context, Effect, Layer, Option } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EntropySensorService, EventBusLive } from "@reactive-agents/core";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import { runReactiveObserver } from "../../src/kernel/capabilities/reflect/reactive-observer.js";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { makeKernelState, makeStrategyServices } from "../../src/testing/kernel-fixtures.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { toolFailureStreak } from "../../src/kernel/capabilities/reflect/tool-failure-streak.js";
import type { KernelMessage, KernelRunOptions } from "../../src/kernel/state/kernel-state.js";

const assistant = (...names: string[]): KernelMessage => ({
  role: "assistant",
  content: "",
  toolCalls: names.map((name, i) => ({ id: `${name}-${i}`, name, arguments: {} })),
});
const result = (id: string, toolName: string, isError: boolean): KernelMessage => ({
  role: "tool_result",
  toolCallId: id,
  toolName,
  content: isError ? "ENOENT" : "ok",
  ...(isError ? { isError: true } : {}),
});

describe("(c) the tool-failure streak counts batches", () => {
  it("the lh r0 batch (9 reads ok, 2 reads failed) is streak 1", () => {
    const batch = [
      assistant(...Array.from({ length: 11 }, () => "file-read")),
      ...Array.from({ length: 9 }, (_, i) => result(`ok${i}`, "file-read", false)),
      result("clean", "file-read", true),
      result("by-region", "file-read", true),
    ];
    expect(toolFailureStreak(batch)).toEqual({ count: 1, toolName: "file-read" });
  });

  it("one failure in each of two batches is streak 2", () => {
    const msgs = [
      assistant("file-read"),
      result("a", "file-read", true),
      { role: "user" as const, content: "progress: 0 of 3 files written" },
      assistant("file-read", "file-read"),
      result("b", "file-read", true),
      result("c", "file-read", true),
    ];
    expect(toolFailureStreak(msgs)).toEqual({ count: 2, toolName: "file-read" });
  });

  it("a success in the trailing batch still ends the streak", () => {
    const msgs = [assistant("file-read"), result("a", "file-read", true), assistant("file-read", "file-read"), result("b", "file-read", true), result("c", "file-read", false)];
    expect(toolFailureStreak(msgs)).toEqual({ count: 0, toolName: undefined });
  });
});

// ── (w) wiring ────────────────────────────────────────────────────────────────

const entropyScore = {
  composite: 0.5,
  sources: { token: 0, structural: 0.5, semantic: 0, behavioral: 0, contextPressure: 0 },
  trajectory: { derivative: 0, shape: "flat" as const, momentum: 0 },
  confidence: "medium" as const,
  modelTier: "local" as const,
  iteration: 0,
  iterationWeight: 1,
  timestamp: 0,
};
const calibration = { modelId: "test", calibrated: false, sampleCount: 0, highEntropyThreshold: 0.8, convergenceThreshold: 0.4, driftDetected: false };
const entropySensor: EntropySensorService["Type"] = {
  score: () => Effect.succeed(entropyScore),
  scoreContext: () => Effect.succeed({ utilizationPct: 0, sections: [], atRiskSections: [], compressionHeadroom: 1 }),
  getCalibration: () => Effect.succeed(calibration),
  updateCalibration: () => Effect.succeed(calibration),
  getTrajectory: () => Effect.succeed({ history: [], derivative: 0, momentum: 0, shape: "flat" as const }),
};

type EvalParams = {
  readonly consecutiveToolFailures?: number;
  readonly failingToolName?: string;
  readonly pendingToolNames?: readonly string[];
};
type Decision = { readonly decision: string; readonly reason: string };
const ControllerTag = Context.GenericTag<{ readonly evaluate: (p: EvalParams) => Effect.Effect<readonly Decision[]> }>("ReactiveControllerService");

const READ = { name: "file-read", description: "read", parameters: [{ name: "path", type: "string", required: true }] };
const WRITE = {
  name: "file-write",
  description: "write",
  parameters: [{ name: "path", type: "string", required: true }, { name: "content", type: "string", required: true }],
};

describe("(w) the observer hands the pending batch to the controller", () => {
  it("default runPass path: the evaluation after the file-write think sees pendingToolNames", async () => {
    const seen: EvalParams[] = [];
    const tools = mockToolServiceLayer({
      execute: (req) =>
        Effect.succeed(
          req.toolName === "file-read"
            ? { success: false, result: "File read failed: ENOENT" }
            : { success: true, result: { ok: true } },
        ),
    });
    const controller = Layer.succeed(ControllerTag, {
      evaluate: (p: EvalParams) => {
        seen.push(p);
        return Effect.succeed([]);
      },
    });
    await Effect.runPromise(
      runPass(
        reactKernel,
        { task: "Write clean.csv", availableToolSchemas: [READ, WRITE] },
        { maxIterations: 8, strategy: "reactive", kernelType: "react", taskId: "redirect-pending-batch" },
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            TestLLMServiceLayer([
              { toolCalls: [{ id: "r1", name: "file-read", args: { path: "clean.csv" } }] },
              { toolCalls: [{ id: "r2", name: "file-read", args: { path: "by-region.json" } }] },
              { toolCalls: [{ id: "w1", name: "file-write", args: { path: "clean.csv", content: "order_id" } }] },
              { text: "FINAL ANSWER: wrote clean.csv." },
            ]),
            tools,
            EventBusLive,
            Layer.succeed(EntropySensorService, entropySensor),
            controller,
          ),
        ),
      ),
    );
    // The think that emitted the file-write is evaluated with the batch pending
    // and the 2-batch file-read streak still trailing.
    expect(seen).toContainEqual(
      expect.objectContaining({ pendingToolNames: ["file-write"], consecutiveToolFailures: 2, failingToolName: "file-read" }),
    );
    // Post-act evaluations carry no pending batch.
    expect(seen.some((p) => p.pendingToolNames === undefined)).toBe(true);
    expect(seen.every((p) => p.pendingToolNames === undefined || p.pendingToolNames.length > 0)).toBe(true);
  }, 20000);

  it("observer unit: names come from meta.pendingNativeToolCalls; absent when none", async () => {
    const capture = async (pending: readonly string[] | undefined) => {
      let captured: Record<string, unknown> = {};
      const services = makeStrategyServices({
        entropySensor: Option.some(entropySensor),
        reactiveController: Option.some({
          evaluate: (params) => {
            captured = params;
            return Effect.succeed([]);
          },
        }),
      });
      const state = makeKernelState({
        taskId: "observer-pending",
        strategy: "reactive",
        kernelType: "react",
        steps: [makeStep("thought", "write the outputs", {})],
        iteration: 3,
        meta: {
          entropy: { modelId: "test", entropyHistory: [entropyScore] },
          ...(pending ? { pendingNativeToolCalls: pending.map((name, i) => ({ id: `c${i}`, name, arguments: {} })) } : {}),
        },
      });
      const options: KernelRunOptions = { maxIterations: 10, strategy: "reactive", kernelType: "react", modelId: "test" };
      await Effect.runPromise(runReactiveObserver(state, services, Option.none(), 0, options, "local"));
      return captured;
    };
    expect((await capture(["file-write", "recall"]))["pendingToolNames"]).toEqual(["file-write", "recall"]);
    expect(await capture(undefined)).not.toHaveProperty("pendingToolNames");
    expect(await capture([])).not.toHaveProperty("pendingToolNames");
  });
});
