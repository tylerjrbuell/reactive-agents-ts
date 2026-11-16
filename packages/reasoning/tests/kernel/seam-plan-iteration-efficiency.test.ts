// Run: bun test packages/reasoning/tests/kernel/seam-plan-iteration-efficiency.test.ts --timeout 20000
//
// Execute-phase iteration efficiency on a run SEEDED with a plan checklist
// (Cortex trace 01M7JHP80MHNZ35EVPS42JBD7T: todo-only turns ate the budget, the
// run hit maxIterations with no answer). Levers pinned here:
//   proposeBookkeepingRefund — a todo-only act round does not spend the budget
//                              (bounded to half of it; seeded runs only);
//   wrapUpReserve            — opt-in (RA_WRAPUP_RESERVE=1): the last think call
//                              withholds tools and asks for an answer;
//   umami-shaped scripted run — seven todo-only turns + three real calls reach an
//                              answer inside maxIterations 10; the same script
//                              without a seed does not (behavior unchanged).
// (The auto-tick lever is pinned in seam-plan-steps.test.ts.)
//
// RED-ON-CUT: return undefined from proposeBookkeepingRefund (the scripted run
// stops reaching its answer), drop the `initialAdvisory` gate (the unseeded
// script then reaches it), drop the cap check (the cap pin fails), drop the
// `harness.wrapUpReserve` check or the seed gate in wrapUpReserve (flag/seed
// pins fail).
import { afterEach, describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBusLive, foldAdvisory } from "@reactive-agents/core";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import { reserveBudgetAnswerTurn } from "../../src/kernel/loop/budget-answer-turn.js";
import {
  BOOKKEEPING_REFUND_ACTOR,
  bookkeepingRefundsIssued,
  proposeBookkeepingRefund,
} from "../../src/kernel/loop/iterate-bookkeeping-refund-seam.js";
import { wrapUpReserve } from "../../src/kernel/loop/wrap-up-reserve.js";
import { seedInitialAdvisory } from "../../src/kernel/state/checklist-seed.js";
import { resolveHarnessConfig } from "../../src/harness-config.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import { makeKernelInput, makeKernelRunOptions, makeKernelState } from "../../src/testing/kernel-fixtures.js";
import type { KernelInput, KernelRunOptions, KernelState } from "../../src/kernel/state/kernel-state.js";

const SEED = [
  { id: "1", title: "List the sites", status: "pending" as const, tool: "list_sites" },
  { id: "2", title: "Get the date range", status: "pending" as const, tool: "get_range" },
  { id: "3", title: "Get the traffic", status: "pending" as const, tool: "get_traffic" },
];

const seededState = (over: Partial<KernelState> = {}): KernelState =>
  seedInitialAdvisory(makeKernelState({ status: "thinking", ...over } as never), { initialAdvisory: SEED });
const seededInput = (over: Partial<KernelInput> = {}): KernelInput =>
  makeKernelInput({ task: "Execute the plan.", initialAdvisory: SEED, ...over });

// ── bookkeeping refund (unit) ───────────────────────────────────────────────

describe("proposeBookkeepingRefund", () => {
  const options = (max = 10): KernelRunOptions => makeKernelRunOptions({ maxIterations: max });
  const base = (over: Partial<Parameters<typeof proposeBookkeepingRefund>[0]> = {}) => ({
    state: seededState({ iteration: 1 }),
    input: seededInput(),
    options: options(),
    toolsThisStep: ["todo"],
    iterationAtPassStart: 0,
    ...over,
  });

  it("a todo-only act round on a seeded run raises the bound by one and records the refund", () => {
    const r = proposeBookkeepingRefund(base());
    expect(r?.options.maxIterations).toBe(11);
    expect(bookkeepingRefundsIssued(r!.state)).toBe(1);
    expect(r!.state.steps.at(-1)?.metadata?.intervention?.actor).toBe(BOOKKEEPING_REFUND_ACTOR);
    expect(r!.state.steps.at(-1)?.type).toBe("harness_signal");
  });

  it("nothing changes: a real call in the round, no call, a think pass (no iteration spent), no seed, plan posture, a finished run", () => {
    expect(proposeBookkeepingRefund(base({ toolsThisStep: ["todo", "list_sites"] }))).toBeUndefined();
    expect(proposeBookkeepingRefund(base({ toolsThisStep: ["list_sites"] }))).toBeUndefined();
    expect(proposeBookkeepingRefund(base({ toolsThisStep: [] }))).toBeUndefined();
    expect(proposeBookkeepingRefund(base({ iterationAtPassStart: 1 }))).toBeUndefined();
    expect(proposeBookkeepingRefund(base({ input: makeKernelInput({ task: "t" }) }))).toBeUndefined();
    expect(proposeBookkeepingRefund(base({ input: seededInput({ posture: "plan" }) }))).toBeUndefined();
    expect(proposeBookkeepingRefund(base({ state: seededState({ iteration: 1, status: "done" }) }))).toBeUndefined();
  });

  it("bounded: at most half of the ORIGINAL budget is refunded, however far the bound has been raised", () => {
    let state = seededState({ iteration: 1 });
    let opts = options(10);
    let granted = 0;
    for (let i = 0; i < 20; i++) {
      const r = proposeBookkeepingRefund({ state, input: seededInput(), options: opts, toolsThisStep: ["todo"], iterationAtPassStart: 0 });
      if (r === undefined) break;
      state = r.state;
      opts = r.options;
      granted++;
    }
    expect(granted).toBe(5);
    expect(opts.maxIterations).toBe(15);
  });
});

