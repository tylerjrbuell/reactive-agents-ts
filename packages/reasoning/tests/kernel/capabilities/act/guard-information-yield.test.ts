/**
 * repetitionGuard blocks on information yield, not on a tool-name count.
 *
 * Owner repro (Cortex, umami analysis task): five `umami/get_website_metrics`
 * calls with different `type` arguments each returned a different ranking, and
 * the 5th was refused with "You have already called umami/get_website_metrics 4
 * times. Stop repeating this tool." The name contains `get`, so it was
 * parallel-safe with a ceiling of maxBatchSize (4), and the distinct-arguments
 * carve-out explicitly excluded parallel-safe tools.
 *
 * Repetition now means "the tool stopped producing new information": the last
 * 2 results of that tool were empty, failed, or duplicated an earlier result.
 * A hard backstop (max(threshold, ceil(maxIterations * 0.75)) calls) still
 * bounds a run of distinct, yielding calls.
 */
import { describe, it, expect } from "bun:test";
import type { ToolCallSpec } from "@reactive-agents/tools";
import { repetitionGuard } from "../../../../src/kernel/capabilities/act/guard.js";
import { makeStep } from "../../../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../../../src/kernel/utils/observation-helpers.js";
import { initialKernelState, type KernelState, type KernelInput } from "../../../../src/kernel/state/kernel-state.js";
import type { ReasoningStep } from "../../../../src/types/index.js";
import { withEvidence } from "../../tool-evidence-fixture.js";

const METRICS = "umami/get_website_metrics";

let seq = 0;
function call(name: string, args: Record<string, unknown>): ToolCallSpec {
  seq += 1;
  return { id: `c${seq}`, name, arguments: args };
}

/** An executed call: action + its tool observation. */
function ran(tc: ToolCallSpec, result: string, opts: { success?: boolean; storedKey?: string } = {}): ReasoningStep[] {
  const success = opts.success ?? true;
  return [
    makeStep("action", `${tc.name}(${JSON.stringify(tc.arguments)})`, { toolCall: tc }),
    makeStep("observation", result, {
      toolCallId: tc.id,
      ...(opts.storedKey !== undefined ? { storedKey: opts.storedKey } : {}),
      observationResult: makeObservationResult(tc.name, success, result),
    }),
  ];
}

function stateOf(steps: ReasoningStep[], meta: Record<string, unknown> = {}): KernelState {
  const base = initialKernelState({ maxIterations: 20, strategy: "react-kernel", kernelType: "react", taskId: "yield" });
  return withEvidence({ ...base, steps, meta: { ...base.meta, ...meta } } as KernelState);
}

const input = { requiredToolQuantities: {}, nextMovesPlanning: { maxBatchSize: 4 } } as KernelInput;

const metricTypes = ["url", "referrer", "country", "browser", "os", "device", "event", "language"];

describe("repetitionGuard — information yield (a): distinct query args with distinct results run", () => {
  it("lets 8 get_* metrics queries with distinct args and distinct results all pass", () => {
    const steps: ReasoningStep[] = [];
    for (const type of metricTypes) {
      const tc = call(METRICS, { websiteId: "w1", type, startAt: "2026-10-01" });
      expect(repetitionGuard(tc, stateOf(steps), input)).toEqual({ pass: true });
      steps.push(...ran(tc, JSON.stringify([{ x: `${type}-top`, y: type.length * 7 }])));
    }
  });

  it("lets a read-only tool with the same url target but different query args pass while it yields", () => {
    const steps: ReasoningStep[] = [];
    for (const section of ["intro", "pricing", "faq", "team", "careers", "blog"]) {
      const tc = call("page-get", { url: "https://example.com", section });
      expect(repetitionGuard(tc, stateOf(steps), input)).toEqual({ pass: true });
      steps.push(...ran(tc, `section ${section}: body of ${section}`));
    }
  });
});

describe("repetitionGuard — information yield (b): last 2 results added nothing", () => {
  it("nudges when the last 2 results duplicate earlier results", () => {
    const steps: ReasoningStep[] = [
      ...ran(call(METRICS, { type: "url" }), "rows: /a 10, /b 5"),
      ...ran(call(METRICS, { type: "referrer" }), "rows: google 9"),
      ...ran(call(METRICS, { type: "country" }), "rows: /a 10, /b 5"),
      ...ran(call(METRICS, { type: "browser" }), "rows: google 9"),
    ];
    const outcome = repetitionGuard(call(METRICS, { type: "os" }), stateOf(steps), input);
    expect(outcome.pass).toBe(false);
    if (!outcome.pass) {
      expect(outcome.observation).toContain(`You have already called ${METRICS} 4 times. Stop repeating this tool.`);
      expect(outcome.observation).toContain("last 2 results added no new information");
    }
  });

  it("nudges when the last 2 results are empty", () => {
    const steps: ReasoningStep[] = [
      ...ran(call(METRICS, { type: "url" }), "rows: /a 10"),
      ...ran(call(METRICS, { type: "referrer" }), "rows: google 9"),
      ...ran(call(METRICS, { type: "country" }), "[]"),
      ...ran(call(METRICS, { type: "browser" }), "   "),
    ];
    expect(repetitionGuard(call(METRICS, { type: "os" }), stateOf(steps), input).pass).toBe(false);
  });

  it("does not nudge on a single no-new-info result (N = 2)", () => {
    const steps: ReasoningStep[] = [
      ...ran(call(METRICS, { type: "url" }), "rows: /a 10"),
      ...ran(call(METRICS, { type: "referrer" }), "rows: google 9"),
      ...ran(call(METRICS, { type: "country" }), "rows: US 4"),
      ...ran(call(METRICS, { type: "browser" }), "rows: US 4"),
    ];
    expect(repetitionGuard(call(METRICS, { type: "os" }), stateOf(steps), input)).toEqual({ pass: true });
  });
});

