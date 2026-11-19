// Run: bun test packages/reasoning/tests/strategies/reflexion-completed-actions.test.ts --timeout 20000
//
// QA N4 (wiki/Research/Harness-Reports/2026-11-19-v0.19-qa-strategy-matrix.md):
// reflexion's ALREADY COMPLETED ACTIONS list marked a call failed only when its
// observation text matched `[Tool error`, so a call a guard refused was listed
// as done (`✅ city-population({"city":" Cairo"})` while Cairo never ran). It
// paired actions with observations by index and only read the last
// tool-calling pass, so values an earlier pass fetched dropped out of it.
//
// The list (strategies/reflexion/completed-actions.ts) now pairs each call with
// its observation by toolCallId, reads the outcome from typed step metadata
// (`⛔` for a refused call, which is not done), and covers every pass so far.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBusLive } from "@reactive-agents/core";
import { LLMService, TestLLMServiceLayer, type TestTurn } from "@reactive-agents/llm-provider";
import { createToolsLayer, ToolService } from "@reactive-agents/tools";
import { ReasoningService, ReasoningServiceLive } from "../../src/services/reasoning-service.js";
import { StrategyRegistryLive } from "../../src/services/strategy-registry.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { blockedCallSteps, makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import {
  buildCompletedActionsContext,
  extractSuccessfulSideEffectTools,
  pairToolCalls,
} from "../../src/strategies/reflexion/completed-actions.js";
import type { ReasoningStep } from "../../src/types/index.js";

const popTool = {
  name: "city-population",
  description: "Look up the population of one city",
  parameters: [{ name: "city", type: "string" as const, description: "City name", required: true }],
  riskLevel: "low" as const,
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function" as const,
};
const popSchema = { name: popTool.name, description: popTool.description, parameters: popTool.parameters };
const POPS: Readonly<Record<string, number>> = { Tokyo: 13960000, Paris: 2161000 };

const callOf = (id: string, city: string) => ({ id, name: popTool.name, arguments: { city } });

/** An executed call: the action and its successful observation. */
function ran(id: string, city: string, result: string): ReasoningStep[] {
  return [
    makeStep("action", `${popTool.name}(${JSON.stringify({ city })})`, { toolCall: callOf(id, city) }),
    makeStep("observation", result, { toolCallId: id, observationResult: makeObservationResult(popTool.name, true, result) }),
  ];
}

describe("completed-actions: the seam (N4)", () => {
  it("marks a guard-refused call ⛔ not run, even though the guard observation is a soft success", () => {
    // A repetition-guard refusal: guard-tagged, observationResult.success === true.
    const refused = blockedCallSteps(callOf("c2", "Cairo"), "⚠️ You have already called city-population 3 times. Stop repeating this tool.", true, { guard: true, toolUsed: true });
    const text = buildCompletedActionsContext([...ran("c1", "Tokyo", "13960000"), ...refused]);
    expect(text).toContain(`✅ city-population({"city":"Tokyo"})`);
    expect(text).toContain(`⛔ city-population({"city":"Cairo"}) — NOT run`);
    expect(text).not.toContain(`✅ city-population({"city":"Cairo"})`);
  });

  it("pairs by toolCallId, not by index (a batch's actions before its observations)", () => {
    const a1 = makeStep("action", `${popTool.name}({"city":"Tokyo"})`, { toolCall: callOf("t", "Tokyo") });
    const a2 = makeStep("action", `${popTool.name}({"city":"Paris"})`, { toolCall: callOf("p", "Paris") });
    const oP = makeStep("observation", "Tool error: upstream 500", { toolCallId: "p", observationResult: makeObservationResult(popTool.name, false, "Tool error: upstream 500") });
    const oT = makeStep("observation", "13960000", { toolCallId: "t", observationResult: makeObservationResult(popTool.name, true, "13960000") });
    const paired = pairToolCalls([a1, a2, oP, oT]);
    expect(paired.map((p) => [p.observation?.content, p.outcome])).toEqual([["13960000", "ok"], ["Tool error: upstream 500", "failed"]]);
  });

  it("keeps a call's best outcome across passes, once", () => {
    const refused = blockedCallSteps(callOf("x", "Paris"), "city-population was not run: cap reached", false, { guard: true });
    const text = buildCompletedActionsContext([...refused, ...ran("y", "Paris", "2161000")]);
    expect(text.match(/city-population\(\{"city":"Paris"\}\)/g)?.length).toBe(1);
    expect(text).toContain(`✅ city-population({"city":"Paris"})`);
    expect(text).not.toContain("⛔");
  });

  it("never blocks a side-effect tool whose only call was refused", () => {
    const refused = blockedCallSteps({ id: "w", name: "file-write", arguments: { path: "a.md" } }, "file-write was not run: cap reached", false, { guard: true });
    expect(extractSuccessfulSideEffectTools(refused)).toEqual([]);
  });
});

