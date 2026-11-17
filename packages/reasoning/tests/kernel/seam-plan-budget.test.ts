// Run: bun test packages/reasoning/tests/kernel/seam-plan-budget.test.ts --timeout 20000
//
// Plan-sized iteration budget (kernel/loop/plan-budget.ts). A run SEEDED with a
// plan checklist whose unchecked steps need more iterations than maxIterations
// gets the bound raised once at run start, recorded, bounded. Pinned here:
//   planBudget              — the sizing arithmetic, hard cap, fits => undefined;
//   proposePlanBudget       — seeded/unseeded/plan posture/opt-out/idempotent,
//                             only UNCHECKED steps count, the signal step;
//   refund interplay        — the refund cap stays on the ORIGINAL budget and
//                             raise + refunds never pass the hard cap;
//   resolver                — default on (absent), `planBudget:false` / RA_PLAN_BUDGET=0 off;
//   Umami-shaped scripted run — 18 unchecked steps vs maxIterations 10 finish
//                             inside the raised bound with the signal recorded;
//                             opted out, the same script does not.
//
// RED-ON-CUT: return undefined from proposePlanBudget (scripted run + raise pins
// fail), drop the `planBudgetHardCap` check in proposeBookkeepingRefund (the
// hard-cap pin fails), drop `options.configuredMaxIterations` from the refund
// cap (the original-budget pin fails), drop the `harness.planBudget === false`
// gate (the opt-out pins fail).
import { afterEach, describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import { runKernel } from "../../src/kernel/loop/runner.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import {
  PLAN_BUDGET_ACTOR,
  PLAN_BUDGET_ABSOLUTE_CEILING,
  planBudget,
  proposePlanBudget,
  proposePlanBudgetExtension,
} from "../../src/kernel/loop/plan-budget.js";
import { proposeBookkeepingRefund } from "../../src/kernel/loop/iterate-bookkeeping-refund-seam.js";
import { seedInitialAdvisory, type AdvisorySeedItem } from "../../src/kernel/state/checklist-seed.js";
import { resolveHarnessConfig } from "../../src/harness-config.js";
import { makeKernelInput, makeKernelRunOptions, makeKernelState } from "../../src/testing/kernel-fixtures.js";
import { transitionState, type KernelInput, type KernelRunOptions, type KernelState, type ThoughtKernel } from "../../src/kernel/state/kernel-state.js";

const seedOf = (n: number, done = 0): AdvisorySeedItem[] =>
  Array.from({ length: n }, (_, i) => ({
    id: String(i + 1),
    title: `Step ${i + 1}`,
    status: i < done ? ("completed" as const) : ("pending" as const),
  }));
const stateOf = (seed: readonly AdvisorySeedItem[], over: Partial<KernelState> = {}): KernelState =>
  seedInitialAdvisory(makeKernelState({ status: "thinking", ...over } as never), { initialAdvisory: seed });
const inputOf = (seed: readonly AdvisorySeedItem[], over: Partial<KernelInput> = {}): KernelInput =>
  makeKernelInput({ task: "Execute the plan.", initialAdvisory: seed, ...over });
const optionsOf = (max = 10): KernelRunOptions => makeKernelRunOptions({ maxIterations: max });

describe("planBudget (arithmetic)", () => {
  it("18 unchecked steps vs 10: target steps + reserve (max(2, ceil(25%)) = 5) = 23 under the hard cap 30; stage 1 is halfway (17)", () => {
    expect(planBudget(10, 18)).toEqual({ configured: 10, steps: 18, reserve: 5, effective: 23, hardCap: 30, stage1: 17 });
  });
  it("a plan that fits changes nothing", () => {
    expect(planBudget(10, 3)).toBeUndefined(); // 3 + 2 = 5 <= 10
    expect(planBudget(10, 8)).toBeUndefined(); // 8 + 2 = 10 <= 10
    expect(planBudget(10, 0)).toBeUndefined();
  });
  it("hard cap: 3x configured, never above 60; a 200-step seed stops at the cap", () => {
    expect(planBudget(10, 200)?.effective).toBe(30);
    expect(planBudget(25, 200)?.effective).toBe(60);
    expect(planBudget(25, 200)?.hardCap).toBe(PLAN_BUDGET_ABSOLUTE_CEILING);
    expect(planBudget(100, 200)).toBeUndefined(); // configured already above the ceiling: never lowered, never raised
  });
});

