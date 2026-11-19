/**
 * R2 — an identical re-fetch gets the stored result back, never a bare refusal.
 *
 * Owner trace 01M7SZPWPNY8 (gemini-flash, umami task): seq 1356 re-sent the
 * get_website_metrics call of seq 1267 with the same arguments in another key
 * order. `duplicateGuard` compared raw `JSON.stringify` output, so it missed the
 * duplicate, and `repetitionGuard` refused it ("already called 6 times") with no
 * data. The earlier result had been compacted to a preview stored under
 * `_tool_result_1`, which the refusal never named.
 *
 * Fixed: the duplicate check compares canonical arguments, and a compacted prior
 * result's refusal names its stored key (`recall("_tool_result_N", full: true)`).
 */
import { describe, it, expect } from "bun:test";
import type { ToolCallSpec } from "@reactive-agents/tools";
import { checkToolCall, defaultGuards, duplicateGuard } from "../../../../src/kernel/capabilities/act/guard.js";
import { makeStep } from "../../../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../../../src/kernel/utils/observation-helpers.js";
import { initialKernelState, type KernelState, type KernelInput } from "../../../../src/kernel/state/kernel-state.js";
import type { ReasoningStep } from "../../../../src/types/index.js";
import { withEvidence } from "../../tool-evidence-fixture.js";

const METRICS = "umami/get_website_metrics";
let seq = 0;
const call = (args: Record<string, unknown>): ToolCallSpec => {
  seq += 1;
  return { id: `c${seq}`, name: METRICS, arguments: args };
};

function ran(tc: ToolCallSpec, result: string, storedKey?: string): ReasoningStep[] {
  return [
    makeStep("action", `${tc.name}(${JSON.stringify(tc.arguments)})`, { toolCall: tc }),
    makeStep("observation", result, {
      toolCallId: tc.id,
      ...(storedKey !== undefined ? { storedKey } : {}),
      observationResult: makeObservationResult(tc.name, true, result),
    }),
  ];
}

const stateOf = (steps: ReasoningStep[]): KernelState => {
  const base = initialKernelState({ maxIterations: 16, strategy: "reactive", kernelType: "react", taskId: "r2" });
  return withEvidence({ ...base, steps, meta: { ...base.meta, maxIterations: 16 } } as KernelState);
};

const input = {
  task: "Analyze my website stats for the last 5 days to see the cause of the recent traffic spike",
  requiredToolQuantities: {},
  nextMovesPlanning: { maxBatchSize: 4 },
  availableToolSchemas: [{ name: METRICS, description: "metrics ranking", parameters: [] }],
} as KernelInput;

const day = { websiteId: "w1", startAt: "2026-11-17T00:00:00.000Z", endAt: "2026-11-17T23:59:59.000Z", timezone: "UTC" };
const hour = { websiteId: "w1", startAt: "2026-11-17T00:30:00.000Z", endAt: "2026-11-17T02:00:00.000Z", timezone: "UTC" };
const PREVIEW = "[umami/get_website_metrics result — compressed preview]\nType: Object(7 keys) | data: Array(20)";

/** The trace's six prior calls: path/referrer/channel for the day, country/browser/path for the hour. */
const sixPrior = (): ReasoningStep[] => [
  ...ran(call({ endAt: day.endAt, type: "path", timezone: day.timezone, websiteId: day.websiteId, startAt: day.startAt }), PREVIEW, "_tool_result_1"),
  ...ran(call({ ...day, type: "referrer" }), "rows: google 9"),
  ...ran(call({ ...day, type: "channel" }), "rows: direct 7"),
  ...ran(call({ ...hour, type: "country" }), "rows: US 4"),
  ...ran(call({ ...hour, type: "browser" }), "rows: chrome 3"),
  ...ran(call({ ...hour, type: "path" }), "rows: /docs 2"),
];

describe("R2 — identical re-fetch after compaction", () => {
  it("the default chain answers a key-reordered identical call with the duplicate guard, naming the stored key", () => {
    const refetch = call({ timezone: day.timezone, type: "path", startAt: day.startAt, websiteId: day.websiteId, endAt: day.endAt });
    const outcome = checkToolCall(defaultGuards)(refetch, stateOf(sixPrior()), input);
    expect(outcome.pass).toBe(false);
    if (outcome.pass) return;
    expect(outcome.guard).toBe("duplicate_guard");
    expect(outcome.observation).not.toContain("You have already called");
    expect(outcome.observation).toContain(PREVIEW);
    expect(outcome.observation).toContain('recall("_tool_result_1", full: true)');
  });

  it("whitespace-only differences in string args are the same call", () => {
    const steps = ran(call({ query: "traffic  spike" }), "result A");
    const outcome = duplicateGuard(call({ query: " traffic spike " }), stateOf(steps), input);
    expect(outcome.pass).toBe(false);
  });

  it("an uncompacted prior result gets no recall pointer", () => {
    const steps = ran(call({ ...day, type: "referrer" }), "rows: google 9");
    const outcome = duplicateGuard(call({ type: "referrer", ...day }), stateOf(steps), input);
    expect(outcome.pass).toBe(false);
    if (!outcome.pass) {
      expect(outcome.observation.startsWith("rows: google 9 [Already done")).toBe(true);
      expect(outcome.observation).not.toContain("recall(");
    }
  });

  it("a call with different args still is not a duplicate", () => {
    const steps = ran(call({ ...day, type: "referrer" }), "rows: google 9");
    expect(duplicateGuard(call({ ...day, type: "referrer", limit: 10 }), stateOf(steps), input)).toEqual({ pass: true });
  });
});
