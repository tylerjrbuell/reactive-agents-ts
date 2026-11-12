// Run: bun test packages/runtime/tests/debrief-independent.test.ts --timeout 20000
//
// A debrief is its own setting. Unset it follows `.withMemory()`; `.withDebrief()`
// turns it on with memory off and `.withDebrief(false)` turns it off with memory
// on. When on, the debrief is saved to the debrief store (nothing provided that
// store before, so a debrief reached the DebriefCompleted event but was never
// kept).
//
// Red-on-cut: make `isDebriefEnabled` (src/debrief.ts) return
// `c.enableMemory === true` and the memory-off cases fail; make
// `buildDebriefStoreLayer` (src/runtime-memory-layer.ts) return `Layer.empty` and
// the store cases fail.
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { DebriefStoreService } from "@reactive-agents/memory";
import { ReactiveAgents } from "../src/index.js";
import { isDebriefEnabled } from "../src/debrief.js";
import { buildDebriefStoreLayer } from "../src/runtime-memory-layer.js";
import { synthesizeAndStoreDebrief, type DebriefSynthesisDeps } from "../src/engine/finalize/debrief-synthesis.js";
import { defaultReactiveAgentsConfig, type ExecutionContext, type ReactiveAgentsConfig } from "../src/types.js";
import type { RuntimeOptions } from "../src/runtime-types.js";
import { createRuntime } from "../src/runtime.js";

const build = (configure: (b: ReturnType<typeof ReactiveAgents.create>) => ReturnType<typeof ReactiveAgents.create>) =>
  configure(
    ReactiveAgents.create()
      .withName("debrief-agent")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" }),
  ).build();

describe("isDebriefEnabled", () => {
  it("follows memory when unset; an explicit value wins either way", () => {
    expect(isDebriefEnabled({})).toBe(false);
    expect(isDebriefEnabled({ enableMemory: true })).toBe(true);
    expect(isDebriefEnabled({ debrief: true })).toBe(true);
    expect(isDebriefEnabled({ debrief: true, enableMemory: false })).toBe(true);
    expect(isDebriefEnabled({ debrief: false, enableMemory: true })).toBe(false);
  });
});

describe("builder + AgentConfig", () => {
  it(".withDebrief() round-trips through toConfig / fromConfig", async () => {
    const config = ReactiveAgents.create().withName("a").withProvider("test").withDebrief().toConfig();
    expect(config.debrief).toBe(true);
    const off = ReactiveAgents.create().withName("a").withProvider("test").withDebrief(false).toConfig();
    expect(off.debrief).toBe(false);
    expect(ReactiveAgents.create().withName("a").withProvider("test").toConfig().debrief).toBeUndefined();
    const again = (await ReactiveAgents.fromConfig(config)).toConfig();
    expect(again.debrief).toBe(true);
  });
});

describe("a run's debrief", () => {
  it("is produced with memory off when .withDebrief() is set", async () => {
    const agent = await build((b) => b.withDebrief());
    const result = await agent.run("simple task");
    expect(result.success).toBe(true);
    expect(result.debrief).toBeDefined();
    await agent.dispose();
  });

  it("is absent with memory off and no .withDebrief()", async () => {
    const agent = await build((b) => b);
    const result = await agent.run("simple task");
    expect(result.debrief).toBeUndefined();
    await agent.dispose();
  });

  it("is absent with memory on when .withDebrief(false)", async () => {
    const agent = await build((b) => b.withMemory().withDebrief(false));
    const result = await agent.run("simple task");
    expect(result.debrief).toBeUndefined();
    await agent.dispose();
  });

  it("still follows memory when .withDebrief() is not called", async () => {
    const agent = await build((b) => b.withMemory());
    const result = await agent.run("simple task");
    expect(result.debrief).toBeDefined();
    await agent.dispose();
  });
});