// ── wrap-up reserve (unit) ──────────────────────────────────────────────────

describe("wrapUpReserve (opt-in)", () => {
  const saved = process.env.RA_WRAPUP_RESERVE;
  afterEach(() => {
    if (saved === undefined) delete process.env.RA_WRAPUP_RESERVE;
    else process.env.RA_WRAPUP_RESERVE = saved;
  });
  const ON = (): KernelInput["harness"] => {
    process.env.RA_WRAPUP_RESERVE = "1";
    return resolveHarnessConfig();
  };
  const evidence = [
    makeStep("action", "list_sites({})", { toolCall: { id: "c1", name: "list_sites", arguments: {} } }),
    makeStep("observation", "site-a, site-b", { toolCallId: "c1", observationResult: makeObservationResult("list_sites", true, "site-a, site-b") }),
  ];
  const lastCall = (): KernelState =>
    seededState({ iteration: 9, llmCalls: 9, steps: evidence, toolsUsed: new Set(["list_sites"]) } as never);

  it("resolves off by default and on from RA_WRAPUP_RESERVE=1", () => {
    delete process.env.RA_WRAPUP_RESERVE;
    expect("wrapUpReserve" in resolveHarnessConfig()).toBe(false);
    process.env.RA_WRAPUP_RESERVE = "1";
    expect(resolveHarnessConfig().wrapUpReserve).toBe(true);
  });

  it("config wins over env: config true beats an unset env, config false beats RA_WRAPUP_RESERVE=1", () => {
    delete process.env.RA_WRAPUP_RESERVE;
    expect(resolveHarnessConfig({ wrapUpReserve: true }).wrapUpReserve).toBe(true);
    process.env.RA_WRAPUP_RESERVE = "1";
    expect("wrapUpReserve" in resolveHarnessConfig({ wrapUpReserve: false })).toBe(false);
  });

  it("flag on, seeded, last call, evidence: an answer-turn record (tools withheld) and a hint naming the unfinished steps", () => {
    const r = wrapUpReserve(lastCall(), seededInput({ harness: ON() }), true);
    expect(r?.record.gateDecision).toBe("deny-once");
    expect(r?.record.answerTurnAt).toBe(9);
    expect(r?.hint).toContain("Answer now from the evidence gathered");
    expect(r?.hint).toContain("state plainly what is unfinished");
    expect(r?.hint).toContain("[1] List the sites");
    expect(r?.hint).toContain("[3] Get the traffic");
  });

  it("nothing: flag off, not the last call, no seed, plan posture, no evidence", () => {
    const harness = ON();
    expect(wrapUpReserve(lastCall(), seededInput({ harness: resolveHarnessConfig({}) === harness ? harness : undefined }), true)).toBeUndefined();
    expect(wrapUpReserve(lastCall(), seededInput({ harness }), false)).toBeUndefined();
    expect(wrapUpReserve(lastCall(), makeKernelInput({ task: "t", harness }), true)).toBeUndefined();
    expect(wrapUpReserve(lastCall(), seededInput({ harness, posture: "plan" }), true)).toBeUndefined();
    expect(wrapUpReserve(seededState({ iteration: 9, llmCalls: 9 }), seededInput({ harness }), true)).toBeUndefined();
  });

  it("reserveBudgetAnswerTurn takes it: gate step + the wrap-up hint as guidance; a second call at the same count reserves nothing", async () => {
    const input = seededInput({ harness: ON() });
    const state = lastCall();
    const after = await Effect.runPromise(
      reserveBudgetAnswerTurn({ state, input, maxIterations: 10, taskId: "t" }).pipe(Effect.provide(EventBusLive)),
    );
    expect(after.steps.at(-1)?.metadata?.exitGate?.answerTurnAt).toBe(9);
    expect(after.pendingGuidance?.qualityGateHint).toContain("state plainly what is unfinished");
    const again = await Effect.runPromise(
      reserveBudgetAnswerTurn({ state: after, input, maxIterations: 10, taskId: "t" }).pipe(Effect.provide(EventBusLive)),
    );
    expect(again).toBe(after);
  });
});

