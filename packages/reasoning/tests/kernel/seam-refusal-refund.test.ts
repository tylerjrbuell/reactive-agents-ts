// Run: bun test packages/reasoning/tests/kernel/seam-refusal-refund.test.ts --timeout 20000
//
// A round of only refused duplicate calls does not spend the iteration budget
// (cogito todo-heavy, live addendum 6 cause E: refused re-reads burned the
// 14-iteration cap with one output unwritten). Bounded: 3 refused rounds in a row
// (only a call that ran resets the count) and the shared half-budget cap.
//
// RED-ON-CUT: return undefined from proposeRefusalRefund (the scripted run loses its
// answer inside the budget); drop the MAX_CONSECUTIVE_REFUSAL_REFUNDS check (the
// bound pin sees more than 3 refunds).
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBusLive } from "@reactive-agents/core";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import { DUPLICATE_REFUSAL_TAG } from "../../src/kernel/capabilities/act/guard.js";
import { bookkeepingRefundsIssued } from "../../src/kernel/loop/iterate-bookkeeping-refund-seam.js";
import {
  consecutiveRefusalRefunds,
  MAX_CONSECUTIVE_REFUSAL_REFUNDS,
  proposeRefusalRefund,
} from "../../src/kernel/loop/iterate-refusal-refund-seam.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { blockedCallSteps, makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import { makeKernelInput, makeKernelRunOptions, makeKernelState } from "../../src/testing/kernel-fixtures.js";
import type { KernelInput, KernelRunOptions, KernelState } from "../../src/kernel/state/kernel-state.js";
import type { ReasoningStep } from "../../src/types/index.js";

const call = (id: string, q = "same") => ({ id, name: "get_range", arguments: { q } });
const refused = (id: string): ReasoningStep[] => blockedCallSteps(call(id), `prior result [${DUPLICATE_REFUSAL_TAG} Read b first.]`, true, { guard: true, toolUsed: true });
const otherRefusal = (id: string): ReasoningStep[] => blockedCallSteps(call(id), "You called get_range 5 times already.", true, { guard: true, toolUsed: true });
const ran = (id: string): ReasoningStep[] => [
  makeStep("action", "get_range", { toolCall: call(id), toolUsed: "get_range" }),
  makeStep("observation", "ok", { toolCallId: id, observationResult: makeObservationResult("get_range", true, "ok") }),
];

const options = (max = 14): KernelRunOptions => makeKernelRunOptions({ maxIterations: max });
const stateOf = (steps: ReasoningStep[], iteration = 3): KernelState => makeKernelState({ status: "thinking", iteration, steps } as never);
const args = (round: ReasoningStep[], prior: ReasoningStep[] = [], over: Partial<Parameters<typeof proposeRefusalRefund>[0]> = {}) => ({
  state: stateOf([...prior, ...round]),
  input: makeKernelInput({ task: "t" }),
  options: options(),
  roundSteps: round,
  iterationAtPassStart: 2,
  ...over,
});

describe("proposeRefusalRefund", () => {
  it("a round of only refused duplicates raises the bound by one and records the refund", () => {
    const r = proposeRefusalRefund(args([...refused("d1"), ...refused("d2")]));
    expect(r?.options.maxIterations).toBe(15);
    expect(bookkeepingRefundsIssued(r!.state)).toBe(1);
    expect(r!.state.steps.at(-1)?.type).toBe("harness_signal");
  });

  it("nothing changes: a call that ran, a mixed round, another refusal, no call, a think pass, the switch off, a finished run", () => {
    expect(proposeRefusalRefund(args(ran("a")))).toBeUndefined();
    expect(proposeRefusalRefund(args([...refused("d1"), ...ran("a")]))).toBeUndefined();
    expect(proposeRefusalRefund(args(otherRefusal("o1")))).toBeUndefined();
    expect(proposeRefusalRefund(args([]))).toBeUndefined();
    expect(proposeRefusalRefund(args(refused("d1"), [], { iterationAtPassStart: 3 }))).toBeUndefined();
    expect(proposeRefusalRefund(args(refused("d1"), [], { input: makeKernelInput({ task: "t", harness: { bookkeepingRefund: false } } as Partial<KernelInput>) }))).toBeUndefined();
    expect(proposeRefusalRefund({ ...args(refused("d1")), state: makeKernelState({ status: "done", iteration: 3, steps: refused("d1") } as never) })).toBeUndefined();
  });
});