describe("repetitionGuard — information yield (c): research runaway", () => {
  it("stops varied web-search queries that keep returning the same results", () => {
    const same = "1. Example Domain - https://example.com\n2. Example Org - https://example.org";
    const steps: ReasoningStep[] = ["best rust web framework", "top rust web frameworks", "rust web framework 2026", "rust http frameworks"]
      .flatMap((query) => ran(call("web-search", { query }), same));
    const outcome = repetitionGuard(call("web-search", { query: "rust web framework comparison" }), stateOf(steps), input);
    expect(outcome.pass).toBe(false);
    if (!outcome.pass) expect(outcome.observation).toContain("Stop repeating this tool");
  });

  it("lets varied web-search queries past 4 while each returns new results", () => {
    const steps: ReasoningStep[] = ["axum", "actix", "rocket", "warp", "poem"]
      .flatMap((query) => ran(call("web-search", { query }), `1. ${query} docs - https://${query}.rs`));
    expect(repetitionGuard(call("web-search", { query: "salvo" }), stateOf(steps), input)).toEqual({ pass: true });
  });

  it("blocks distinct, yielding calls at the hard backstop max(threshold, ceil(maxIterations * 0.75))", () => {
    const small = { maxIterations: 8 }; // the run's budget (state.meta) → backstop = max(4, 6) = 6
    const steps: ReasoningStep[] = metricTypes.slice(0, 6)
      .flatMap((type) => ran(call(METRICS, { type }), `rows for ${type}`));
    const outcome = repetitionGuard(call(METRICS, { type: "language" }), stateOf(steps, small), input);
    expect(outcome.pass).toBe(false);
    const underBackstop = steps.slice(0, 10); // 5 prior calls
    expect(repetitionGuard(call(METRICS, { type: "language" }), stateOf(underBackstop, small), input)).toEqual({ pass: true });
  });
});

describe("repetitionGuard — an exhausted stall only blocks the tool that feeds it", () => {
  const stall = (refs: Record<string, number>) => ({
    assessment: {
      requirementProgress: new Map([["enumerate-pages", { stallCount: 5, refEscalation: new Map(Object.entries(refs)) }]]),
    },
  });

  it("an unrelated exhausted stall does not block a yielding query tool", () => {
    const steps: ReasoningStep[] = metricTypes.slice(0, 4)
      .flatMap((type) => ran(call(METRICS, { type }), `rows for ${type}`));
    const outcome = repetitionGuard(call(METRICS, { type: "os" }), stateOf(steps, stall({ _tool_result_99: 4 })), input);
    expect(outcome).toEqual({ pass: true });
  });

  it("an unrelated exhausted stall is not named when a non-yielding tool is nudged", () => {
    const steps: ReasoningStep[] = ["url", "referrer", "country", "browser"]
      .flatMap((type) => ran(call(METRICS, { type }), "same rows", { storedKey: `_tool_result_${type}` }));
    const outcome = repetitionGuard(call(METRICS, { type: "os" }), stateOf(steps, stall({ _tool_result_99: 4 })), input);
    expect(outcome.pass).toBe(false);
    if (!outcome.pass) expect(outcome.observation).not.toContain("enumerate-pages");
  });

  it("a stall this tool feeds, with no new information, blocks and names the requirement", () => {
    const steps: ReasoningStep[] = [
      ...ran(call(METRICS, { type: "url" }), "page 1 rows", { storedKey: "_tool_result_1" }),
      ...ran(call(METRICS, { type: "referrer" }), "page 2 rows", { storedKey: "_tool_result_2" }),
      ...ran(call(METRICS, { type: "country" }), "page 1 rows", { storedKey: "_tool_result_3" }),
      ...ran(call(METRICS, { type: "browser" }), "page 2 rows", { storedKey: "_tool_result_4" }),
    ];
    const outcome = repetitionGuard(call(METRICS, { type: "os" }), stateOf(steps, stall({ _tool_result_4: 4 })), input);
    expect(outcome.pass).toBe(false);
    if (!outcome.pass) expect(outcome.observation).toContain("enumerate-pages");
  });
});