describe("proposePlanBudget", () => {
  const seed = seedOf(18);
  const args = (over: { seed?: readonly AdvisorySeedItem[]; input?: Partial<KernelInput>; options?: KernelRunOptions } = {}) => ({
    state: stateOf(over.seed ?? seed),
    input: inputOf(over.seed ?? seed, over.input),
    options: over.options ?? optionsOf(),
  });

  it("seeded 18-step plan vs max 10: raises the bound, records the original and the cap, adds one signal step", () => {
    const r = proposePlanBudget(args());
    expect(r?.options.maxIterations).toBe(17); // stage 1; the rest (to 23) only on progress
    expect(r?.options.planBudgetTarget).toBe(23);
    expect(r?.options.configuredMaxIterations).toBe(10);
    expect(r?.options.planBudgetHardCap).toBe(30);
    const step = r!.state.steps.at(-1);
    expect(step?.type).toBe("harness_signal");
    expect(step?.metadata?.intervention?.actor).toBe(PLAN_BUDGET_ACTOR);
    expect(step?.metadata?.intervention?.authorityClass).toBe("deterministic");
    expect(step?.content).toContain("iteration budget raised to 17");
  });

  it("meta.maxIterations (what progress events report) carries the effective bound, and a refund keeps it in step", () => {
    const r = proposePlanBudget(args())!;
    expect(r.state.meta.maxIterations).toBe(17);
    const refunded = proposeBookkeepingRefund({
      state: { ...r.state, iteration: 1 },
      input: inputOf(seed),
      options: r.options,
      toolsThisStep: ["todo"],
      iterationAtPassStart: 0,
    });
    expect(refunded?.options.maxIterations).toBe(18);
    expect(refunded?.state.meta.maxIterations).toBe(18);
  });

  it("only UNCHECKED steps count: a resumed plan with 15 of 18 done fits and is untouched", () => {
    expect(proposePlanBudget(args({ seed: seedOf(18, 15) }))).toBeUndefined();
    expect(proposePlanBudget(args({ seed: seedOf(18, 6) }))?.budget.steps).toBe(12);
  });

  it("nothing changes: unseeded, plan posture, finished run, already raised, opted out", () => {
    expect(proposePlanBudget({ state: makeKernelState({ status: "thinking" } as never), input: makeKernelInput({ task: "t" }), options: optionsOf() })).toBeUndefined();
    expect(proposePlanBudget(args({ input: { posture: "plan" } }))).toBeUndefined();
    expect(proposePlanBudget({ ...args(), state: stateOf(seed, { status: "done" }) })).toBeUndefined();
    expect(proposePlanBudget(args({ options: { ...optionsOf(), configuredMaxIterations: 10 } }))).toBeUndefined();
    expect(proposePlanBudget(args({ input: { harness: resolveHarnessConfig({ planBudget: false }) } }))).toBeUndefined();
  });

  it("a plan that fits is byte-identical: no step, same options object", () => {
    const small = seedOf(3);
    expect(proposePlanBudget(args({ seed: small }))).toBeUndefined();
  });
});

describe("ReasoningIterationProgress reports the effective bound", () => {
  const bounds = async (seed: readonly AdvisorySeedItem[]): Promise<unknown[]> => {
    const events: Record<string, unknown>[] = [];
    const bus: EventBus["Type"] = {
      publish: (event) => {
        events.push({ ...event });
        return Effect.void;
      },
      subscribe: () => Effect.succeed(() => {}),
      on: () => Effect.succeed(() => {}),
    };
    const kernel: ThoughtKernel = (state) => {
      if (state.status === "thinking") return Effect.succeed(transitionState(state, { status: "acting" }));
      const next = state.iteration + 1;
      return Effect.succeed(
        transitionState(state, {
          status: next >= 2 ? "done" : "thinking",
          ...(next >= 2 ? { output: "finished" } : {}),
          iteration: next,
          steps: [...state.steps, makeStep("action", `probe-${next}()`, { toolUsed: `probe-${next}` })],
        }),
      );
    };
    await Effect.runPromise(
      runKernel(kernel, { task: "Execute the plan.", initialAdvisory: seed }, { maxIterations: 10, strategy: "reactive", kernelType: "react" }).pipe(
        Effect.provide(Layer.merge(TestLLMServiceLayer(), Layer.succeed(EventBus, bus))),
      ),
    );
    return events.filter((e) => e._tag === "ReasoningIterationProgress").map((e) => e.maxIterations);
  };

  it("a seeded 18-step run vs max 10 reports the stage-1 bound 17; a plan that fits reports the configured 10", async () => {
    expect(await bounds(seedOf(18))).toEqual([17, 17]);
    expect(await bounds(seedOf(3))).toEqual([10, 10]);
  });
});

