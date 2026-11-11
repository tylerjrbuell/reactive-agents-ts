// Run: bun test packages/runtime/tests/seam-agent-memory-facade.test.ts --timeout 20000
//
// Seam pins for `agent.memory()` (agent/memory-facade.ts) and runtime memory
// provenance (engine/memory-provenance.ts):
//   1. A write made inside a run (guardrails wrapper on MemoryService and on
//      the AgentMemory port) stores the run's taskId/runId, and
//      `agent.memory().search` returns it.
//   2. memory-flush stamps extracted entries with the run's taskId/runId.
//   3. local-learning-style procedural writes keep provenance; the facade
//      lists, updates (provenance kept) and deletes semantic and procedural
//      entries; episodic is listable, and `episodic.list({ taskId })` filters
//      in the store before the limit.
//   4. Without `.withMemory()` every call rejects with the RAW
//      MemoryNotEnabledError (shared runFacadeEffect bridge, no FiberFailure).
import { afterAll, describe, expect, it } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentMemory, rootContext } from "@reactive-agents/core";
import { withRunScope } from "@reactive-agents/core/internal/run-scope";
import {
  createMemoryLayer,
  EpisodicMemoryService,
  MemoryIdSchema,
  MemoryService,
  ProceduralMemoryService,
  SemanticMemoryService,
  type ProceduralEntry,
  type SemanticEntry,
} from "@reactive-agents/memory";
import { LearningEngineService, type SkillFragment } from "@reactive-agents/reactive-intelligence";
import { runLocalLearning } from "../src/engine/finalize/local-learning.js";
import { ReactiveAgents } from "../src/index.js";
import { MemoryNotEnabledError } from "../src/agent/memory-facade.js";
import { withMemoryGuardrails } from "../src/memory-guardrails.js";
import { memoryFlush } from "../src/engine/phases/memory-flush.js";
import { withRunProvenance, type RunMemoryProvenance } from "../src/engine/memory-provenance.js";
import { makeExecutionContext, makeRuntimeConfig, makeTask } from "../src/testing/index.js";
import type { ExecutionContext } from "../src/types.js";
import type { PhaseDeps } from "../src/engine/runtime-context.js";

const BASE = mkdtempSync(join(tmpdir(), "ra-memory-facade-"));
afterAll(() => rmSync(BASE, { recursive: true, force: true }));

let seq = 0;
const dbPath = (): string => join(BASE, `memory-${++seq}.db`);

const semanticEntry = (agentId: string, content: string, extra: Partial<SemanticEntry> = {}): SemanticEntry => {
  const now = new Date();
  return {
    id: MemoryIdSchema.make(`sem-${++seq}`),
    agentId,
    content,
    summary: content.slice(0, 40),
    importance: 0.8,
    verified: false,
    tags: ["test"],
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    lastAccessedAt: now,
    ...extra,
  };
};

const buildAgent = (name: string, withMemory: boolean) => {
  const b = ReactiveAgents.create().withName(name).withTestScenario([{ text: "ok" }]);
  return (withMemory ? b.withMemory({ dbPath: dbPath() }) : b).build();
};

describe("withRunProvenance", () => {
  it("fills taskId/runId from the active run; explicit and pre-set fields win", async () => {
    const inRun = <A>(e: Effect.Effect<A>) => Effect.runPromise(withRunScope(rootContext("run-1", "a"))(e));
    expect(await inRun(withRunProvenance({}))).toEqual({ taskId: "run-1", runId: "run-1" });
    expect(await inRun(withRunProvenance({}, { taskId: "task-x" }))).toEqual({ taskId: "task-x", runId: "run-1" });
    expect(await inRun(withRunProvenance<RunMemoryProvenance>({ runId: "mine" }))).toEqual({ taskId: "run-1", runId: "mine" });
    // Outside a run nothing is guessed.
    expect(await Effect.runPromise(withRunProvenance({}))).toEqual({});
  });
});

