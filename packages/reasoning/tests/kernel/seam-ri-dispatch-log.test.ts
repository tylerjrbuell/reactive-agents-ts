// Run: bun test packages/reasoning/tests/kernel/seam-ri-dispatch-log.test.ts --timeout 20000
//
// Kernel side of the RI controller census fixes (2026-11-06,
// wiki/Research/Harness-Reports/2026-11-06-ri-controller-census.md) and the
// early-stop/redirect verdict follow-ups (same day).
//
// Pins (reflect/reactive-observer.ts + loop/turn-operations.ts):
//   (R2) controllerDecisionLog holds only decisions the dispatcher APPLIED,
//        appended after dispatch: a suppressed redirect is not logged, and the
//        dispatch that follows sees an empty log (so the handler nudges).
//   (R1) the observer always passes the pending batch (empty when nothing is
//        pending) as (name, canonical-args key) identities, and the failed
//        calls' keys; an identical call yields the same key in both.
//   (W)  an `early-stop-withheld` notice is published as a guard event
//        (`ri-early-stop` / `block`), never dispatched, stored or logged.
//   (R3) the turn hands RI `switchingAvailable` from the run's
//        strategySwitching options (false by default: switching is opt-in).
//
// RED-ON-CUT (shown during the mission 2026-11-06, then restored):
//   - log every evaluated decision, not only applied ones: (R2) and (W) fail;
//   - pass `pendingToolCalls` only when non-empty: (R1-empty) fails;
//   - skip the GuardFiredEmitted publish for notices: (W) fails;
//   - drop the `switchingAvailable` forward in the observer: both (R3) fail.
import { describe, it, expect } from "bun:test";
import { Context, Effect, Layer, Option } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EntropySensorService, EventBusLive } from "@reactive-agents/core";
import { runReactiveObserver } from "../../src/kernel/capabilities/reflect/reactive-observer.js";
import { toolCallArgsKey } from "../../src/kernel/capabilities/reflect/tool-failure-streak.js";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { makeKernelState, makeStrategyServices } from "../../src/testing/kernel-fixtures.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import type { KernelMessage, KernelRunOptions, KernelState } from "../../src/kernel/state/kernel-state.js";
import type { StrategyServices } from "../../src/kernel/utils/service-utils.js";

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

const options: KernelRunOptions = { maxIterations: 10, strategy: "reactive", kernelType: "react", modelId: "test" };

type Decision = { readonly decision: string; readonly reason: string };
type DispatchFn = NonNullable<Option.Option.Value<StrategyServices["dispatcher"]>>["dispatch"];

const REDIRECT: Decision = { decision: "tool-failure-redirect", reason: '"file-read" has failed 2 consecutive times' };

const stateWith = (overrides: Partial<KernelState> = {}): KernelState =>
  makeKernelState({
    taskId: "ri-dispatch-log",
    strategy: "reactive",
    kernelType: "react",
    steps: [makeStep("thought", "retry the read", {})],
    iteration: 3,
    meta: { entropy: { modelId: "test", entropyHistory: [entropyScore] } },
    ...overrides,
  });

/** A dispatcher stub: suppresses or applies every decision per call, recording the log it saw. */
const scriptedDispatcher = (applyPerCall: readonly boolean[], seenLogs: string[][]) => {
  let call = 0;
  const dispatch: DispatchFn = (decisions, state) => {
    const apply = applyPerCall[call++] ?? false;
    const log = state["controllerDecisionLog"];
    seenLogs.push(Array.isArray(log) ? log.map(String) : []);
    return Effect.succeed({
      appliedPatches: apply
        ? decisions.map((d) => ({ decisionType: d.decision, patch: { kind: "append-system-nudge", text: "change approach" } }))
        : [],
      skipped: apply ? [] : decisions.map((d) => ({ decisionType: d.decision, reason: "below-entropy-threshold" })),
      totalCost: { tokens: 0, latencyMs: 0 },
    });
  };
  return { dispatch };
};

describe("(R2) the decision log records only applied decisions", () => {
  it("suppressed first redirect is not logged; the next dispatch sees an empty log; the applied one is logged once", async () => {
    const seenLogs: string[][] = [];
    const services = makeStrategyServices({
      entropySensor: Option.some(entropySensor),
      reactiveController: Option.some({ evaluate: () => Effect.succeed([REDIRECT]) }),
      dispatcher: Option.some(scriptedDispatcher([false, true], seenLogs)),
    });
    const first = await Effect.runPromise(runReactiveObserver(stateWith(), services, Option.none(), 0, options));
    expect(first.state.controllerDecisionLog).toEqual([]);
    const second = await Effect.runPromise(runReactiveObserver(first.state, services, Option.none(), 0, options));
    // The handler would read this log: no prior fire, so it nudges.
    expect(seenLogs).toEqual([[], []]);
    expect(second.state.controllerDecisionLog).toEqual([`tool-failure-redirect: ${REDIRECT.reason}`]);
  });

  it("without a dispatcher nothing is applied, so nothing is logged", async () => {
    const services = makeStrategyServices({
      entropySensor: Option.some(entropySensor),
      reactiveController: Option.some({ evaluate: () => Effect.succeed([REDIRECT]) }),
    });
    const out = await Effect.runPromise(runReactiveObserver(stateWith(), services, Option.none(), 0, options));
    expect(out.state.controllerDecisionLog).toEqual([]);
  });
});

