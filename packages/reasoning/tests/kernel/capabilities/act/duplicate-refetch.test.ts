// Run: bun test packages/reasoning/tests/kernel/capabilities/act/duplicate-refetch.test.ts --timeout 15000
/**
 * R2 — an exact re-fetch is a cached replay, never a failed or denied call.
 *
 * Owner traces (gemini-flash, umami task, maxIterations 16):
 * - 01M7SZPWPNY8: seq 1356 re-sent the call of seq 1267 with its argument keys
 *   in another order.
 * - 01M7T08Q64H1: seven distinct get_website_metrics calls ran (one compacted
 *   to `_tool_result_1`), then a batch of four exact repeats, keys reordered
 *   (seq 253=160, 258=158, 263=162, 268=199).
 *
 * `duplicateGuard` compared raw `JSON.stringify`, so it missed every one, and
 * `repetitionGuard` refused them with "You have already called ... 7 times. Stop
 * repeating this tool". The calls were recorded ok:false, and Cortex showed them
 * as red "unique calls denied".
 *
 * Fixed: the duplicate check compares canonical arguments; the reply replays
 * the earlier result (the full stored copy when it was compacted), says
 * "Already fetched at step N; this is that result.", is recorded as a success,
 * and fires `duplicate_guard` as a `redirect`, not a `block`.
 */
import { describe, it, expect } from "bun:test";
import { Effect, Option } from "effect";
import { EventBus, EventBusLive, HarnessPipeline, RegistrationHarness } from "@reactive-agents/core";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { TextParseDriver, type ToolCallSpec } from "@reactive-agents/tools";
import { handleActing } from "../../../../src/kernel/capabilities/act/act.js";
import { checkToolCall, defaultGuards, duplicateGuard } from "../../../../src/kernel/capabilities/act/guard.js";
import { makeStep } from "../../../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../../../src/kernel/utils/observation-helpers.js";
import {
  initialKernelState,
  noopHooks,
  type KernelContext,
  type KernelHooks,
  type KernelInput,
  type KernelState,
  type ToolServiceInstance,
} from "../../../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../../src/context/context-profile.js";
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

const day = { websiteId: "w1", startAt: "2026-11-17T00:00:00.000Z", endAt: "2026-11-17T23:59:59.000Z" };
const PREVIEW = "[umami/get_website_metrics result — compressed preview]\nType: Object(7 keys) | data: Array(20)";
/** The compacted result's full stored copy (scripted rows, no analytics values). */
const FULL_PATH = JSON.stringify({ type: "path", data: Array.from({ length: 20 }, (_, i) => ({ x: `/p${i}`, y: 20 - i })) });

/** 01M7T08Q64H1's seven distinct calls, in its key orders; `path` was compacted. */
const sevenDistinct = (): ReasoningStep[] => [
  ...ran(call({ startAt: day.startAt, websiteId: day.websiteId, type: "path", endAt: day.endAt }), PREVIEW, "_tool_result_1"),
  ...ran(call({ startAt: day.startAt, type: "referrer", websiteId: day.websiteId, endAt: day.endAt }), "rows: r1 9"),
  ...ran(call({ websiteId: day.websiteId, type: "channel", endAt: day.endAt, startAt: day.startAt }), "rows: c1 7"),
  ...ran(call({ ...day, type: "country" }), "rows: k1 4"),
  ...ran(call({ ...day, type: "browser" }), "rows: b1 3"),
  ...ran(call({ ...day, type: "device" }), "rows: d1 2"),
  ...ran(call({ websiteId: day.websiteId, type: "utmCampaign", startAt: day.startAt, endAt: day.endAt }), "rows: u1 1"),
];

/** The batch of four exact repeats, keys reordered as gemini sent them. */
const fourRepeats = (): ToolCallSpec[] => [
  call({ startAt: day.startAt, type: "referrer", endAt: day.endAt, websiteId: day.websiteId }),
  call({ endAt: day.endAt, type: "path", websiteId: day.websiteId, startAt: day.startAt }),
  call({ endAt: day.endAt, websiteId: day.websiteId, startAt: day.startAt, type: "channel" }),
  call({ websiteId: day.websiteId, startAt: day.startAt, type: "utmCampaign", endAt: day.endAt }),
];

const input = {
  task: "Analyze my website stats for the last 5 days to see the cause of the recent traffic spike",
  availableToolSchemas: [{ name: METRICS, description: "metrics ranking", parameters: [] }],
  harnessPipeline: new HarnessPipeline(new RegistrationHarness()._collected),
  requiredToolQuantities: {},
  nextMovesPlanning: { maxBatchSize: 4 },
} as KernelInput;

function stateOf(steps: ReasoningStep[], pending: readonly ToolCallSpec[] = []): KernelState {
  const base = initialKernelState({ maxIterations: 16, strategy: "reactive", kernelType: "react", taskId: "r2" });
  return withEvidence({
    ...base,
    status: "acting",
    steps,
    scratchpad: new Map([["_tool_result_1", FULL_PATH]]),
    meta: { ...base.meta, maxIterations: 16, pendingNativeToolCalls: [...pending], lastThought: "go", lastThinking: null },
  } as KernelState);
}

