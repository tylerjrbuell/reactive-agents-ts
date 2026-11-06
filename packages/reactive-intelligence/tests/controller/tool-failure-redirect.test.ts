// Run: bun test packages/reactive-intelligence/tests/controller/tool-failure-redirect.test.ts --timeout 20000
//
// tool-failure-redirect ends a run only when the model ignored the redirect.
//
// lh-a0 baseline 2026-11-06 (cogito, lh-pipeline-stages r0, run
// 01M6REXPKJXWABQ9WB081BTBCR): two file-reads of not-yet-written outputs failed
// in ONE batch; the redirect fired as an early-stop on its FIRST fire, then
// fired again after the model's next think and ended the run before act ran
// the model's 4 file-writes. Across 966 recorded traces the redirect fired 30
// times, all 30 as early-stops; the nudge never ran.
//
// RI census 2026-11-06 residuals, fixed here:
//   A — the re-fire keyed on the tool NAME while the nudge asks for different
//       arguments: 5 of 6 inspectable post-nudge calls had changed args and
//       were early-stopped (e.g. 01M6QTFXJ2E5H7FPG80P3QVAKR). Escalation now
//       needs an IDENTICAL failing call (same tool + canonical args) pending.
//       Verdict 2026-11-06: a NO-TOOL turn after the nudge escalated too
//       (01M6RKA3KHF937NA4QV45HWMZR iters 5-6); an empty batch repeats nothing.
//   B — the decision log counted suppressed decisions as fires. The kernel
//       observer now logs only APPLIED decisions, after dispatch, so the
//       handler escalates on one prior applied nudge.
//
// Pins:
//   (a) a pending batch that avoids the failing tool: no decision;
//   (b) a pending batch that still calls the failing tool: the first decision;
//   (n) the first fire is the nudge, and the nudge does not claim the tool is
//       unavailable nor order a final answer;
//   (s) the lh r0 sequence through the real controller + dispatcher;
//   (r1) after the nudge: changed args → no stop; identical retry → stop;
//        empty batch (no-tool turn / post-act) → no stop;
//   (r2) a suppressed first redirect, then a dispatched one → nudge, not stop.
//
// RED-ON-CUT (shown during the mission 2026-11-06, then restored):
//   - drop the changed-approach check in evaluators/tool-failure-streak.ts:
//     (a) fails (since R1 the identical-call check also keeps (s) green);
//   - restore `redirectFires >= 2` in handlers/tool-failure-redirect.ts: (b2)
//     and (s2) fail (the ignored nudge is not escalated);
//   - drop the identical-call check (the `nudged` block) in the evaluator:
//     (r1-changed), (r1-empty) and (s3) fail (early-stop).
// The observer side of (r2) — log only applied decisions, after dispatch — is
// pinned in packages/reasoning/tests/kernel/seam-ri-dispatch-log.test.ts.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import type { KernelStateLike } from "@reactive-agents/core";
import { evaluateToolFailureStreak } from "../../src/controller/evaluators/tool-failure-streak.js";
import { toolFailureRedirectHandler } from "../../src/controller/handlers/tool-failure-redirect.js";
import { defaultInterventionRegistry } from "../../src/controller/handlers/index.js";
import { makeDispatcher, registerHandler } from "../../src/controller/dispatcher.js";
import { defaultInterventionConfig, type InterventionContext } from "../../src/controller/intervention.js";
import { ReactiveControllerService, ReactiveControllerServiceLive } from "../../src/controller/controller-service.js";
import type { ControllerDecision, ControllerEvalParams, ToolCallIdentity } from "../../src/types.js";

type Redirect = Extract<ControllerDecision, { decision: "tool-failure-redirect" }>;

const call = (name: string, argsKey: string): ToolCallIdentity => ({ name, argsKey });

const base: ControllerEvalParams = {
  entropyHistory: [{ composite: 0.5, trajectory: { shape: "flat", derivative: 0, momentum: 0 } }],
  iteration: 3,
  maxIterations: 22,
  strategy: "reactive",
  calibration: { highEntropyThreshold: 0.8, convergenceThreshold: 0.4, calibrated: false, sampleCount: 0 },
  config: { earlyStop: false, strategySwitch: false },
  behavioralLoopScore: 0,
  consecutiveToolFailures: 2,
  failingToolName: "file-read",
  failingArgsKeys: ["clean", "by-region"],
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

/** The kernel observer's view at dispatch: the log holds earlier APPLIED decisions only. */
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
      evaluateToolFailureStreak({
        ...base,
        pendingToolCalls: [call("file-write", "w1"), call("file-write", "w2"), call("file-write", "w3"), call("file-write", "w4"), call("recall", "r")],
      }),
    ).toBeNull();
  });

  it("(b) a pending batch that still calls the failing tool keeps the decision", () => {
    expect(evaluateToolFailureStreak({ ...base, pendingToolCalls: [call("file-write", "w"), call("file-read", "other")] })).toMatchObject({
      decision: "tool-failure-redirect",
      failingTool: "file-read",
      streakCount: 2,
    });
  });

  it("no batch pending (the post-act evaluation) keeps the first decision", () => {
    expect(evaluateToolFailureStreak({ ...base, pendingToolCalls: [] })?.decision).toBe("tool-failure-redirect");
    expect(evaluateToolFailureStreak(base)?.decision).toBe("tool-failure-redirect");
  });
});

