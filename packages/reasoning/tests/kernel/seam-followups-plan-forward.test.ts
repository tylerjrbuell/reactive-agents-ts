// Run: bun test packages/reasoning/tests/kernel/seam-followups-plan-forward.test.ts --timeout 20000
//
// Follow-ups of the loop-resume and plan-unification work:
//   1. a loop stop (state.meta.loopStop) rides metadata.extensions.loopStop on every
//      kernel-backed terminal, so a non-durable or streamed run exposes the summary;
//   2. appendGuidanceText / contributeGuidance are on the public surface;
//   3. a supplied plan flows ReasoningService.execute -> registry -> strategy, and the
//      run's final plan returns in metadata.extensions.plan (core shape, final statuses);
//      adaptive routes a supplied plan to a strategy that adopts it;
//   4. the wrap-up reserve's trace event has its own guard name (activation is countable);
//   5. auto-tick and the bookkeeping refund have kill switches (default on).
//
// RED-ON-CUT: drop the loopStop line in kernelTerminalMetadata, the `corePlan`
// arm of joinedExtensions, the `plan` field on StrategyFn/execute, the adaptive
// plan override, the WRAP_UP_RESERVE_GUARD pick in reserveBudgetAnswerTurn, or
// the `harness.autoTick` / `harness.bookkeepingRefund` early returns.
import { afterEach, describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import type { Plan as CorePlan } from "@reactive-agents/core";
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import * as surface from "../../src/index.js";
import { kernelTerminalMetadata } from "../../src/strategies/substrate/strategy-run.js";
import { buildLoopStopRecord } from "../../src/kernel/loop/loop-stop.js";
import { ReasoningService, ReasoningServiceLive } from "../../src/services/reasoning-service.js";
import { StrategyRegistryLive } from "../../src/services/strategy-registry.js";
import { executeAdaptive } from "../../src/strategies/adaptive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import { resolveHarnessConfig } from "../../src/harness-config.js";
import { reserveBudgetAnswerTurn } from "../../src/kernel/loop/budget-answer-turn.js";
import { WRAP_UP_RESERVE_GUARD } from "../../src/kernel/loop/wrap-up-reserve.js";
import { proposeBookkeepingRefund } from "../../src/kernel/loop/iterate-bookkeeping-refund-seam.js";
import { applyFollowPlanGuidance } from "../../src/kernel/loop/iterate-follow-plan-seam.js";
import { seedInitialAdvisory } from "../../src/kernel/state/checklist-seed.js";
import { viewItems, startRound } from "../../src/kernel/capabilities/act/checklist-round.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import { makeKernelInput, makeKernelRunOptions, makeKernelState } from "../../src/testing/kernel-fixtures.js";
import type { KernelState } from "../../src/kernel/state/kernel-state.js";

// ── 1. loopStop on the terminal metadata ─────────────────────────────────────

describe("loopStop rides the kernel terminal metadata", () => {
  it("a loop-stopped state carries extensions.loopStop; a clean state carries none", () => {
    const stopped = makeKernelState({ status: "done" } as never);
    const record = buildLoopStopRecord(stopped, { reason: "loop_graceful" });
    const withStop = { ...stopped, meta: { ...stopped.meta, loopStop: record } } as KernelState;
    const meta = kernelTerminalMetadata(withStop, []);
    expect((meta.extensions as Record<string, unknown>).loopStop).toEqual(record);
    const clean = kernelTerminalMetadata(stopped, []);
    expect("loopStop" in (clean.extensions as Record<string, unknown>)).toBe(false);
  });
});

// ── 2. public surface ────────────────────────────────────────────────────────

describe("guidance writers are public", () => {
  it("appendGuidanceText and contributeGuidance are exported and append/merge", () => {
    const once = surface.appendGuidanceText(undefined, "icsGuidance", "a");
    expect(surface.appendGuidanceText(once, "icsGuidance", "b").icsGuidance).toBe("a\nb");
    expect(surface.contributeGuidance(once, [{ kind: "icsGuidance", text: "z" }]).icsGuidance).toBe("z");
  });
});

// ── 3. a supplied plan flows through the service and comes back ──────────────

const tool = (name: string) => ({
  name,
  description: `${name} tool`,
  parameters: [{ name: "query", type: "string", description: "input", required: false }],
});

const supplied: CorePlan = {
  id: "user-plan",
  goal: "Find AI news then summarize it",
  createdAt: 1,
  source: "user-edited",
  steps: [
    { id: "search", title: "search", tool: "web-search", args: { query: "ai news" }, status: "pending" },
    { id: "fetch", title: "fetch", tool: "web-fetch", dependsOn: ["search"], status: "pending" },
  ],
};

const harnessLayers = () => {
  const toolLayer = mockToolServiceLayer({
    execute: (req: { toolName: string }) => Effect.succeed({ success: true, result: `r-${req.toolName}` }),
    getTool: (name: string) => Effect.succeed(tool(name)),
    register: () => Effect.void,
    listTools: () => Effect.succeed([]),
    deregister: () => Effect.void,
  });
  const counts = { structured: 0 };
  const inner = TestLLMService([{ text: "Final summary." }]);
  const llm = Layer.succeed(LLMService, LLMService.of({
    ...inner,
    completeStructured: (req) => { counts.structured += 1; return inner.completeStructured(req); },
  }));
  return { counts, layer: Layer.mergeAll(toolLayer, llm) };
};

describe("supplied plan: ReasoningService.execute -> strategy -> metadata.extensions.plan", () => {
  it("blueprint adopts the plan (no planner call) and returns it in core shape, steps done, source kept", async () => {
    const { counts, layer } = harnessLayers();
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const reasoning = yield* ReasoningService;
        return yield* reasoning.execute({
          taskDescription: "Find AI news then summarize it",
          taskType: "research",
          memoryContext: "",
          availableTools: ["web-search", "web-fetch"],
          availableToolSchemas: [tool("web-search"), tool("web-fetch")],
          strategy: "blueprint",
          plan: supplied,
          taskId: "plan-forward-bp",
        });
      }).pipe(
        Effect.provide(Layer.provideMerge(ReasoningServiceLive(defaultReasoningConfig), Layer.mergeAll(layer, StrategyRegistryLive, EventBusLive))),
      ),
    );
    expect(counts.structured).toBe(0);
    const plan = (result.metadata.extensions as Record<string, unknown> | undefined)?.plan as CorePlan | undefined;
    expect(plan?.id).toBe("user-plan");
    expect(plan?.source).toBe("user-edited");
    expect(plan?.steps.map((s) => [s.id, s.status, s.tool])).toEqual([["search", "done", "web-search"], ["fetch", "done", "web-fetch"]]);
    expect(plan?.steps[1]?.dependsOn).toEqual(["search"]);
  });

  it("adaptive routes a supplied plan to a plan-adopting strategy and forwards it", async () => {
    const { layer } = harnessLayers();
    const result = await Effect.runPromise(
      provideTestEnvelope(
        executeAdaptive({
          taskDescription: "Find AI news then summarize it",
          taskType: "research",
          memoryContext: "",
          availableTools: ["web-search", "web-fetch"],
          availableToolSchemas: [tool("web-search"), tool("web-fetch")],
          config: defaultReasoningConfig,
          plan: supplied,
          taskId: "plan-forward-adaptive",
        }).pipe(Effect.provide(Layer.mergeAll(layer, EventBusLive))),
      ),
    );
    // (Adaptive's own strategy classifier may call the model; the plan id proves the supplied plan ran.)
    const plan = (result.metadata.extensions as Record<string, unknown> | undefined)?.plan as CorePlan | undefined;
    expect(plan?.id).toBe("user-plan");
  });
});