describe("agent.memory() — provenance end to end", () => {
  it("a write inside a run is returned by search with the run's taskId and runId", async () => {
    const agent = await buildAgent("mem-facade-prov", true);
    const entry = semanticEntry(agent.agentId, "The deploy pipeline uses blue green rollout.");
    await agent.runtime.runPromise(
      withRunScope(rootContext("task-abc", agent.agentId))(
        Effect.flatMap(MemoryService, (m) => m.storeSemantic(entry)),
      ) as Effect.Effect<unknown>,
    );

    const hits = await agent.memory().search("deploy pipeline");
    expect(hits.length).toBe(1);
    expect(hits[0]!.id).toBe(entry.id);
    expect(hits[0]!.taskId).toBe("task-abc");
    expect(hits[0]!.runId).toBe("task-abc");
    expect("embedding" in hits[0]!).toBe(false);
    // Provenance filters narrow by run.
    expect((await agent.memory().search("deploy", { runId: "task-abc" })).length).toBe(1);
    expect((await agent.memory().search("deploy", { runId: "other" })).length).toBe(0);
    await agent.dispose();
  }, 30000);

  it("tool-driven AgentMemory writes carry provenance through the guardrails wrapper", async () => {
    const agent = await buildAgent("mem-facade-port", true);
    const entry = semanticEntry(agent.agentId, "Tool observation about the staging cluster.");
    await agent.runtime.runPromise(
      withRunScope(rootContext("task-port", agent.agentId))(
        Effect.flatMap(AgentMemory, (m) => m.storeSemantic(entry)),
      ) as Effect.Effect<unknown>,
    );
    const got = await agent.memory().semantic.get(entry.id);
    expect(got?.taskId).toBe("task-port");
    expect(got?.runId).toBe("task-port");
    await agent.dispose();
  }, 30000);
});