// ── umami-shaped scripted run ───────────────────────────────────────────────

describe("umami-shaped run: todo-only turns, one real call per turn, maxIterations 10", () => {
  const schema = (name: string, params = [{ name: "q", type: "string", required: false }]) => ({ name, description: `${name} tool`, parameters: params });
  const SCHEMAS = [
    { name: "todo", description: "checklist", parameters: [{ name: "action", type: "string", required: true }, { name: "items", type: "array", required: false }, { name: "id", type: "number", required: false }] },
    schema("list_sites"),
    schema("get_range"),
    schema("get_traffic"),
  ];
  const toolLayer = mockToolServiceLayer({
    execute: () => Effect.succeed({ success: true, result: { ok: true } }),
    getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: [{ name: "q", type: "string", required: false }] }),
  });
  const pad = (n: number): string => Array.from({ length: 450 }, (_, i) => `t${n}w${i}`).join(" ");
  const turn = (n: number, name: string, args: Record<string, unknown>) => ({ text: pad(n), toolCall: { name, args } });
  const todoOnly = (n: number) => turn(n, "todo", { action: "add", items: [`extra bookkeeping row number ${n} ${"x".repeat(n)}`] });
  const script = () => [
    todoOnly(1), todoOnly(2), todoOnly(3),
    turn(4, "list_sites", { q: "all" }),
    todoOnly(5), todoOnly(6),
    turn(7, "get_range", { q: "site-a" }),
    todoOnly(8), todoOnly(9),
    turn(10, "get_traffic", { q: "site-a-week" }),
    { text: "The spike came from site-a on Tuesday." },
  ];
  const opts: KernelRunOptions = { maxIterations: 10, strategy: "reactive", kernelType: "react", taskId: "umami-shape", modelId: "llama3.2:3b" };
  const run = (inp: KernelInput) =>
    Effect.runPromise(
      runPass(reactKernel, inp, opts).pipe(Effect.provide(Layer.mergeAll(TestLLMServiceLayer(script()), toolLayer, EventBusLive))),
    );
  const base = (over: Partial<KernelInput> = {}): KernelInput =>
    ({ task: "Execute the plan.", availableToolSchemas: SCHEMAS, metaTools: { todo: true }, contextProfile: { tier: "local" }, ...over }) as KernelInput;

  it("seeded: the refund lets the run reach its answer, the hinted steps are ticked by the harness", async () => {
    const pass = await run(base({ initialAdvisory: SEED }));
    expect(pass.state.status).toBe("done");
    expect(pass.state.output).toContain("The spike came from site-a on Tuesday.");
    expect(bookkeepingRefundsIssued(pass.state)).toBeGreaterThan(0);
    const facts = (pass.state.ledger ?? []).flatMap((e) => (e.kind === "checklist-item" ? [e] : []));
    const items = foldAdvisory(facts);
    expect(items.filter((i) => ["1", "2", "3"].includes(i.id)).map((i) => i.status)).toEqual(["completed", "completed", "completed"]);
  });

  it("not seeded: the same script spends the budget on its todo turns (no answer inside 10), no refund recorded", async () => {
    const pass = await run(base());
    expect(pass.state.output ?? "").not.toContain("The spike came from site-a on Tuesday.");
    expect(bookkeepingRefundsIssued(pass.state)).toBe(0);
  });
});