describe("refusal refund bound", () => {
  it("stops at MAX_CONSECUTIVE_REFUSAL_REFUNDS refused rounds in a row", () => {
    let state = stateOf([]);
    let opts = options();
    let granted = 0;
    for (let n = 0; n < 10; n++) {
      const round = refused(`d${n}`);
      const withRound = { ...state, iteration: state.iteration + 1, steps: [...state.steps, ...round] };
      const r = proposeRefusalRefund({ state: withRound, input: makeKernelInput({ task: "t" }), options: opts, roundSteps: round, iterationAtPassStart: state.iteration });
      state = r?.state ?? withRound;
      opts = r?.options ?? opts;
      if (r !== undefined) granted++;
    }
    expect(granted).toBe(MAX_CONSECUTIVE_REFUSAL_REFUNDS);
    expect(consecutiveRefusalRefunds(state)).toBe(MAX_CONSECUTIVE_REFUSAL_REFUNDS);
  });

  it("a call that ran resets the streak", () => {
    const streak = [...refused("d1"), makeStep("harness_signal", "r", { intervention: { actor: "bookkeeping-refund", authorityClass: "deterministic", evidence: "e", whatChanged: "bookkeeping-refund: the refused-duplicate round did not count against maxIterations", iter: 1 } })];
    expect(consecutiveRefusalRefunds(stateOf(streak))).toBe(1);
    expect(consecutiveRefusalRefunds(stateOf([...streak, ...ran("a")]))).toBe(0);
  });
});

// ── scripted run: the refund is wired into the loop ──────────────────────────

describe("scripted run: refused re-reads, maxIterations 5", () => {
  const SCHEMAS = ["get_range", "get_other", "get_third"].map((name) => ({ name, description: `${name} tool`, parameters: [{ name: "q", type: "string", required: false }] }));
  const toolLayer = mockToolServiceLayer({
    // Distinct results: identical ones read as a stall to the stall-deliverable exit.
    execute: (req: { readonly arguments: unknown }) => Effect.succeed({ success: true, result: { value: `result for ${JSON.stringify(req.arguments)}` } }),
    getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: [{ name: "q", type: "string", required: false }] }),
  });
  const pad = (n: number): string => Array.from({ length: 450 }, (_, i) => `t${n}w${i}`).join(" ");
  const turn = (n: number, name: string, q: string) => ({ text: pad(n), toolCall: { name, args: { q } } });
  const opts: KernelRunOptions = { maxIterations: 5, strategy: "reactive", kernelType: "react", taskId: "refusal-shape", modelId: "llama3.2:3b" };
  const run = (script: unknown[]) =>
    Effect.runPromise(
      runPass(reactKernel, { task: "Query get_range with a, get_other with b and get_third with c, then say what came back.", availableToolSchemas: SCHEMAS, requiredTools: ["get_third"], contextProfile: { tier: "local" } } as KernelInput, opts).pipe(
        Effect.provide(Layer.mergeAll(TestLLMServiceLayer(script as never), toolLayer, EventBusLive)),
      ),
    );

  it("a refused re-read does not stop the run reaching its answer inside the budget", async () => {
    const pass = await run([
      turn(1, "get_range", "a"), turn(2, "get_range", "a"),
      turn(3, "get_other", "b"), turn(4, "get_third", "c"), turn(5, "get_third", "d"),
      { text: "Done: a, b, c and d fetched." },
    ]);
    expect(pass.state.output).toContain("Done: a, b, c and d fetched.");
    expect(bookkeepingRefundsIssued(pass.state)).toBe(1);
  });

  it("an endless re-read loop is granted at most 3 free turns, then spends the budget", async () => {
    const pass = await run([turn(1, "get_range", "a"), ...Array.from({ length: 12 }, (_, i) => turn(i + 2, "get_range", "a"))]);
    // Another exit (stall / loop) may end it sooner; the exact bound is the unit pin above.
    expect(bookkeepingRefundsIssued(pass.state)).toBeLessThanOrEqual(MAX_CONSECUTIVE_REFUSAL_REFUNDS);
    expect(pass.state.iteration).toBeLessThanOrEqual(opts.maxIterations + MAX_CONSECUTIVE_REFUSAL_REFUNDS);
  });
});