type Completed = { readonly result: string; readonly success: boolean };

describe("R2 — exact re-fetch is a cached replay", () => {
  it("guard level: each key-reordered repeat replays its own earlier result, never 'already called N times'", () => {
    const steps = sevenDistinct();
    const expected = [FULL_PATH, "rows: r1 9", "rows: c1 7", "rows: u1 1"];
    const repeats = fourRepeats();
    const order = [1, 0, 2, 3]; // fourRepeats() is referrer, path, channel, utmCampaign
    repeats.forEach((tc, i) => {
      const outcome = checkToolCall(defaultGuards)(tc, stateOf(steps), input);
      expect(outcome.pass).toBe(false);
      if (outcome.pass) return;
      expect(outcome.guard).toBe("duplicate_guard");
      expect(outcome.replay).toBe(true);
      expect(outcome.observation).not.toContain("You have already called");
      expect(outcome.observation).not.toContain("Stop repeating");
      expect(outcome.observation.startsWith(expected[order[i]!]!)).toBe(true);
      expect(outcome.observation).toMatch(/Already fetched at step \d+; this is that result\./);
    });
  });

  it("a compacted earlier result is replayed in full from its stored copy, not as the preview", () => {
    const outcome = duplicateGuard(fourRepeats()[1]!, stateOf(sevenDistinct()), input);
    expect(outcome.pass).toBe(false);
    if (outcome.pass) return;
    expect(outcome.observation).toContain(FULL_PATH);
    expect(outcome.observation).not.toContain("compressed preview");
    // The path call is the first step of the run.
    expect(outcome.observation).toContain("Already fetched at step 1;");
  });

  it("act path: the four repeats are answered as successes and fire duplicate_guard redirect, with no tool execution", async () => {
    const completed: Completed[] = [];
    const hooks: KernelHooks = {
      ...noopHooks,
      onObservation: (_s, result, success) => Effect.sync(() => void completed.push({ result, success })),
    };
    let executed = 0;
    const toolService: Option.Option<ToolServiceInstance> = Option.some({
      execute: () => Effect.sync(() => { executed += 1; return { success: true, result: "rows: fresh" }; }),
      getTool: () => Effect.fail(new Error("no schema")),
      listTools: () => Effect.succeed([]),
    });
    const profile = CONTEXT_PROFILES["mid"];
    const ctx: KernelContext = {
      input: input as KernelContext["input"],
      profile,
      compression: { budget: profile.toolResultMaxChars ?? 800, previewItems: 3, autoStore: true, codeTransform: true },
      toolService,
      hooks,
      toolCallingDriver: new TextParseDriver(),
    };
    const repeats = fourRepeats();
    const { state, fired } = await Effect.runPromise(
      Effect.gen(function* () {
        const fired: { guard: string; outcome: string }[] = [];
        const bus = yield* EventBus;
        yield* bus.on("GuardFiredEmitted", (e) => Effect.sync(() => void fired.push({ guard: e.guard, outcome: e.outcome })));
        const state = yield* handleActing(stateOf(sevenDistinct(), repeats), ctx).pipe(Effect.provide(TestLLMServiceLayer()));
        return { state, fired };
      }).pipe(Effect.provide(EventBusLive)),
    );

    expect(executed).toBe(0);
    expect(completed).toHaveLength(4);
    for (const c of completed) {
      expect(c.success).toBe(true);
      expect(c.result).not.toContain("You have already called");
    }
    const dup = fired.filter((f) => f.guard === "duplicate_guard");
    expect(dup).toHaveLength(4);
    expect(dup.every((f) => f.outcome === "redirect")).toBe(true);
    expect(fired.some((f) => f.guard === "repetition_guard")).toBe(false);
    for (const tc of repeats) {
      const obs = state.steps.find((s) => s.type === "observation" && s.metadata?.toolCallId === tc.id);
      expect(obs?.metadata?.observationResult?.success).toBe(true);
    }
  }, 15000);

  it("whitespace-only differences in string args are the same call", () => {
    const steps = ran(call({ query: "traffic  spike" }), "result A");
    expect(duplicateGuard(call({ query: " traffic spike " }), stateOf(steps), input).pass).toBe(false);
  });

  it("an uncompacted earlier result replays its own text with no recall pointer", () => {
    const steps = ran(call({ ...day, type: "referrer" }), "rows: r1 9");
    const outcome = duplicateGuard(call({ type: "referrer", ...day }), stateOf(steps), input);
    expect(outcome.pass).toBe(false);
    if (!outcome.pass) {
      expect(outcome.observation.startsWith("rows: r1 9 [Already done")).toBe(true);
      expect(outcome.observation).not.toContain("recall(");
    }
  });

  it("a call with different args is not a duplicate", () => {
    const steps = ran(call({ ...day, type: "referrer" }), "rows: r1 9");
    expect(duplicateGuard(call({ ...day, type: "referrer", limit: 10 }), stateOf(steps), input)).toEqual({ pass: true });
  });
});