describe("agent.memory() — list, update, delete", () => {
  it("semantic: list, update returns the edited entry, delete removes it, unknown get is undefined", async () => {
    const agent = await buildAgent("mem-facade-sem", true);
    const entry = semanticEntry(agent.agentId, "Original fact about caching.", { taskId: "t-1", runId: "r-1" });
    await agent.runtime.runPromise(
      Effect.flatMap(SemanticMemoryService, (s) => s.store(entry)) as Effect.Effect<unknown>,
    );
    const mem = agent.memory();
    expect((await mem.semantic.list()).map((e) => e.id)).toContain(entry.id);

    const updated = await mem.semantic.update(entry.id, { content: "Edited fact about caching.", importance: 0.3 });
    expect(updated.content).toBe("Edited fact about caching.");
    expect(updated.importance).toBe(0.3);
    expect(updated.taskId).toBe("t-1");

    await mem.semantic.delete(entry.id);
    expect(await mem.semantic.get(entry.id)).toBeUndefined();
    const rejected = await mem.semantic.update(entry.id, { content: "x" }).catch((e: unknown) => e);
    expect((rejected as { _tag?: string })._tag).toBe("MemoryNotFoundError");
    await agent.dispose();
  }, 30000);

  it("procedural: update keeps provenance, delete removes; episodic lists", async () => {
    const agent = await buildAgent("mem-facade-proc", true);
    const now = new Date();
    const wfId = MemoryIdSchema.make("wf-1");
    await agent.runtime.runPromise(
      Effect.gen(function* () {
        const p = yield* ProceduralMemoryService;
        yield* p.store({
          id: wfId, agentId: agent.agentId, name: "deploy", description: "how to deploy",
          pattern: "{}", successRate: 0.9, useCount: 2, tags: ["ops"], createdAt: now, updatedAt: now,
          taskId: "t-learn", runId: "r-learn",
        });
        const e = yield* EpisodicMemoryService;
        yield* e.log({ id: MemoryIdSchema.make("ep-1"), agentId: agent.agentId, date: now.toISOString().slice(0, 10), content: "ran deploy", taskId: "t-learn", eventType: "task-completed", createdAt: now });
      }) as Effect.Effect<unknown>,
    );
    const mem = agent.memory();
    expect((await mem.procedural.list()).map((w) => w.id)).toEqual([wfId]);
    const updated = await mem.procedural.update(wfId, { description: "edited" });
    expect(updated.description).toBe("edited");
    expect((await mem.procedural.get(wfId))?.description).toBe("edited");
    expect((await mem.procedural.get(wfId))?.runId).toBe("r-learn");
    await mem.procedural.delete(wfId);
    expect(await mem.procedural.get(wfId)).toBeUndefined();

    const episodes = await mem.episodic.list();
    expect(episodes.some((e) => e.content === "ran deploy" && e.taskId === "t-learn")).toBe(true);
    await agent.dispose();
  }, 30000);

  it("episodic.list({ taskId }) filters in the store, before the limit, newest first", async () => {
    const agent = await buildAgent("mem-facade-ep-task", true);
    const base = Date.now() - 100_000;
    const day = new Date(base).toISOString().slice(0, 10);
    await agent.runtime.runPromise(
      Effect.gen(function* () {
        const e = yield* EpisodicMemoryService;
        // Two old entries of task "t-old", then 60 newer entries of "t-new":
        // the default limit (50) of the unfiltered list never reaches "t-old".
        for (let i = 0; i < 2; i++) {
          yield* e.log({ id: MemoryIdSchema.make(`ep-old-${i}`), agentId: agent.agentId, date: day, content: `old ${i}`, taskId: "t-old", eventType: "task-completed", createdAt: new Date(base + i) });
        }
        for (let i = 0; i < 60; i++) {
          yield* e.log({ id: MemoryIdSchema.make(`ep-new-${i}`), agentId: agent.agentId, date: day, content: `new ${i}`, taskId: "t-new", eventType: "task-completed", createdAt: new Date(base + 1000 + i) });
        }
        // Same task id, other agent: never listed.
        yield* e.log({ id: MemoryIdSchema.make("ep-foreign"), agentId: "other-agent", date: day, content: "foreign", taskId: "t-old", eventType: "task-completed", createdAt: new Date(base + 5) });
      }) as Effect.Effect<unknown>,
    );
    const mem = agent.memory();
    expect((await mem.episodic.list()).some((e) => e.taskId === "t-old")).toBe(false);
    const old = await mem.episodic.list({ taskId: "t-old" });
    expect(old.map((e) => e.content)).toEqual(["old 1", "old 0"]);
    const newest = await mem.episodic.list({ taskId: "t-new", limit: 3 });
    expect(newest.map((e) => e.content)).toEqual(["new 59", "new 58", "new 57"]);
    expect(await mem.episodic.list({ taskId: "missing" })).toEqual([]);
    await agent.dispose();
  }, 30000);

  it("without .withMemory() calls reject with the raw MemoryNotEnabledError", async () => {
    const agent = await buildAgent("mem-facade-off", false);
    const err = await agent.memory().search("anything").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MemoryNotEnabledError);
    const listErr = await agent.memory().procedural.list().catch((e: unknown) => e);
    expect((listErr as { _tag?: string })._tag).toBe("MemoryNotEnabledError");
    await agent.dispose();
  }, 30000);
});

// ─── local-learning stamps synthesized skill fragments ───

