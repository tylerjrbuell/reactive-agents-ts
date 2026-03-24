import { describe, it, expect, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import { SkillStoreService, SkillStoreServiceLive, MemoryDatabaseLive } from "../src/index.js";
import type { SkillRecord, SkillVersion, SkillFragmentConfig } from "@reactive-agents/core";
import { defaultMemoryConfig } from "../src/types.js";
import * as fs from "node:fs";
import * as path from "node:path";

const TEST_DB_DIR = "/tmp/test-skill-store-db";
const TEST_DB = path.join(TEST_DB_DIR, "skills.db");

const defaultConfig: SkillFragmentConfig = {
  strategy: "reactive",
  temperature: 0.7,
  maxIterations: 5,
  promptTemplateId: "default",
  systemPromptTokens: 0,
  compressionEnabled: false,
};

const makeSkill = (overrides: Partial<SkillRecord> = {}): SkillRecord => ({
  id: overrides.id ?? `skill-${Date.now()}`,
  name: overrides.name ?? "test-skill",
  description: overrides.description ?? "A test skill",
  agentId: overrides.agentId ?? "agent-1",
  source: overrides.source ?? "learned",
  instructions: overrides.instructions ?? "# Test\nDo the thing",
  version: overrides.version ?? 1,
  versionHistory: overrides.versionHistory ?? [],
  config: overrides.config ?? defaultConfig,
  evolutionMode: overrides.evolutionMode ?? "auto",
  confidence: overrides.confidence ?? "tentative",
  successRate: overrides.successRate ?? 0,
  useCount: overrides.useCount ?? 0,
  refinementCount: overrides.refinementCount ?? 0,
  taskCategories: overrides.taskCategories ?? ["coding"],
  modelAffinities: overrides.modelAffinities ?? [],
  base: overrides.base ?? null,
  avgPostActivationEntropyDelta: 0,
  avgConvergenceIteration: 0,
  convergenceSpeedTrend: [],
  conflictsWith: [],
  lastActivatedAt: null,
  lastRefinedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  contentVariants: overrides.contentVariants ?? { full: "# Test\nDo the thing", summary: null, condensed: null },
});

describe("SkillStoreService", () => {
  afterEach(() => {
    try { fs.unlinkSync(TEST_DB); fs.unlinkSync(TEST_DB + "-wal"); fs.unlinkSync(TEST_DB + "-shm"); } catch { /* ignore */ }
    try { fs.rmSync(TEST_DB_DIR, { recursive: true }); } catch { /* ignore */ }
  });

  const config = { ...defaultMemoryConfig("test-agent"), dbPath: TEST_DB };
  const dbLayer = MemoryDatabaseLive(config);
  const layer = SkillStoreServiceLive.pipe(Layer.provide(dbLayer));

  const run = <A>(effect: Effect.Effect<A, any, SkillStoreService>) =>
    Effect.runPromise(Effect.provide(effect, layer));

  it("store() persists a SkillRecord and get() retrieves it", async () => {
    const skill = makeSkill({ id: "skill-1", name: "data-analysis" });
    await run(Effect.gen(function* () {
      const store = yield* SkillStoreService;
      yield* store.store(skill);
      const retrieved = yield* store.get("skill-1");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe("data-analysis");
      expect(retrieved!.source).toBe("learned");
      expect(retrieved!.confidence).toBe("tentative");
      expect(retrieved!.contentVariants.full).toBe("# Test\nDo the thing");
    }));
  });

  it("get() returns null for non-existent skill", async () => {
    await run(Effect.gen(function* () {
      const store = yield* SkillStoreService;
      const retrieved = yield* store.get("nonexistent");
      expect(retrieved).toBeNull();
    }));
  });

  it("findByTask() returns skills matching taskCategories", async () => {
    const s1 = makeSkill({ id: "s1", taskCategories: ["coding", "analysis"] });
    const s2 = makeSkill({ id: "s2", taskCategories: ["writing"] });
    await run(Effect.gen(function* () {
      const store = yield* SkillStoreService;
      yield* store.store(s1);
      yield* store.store(s2);
      const results = yield* store.findByTask("agent-1", ["coding"]);
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("s1");
    }));
  });

  it("findByTask() ranks by successRate * useCount", async () => {
    const s1 = makeSkill({ id: "s1", successRate: 0.9, useCount: 10, taskCategories: ["coding"] });
    const s2 = makeSkill({ id: "s2", successRate: 0.5, useCount: 20, taskCategories: ["coding"] });
    const s3 = makeSkill({ id: "s3", successRate: 0.8, useCount: 5, taskCategories: ["coding"] });
    await run(Effect.gen(function* () {
      const store = yield* SkillStoreService;
      yield* store.store(s2); // score: 10
      yield* store.store(s1); // score: 9
      yield* store.store(s3); // score: 4
      const results = yield* store.findByTask("agent-1", ["coding"]);
      expect(results[0]!.id).toBe("s2");
      expect(results[1]!.id).toBe("s1");
      expect(results[2]!.id).toBe("s3");
    }));
  });

  it("update() modifies fields", async () => {
    const skill = makeSkill({ id: "s1" });
    await run(Effect.gen(function* () {
      const store = yield* SkillStoreService;
      yield* store.store(skill);
      yield* store.update("s1", { successRate: 0.95, useCount: 15 });
      const updated = yield* store.get("s1");
      expect(updated!.successRate).toBe(0.95);
      expect(updated!.useCount).toBe(15);
    }));
  });

  it("promote() transitions confidence", async () => {
    const skill = makeSkill({ id: "s1", confidence: "tentative" });
    await run(Effect.gen(function* () {
      const store = yield* SkillStoreService;
      yield* store.store(skill);
      yield* store.promote("s1", "trusted");
      const promoted = yield* store.get("s1");
      expect(promoted!.confidence).toBe("trusted");
    }));
  });

  it("rollback() restores previous version atomically", async () => {
    const skill = makeSkill({ id: "s1", version: 2, instructions: "v2 instructions" });
    const prevVersion: SkillVersion = {
      version: 1,
      instructions: "v1 instructions",
      config: defaultConfig,
      refinedAt: new Date(),
      successRateAtRefinement: 0.8,
      status: "active",
    };
    await run(Effect.gen(function* () {
      const store = yield* SkillStoreService;
      yield* store.store(skill);
      yield* store.addVersion("s1", prevVersion);
      yield* store.addVersion("s1", { ...prevVersion, version: 2, instructions: "v2 instructions", status: "candidate" });
      yield* store.rollback("s1");
      const rolledBack = yield* store.get("s1");
      expect(rolledBack!.version).toBe(1);
      expect(rolledBack!.instructions).toBe("v1 instructions");
    }));
  });

  it("listAll() returns all skills for an agent", async () => {
    await run(Effect.gen(function* () {
      const store = yield* SkillStoreService;
      yield* store.store(makeSkill({ id: "s1", agentId: "agent-1" }));
      yield* store.store(makeSkill({ id: "s2", agentId: "agent-1" }));
      yield* store.store(makeSkill({ id: "s3", agentId: "agent-2" }));
      const results = yield* store.listAll("agent-1");
      expect(results).toHaveLength(2);
    }));
  });

  it("delete() removes skill and version history", async () => {
    await run(Effect.gen(function* () {
      const store = yield* SkillStoreService;
      yield* store.store(makeSkill({ id: "s1" }));
      yield* store.addVersion("s1", { version: 1, instructions: "v1", config: defaultConfig, refinedAt: new Date(), successRateAtRefinement: 0, status: "active" });
      yield* store.delete("s1");
      const result = yield* store.get("s1");
      expect(result).toBeNull();
    }));
  });

  it("getByName() finds skill by agent and name", async () => {
    await run(Effect.gen(function* () {
      const store = yield* SkillStoreService;
      yield* store.store(makeSkill({ id: "s1", name: "data-analysis" }));
      const result = yield* store.getByName("agent-1", "data-analysis");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("data-analysis");
    }));
  });
});