describe("debrief store", () => {
  const options = (extra: Partial<RuntimeOptions>): RuntimeOptions =>
    ({ agentId: "debrief-store-agent", provider: "test", ...extra }) as RuntimeOptions;

  // Memory-off layers carry their own database, so nothing is left to provide.
  const storeLayer = (extra: Partial<RuntimeOptions>) =>
    buildDebriefStoreLayer(options(extra), Layer.empty) as Layer.Layer<DebriefStoreService>;

  const storeOf = (extra: Partial<RuntimeOptions>) =>
    Effect.serviceOption(DebriefStoreService).pipe(Effect.provide(storeLayer(extra)));

  it("is provided with memory off when debrief is on", async () => {
    expect(Option.isSome(await Effect.runPromise(storeOf({ debrief: true })))).toBe(true);
  });

  it("engine saves the synthesized debrief into the store when debrief is on", async () => {
    const program = Effect.gen(function* () {
      yield* synthesizeAndStoreDebrief(deps({ debrief: true }));
      const store = yield* DebriefStoreService;
      const saved = yield* store.findByTaskId("t-1");
      expect(saved?.taskId).toBe("t-1");
    });
    await Effect.runPromise(program.pipe(Effect.provide(storeLayer({ debrief: true }))));
  });

  it("is absent when debrief is unset with memory off", async () => {
    expect(Option.isNone(await Effect.runPromise(storeOf({})))).toBe(true);
  });

  it("is absent when debrief is false even with memory on", async () => {
    expect(Option.isNone(await Effect.runPromise(storeOf({ enableMemory: true, debrief: false })))).toBe(true);
  });
});

describe("createRuntime wires the debrief store", () => {
  const probe = (extra: Partial<RuntimeOptions>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* Effect.serviceOption(DebriefStoreService);
        return Option.isSome(store);
      }).pipe(Effect.provide(createRuntime({ agentId: "wire-agent", provider: "test", ...extra }))),
    );

  it("provides it for debrief: true with memory off", async () => {
    expect(await probe({ debrief: true })).toBe(true);
  });

  it("provides it for memory on (debrief unset)", async () => {
    expect(await probe({ enableMemory: true })).toBe(true);
  });

  it("does not provide it for a bare runtime", async () => {
    expect(await probe({})).toBe(false);
  });
});

// ── engine gate ──

const ctx = (): ExecutionContext => {
  const base: Partial<ExecutionContext> = {
    taskId: "t-1" as never,
    agentId: "a-1" as never,
    iteration: 1,
    tokensUsed: 10,
    cost: 0,
    startedAt: new Date(),
    agentState: "running",
    selectedStrategy: "reactive",
    metadata: { reasoningSteps: [] } as ExecutionContext["metadata"],
  };
  return base as ExecutionContext;
};

const deps = (over: { debrief?: boolean; enableMemory?: boolean }): DebriefSynthesisDeps => ({
  ctx: ctx(),
  task: {
    id: "t-1" as never,
    agentId: "a-1" as never,
    type: "query" as const,
    input: { question: "q" },
    priority: "medium" as const,
    status: "pending" as const,
    metadata: { tags: [] },
    createdAt: new Date(),
  },
  config: defaultReactiveAgentsConfig("a-1", over) as ReactiveAgentsConfig,
  eb: null,
  rr: { output: "done", status: "completed", metadata: { terminatedBy: "end_turn" } },
  terminatedByRaw: "end_turn",
  sanitizedOutput: "done",
  outputForSuccess: "done",
  hasSubstantiveOutput: true,
  toolCallLog: [],
});

describe("engine gate (synthesizeAndStoreDebrief)", () => {
  it("produces a debrief with memory off when debrief is on", async () => {
    const r = await Effect.runPromise(synthesizeAndStoreDebrief(deps({ debrief: true, enableMemory: false })));
    expect(r.debrief).toBeDefined();
  });

  it("produces none with memory off and debrief unset", async () => {
    const r = await Effect.runPromise(synthesizeAndStoreDebrief(deps({ enableMemory: false })));
    expect(r.debrief).toBeUndefined();
  });

  it("produces none with memory on and debrief false", async () => {
    const r = await Effect.runPromise(synthesizeAndStoreDebrief(deps({ enableMemory: true, debrief: false })));
    expect(r.debrief).toBeUndefined();
  });
});
