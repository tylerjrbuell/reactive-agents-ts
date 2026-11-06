// Run: bun test packages/reasoning/tests/kernel/capabilities/reflect/reactive-observer-progress-signal.test.ts --timeout 20000
//
// S2a (spike pack 2026-11-06, run 01M6Q83PG3QMPENNYM5PBRY6Y5): RI's overflow
// early-stop stopped cogito h3-todo-heavy runs at iteration 13 of 14 on flat
// entropy while they wrote one new file per pass. RI now stands down when
// `progressedThisPass` is true; this file pins that the kernel observer HANDS
// it over, on the default path (not gated on the long-horizon profile), from
// THIS pass's post-act assessment.
//
// RED-ON-CUT: delete the `progressedThisPass` spread in reactive-observer.ts's
// controller evaluate params and every "carries" assertion below fails.
import { Effect, Layer, Context, Option } from "effect";
import { describe, it, expect } from "bun:test";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EntropySensorService } from "@reactive-agents/core";
import { runReactiveObserver } from "../../../../src/kernel/capabilities/reflect/reactive-observer.js";
import type { KernelInput, KernelRunOptions, KernelState } from "../../../../src/kernel/state/kernel-state.js";
import type { StrategyServices } from "../../../../src/kernel/utils/service-utils.js";
import { makeStep } from "../../../../src/kernel/capabilities/sense/step-utils.js";
import { makeKernelState, makeRunContract, makeStrategyServices } from "../../../../src/testing/kernel-fixtures.js";
import { mockToolServiceLayer } from "../../../../src/testing/tool-service-mock.js";
import { assess } from "../../../../src/kernel/assessment/assess.js";
import { appendEntries, type RunLedger } from "../../../../src/kernel/ledger/run-ledger.js";
import { reactKernel } from "../../../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../../../src/kernel/loop/run-pass.js";

const entropyScore = {
  composite: 0.5,
  sources: { token: 0.3, structural: 0.4, semantic: 0.5, behavioral: 0.2, contextPressure: 0.1 },
  trajectory: { derivative: 0, shape: "flat" as const, momentum: 0 },
  confidence: "medium" as const,
  modelTier: "local" as const,
  iteration: 3,
  iterationWeight: 0.8,
  timestamp: Date.now(),
};

const calibration = {
  modelId: "test-model",
  calibrated: true,
  sampleCount: 25,
  highEntropyThreshold: 0.72,
  convergenceThreshold: 0.35,
  driftDetected: false,
};

const mockEntropySensor = {
  score: () => Effect.succeed(entropyScore),
  scoreContext: () => Effect.succeed({ utilizationPct: 0.5, sections: [], atRiskSections: [], compressionHeadroom: 0.5 }),
  getCalibration: () => Effect.succeed(calibration),
  updateCalibration: () => Effect.succeed(calibration),
  getTrajectory: () => Effect.succeed({ history: [], derivative: 0, momentum: 0, shape: "flat" as const }),
};

const options: KernelRunOptions = { maxIterations: 14, strategy: "reactive", kernelType: "react", modelId: "test-model" };

// ── Direct-import seam pin: the observer maps the assessment it is handed ──────

const contract = makeRunContract({});
const at = (iteration: number, ledger: RunLedger) =>
  assess(contract, ledger, { iteration, maxIterations: 14, tokensUsed: 0, costUsd: 0 });
const writeAt = (i: number): RunLedger =>
  appendEntries([], [
    { kind: "tool-invocation", iteration: i, toolName: "file-write", args: { path: `./f${i}.md`, content: "x" }, toolCallId: `w${i}` },
    { kind: "tool-result", iteration: i, toolName: "file-write", success: true, preview: `Wrote 1 bytes to ./f${i}.md`, toolCallId: `w${i}` },
  ]);
const probeAt = (i: number): RunLedger =>
  appendEntries([], [{ kind: "tool-result", iteration: i, toolName: "probe", success: true, preview: "No results found.", toolCallId: `p${i}` }]);

const captureEvalParams = async (assessment: KernelState["meta"]["assessment"]): Promise<Record<string, unknown>> => {
  let captured: Record<string, unknown> = {};
  const services: StrategyServices = makeStrategyServices({
    entropySensor: Option.some(mockEntropySensor),
    reactiveController: Option.some({
      evaluate: (params) => {
        captured = params;
        return Effect.succeed([]);
      },
    }),
  });
  const state = makeKernelState({
    taskId: "s2a-seam",
    strategy: "reactive",
    kernelType: "react",
    steps: [makeStep("thought", "Writing the next file", {})],
    iteration: 13,
    meta: {
      entropy: { modelId: "test-model", entropyHistory: [entropyScore] },
      ...(assessment ? { assessment } : {}),
    },
  });
  await Effect.runPromise(runReactiveObserver(state, services, Option.none(), 0, options));
  return captured;
};