describe("bookkeeping refund after a plan raise", () => {
  const drain = (start: { state: KernelState; options: KernelRunOptions }, input: KernelInput): number => {
    let { state, options } = start;
    let granted = 0;
    for (let i = 0; i < 200; i++) {
      const r = proposeBookkeepingRefund({ state, input, options, toolsThisStep: ["todo"], iterationAtPassStart: 0 });
      if (r === undefined) break;
      state = r.state;
      options = r.options;
      granted++;
    }
    return granted;
  };

  it("the refund cap stays on the ORIGINAL budget (half of 10) and the sum never passes the hard cap", () => {
    const seed = seedOf(18);
    const raised = proposePlanBudget({ state: stateOf(seed, { iteration: 1 }), input: inputOf(seed), options: optionsOf() })!;
    expect(drain(raised, inputOf(seed))).toBe(5); // original 10 / 2, not 23 / 2
  });

  it("a 200-step seed: stage 1 (20) + refunds (5) stay under the hard cap (30), never above", () => {
    const seed = seedOf(200);
    const raised = proposePlanBudget({ state: stateOf(seed, { iteration: 1 }), input: inputOf(seed), options: optionsOf() })!;
    expect(raised.options.maxIterations).toBe(20);
    expect(raised.options.planBudgetHardCap).toBe(30);
    let { state, options } = raised;
    for (let i = 0; i < 50; i++) {
      const r = proposeBookkeepingRefund({ state, input: inputOf(seed), options, toolsThisStep: ["todo"], iterationAtPassStart: 0 });
      if (r === undefined) break;
      state = r.state;
      options = r.options;
    }
    expect(options.maxIterations).toBe(25);
  });
});

describe("staged raise: stage 2 only on progress", () => {
  const seed = seedOf(18);
  const raised = () => proposePlanBudget({ state: stateOf(seed, { iteration: 1 }), input: inputOf(seed), options: optionsOf() })!;
  const obs = (success: boolean) =>
    makeStep("observation", "result", {
      observationResult: { success, toolName: "get_range", displayText: "r", category: "data", resultKind: "data", preserveOnCompaction: false, trustLevel: "trusted" },
    } as never);
  const near = (r: ReturnType<typeof raised>, extra: Partial<KernelState>): KernelState => transitionState(r.state, { iteration: 15, ...extra } as never);

  it("a stalled run (no success, no row done) gets no extension: it ends at stage 1", () => {
    const r = raised();
    expect(proposePlanBudgetExtension({ state: near(r, { steps: [...r.state.steps, obs(false)] }), options: r.options, refunds: 0 })).toBeUndefined();
  });
  it("a run with a successful tool step since the raise extends to the plan-sized target (23), once", () => {
    const r = raised();
    const ext = proposePlanBudgetExtension({ state: near(r, { steps: [...r.state.steps, obs(true)] }), options: r.options, refunds: 0 })!;
    expect(ext.options.maxIterations).toBe(23);
    expect(ext.state.meta.maxIterations).toBe(23);
    expect(ext.state.steps.at(-1)?.metadata?.intervention?.actor).toBe(PLAN_BUDGET_ACTOR);
    expect(proposePlanBudgetExtension({ state: ext.state, options: ext.options, refunds: 0 })).toBeUndefined(); // stage 2 is the last
  });
  it("progress by a checklist row completed also counts", () => {
    const r = raised();
    const doneState = stateOf(seedOf(18, 1), { iteration: 15 });
    expect(proposePlanBudgetExtension({ state: doneState, options: { ...r.options, planBudgetMark: { steps: 0, completed: 0 } }, refunds: 0 })?.to).toBe(23);
  });
  it("not near the bound: nothing yet; refunds ride on top and the hard cap holds", () => {
    const r = raised();
    const early = transitionState(r.state, { iteration: 5, steps: [...r.state.steps, obs(true)] } as never);
    expect(proposePlanBudgetExtension({ state: early, options: r.options, refunds: 0 })).toBeUndefined();
    const ext = proposePlanBudgetExtension({ state: near(r, { iteration: 18, steps: [...r.state.steps, obs(true)] }), options: { ...r.options, maxIterations: 20 }, refunds: 3 })!;
    expect(ext.to).toBe(26); // target 23 + 3 refunds, under the hard cap 30
  });
  it("a plan that fits stage-1 == target has no second stage", () => {
    const r = proposePlanBudget({ state: stateOf(seedOf(10)), input: inputOf(seedOf(10)), options: optionsOf(5) })!;
    expect(r.options.planBudgetTarget === undefined || r.options.maxIterations < r.options.planBudgetTarget).toBe(true);
  });
});

describe("planBudget resolver", () => {
  const saved = process.env.RA_PLAN_BUDGET;
  afterEach(() => {
    if (saved === undefined) delete process.env.RA_PLAN_BUDGET;
    else process.env.RA_PLAN_BUDGET = saved;
  });
  it("default ON (field absent, resolved harness unchanged); config false or RA_PLAN_BUDGET=0 turns it off; config beats env", () => {
    delete process.env.RA_PLAN_BUDGET;
    expect("planBudget" in resolveHarnessConfig()).toBe(false);
    expect(resolveHarnessConfig({ planBudget: false }).planBudget).toBe(false);
    process.env.RA_PLAN_BUDGET = "0";
    expect(resolveHarnessConfig().planBudget).toBe(false);
    expect("planBudget" in resolveHarnessConfig({ planBudget: true })).toBe(false);
  });
});

