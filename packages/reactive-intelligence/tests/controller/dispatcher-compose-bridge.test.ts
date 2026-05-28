import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  HarnessPipeline,
  RegistrationHarness,
  type ControlStrategyEvaluatedPayload,
  type LifecycleFailurePayload,
  type Tag,
} from "@reactive-agents/core";
import { makeDispatcher, registerHandler } from "../../src/controller/dispatcher.js";
import {
  asInterventionHandler,
  defaultInterventionConfig,
  type InterventionContext,
  type InterventionHandler,
  type InterventionOutcome,
  type KernelStatePatch,
} from "../../src/controller/intervention.js";
import type { ControllerDecision } from "../../src/types.js";

// HS-112 — RI dispatcher → Compose tag bridge.
//
// When a handler returns `applied=true` and the decision has a natural
// Compose tag mapping, the dispatcher emits the tag. Decisions without
// a mapping are silently passed (no spurious tag creation). The bridge
// never fires for skipped / suppressed / failed decisions.

const baseSuppression = { ...defaultInterventionConfig.suppression, minIteration: 0, minEntropyComposite: 0 };

const makeContext = (
  pipeline: HarnessPipeline | undefined,
  overrides: Partial<InterventionContext> = {},
): InterventionContext => ({
  iteration: 5,
  entropyScore: {
    composite: 0.7,
    structural: 0.6,
    semantic: 0.5,
    behavioral: 0.4,
    contextPressure: 0.3,
  },
  recentDecisions: [],
  budget: {
    interventionsFiredThisRun: 0,
    tokensSpentOnInterventions: 0,
  },
  harnessPipeline: pipeline,
  ...overrides,
});

const makeState = () => ({
  taskId: "t-1",
  strategy: "react",
  iteration: 5,
}) as unknown as Parameters<ReturnType<typeof makeDispatcher>["dispatch"]>[1];

const successOutcome = (patches: KernelStatePatch[] = []): InterventionOutcome => ({
  applied: true,
  patches,
  cost: { tokensEstimated: 0, latencyMsEstimated: 0 },
  reason: "applied",
  telemetry: {},
});

const skipOutcome = (reason: string): InterventionOutcome => ({
  applied: false,
  patches: [],
  cost: { tokensEstimated: 0, latencyMsEstimated: 0 },
  reason,
  telemetry: {},
});

type TapEntry = { readonly tag: Tag; readonly payload: unknown };

const taps = (h: RegistrationHarness, sink: TapEntry[]) => {
  for (const tag of [
    "control.strategy-evaluated",
    "lifecycle.failure",
    "nudge.healing-failure",
  ] as const) {
    h.tap(tag, (payload: unknown) => { sink.push({ tag, payload }); });
  }
};

const fixedHandler = <T extends ControllerDecision["decision"]>(
  type: T,
  outcome: InterventionOutcome,
): InterventionHandler<T> => ({
  type,
  description: `${type} test handler`,
  defaultMode: "dispatch",
  execute: () => Effect.succeed(outcome) as Effect.Effect<InterventionOutcome, never, never>,
});