/** The scripted LLM, recording every request so the improve pass's task text can be read. */
function recordingLayer(turns: TestTurn[], seen: string[]) {
  return Layer.effect(
    LLMService,
    Effect.gen(function* () {
      const inner = yield* LLMService;
      return {
        ...inner,
        complete: (req: Parameters<typeof inner.complete>[0]) => { seen.push(JSON.stringify(req)); return inner.complete(req); },
        stream: (req: Parameters<typeof inner.stream>[0]) => { seen.push(JSON.stringify(req)); return inner.stream(req); },
      };
    }),
  ).pipe(Layer.provide(TestLLMServiceLayer(turns)));
}

function runReflexion(turns: TestTurn[], maxRetries: number, cap?: Readonly<Record<string, number>>): Promise<readonly string[]> {
  const seen: string[] = [];
  const config = {
    ...defaultReasoningConfig,
    strategies: { ...defaultReasoningConfig.strategies, reflexion: { ...defaultReasoningConfig.strategies.reflexion, maxRetries } },
  };
  const program = Effect.gen(function* () {
    const tools = yield* ToolService;
    yield* tools.register(popTool, (args) => Effect.succeed({ city: String(args.city), population: POPS[String(args.city)] ?? 0 }));
    const reasoning = yield* ReasoningService;
    yield* reasoning
      .execute({
        taskDescription: "Look up the population of Tokyo and Paris with city-population and report both.",
        taskType: "research",
        memoryContext: "",
        availableTools: [popTool.name],
        availableToolSchemas: [popSchema],
        strategy: "reflexion",
        taskId: "n4-reflexion",
        ...(cap !== undefined ? { maxCallsPerTool: cap } : {}),
      })
      .pipe(Effect.catchAll(() => Effect.void));
  });
  const base = Layer.mergeAll(recordingLayer(turns, seen), createToolsLayer(), StrategyRegistryLive, EventBusLive);
  return Effect.runPromise(program.pipe(Effect.provide(Layer.provideMerge(ReasoningServiceLive(config), base)))).then(() => seen);
}

/** The completed-actions block of the last request that carried one (JSON-escaped request text). */
const lastCompletedActions = (seen: readonly string[]): string => {
  const req = [...seen].reverse().find((r) => r.includes("ALREADY COMPLETED ACTIONS"));
  const block = req?.slice(req.indexOf("ALREADY COMPLETED ACTIONS")) ?? "";
  return block.slice(0, 600).replace(/\\"/g, '"');
};

describe("reflexion improve pass: ALREADY COMPLETED ACTIONS (N4, scripted)", () => {
  it("lists a refused call as not run, never as done", async () => {
    // maxCallsPerTool 1: Tokyo runs, the tool gate refuses Paris.
    const seen = await runReflexion([
      { toolCalls: [{ id: "t1", name: popTool.name, args: { city: "Tokyo" } }, { id: "p1", name: popTool.name, args: { city: "Paris" } }] },
      { text: "FINAL ANSWER: Tokyo 13960000, Paris unknown" },
      { text: "UNSATISFIED: Paris is missing its population." },
      { text: "FINAL ANSWER: Tokyo 13960000, Paris unknown" },
    ], 1, { [popTool.name]: 1 });
    const block = lastCompletedActions(seen);
    expect(block).toContain(`✅ city-population({"city":"Tokyo"})`);
    expect(block).toContain(`⛔ city-population({"city":"Paris"})`);
    expect(block).not.toContain(`✅ city-population({"city":"Paris"})`);
  }, 20000);

  it("keeps the generate pass's calls once a later improve pass called tools too", async () => {
    // generate: Tokyo. improve-1: Paris. improve-2's list must still carry Tokyo.
    const seen = await runReflexion([
      { toolCall: { id: "t1", name: popTool.name, args: { city: "Tokyo" } } },
      { text: "FINAL ANSWER: Tokyo 13960000" },
      { text: "UNSATISFIED: Paris is missing." },
      { toolCall: { id: "p1", name: popTool.name, args: { city: "Paris" } } },
      { text: "FINAL ANSWER: Tokyo 13960000, Paris 2161000" },
      { text: "UNSATISFIED: add a total." },
      { text: "FINAL ANSWER: Tokyo 13960000, Paris 2161000, total 16121000" },
    ], 2);
    const block = lastCompletedActions(seen);
    expect(block).toContain(`✅ city-population({"city":"Paris"})`);
    expect(block).toContain(`✅ city-population({"city":"Tokyo"})`);
  }, 20000);
});
