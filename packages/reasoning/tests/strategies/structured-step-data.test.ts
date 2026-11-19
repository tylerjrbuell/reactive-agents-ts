// Run: bun test packages/reasoning/tests/strategies/structured-step-data.test.ts --timeout 20000
//
// ReasoningStepCompleted.structured: ToT tree nodes + chosen path, code-action
// code/result/verify, reflexion critique + accepted flag. Zero-token scripted
// runs; payloads collected from the bus. Text fields stay untouched.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBus, EventBusLive, type ReasoningStepData } from "@reactive-agents/core";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { executeTreeOfThought } from "../../src/strategies/tree-of-thought.js";
import { executeCodeAction } from "../../src/strategies/code-action.js";
import { executeReflexion } from "../../src/strategies/reflexion.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";

interface BusEvent {
  readonly _tag?: string;
  readonly strategy?: string;
  readonly thought?: string;
  readonly observation?: string;
  readonly structured?: ReasoningStepData;
}

/** Run `body` with an EventBus, returning its result plus every ReasoningStepCompleted. */
const collect = <A, E, R>(body: Effect.Effect<A, E, R>) => {
  const events: BusEvent[] = [];
  return Effect.runPromise(provideTestEnvelope(
    Effect.gen(function* () {
      const bus = yield* EventBus;
      const unsub = yield* bus.subscribe((e) => {
        if ((e as BusEvent)._tag === "ReasoningStepCompleted") events.push(e as BusEvent);
        return Effect.void;
      });
      const result = yield* body;
      unsub();
      return result;
    }).pipe(Effect.provide(EventBusLive)) as Effect.Effect<A, E, never>,
  )).then((result) => ({ result, events }));
};

const structuredOf = <K extends ReasoningStepData["kind"]>(events: readonly BusEvent[], kind: K) =>
  events
    .map((e) => e.structured)
    .filter((s): s is Extract<ReasoningStepData, { kind: K }> => s?.kind === kind);