// ── 4. wrap-up reserve guard event ───────────────────────────────────────────

const SEED = [
  { id: "1", title: "List the sites", status: "pending" as const, tool: "list_sites" },
  { id: "2", title: "Get the traffic", status: "pending" as const, tool: "get_traffic" },
];
const evidence = [
  makeStep("action", "list_sites({})", { toolCall: { id: "c1", name: "list_sites", arguments: {} } }),
  makeStep("observation", "site-a", { toolCallId: "c1", observationResult: makeObservationResult("list_sites", true, "site-a") }),
];
const seededState = (over: Partial<KernelState> = {}): KernelState =>
  seedInitialAdvisory(makeKernelState({ status: "thinking", ...over } as never), { initialAdvisory: SEED });

describe("wrap-up reserve fires a guard event under its own name", () => {
  const saved = process.env.RA_WRAPUP_RESERVE;
  afterEach(() => {
    if (saved === undefined) delete process.env.RA_WRAPUP_RESERVE;
    else process.env.RA_WRAPUP_RESERVE = saved;
  });
  it("GuardFiredEmitted carries guard 'wrap_up_reserve' (not 'budget_answer_turn')", async () => {
    process.env.RA_WRAPUP_RESERVE = "1";
    const input = makeKernelInput({ task: "Execute the plan.", initialAdvisory: SEED, harness: resolveHarnessConfig() });
    const state = seededState({ iteration: 9, llmCalls: 9, steps: evidence, toolsUsed: new Set(["list_sites"]) } as never);
    const guards: string[] = [];
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* EventBus;
        yield* bus.on("GuardFiredEmitted", (e) => Effect.sync(() => { guards.push(e.guard); }));
        yield* reserveBudgetAnswerTurn({ state, input, maxIterations: 10, taskId: "t" });
      }).pipe(Effect.provide(EventBusLive)),
    );
    expect(WRAP_UP_RESERVE_GUARD).toBe("wrap_up_reserve");
    expect(guards).toContain("wrap_up_reserve");
    expect(guards).not.toContain("budget_answer_turn");
  });
});