describe("S2a: reactive-observer hands progressedThisPass to the controller (seam pin)", () => {
  it("carries true when the assessment shows new substantive evidence, without the long-horizon profile", async () => {
    const assessment = at(13, writeAt(13));
    expect(assessment.evidenceDelta).toBeGreaterThan(0);
    const params = await captureEvalParams(assessment);
    expect(params["progressedThisPass"]).toBe(true);
    // E2's phase stays long-horizon-gated; the progress signal is not.
    expect(params).not.toHaveProperty("phase");
  });

  it("carries false when the assessment shows no new evidence", async () => {
    const assessment = at(13, probeAt(13));
    expect(assessment.evidenceDelta).toBe(0);
    const params = await captureEvalParams(assessment);
    expect(params["progressedThisPass"]).toBe(false);
  });

  it("omits the field when the state carries no assessment (no compiled contract)", async () => {
    const params = await captureEvalParams(undefined);
    expect(params).not.toHaveProperty("progressedThisPass");
  });
});

// ── Live-path pin: timing — the observer reads THIS pass's post-act assessment ──

const P = (name: string) => ({ name, type: "string", required: true });
const SCHEMAS = [{ name: "file-write", description: "write a file", parameters: [P("path"), P("content")] }];

let padN = 0;
const pad = (): string => {
  padN += 1;
  return Array.from({ length: 120 }, (_, i) => `w${padN}y${i}`).join(" ");
};
const write = (n: number) => ({ text: pad(), toolCall: { name: "file-write", args: { path: `./part-${n}.md`, content: `part ${n}` } } });

describe("S2a: one new file per pass reads as progress on the live kernel path", () => {
  it("every file-writing pass hands progressedThisPass: true to the controller", async () => {
    const seen: { iteration: number; progressedThisPass: unknown }[] = [];
    const ControllerTag = Context.GenericTag<{
      readonly evaluate: (params: Record<string, unknown>) => Effect.Effect<readonly { decision: string; reason: string }[]>;
    }>("ReactiveControllerService");
    const controllerLayer = Layer.succeed(ControllerTag, {
      evaluate: (params) => {
        seen.push({ iteration: params["iteration"] as number, progressedThisPass: params["progressedThisPass"] });
        return Effect.succeed([]);
      },
    });
    const sensorLayer = Layer.succeed(EntropySensorService, mockEntropySensor);
    const tools = mockToolServiceLayer({
      execute: (req) => {
        const path = typeof req.args === "object" && req.args !== null && "path" in req.args ? String(req.args.path) : "";
        return Effect.succeed({ success: true, result: `Wrote 6 bytes to ${path}` });
      },
      getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: SCHEMAS[0]!.parameters }),
    });
    const input: KernelInput = {
      task: "Write four files ./part-1.md through ./part-4.md, one per step, then say done.",
      availableToolSchemas: SCHEMAS,
      contextProfile: { tier: "local" },
    } as KernelInput;

    await Effect.runPromise(
      runPass(reactKernel, input, { ...options, taskId: "s2a-live" }).pipe(
        Effect.provide(
          Layer.mergeAll(
            TestLLMServiceLayer([write(1), write(2), write(3), write(4), { text: "Done: wrote all four parts." }]),
            tools,
            sensorLayer,
            controllerLayer,
          ),
        ),
      ),
    );

    // The react kernel evaluates once per pass (think pass, act pass). The
    // assessment is iteration-scoped: every evaluation at a file-writing
    // iteration reads the new file as progress; the opening think (iteration
    // 0, nothing written yet) does not. How many write iterations run before
    // the harness ends the run is not under test here (measured: 3).
    const writing = seen.filter((e) => e.iteration >= 1 && e.iteration <= 4);
    expect(new Set(writing.map((e) => e.iteration)).size).toBeGreaterThanOrEqual(3);
    expect(writing.every((e) => e.progressedThisPass === true)).toBe(true);
    expect(seen[0]).toEqual({ iteration: 0, progressedThisPass: false });
  });
});
