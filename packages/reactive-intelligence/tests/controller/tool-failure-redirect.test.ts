// Run: bun test packages/reactive-intelligence/tests/controller/tool-failure-redirect.test.ts --timeout 20000
//
// tool-failure-redirect ends a run only when the model ignored the redirect.
//
// lh-a0 baseline 2026-11-06 (cogito, lh-pipeline-stages r0, run
// 01M6REXPKJXWABQ9WB081BTBCR): two file-reads of not-yet-written outputs failed
// in ONE batch; the redirect fired as an early-stop on its FIRST fire (the
// kernel observer appends the decision to controllerDecisionLog before
// dispatch, so the handler counted the current fire as a prior one), then
// fired again after the model's next think and ended the run before act ran
// the model's 4 file-writes. Across 966 recorded traces the redirect fired 30
// times, all 30 as early-stops; the nudge never ran.
//
// Pins:
//   (a) a pending batch that avoids the failing tool: no decision, no early-stop;
//   (b) a pending batch that still calls the failing tool: early-stop (unchanged);
//   (n) the first fire is the nudge, and the nudge does not claim the tool is
//       unavailable nor order a final answer;
//   (s) the lh r0 sequence through the real controller + dispatcher.
//
// RED-ON-CUT (shown during the mission, then restored):
//   - drop the pending-batch check in evaluators/tool-failure-streak.ts: (a) and
//     (s) fail (the switched batch is early-stopped);
//   - restore `priorRedirects >= 1` in handlers/tool-failure-redirect.ts: (n)
//     and (s) fail (the first fire is an early-stop).
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import type { KernelStateLike } from "@reactive-agents/core";
import { evaluateToolFailureStreak } from "../../src/controller/evaluators/tool-failure-streak.js";
import { toolFailureRedirectHandler } from "../../src/controller/handlers/tool-failure-redirect.js";
import { defaultInterventionRegistry } from "../../src/controller/handlers/index.js";
import { makeDispatcher, registerHandler } from "../../src/controller/dispatcher.js";
import { defaultInterventionConfig, type InterventionContext } from "../../src/controller/intervention.js";
import { ReactiveControllerService, ReactiveControllerServiceLive } from "../../src/controller/controller-service.js";
import type { ControllerDecision, ControllerEvalParams } from "../../src/types.js";

type Redirect = Extract<ControllerDecision, { decision: "tool-failure-redirect" }>;

const base: ControllerEvalParams = {
  entropyHistory: [{ composite: 0.5, trajectory: { shape: "flat", derivative: 0, momentum: 0 } }],
  iteration: 3,
  maxIterations: 22,
  strategy: "reactive",
  calibration: { highEntropyThreshold: 0.8, convergenceThreshold: 0.4, calibrated: false, sampleCount: 0 },
  config: { earlyStop: false, contextCompression: false, strategySwitch: false },
  contextPressure: 0,
  behavioralLoopScore: 0,
  consecutiveToolFailures: 2,
  failingToolName: "file-read",
};

const context: InterventionContext = {
  iteration: 3,
  entropyScore: {
    composite: 0.5,
    sources: { token: 0, structural: 0.5, semantic: 0, behavioral: 0, contextPressure: 0 },
    trajectory: { history: [0.5], derivative: 0, momentum: 0, shape: "flat" },
    confidence: "medium",
    modelTier: "local",
    iteration: 3,
    iterationWeight: 1,
    timestamp: 0,
  },
  recentDecisions: [],
  budget: { tokensSpentOnInterventions: 0, interventionsFiredThisRun: 0 },
  adaptiveMinEntropy: 0.12,
};

/** The kernel observer's view: the decision is already in the log when dispatch runs. */
const stateWithLog = (log: readonly string[]): Readonly<KernelStateLike & Record<string, unknown>> => ({
  taskId: "lh-pipeline-stages",
  strategy: "reactive",
  kernelType: "react",
  steps: [],
  toolsUsed: new Set<string>(),
  iteration: 3,
  tokens: 0,
  status: "thinking",
  output: null,
  error: null,
  meta: {},
  controllerDecisionLog: log,
});