describe("dispatcher → Compose bridge (HS-112)", () => {
  it("emits control.strategy-evaluated when switch-strategy is applied", async () => {
    const h = new RegistrationHarness();
    const captured: TapEntry[] = [];
    taps(h, captured);
    const pipeline = new HarnessPipeline(h._collected);

    const dispatcher = makeDispatcher({ ...defaultInterventionConfig, suppression: baseSuppression });
    registerHandler(dispatcher, asInterventionHandler(fixedHandler("switch-strategy", successOutcome([
      { kind: "request-strategy-switch", to: "reflexion", reason: "stall" },
    ]))));

    const decisions: ControllerDecision[] = [
      { decision: "switch-strategy", from: "react", to: "reflexion", reason: "stall" },
    ];

    await Effect.runPromise(dispatcher.dispatch(decisions, makeState(), makeContext(pipeline)));

    const entry = captured.find((c) => c.tag === "control.strategy-evaluated");
    expect(entry).toBeDefined();
    const payload = entry!.payload as ControlStrategyEvaluatedPayload;
    expect(payload.currentStrategy).toBe("react");
    expect(payload.availableStrategies).toEqual(["reflexion"]);
    expect(payload.recommendedAction).toBe("switch");
  });

  it("emits lifecycle.failure for stall-detect / harness-harm / human-escalate", async () => {
    const h = new RegistrationHarness();
    const captured: TapEntry[] = [];
    taps(h, captured);
    const pipeline = new HarnessPipeline(h._collected);

    const dispatcher = makeDispatcher({ ...defaultInterventionConfig, suppression: baseSuppression });
    registerHandler(dispatcher, asInterventionHandler(fixedHandler("stall-detect", successOutcome())));
    registerHandler(dispatcher, asInterventionHandler(fixedHandler("harness-harm", successOutcome())));
    registerHandler(dispatcher, asInterventionHandler(fixedHandler("human-escalate", successOutcome())));

    const decisions: ControllerDecision[] = [
      { decision: "stall-detect", reason: "no progress", stalledIterations: 4 },
      { decision: "harness-harm", reason: "infinite loop signature", harmLevel: "confirmed" },
      { decision: "human-escalate", reason: "blocked", decisionsExhausted: ["switch-strategy"] },
    ];

    await Effect.runPromise(dispatcher.dispatch(decisions, makeState(), makeContext(pipeline)));

    const failures = captured.filter((c) => c.tag === "lifecycle.failure");
    expect(failures).toHaveLength(3);
    const reasons = failures.map((f) => (f.payload as LifecycleFailurePayload).reason).sort();
    expect(reasons).toEqual(["llm-refusal", "tool-error", "verifier-rejection"]);
  });

  it("emits nudge.healing-failure for tool-failure-redirect", async () => {
    const h = new RegistrationHarness();
    const captured: TapEntry[] = [];
    taps(h, captured);
    const pipeline = new HarnessPipeline(h._collected);

    const dispatcher = makeDispatcher({ ...defaultInterventionConfig, suppression: baseSuppression });
    registerHandler(dispatcher, asInterventionHandler(fixedHandler("tool-failure-redirect", successOutcome())));

    await Effect.runPromise(dispatcher.dispatch(
      [{ decision: "tool-failure-redirect", failingTool: "web-search", streakCount: 3, reason: "404" }],
      makeState(),
      makeContext(pipeline),
    ));

    const entry = captured.find((c) => c.tag === "nudge.healing-failure");
    expect(entry).toBeDefined();
    expect(String(entry!.payload)).toContain("web-search");
    expect(String(entry!.payload)).toContain("streak=3");
  });

  it("does not emit a tag for unmapped decisions (temp-adjust, compress, skill-activate, …)", async () => {
    const h = new RegistrationHarness();
    const captured: TapEntry[] = [];
    taps(h, captured);
    // Also tap the 4 always-live tags so we'd catch any spurious emission.
    h.tap("prompt.system", (payload: unknown) => { captured.push({ tag: "prompt.system", payload }); });
    h.tap("observation.tool-result", (payload: unknown) => { captured.push({ tag: "observation.tool-result", payload }); });
    h.tap("nudge.loop-detected", (payload: unknown) => { captured.push({ tag: "nudge.loop-detected", payload }); });
    h.tap("message.tool-result", (payload: unknown) => { captured.push({ tag: "message.tool-result", payload }); });
    const pipeline = new HarnessPipeline(h._collected);

    const dispatcher = makeDispatcher({ ...defaultInterventionConfig, suppression: baseSuppression });
    registerHandler(dispatcher, asInterventionHandler(fixedHandler("temp-adjust", successOutcome())));
    registerHandler(dispatcher, asInterventionHandler(fixedHandler("compress", successOutcome())));
    registerHandler(dispatcher, asInterventionHandler(fixedHandler("skill-activate", successOutcome())));

    const decisions: ControllerDecision[] = [
      { decision: "temp-adjust", delta: 0.2, reason: "raise diversity" },
      { decision: "compress", sections: ["history"], estimatedSavings: 1000 },
      { decision: "skill-activate", skillName: "code-review", trigger: "entropy-match", confidence: "high" },
    ];

    await Effect.runPromise(dispatcher.dispatch(decisions, makeState(), makeContext(pipeline)));

    expect(captured).toEqual([]);
  });

  it("does not emit when the handler reports applied=false", async () => {
    const h = new RegistrationHarness();
    const captured: TapEntry[] = [];
    taps(h, captured);
    const pipeline = new HarnessPipeline(h._collected);

    const dispatcher = makeDispatcher({ ...defaultInterventionConfig, suppression: baseSuppression });
    registerHandler(dispatcher, asInterventionHandler(fixedHandler("switch-strategy", skipOutcome("handler-deferred"))));

    await Effect.runPromise(dispatcher.dispatch(
      [{ decision: "switch-strategy", from: "react", to: "reflexion", reason: "x" }],
      makeState(),
      makeContext(pipeline),
    ));

    expect(captured).toEqual([]);
  });

  it("uses phase='strategy-select' for switch-strategy and phase='audit' for the others", async () => {
    const h = new RegistrationHarness();
    const seenCtx: Array<{ tag: Tag; phase: string }> = [];
    for (const tag of [
      "control.strategy-evaluated",
      "lifecycle.failure",
      "nudge.healing-failure",
    ] as const) {
      h.tap(tag, (_payload: unknown, ctx: unknown) => { seenCtx.push({ tag, phase: (ctx as { phase: string }).phase }); });
    }
    const pipeline = new HarnessPipeline(h._collected);

    const dispatcher = makeDispatcher({ ...defaultInterventionConfig, suppression: baseSuppression });
    registerHandler(dispatcher, asInterventionHandler(fixedHandler("switch-strategy", successOutcome())));
    registerHandler(dispatcher, asInterventionHandler(fixedHandler("stall-detect", successOutcome())));
    registerHandler(dispatcher, asInterventionHandler(fixedHandler("tool-failure-redirect", successOutcome())));

    await Effect.runPromise(dispatcher.dispatch(
      [
        { decision: "switch-strategy", from: "react", to: "reflexion", reason: "stall" },
        { decision: "stall-detect", reason: "no progress", stalledIterations: 3 },
        { decision: "tool-failure-redirect", failingTool: "web-search", streakCount: 2, reason: "404" },
      ],
      makeState(),
      makeContext(pipeline),
    ));

    const find = (tag: Tag) => seenCtx.find((c) => c.tag === tag);
    expect(find("control.strategy-evaluated")?.phase).toBe("strategy-select");
    expect(find("lifecycle.failure")?.phase).toBe("audit");
    expect(find("nudge.healing-failure")?.phase).toBe("audit");
  });

  it("is a no-op when no harnessPipeline is provided", async () => {
    const dispatcher = makeDispatcher({ ...defaultInterventionConfig, suppression: baseSuppression });
    registerHandler(dispatcher, asInterventionHandler(fixedHandler("switch-strategy", successOutcome())));

    // No pipeline in context; dispatch still succeeds.
    const result = await Effect.runPromise(dispatcher.dispatch(
      [{ decision: "switch-strategy", from: "react", to: "reflexion", reason: "x" }],
      makeState(),
      makeContext(undefined),
    ));
    expect(result.appliedPatches).toBeDefined();
  });
});