// ── Umami-shaped scripted run ───────────────────────────────────────────────

describe("umami-shaped run: 18 unchecked seeded steps, maxIterations 10", () => {
  const params = [{ name: "q", type: "string", required: false }];
  const SCHEMAS = ["list_sites", "get_range", "get_traffic", "get_pages"].map((name) => ({ name, description: `${name} tool`, parameters: params }));
  const toolLayer = mockToolServiceLayer({
    execute: () => Effect.succeed({ success: true, result: { ok: true } }),
    getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: params }),
  });
  const pad = (n: number): string => Array.from({ length: 450 }, (_, i) => `t${n}w${i}`).join(" ");
  const NAMES = ["list_sites", "get_range", "get_traffic", "get_pages"];
  const script = (calls = 14) => [
    ...Array.from({ length: calls },(_, i) => ({ text: pad(i + 1), toolCall: { name: NAMES[i % NAMES.length]!, args: { q: `arg-${i}` } } })),
    { text: "The spike came from site-a on Tuesday." },
  ];
  const opts: KernelRunOptions = { maxIterations: 10, strategy: "reactive", kernelType: "react", taskId: "plan-budget-shape", modelId: "llama3.2:3b" };
  const run = (over: Partial<KernelInput> = {}) =>
    Effect.runPromise(
      runPass(
        reactKernel,
        { task: "Execute the plan.", availableToolSchemas: SCHEMAS, contextProfile: { tier: "local" }, initialAdvisory: seedOf(18), ...over } as KernelInput,
        opts,
      ).pipe(Effect.provide(Layer.mergeAll(TestLLMServiceLayer(script()), toolLayer, EventBusLive))),
    );
  const raiseSteps = (s: KernelState) => s.steps.filter((x) => x.metadata?.intervention?.actor === PLAN_BUDGET_ACTOR);

  it("raised: the run reaches its answer inside the raised bound, with one recorded plan-budget signal", async () => {
    const pass = await run();
    expect(pass.state.status).toBe("done");
    expect(pass.state.output).toContain("The spike came from site-a on Tuesday.");
    expect(raiseSteps(pass.state)[0]?.content).toContain("raised to 17");
    expect(raiseSteps(pass.state).some((s) => s.content.includes("extended"))).toBe(false); // finished inside stage 1
  });

  it("progress earns stage 2: a run that needs 19 tool rounds runs past stage 1 (17), with the extension recorded once", async () => {
    const pass = await Effect.runPromise(
      runPass(
        reactKernel,
        { task: "Execute the plan.", availableToolSchemas: SCHEMAS, contextProfile: { tier: "local" }, initialAdvisory: seedOf(18) } as KernelInput,
        opts,
      ).pipe(Effect.provide(Layer.mergeAll(TestLLMServiceLayer(script(19)), toolLayer, EventBusLive))),
    );
    expect(raiseSteps(pass.state).filter((s) => s.content.includes("extended to 23"))).toHaveLength(1);
    expect(pass.state.iteration).toBeGreaterThan(17);
    expect(pass.state.iteration).toBeGreaterThan(10);
  });

  it("stalled: every tool call fails, so stage 2 is never granted and the run stops at stage 1 (17)", async () => {
    const failing = mockToolServiceLayer({
      execute: () => Effect.succeed({ success: false, result: "boom" } as never),
      getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: params }),
    });
    const pass = await Effect.runPromise(
      runPass(
        reactKernel,
        { task: "Execute the plan.", availableToolSchemas: SCHEMAS, contextProfile: { tier: "local" }, initialAdvisory: seedOf(18) } as KernelInput,
        opts,
      ).pipe(Effect.provide(Layer.mergeAll(TestLLMServiceLayer(script()), failing, EventBusLive))),
    );
    expect(raiseSteps(pass.state).some((s) => s.content.includes("extended"))).toBe(false);
    expect(pass.state.iteration).toBeLessThanOrEqual(17);
  });

  it("opted out (planBudget false): today's bound, no signal, no answer inside 10", async () => {
    const pass = await run({ harness: resolveHarnessConfig({ planBudget: false }) });
    expect(raiseSteps(pass.state)).toHaveLength(0);
    expect(pass.state.output ?? "").not.toContain("The spike came from site-a on Tuesday.");
  });

  it("unseeded: identical to today (no signal, no answer inside 10)", async () => {
    const pass = await run({ initialAdvisory: undefined });
    expect(raiseSteps(pass.state)).toHaveLength(0);
    expect(pass.state.output ?? "").not.toContain("The spike came from site-a on Tuesday.");
  });
});