// ── 5. kill switches ─────────────────────────────────────────────────────────

describe("auto-tick and bookkeeping refund kill switches (default on)", () => {
  const savedTick = process.env.RA_AUTO_TICK;
  const savedRefund = process.env.RA_BOOKKEEPING_REFUND;
  afterEach(() => {
    if (savedTick === undefined) delete process.env.RA_AUTO_TICK;
    else process.env.RA_AUTO_TICK = savedTick;
    if (savedRefund === undefined) delete process.env.RA_BOOKKEEPING_REFUND;
    else process.env.RA_BOOKKEEPING_REFUND = savedRefund;
  });

  it("resolve: absent by default (on), present as false from config or env, config beats env", () => {
    delete process.env.RA_AUTO_TICK;
    delete process.env.RA_BOOKKEEPING_REFUND;
    const dflt = resolveHarnessConfig();
    expect("autoTick" in dflt).toBe(false);
    expect("bookkeepingRefund" in dflt).toBe(false);
    expect(resolveHarnessConfig({ autoTick: false, bookkeepingRefund: false })).toMatchObject({ autoTick: false, bookkeepingRefund: false });
    process.env.RA_AUTO_TICK = "0";
    process.env.RA_BOOKKEEPING_REFUND = "0";
    expect(resolveHarnessConfig()).toMatchObject({ autoTick: false, bookkeepingRefund: false });
    const forcedOn = resolveHarnessConfig({ autoTick: true, bookkeepingRefund: true });
    expect("autoTick" in forcedOn).toBe(false);
    expect("bookkeepingRefund" in forcedOn).toBe(false);
  });

  it("autoTick: false leaves the unambiguous hinted step unticked; default ticks it", () => {
    const seed = [{ id: "1", title: "Fetch the price", status: "pending" as const, tool: "crypto-price" }];
    const withObs = (s: KernelState): KernelState => ({
      ...s,
      steps: [...s.steps, makeStep("observation", "r", { observationResult: makeObservationResult("crypto-price", true, "r") })],
    });
    const state = withObs(seedInitialAdvisory(makeKernelState({ status: "thinking" } as never), { initialAdvisory: seed }));
    const status = (s: KernelState) => viewItems(startRound(), s.ledger)[0]?.status;
    const on = applyFollowPlanGuidance(state, makeKernelInput({ task: "t", initialAdvisory: seed }), 0);
    expect(status(on)).toBe("completed");
    const off = applyFollowPlanGuidance(state, makeKernelInput({ task: "t", initialAdvisory: seed, harness: resolveHarnessConfig({ autoTick: false }) }), 0);
    expect(status(off)).toBe("pending");
  });

  it("bookkeepingRefund: false refunds nothing; default refunds a todo-only round", () => {
    const args = (harness?: ReturnType<typeof resolveHarnessConfig>) => ({
      state: seededState({ iteration: 1 }),
      input: makeKernelInput({ task: "Execute the plan.", initialAdvisory: SEED, ...(harness !== undefined ? { harness } : {}) }),
      options: makeKernelRunOptions({ maxIterations: 10 }),
      toolsThisStep: ["todo"],
      iterationAtPassStart: 0,
    });
    expect(proposeBookkeepingRefund(args())?.options.maxIterations).toBe(11);
    expect(proposeBookkeepingRefund(args(resolveHarnessConfig({ bookkeepingRefund: false })))).toBeUndefined();
  });
});
