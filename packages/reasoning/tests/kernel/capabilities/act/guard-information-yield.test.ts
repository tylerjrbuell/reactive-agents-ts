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
import { resolveHarnessConfig, repetitionBackstopCalls, type HarnessConfig } from "../../../../src/harness-config.js";

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
/** One call per iteration: the backstop's iteration fraction is then a call count (review point 1). */
const oneCallInput = { requiredToolQuantities: {}, nextMovesPlanning: { maxBatchSize: 1 } } as KernelInput;

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
    // One call per iteration → backstop = max(1, ceil(8 * 0.75) * 1) = 6.
    const small = { maxIterations: 8 }; // the run's budget (state.meta)
    const steps: ReasoningStep[] = metricTypes.slice(0, 6)
      .flatMap((type) => ran(call(METRICS, { type }), `rows for ${type}`));
    const outcome = repetitionGuard(call(METRICS, { type: "language" }), stateOf(steps, small), oneCallInput);
    expect(outcome.pass).toBe(false);
    const underBackstop = steps.slice(0, 10); // 5 prior calls
    expect(repetitionGuard(call(METRICS, { type: "language" }), stateOf(underBackstop, small), oneCallInput)).toEqual({ pass: true });
  });
});

describe("repetitionGuard — R3: the backstop counts iterations, so batched calls are not starved", () => {
  // Owner trace 01M7SZPWPNY8 (gemini-flash, maxIterations 16): 3-4 distinct
  // get_website_metrics calls per iteration; the 14th distinct query (13 prior
  // calls, iteration 13 of 16) was refused at a call-count backstop of 12.
  const run16 = { maxIterations: 16 };
  const distinctCalls = (n: number): ReasoningStep[] =>
    Array.from({ length: n }, (_, i) => ran(call(METRICS, { type: "path", window: `w${i}` }), `rows for window ${i}`)).flat();
  const next = () => call(METRICS, { type: "path", window: "new" });

  it("a parallel-safe tool gets ceil(16 * 0.75) = 12 iterations of maxBatchSize 4 = 48 calls", () => {
    expect(repetitionGuard(next(), stateOf(distinctCalls(13), run16), input)).toEqual({ pass: true });
    expect(repetitionGuard(next(), stateOf(distinctCalls(47), run16), input)).toEqual({ pass: true });
    expect(repetitionGuard(next(), stateOf(distinctCalls(48), run16), input).pass).toBe(false);
  });

  it("a sequential-only tool keeps one call per iteration (12)", () => {
    const seqCalls = (n: number): ReasoningStep[] =>
      Array.from({ length: n }, (_, i) => ran(call("compute", { expr: `${i} * 2` }), `= ${i * 2}`)).flat();
    const q = () => call("compute", { expr: "99 * 2" });
    expect(repetitionGuard(q(), stateOf(seqCalls(11), run16), input)).toEqual({ pass: true });
    expect(repetitionGuard(q(), stateOf(seqCalls(12), run16), input).pass).toBe(false);
  });

  it("repetitionBackstopCalls scales only the fraction by callsPerIteration; maxCalls stays a call count", () => {
    expect(repetitionBackstopCalls(undefined, 16, 4)).toBe(48);
    expect(repetitionBackstopCalls(undefined, 16)).toBe(12);
    expect(repetitionBackstopCalls(resolveHarnessConfig({ repetitionBackstop: { maxCalls: 10 } }), 16, 4)).toBe(10);
  });
});