describe("tool-failure-redirect: nudge first, early-stop on the ignored redirect", () => {
  const decision = evaluateToolFailureStreak(base)!;
  const entry = `tool-failure-redirect: ${decision.reason}`;

  it("(n) the first fire (no prior applied redirect) is a nudge that does not misstate the failure", async () => {
    const out = await fire(decision, []);
    expect(out.patches.map((p) => p.kind)).toEqual(["append-system-nudge"]);
    const text = (out.patches[0] as { text: string }).text;
    expect(text).toContain('"file-read"');
    expect(text).not.toMatch(/unavailable/i);
    expect(text).not.toMatch(/final-answer/i);
  });

  it("(b2) a fire after one applied nudge is an early-stop", async () => {
    const out = await fire(decision, [entry]);
    expect(out.patches.map((p) => p.kind)).toEqual(["early-stop"]);
  });
});

describe("(r1) after the nudge, only an identical failing call escalates", () => {
  const nudged: ControllerEvalParams = { ...base, priorDecisionsThisRun: ["tool-failure-redirect"] };

  it("(r1-changed) the same tool with changed arguments: no decision, no stop", () => {
    expect(evaluateToolFailureStreak({ ...nudged, pendingToolCalls: [call("file-read", "fixed-path")] })).toBeNull();
  });

  it("(r1-identical) an identical retry of a failed call: the decision (escalated by the handler)", () => {
    expect(evaluateToolFailureStreak({ ...nudged, pendingToolCalls: [call("file-read", "by-region")] })?.decision).toBe(
      "tool-failure-redirect",
    );
  });

  it("(r1-empty) nothing pending (no-tool turn, or post-act): no decision", () => {
    expect(evaluateToolFailureStreak({ ...nudged, pendingToolCalls: [] })).toBeNull();
    expect(evaluateToolFailureStreak(nudged)).toBeNull();
  });
});

/**
 * One kernel observer evaluation in reactive-observer.ts order: evaluate,
 * dispatch with the log of EARLIER applied decisions, then log the applied ones.
 */
const observerSequence = async (
  evaluations: readonly ControllerEvalParams[],
  contexts: readonly InterventionContext[] = evaluations.map(() => context),
) => {
  const dispatcher = makeDispatcher(defaultInterventionConfig);
  for (const h of defaultInterventionRegistry) registerHandler(dispatcher, h);
  const controller = await Effect.runPromise(
    Effect.provide(ReactiveControllerService, ReactiveControllerServiceLive(base.config)),
  );
  let log: string[] = [];
  const patches: string[][] = [];
  for (const [i, params] of evaluations.entries()) {
    const priors = log.map((e) => e.slice(0, e.indexOf(":")));
    const decisions = (await Effect.runPromise(controller.evaluate({ ...params, priorDecisionsThisRun: priors }))).filter(
      (d): d is Redirect => d.decision === "tool-failure-redirect",
    );
    const result = await Effect.runPromise(dispatcher.dispatch(decisions, stateWithLog(log), contexts[i]!));
    const applied = new Set(result.appliedPatches.map((p) => p.decisionType));
    log = [...log, ...decisions.filter((d) => applied.has(d.decision)).map((d) => `${d.decision}: ${d.reason}`)];
    patches.push(result.appliedPatches.map((p) => p.patch.kind));
  }
  return patches;
};

describe("tool-failure-redirect: the lh-pipeline-stages r0 sequence", () => {
  const runSequence = (pendingAfterNudge: readonly ToolCallIdentity[]) =>
    observerSequence([
      // post-act: two file-read failures, nothing pending
      { ...base, pendingToolCalls: [] },
      // post-think: the model's next batch is pending
      { ...base, pendingToolCalls: pendingAfterNudge },
    ]);

  it("(s) nudge, then the switched batch of file-writes is not early-stopped", async () => {
    expect(
      await runSequence([call("file-write", "w1"), call("file-write", "w2"), call("file-write", "w3"), call("file-write", "w4"), call("recall", "r")]),
    ).toEqual([["append-system-nudge"], []]);
  });

  it("(s2) control: a batch that retries the identical failed file-read is early-stopped", async () => {
    expect(await runSequence([call("file-read", "clean")])).toEqual([["append-system-nudge"], ["early-stop"]]);
  });

  it("(s3) a batch that retries file-read with changed args is not early-stopped", async () => {
    expect(await runSequence([call("file-read", "output/clean.csv")])).toEqual([["append-system-nudge"], []]);
  });
});

describe("(r2) a suppressed redirect is not a prior fire", () => {
  it("suppressed first redirect (entropy floor), then a dispatched one → nudge, not early-stop", async () => {
    const belowFloor: InterventionContext = { ...context, adaptiveMinEntropy: 0.9 };
    const identical = { ...base, pendingToolCalls: [call("file-read", "clean")] };
    expect(await observerSequence([identical, identical], [belowFloor, context])).toEqual([[], ["append-system-nudge"]]);
  });
});