describe("(R1) pending batch and failed calls as (name, canonical args) identities", () => {
  const failedTurn = (id: string, path: string): KernelMessage[] => [
    { role: "assistant", content: "", toolCalls: [{ id, name: "file-read", arguments: { path, encoding: "utf8" } }] },
    { role: "tool_result", toolCallId: id, toolName: "file-read", content: "ENOENT", isError: true },
  ];
  const capture = async (pending: readonly { name: string; arguments: Record<string, unknown> }[] | undefined) => {
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
    const state = stateWith({
      messages: [...failedTurn("a", "clean.csv"), ...failedTurn("b", "by-region.json")],
      meta: {
        entropy: { modelId: "test", entropyHistory: [entropyScore] },
        ...(pending ? { pendingNativeToolCalls: pending.map((c, i) => ({ id: `p${i}`, ...c })) } : {}),
      },
    });
    await Effect.runPromise(runReactiveObserver(state, services, Option.none(), 0, options));
    return captured;
  };

  it("(R1-keys) an identical retry (keys reordered) has the same key as the failed call; changed args do not", async () => {
    const params = await capture([
      { name: "file-read", arguments: { encoding: "utf8", path: "by-region.json" } },
      { name: "file-read", arguments: { path: "output/by-region.json", encoding: "utf8" } },
    ]);
    const failed = params["failingArgsKeys"];
    const pending = params["pendingToolCalls"];
    expect(params["consecutiveToolFailures"]).toBe(2);
    expect(failed).toEqual([
      toolCallArgsKey({ path: "clean.csv", encoding: "utf8" }),
      toolCallArgsKey({ path: "by-region.json", encoding: "utf8" }),
    ]);
    expect(pending).toEqual([
      { name: "file-read", argsKey: toolCallArgsKey({ path: "by-region.json", encoding: "utf8" }) },
      { name: "file-read", argsKey: toolCallArgsKey({ path: "output/by-region.json", encoding: "utf8" }) },
    ]);
    expect(Array.isArray(failed) && Array.isArray(pending) && failed.includes(pending[1]?.argsKey)).toBe(false);
  });

  it("(R1-empty) nothing pending (post-act, or a no-tool turn) is passed as an explicit empty batch", async () => {
    expect((await capture(undefined))["pendingToolCalls"]).toEqual([]);
    expect((await capture([]))["pendingToolCalls"]).toEqual([]);
  });
});

describe("(W) the withheld early-stop notice is a guard event, not a decision", () => {
  it("publishes guard ri-early-stop/block; never dispatched, stored or logged", async () => {
    const notice: Decision = { decision: "early-stop-withheld", reason: "Near maxIterations ... produced new evidence this pass" };
    const published: unknown[] = [];
    const dispatched: string[] = [];
    const services = makeStrategyServices({
      entropySensor: Option.some(entropySensor),
      reactiveController: Option.some({ evaluate: () => Effect.succeed([notice, REDIRECT]) }),
      dispatcher: Option.some({
        dispatch: (decisions) => {
          dispatched.push(...decisions.map((d) => d.decision));
          return Effect.succeed({ appliedPatches: [], skipped: [], totalCost: { tokens: 0, latencyMs: 0 } });
        },
      }),
    });
    const bus = { publish: (e: unknown) => Effect.sync(() => void published.push(e)) };
    const out = await Effect.runPromise(runReactiveObserver(stateWith(), services, Option.some(bus), 0, options));
    expect(published).toContainEqual(
      expect.objectContaining({
        _tag: "GuardFiredEmitted",
        guard: "ri-early-stop",
        outcome: "block",
        reason: notice.reason,
        metadata: { branch: "near-cap", standDown: "progressed-this-pass" },
      }),
    );
    expect(dispatched).toEqual(["tool-failure-redirect"]);
    expect(out.state.meta.controllerDecisions?.map((d) => d.decision)).toEqual(["tool-failure-redirect"]);
    expect(out.state.controllerDecisionLog).toEqual([]);
  });
});

// ── (R3) wiring through the default runPass path ──────────────────────────────

type EvalParams = { readonly switchingAvailable?: boolean };
const ControllerTag = Context.GenericTag<{ readonly evaluate: (p: EvalParams) => Effect.Effect<readonly Decision[]> }>(
  "ReactiveControllerService",
);

const seenSwitching = async (strategySwitching: KernelRunOptions["strategySwitching"]) => {
  const seen: EvalParams[] = [];
  await Effect.runPromise(
    runPass(
      reactKernel,
      { task: "Answer briefly", availableToolSchemas: [] },
      {
        maxIterations: 4,
        strategy: "reactive",
        kernelType: "react",
        taskId: "ri-switching-available",
        ...(strategySwitching ? { strategySwitching } : {}),
      },
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          TestLLMServiceLayer([{ text: "FINAL ANSWER: done." }]),
          mockToolServiceLayer({}),
          EventBusLive,
          Layer.succeed(EntropySensorService, entropySensor),
          Layer.succeed(ControllerTag, {
            evaluate: (p: EvalParams) => {
              seen.push(p);
              return Effect.succeed([]);
            },
          }),
        ),
      ),
    ),
  );
  return seen.map((p) => p.switchingAvailable);
};

describe("(R3) the turn hands RI whether the run can switch strategy", () => {
  it("switching off (the default): false", async () => {
    const seen = await seenSwitching(undefined);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((v) => v === false)).toBe(true);
  }, 20000);

  it("switching enabled with a switch left: true", async () => {
    const seen = await seenSwitching({ enabled: true, maxSwitches: 1 });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((v) => v === true)).toBe(true);
  }, 20000);
});