describe("local-learning provenance", () => {
  it("a synthesized skill fragment is stored with the run's taskId and runId", async () => {
    const stored: ProceduralEntry[] = [];
    const fragment: SkillFragment = {
      promptTemplateId: "default",
      systemPromptTokens: 10,
      contextStrategy: { compressionEnabled: false, maxIterations: 5, temperature: 0.2, toolFilteringMode: "none", requiredToolsCount: 0 },
      memoryConfig: { tier: "1", semanticLines: 0, episodicLines: 0, consolidationEnabled: false },
      reasoningConfig: { strategy: "reactive", strategySwitchingEnabled: false, adaptiveEnabled: false },
      convergenceIteration: 1,
      finalComposite: 0.2,
      meanComposite: 0.3,
    };
    const layer = Layer.mergeAll(
      Layer.succeed(LearningEngineService, {
        onRunCompleted: () =>
          Effect.succeed({ calibrationUpdated: false, banditUpdated: false, skillSynthesized: true, skillFragment: fragment, taskCategory: "research" }),
      }),
      Layer.succeed(ProceduralMemoryService, {
        store: (entry) => Effect.sync(() => (stored.push(entry), entry.id)),
        get: () => Effect.die("unexpected get"),
        recordOutcome: () => Effect.void,
        listActive: () => Effect.succeed([]),
        findByTags: () => Effect.succeed([]),
        delete: () => Effect.void,
      }),
    );
    await Effect.runPromise(
      runLocalLearning({
        ctx: makeExecutionContext({ taskId: "task-learn", agentId: "a1", selectedModel: "m", selectedStrategy: "reactive", iteration: 2 }),
        task: makeTask({ id: "task-learn", type: "research", input: "Search and summarize." }),
        config: makeRuntimeConfig({ enableReactiveIntelligence: true, enableMemory: true, defaultModel: "m" }),
        runOutcome: "success",
        entropyLog: [
          {
            iteration: 1,
            composite: 0.3,
            sources: { token: null, structural: 0.3, semantic: null, behavioral: 0.2, contextPressure: 0.1 },
            trajectory: { derivative: 0, shape: "converging", momentum: 0 },
            confidence: "medium",
          },
        ],
        executionDurationMs: 10,
      }).pipe(Effect.provide(layer), withRunScope(rootContext("run-learn", "a1"))),
    );
    expect(stored.length).toBe(1);
    expect(stored[0]!.taskId).toBe("task-learn");
    expect(stored[0]!.runId).toBe("run-learn");
  });
});

// ─── memory-flush stamps extracted entries ───

type MemoryExtractorLike = {
  extractFromConversation: (
    agentId: string,
    messages: readonly { role: string; content: string }[],
  ) => Effect.Effect<unknown[], unknown>;
};
const MemoryExtractorTag = Context.GenericTag<MemoryExtractorLike>("MemoryExtractor");

const flushDeps = (): PhaseDeps =>
  ({
    task: makeTask({ id: "task-flush", agentId: "agent-flush", input: "summarize the repo" }),
    config: { agentId: "agent-flush" } as never,
    hooks: { register: () => Effect.succeed(() => {}), run: (_p: unknown, _t: unknown, c: unknown) => Effect.succeed(c), list: () => Effect.succeed([]) } as never,
    obs: null,
    eb: null,
    ks: null,
    guardrail: null,
    behavioral: null,
    tools: null,
    state: { cancelledTasks: null as never, runningContexts: null as never },
    isNormal: false,
    executionStartMs: Date.now(),
  }) as PhaseDeps;

describe("memory-flush provenance", () => {
  it("extracted semantic entries store the run's taskId and runId", async () => {
    const extracted = semanticEntry("agent-flush", "The repo uses turborepo for builds.");
    const extractorLayer = Layer.succeed(MemoryExtractorTag, {
      extractFromConversation: () => Effect.succeed([extracted]),
    });
    const memLayer = withMemoryGuardrails(createMemoryLayer("1", { agentId: "agent-flush", dbPath: dbPath() }));
    const ctx: ExecutionContext = makeExecutionContext({
      taskId: "task-flush",
      agentId: "agent-flush",
      iteration: 3,
      metadata: { lastResponse: "x".repeat(300), taskComplexity: "complex" },
    });

    const stored = await Effect.runPromise(
      Effect.gen(function* () {
        yield* (memoryFlush.run(ctx, flushDeps()) as Effect.Effect<ExecutionContext, never, never>).pipe(
          Effect.provide(extractorLayer),
          // Scope runId differs from ctx.taskId: the explicit taskId must win
          // (red-on-cut: without the flush's own stamping the guardrails
          // fallback would store taskId "run-flush").
          withRunScope(rootContext("run-flush", "agent-flush")),
        );
        const s = yield* SemanticMemoryService;
        return yield* s.get(extracted.id);
      }).pipe(Effect.provide(memLayer)) as Effect.Effect<SemanticEntry, unknown, never>,
    );
    expect(stored.taskId).toBe("task-flush");
    expect(stored.runId).toBe("run-flush");
  }, 30000);
});