const fire = (decision: Redirect, log: readonly string[]) =>
  Effect.runPromise(toolFailureRedirectHandler.execute(decision, stateWithLog(log), context));

describe("tool-failure-redirect: pending batch", () => {
  it("(a) a pending batch that avoids the failing tool gets no decision", () => {
    expect(
      evaluateToolFailureStreak({ ...base, pendingToolNames: ["file-write", "file-write", "file-write", "file-write", "recall"] }),
    ).toBeNull();
  });

  it("(b) a pending batch that still calls the failing tool keeps the decision", () => {
    expect(evaluateToolFailureStreak({ ...base, pendingToolNames: ["file-write", "file-read"] })).toMatchObject({
      decision: "tool-failure-redirect",
      failingTool: "file-read",
      streakCount: 2,
    });
  });

  it("no batch pending (the post-act evaluation) keeps the decision", () => {
    expect(evaluateToolFailureStreak(base)?.decision).toBe("tool-failure-redirect");
  });
});

describe("tool-failure-redirect: nudge first, early-stop on the ignored redirect", () => {
  const decision = evaluateToolFailureStreak(base)!;
  const entry = `tool-failure-redirect: ${decision.reason}`;

  it("(n) the first fire (log holds only this fire) is a nudge that does not misstate the failure", async () => {
    const out = await fire(decision, [entry]);
    expect(out.patches.map((p) => p.kind)).toEqual(["append-system-nudge"]);
    const text = (out.patches[0] as { text: string }).text;
    expect(text).toContain('"file-read"');
    expect(text).not.toMatch(/unavailable/i);
    expect(text).not.toMatch(/final-answer/i);
  });

  it("(b2) the second fire is an early-stop", async () => {
    const out = await fire(decision, [entry, entry]);
    expect(out.patches.map((p) => p.kind)).toEqual(["early-stop"]);
  });
});

describe("tool-failure-redirect: the lh-pipeline-stages r0 sequence", () => {
  /** One observer evaluation: evaluate, append to the log, dispatch (reactive-observer.ts order). */
  const runSequence = async (pendingAfterNudge: readonly string[]) => {
    const dispatcher = makeDispatcher(defaultInterventionConfig);
    for (const h of defaultInterventionRegistry) registerHandler(dispatcher, h);
    const controller = await Effect.runPromise(
      Effect.provide(ReactiveControllerService, ReactiveControllerServiceLive(base.config)),
    );
    let log: string[] = [];
    const patches: string[][] = [];
    const evaluations: ControllerEvalParams[] = [
      // post-act: two file-read failures, no batch pending
      base,
      // post-think: the model's next batch is pending
      { ...base, pendingToolNames: pendingAfterNudge },
    ];
    for (const params of evaluations) {
      const decisions = (await Effect.runPromise(controller.evaluate(params))).filter(
        (d) => d.decision === "tool-failure-redirect",
      );
      log = [...log, ...decisions.map((d) => `${d.decision}: ${"reason" in d ? d.reason : ""}`)];
      const result = await Effect.runPromise(dispatcher.dispatch(decisions, stateWithLog(log), context));
      patches.push(result.appliedPatches.map((p) => p.patch.kind));
    }
    return patches;
  };

  it("(s) nudge, then the switched batch of file-writes is not early-stopped", async () => {
    expect(await runSequence(["file-write", "file-write", "file-write", "file-write", "recall"])).toEqual([
      ["append-system-nudge"],
      [],
    ]);
  });

  it("(s2) control: a batch that retries file-read after the nudge is early-stopped", async () => {
    expect(await runSequence(["file-read"])).toEqual([["append-system-nudge"], ["early-stop"]]);
  });
});