describe("repetitionGuard — configurable backstop (HarnessConfig.repetitionBackstop)", () => {
  const small = { maxIterations: 8 }; // default backstop = max(4, ceil(8 * 0.75)) = 6
  const priorCalls = (n: number): ReasoningStep[] =>
    metricTypes.slice(0, n).flatMap((type) => ran(call(METRICS, { type }), `rows for ${type}`));
  const withBackstop = (repetitionBackstop: HarnessConfig["repetitionBackstop"]): KernelInput =>
    ({ ...input, harness: resolveHarnessConfig({ repetitionBackstop }) }) as KernelInput;
  // A type no prior call used, so the call always has distinct arguments.
  const next = () => call(METRICS, { type: "region" });

  it("a resolved harness with no repetitionBackstop keeps the default (6 prior calls block, 5 pass)", () => {
    // One call per iteration, so the default ceil(8 * 0.75) = 6 iterations is 6 calls.
    const h = { ...oneCallInput, harness: resolveHarnessConfig() } as KernelInput;
    expect(repetitionGuard(next(), stateOf(priorCalls(6), small), h).pass).toBe(false);
    expect(repetitionGuard(next(), stateOf(priorCalls(5), small), h)).toEqual({ pass: true });
  });

  it("a lower maxCalls blocks earlier (5 prior calls block at maxCalls 5)", () => {
    expect(repetitionGuard(next(), stateOf(priorCalls(5), small), withBackstop({ maxCalls: 5 })).pass).toBe(false);
    expect(repetitionGuard(next(), stateOf(priorCalls(4), small), withBackstop({ maxCalls: 5 }))).toEqual({ pass: true });
  });

  it("maxCalls replaces the fraction: a higher count allows more than ceil(maxIterations * fraction)", () => {
    expect(repetitionGuard(next(), stateOf(priorCalls(7), small), withBackstop({ maxCalls: 8 }))).toEqual({ pass: true });
    expect(repetitionGuard(next(), stateOf(priorCalls(8), small), withBackstop({ maxCalls: 8 })).pass).toBe(false);
  });

  it("a higher iterationFraction allows more (1.0 of 8 iterations = 8 calls at one call per iteration)", () => {
    const oneCall = (repetitionBackstop: HarnessConfig["repetitionBackstop"]): KernelInput =>
      ({ ...oneCallInput, harness: resolveHarnessConfig({ repetitionBackstop }) }) as KernelInput;
    expect(repetitionGuard(next(), stateOf(priorCalls(7), small), oneCall({ iterationFraction: 1 }))).toEqual({ pass: true });
    expect(repetitionGuard(next(), stateOf(priorCalls(8), small), oneCall({ iterationFraction: 1 })).pass).toBe(false);
  });

  it("the review point stays the floor: maxCalls below it still lets calls under the threshold pass", () => {
    // threshold = maxBatchSize 4 for this parallel-safe tool; maxCalls 1 floors to 4.
    expect(repetitionGuard(next(), stateOf(priorCalls(3), small), withBackstop({ maxCalls: 1 }))).toEqual({ pass: true });
    expect(repetitionGuard(next(), stateOf(priorCalls(4), small), withBackstop({ maxCalls: 1 })).pass).toBe(false);
  });
});

describe("resolveHarnessConfig — repetitionBackstop clamping", () => {
  it("absent when unset or when every field is invalid", () => {
    expect("repetitionBackstop" in resolveHarnessConfig()).toBe(false);
    expect("repetitionBackstop" in resolveHarnessConfig({ repetitionBackstop: {} })).toBe(false);
    expect("repetitionBackstop" in resolveHarnessConfig({ repetitionBackstop: { iterationFraction: Number.NaN, maxCalls: Number.POSITIVE_INFINITY } })).toBe(false);
  });

  it("clamps iterationFraction to 0..1 and floors maxCalls to a whole number >= 0", () => {
    expect(resolveHarnessConfig({ repetitionBackstop: { iterationFraction: 1.5 } }).repetitionBackstop).toEqual({ iterationFraction: 1 });
    expect(resolveHarnessConfig({ repetitionBackstop: { iterationFraction: -0.2 } }).repetitionBackstop).toEqual({ iterationFraction: 0 });
    expect(resolveHarnessConfig({ repetitionBackstop: { maxCalls: 6.9 } }).repetitionBackstop).toEqual({ maxCalls: 6 });
    expect(resolveHarnessConfig({ repetitionBackstop: { maxCalls: -3 } }).repetitionBackstop).toEqual({ maxCalls: 0 });
  });

  it("repetitionBackstopCalls: default ceil(maxIterations * 0.75); maxCalls wins over the fraction", () => {
    expect(repetitionBackstopCalls(undefined, 10)).toBe(8);
    expect(repetitionBackstopCalls(resolveHarnessConfig(), 8)).toBe(6);
    expect(repetitionBackstopCalls(resolveHarnessConfig({ repetitionBackstop: { iterationFraction: 0.5 } }), 10)).toBe(5);
    expect(repetitionBackstopCalls(resolveHarnessConfig({ repetitionBackstop: { iterationFraction: 0.5, maxCalls: 12 } }), 10)).toBe(12);
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