describe("structured step data", () => {
  it("tree-of-thought: tot-node per explored node (pruned flag), selected re-emit, tot-path root to leaf", async () => {
    const layer = TestLLMServiceLayer([
      { match: "Generate exactly", text: "1. Approach alpha\n2. Approach beta\n3. Approach gamma" },
      { match: "Rate each", text: "1: 0.9\n2: 0.1\n3: 0.6" },
      { match: "Selected Approach", text: "FINAL ANSWER: done." },
    ]);
    const { events } = await collect(
      executeTreeOfThought({
        taskDescription: "Pick the best approach",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: {
          ...defaultReasoningConfig,
          strategies: {
            ...defaultReasoningConfig.strategies,
            treeOfThought: { breadth: 3, depth: 1, pruningThreshold: 0.3, skipBfsForTrivial: false },
          },
        },
      }).pipe(Effect.provide(layer)),
    );

    const nodes = structuredOf(events, "tot-node");
    const first = nodes.filter((n) => !n.selected);
    expect(first.map((n) => n.content).sort()).toEqual(["Approach alpha", "Approach beta", "Approach gamma"]);
    expect(first.every((n) => n.depth === 1 && n.parentId !== null)).toBe(true);
    const byContent = (c: string) => first.find((n) => n.content === c)!;
    expect(byContent("Approach alpha").score).toBe(0.9);
    expect(byContent("Approach beta").pruned).toBe(true); // 0.1 < 0.3
    expect(byContent("Approach alpha").pruned).toBe(false);

    const path = structuredOf(events, "tot-path");
    expect(path.length).toBe(1);
    const best = byContent("Approach alpha");
    expect(path[0]!.nodeIds).toEqual([best.parentId!, best.nodeId]);

    // The selected follow-up re-emits the winning node with selected: true,
    // and the root (parent of every depth-1 node) is emitted too so the tree is whole.
    const selected = nodes.filter((n) => n.selected);
    expect(selected.map((n) => n.nodeId)).toEqual([best.parentId!, best.nodeId]);
    const root = selected[0]!;
    expect(root).toMatchObject({ depth: 0, parentId: null, content: "Root: Pick the best approach" });
    expect(selected.every((n) => n.pruned === false)).toBe(true);
    // Text field on the node events is unchanged.
    expect(events.some((e) => e.structured?.kind === "tot-node" && e.thought?.startsWith("[TOT d=1] score=0.90"))).toBe(true);
  }, 20000);

  it("code-action: code, stdout and verify verdict on the verify step", async () => {
    const llm = TestLLMServiceLayer([
      { text: "```typescript\n(async () => { return await search({ query: 'x' }); })()\n```" },
    ]);
    const tools = mockToolServiceLayer({
      execute: () => Effect.succeed({ success: true, result: "hit-data" }),
      getTool: (name: string) =>
        Effect.succeed({ name, description: "t", parameters: [{ name: "query", type: "string", required: true }] }),
    });
    const { events } = await collect(
      executeCodeAction({
        taskDescription: "search and finish",
        taskType: "simple",
        memoryContext: "",
        availableTools: ["search"],
        availableToolSchemas: [{
          name: "search",
          description: "Search",
          parameters: [{ name: "query", type: "string", description: "q", required: true }],
        }],
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(Layer.merge(llm, tools))),
    );
    const ca = structuredOf(events, "code-action");
    expect(ca.length).toBeGreaterThanOrEqual(1);
    const verified = ca.find((c) => c.verify !== undefined)!;
    expect(verified.code).toContain("search({ query: 'x' })");
    expect(verified.stdout).toContain("hit-data");
    expect(verified.verify).toMatchObject({ verdict: "PASS" });
    expect(typeof verified.verify!.summary).toBe("string");
  }, 20000);

  it("code-action: a sandbox failure carries stderr and the code", async () => {
    const llm = TestLLMServiceLayer([{ text: "```typescript\n(async () => { throw new TypeError('boom-sandbox'); })()\n```" }]);
    const { events } = await collect(
      executeCodeAction({
        taskDescription: "do a thing",
        taskType: "simple",
        memoryContext: "",
        availableTools: [],
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(llm)),
    );
    const failed = structuredOf(events, "code-action").find((c) => c.stderr !== undefined);
    expect(failed).toBeDefined();
    expect(failed!.stderr).toContain("boom-sandbox");
    expect(failed!.code).toContain("boom-sandbox");
    expect(failed!.verify).toBeUndefined();
  }, 20000);

  it("reflexion: full critique and accepted flag", async () => {
    const llm = TestLLMServiceLayer([
      { match: "Evaluate whether", text: "SATISFIED: The response is accurate and complete." },
    ]);
    const { events } = await collect(
      executeReflexion({
        taskDescription: "Test task",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: {
          ...defaultReasoningConfig,
          strategies: { ...defaultReasoningConfig.strategies, reflexion: { maxRetries: 3, selfCritiqueDepth: "shallow" } },
        },
      }).pipe(Effect.provide(llm)),
    );
    const refl = structuredOf(events, "reflexion");
    expect(refl.length).toBe(1);
    expect(refl[0]!.critique).toBe("SATISFIED: The response is accurate and complete.");
    expect(refl[0]!.accepted).toBe(true);
    expect(events.some((e) => e.structured?.kind === "reflexion" && e.observation?.startsWith("[CRITIQUE 1]"))).toBe(true);
  }, 20000);

  it("reflexion: an unsatisfied critique reports accepted: false", async () => {
    const llm = TestLLMServiceLayer([
      { match: "Evaluate whether", text: "The answer misses the second half entirely." },
    ]);
    const { events } = await collect(
      executeReflexion({
        taskDescription: "Test task",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: {
          ...defaultReasoningConfig,
          strategies: { ...defaultReasoningConfig.strategies, reflexion: { maxRetries: 1, selfCritiqueDepth: "shallow" } },
        },
      }).pipe(Effect.provide(llm)),
    );
    const refl = structuredOf(events, "reflexion");
    expect(refl.length).toBeGreaterThanOrEqual(1);
    expect(refl[0]!.accepted).toBe(false);
    expect(refl[0]!.critique).toContain("misses the second half");
  }, 20000);
});
