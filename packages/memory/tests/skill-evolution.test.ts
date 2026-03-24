import { describe, it, expect, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import { SkillEvolutionService, makeSkillEvolutionService } from "../src/services/skill-evolution.js";
import { SkillStoreService, SkillStoreServiceLive, MemoryDatabaseLive } from "../src/index.js";
import type { SkillRecord, SkillVersion, SkillFragmentConfig } from "@reactive-agents/core";
import type { MemoryLLM, DailyLogEntry, MemoryId } from "../src/types.js";
import { defaultMemoryConfig } from "../src/types.js";
import * as fs from "node:fs";
import * as path from "node:path";

const TEST_DB_DIR = "/tmp/test-skill-evolution-db";
const TEST_DB = path.join(TEST_DB_DIR, "evolution.db");

const defaultConfig: SkillFragmentConfig = { strategy: "reactive", temperature: 0.7, maxIterations: 5, promptTemplateId: "default", systemPromptTokens: 0, compressionEnabled: false };

const makeSkill = (overrides: Partial<SkillRecord> = {}): SkillRecord => ({
  id: overrides.id ?? "skill-1",
  name: "test-skill",
  description: "test",
  agentId: "agent-1",
  source: "learned",
  instructions: "# Steps\n1. Load data.\nValidate format first.\n2. Run analysis.\n\n# Examples\nExample 1",
  version: overrides.version ?? 1,
  versionHistory: overrides.versionHistory ?? [],
  config: defaultConfig,
  evolutionMode: overrides.evolutionMode ?? "auto",
  confidence: overrides.confidence ?? "tentative",
  successRate: overrides.successRate ?? 0.5,
  useCount: overrides.useCount ?? 3,
  refinementCount: overrides.refinementCount ?? 0,
  taskCategories: ["coding"],
  modelAffinities: [],
  base: null,
  avgPostActivationEntropyDelta: 0,
  avgConvergenceIteration: 0,
  convergenceSpeedTrend: [],
  conflictsWith: [],
  lastActivatedAt: null,
  lastRefinedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  contentVariants: { full: "# Steps\n1. Load data.\n2. Run analysis.", summary: null, condensed: null },
  ...overrides,
});

const makeEpisode = (content: string): DailyLogEntry => ({
  id: `ep-${Date.now()}` as MemoryId,
  agentId: "agent-1",
  date: "2026-03-23",
  content,
  eventType: "task-completed",
  createdAt: new Date(),
});

const mockLLM: MemoryLLM = {
  complete: (req) => {
    const userMsg = req.messages.find(m => m.role === "user")?.content ?? "";
    if (userMsg.includes("Condense") && userMsg.includes("500")) {
      return Effect.succeed({ content: "Summary: Load data, then run analysis." });
    }
    if (userMsg.includes("Condense") && userMsg.includes("150")) {
      return Effect.succeed({ content: "Load data. Run analysis." });
    }
    return Effect.succeed({ content: "# Improved Steps\n1. Load and validate data.\n2. Run thorough analysis.\n3. Check edge cases." });
  },
};

const failingLLM: MemoryLLM = {
  complete: () => Effect.fail(new Error("LLM unavailable")),
};

describe("SkillEvolutionService", () => {
  afterEach(() => {
    try { fs.unlinkSync(TEST_DB); fs.unlinkSync(TEST_DB + "-wal"); fs.unlinkSync(TEST_DB + "-shm"); } catch {}
    try { fs.rmSync(TEST_DB_DIR, { recursive: true }); } catch {}
  });

  const config = { ...defaultMemoryConfig("test-agent"), dbPath: TEST_DB };
  const dbLayer = MemoryDatabaseLive(config);
  const storeLayer = SkillStoreServiceLive.pipe(Layer.provide(dbLayer));

  const makeLayer = (llm?: MemoryLLM) =>
    Layer.mergeAll(
      storeLayer,
      makeSkillEvolutionService(llm).pipe(Layer.provide(storeLayer)),
    );

  it("refine() creates candidate version with LLM-refined instructions", async () => {
    const layer = makeLayer(mockLLM);
    const skill = makeSkill();
    await Effect.runPromise(Effect.provide(Effect.gen(function* () {
      const store = yield* SkillStoreService;
      yield* store.store(skill);
      const evo = yield* SkillEvolutionService;
      const refined = yield* evo.refine(skill, [makeEpisode("Task succeeded with fast convergence")]);
      expect(refined.version).toBe(2);
      expect(refined.instructions).toContain("Improved");
      expect(refined.refinementCount).toBe(1);
    }), layer));
  });

  it("refine() skips locked skills", async () => {
    const layer = makeLayer(mockLLM);
    const skill = makeSkill({ evolutionMode: "locked" });
    await Effect.runPromise(Effect.provide(Effect.gen(function* () {
      const store = yield* SkillStoreService;
      yield* store.store(skill);
      const evo = yield* SkillEvolutionService;
      const result = yield* evo.refine(skill, [makeEpisode("Some episode")]);
      expect(result.version).toBe(1); // unchanged
    }), layer));
  });

  it("refine() returns skill unchanged when LLM fails", async () => {
    const layer = makeLayer(failingLLM);
    const skill = makeSkill();
    await Effect.runPromise(Effect.provide(Effect.gen(function* () {
      const store = yield* SkillStoreService;
      yield* store.store(skill);
      const evo = yield* SkillEvolutionService;
      const result = yield* evo.refine(skill, [makeEpisode("Episode")]);
      expect(result.version).toBe(1); // unchanged
    }), layer));
  });

  it("refine() generates contentVariants", async () => {
    const layer = makeLayer(mockLLM);
    const skill = makeSkill();
    await Effect.runPromise(Effect.provide(Effect.gen(function* () {
      const store = yield* SkillStoreService;
      yield* store.store(skill);
      const evo = yield* SkillEvolutionService;
      yield* evo.refine(skill, [makeEpisode("Good run")]);
      const updated = yield* store.get("skill-1");
      expect(updated!.contentVariants.summary).toBeTruthy();
      expect(updated!.contentVariants.condensed).toBeTruthy();
    }), layer));
  });

  it("refine() falls back to heuristic variants when variant LLM calls fail", async () => {
    // LLM succeeds for refinement but fails for variants
    let callCount = 0;
    const partialLLM: MemoryLLM = {
      complete: (req) => {
        callCount++;
        if (callCount === 1) return Effect.succeed({ content: "# Better\n1. Do improved thing.\n2. Check results." });
        return Effect.fail(new Error("variant generation failed"));
      },
    };
    const layer = makeLayer(partialLLM);
    const skill = makeSkill();
    await Effect.runPromise(Effect.provide(Effect.gen(function* () {
      const store = yield* SkillStoreService;
      yield* store.store(skill);
      const evo = yield* SkillEvolutionService;
      yield* evo.refine(skill, [makeEpisode("Episode")]);
      const updated = yield* store.get("skill-1");
      // Heuristic fallback should still produce something
      expect(updated!.contentVariants.summary).not.toBeNull();
      expect(updated!.contentVariants.condensed).not.toBeNull();
    }), layer));
  });

  it("checkRegression() rolls back when successRate dropped", async () => {
    const layer = makeLayer(mockLLM);
    const candidateVersion: SkillVersion = { version: 2, instructions: "v2", config: defaultConfig, refinedAt: new Date(), successRateAtRefinement: 0.9, status: "candidate" };
    const skill = makeSkill({ version: 2, successRate: 0.6, versionHistory: [
      { version: 1, instructions: "v1", config: defaultConfig, refinedAt: new Date(), successRateAtRefinement: 0.7, status: "active" },
      candidateVersion,
    ] });
    await Effect.runPromise(Effect.provide(Effect.gen(function* () {
      const store = yield* SkillStoreService;
      yield* store.store(skill);
      yield* store.addVersion(skill.id, skill.versionHistory[0]!);
      yield* store.addVersion(skill.id, skill.versionHistory[1]!);
      const evo = yield* SkillEvolutionService;
      const result = yield* evo.checkRegression(skill);
      expect(result.rolledBack).toBe(true);
    }), layer));
  });

  it("checkPromotion() promotes tentative→trusted at threshold", async () => {
    const layer = makeLayer(mockLLM);
    const skill = makeSkill({ confidence: "tentative", useCount: 6, successRate: 0.85 });
    await Effect.runPromise(Effect.provide(Effect.gen(function* () {
      const store = yield* SkillStoreService;
      yield* store.store(skill);
      const evo = yield* SkillEvolutionService;
      const result = yield* evo.checkPromotion(skill);
      expect(result.promoted).toBe(true);
      expect(result.newConfidence).toBe("trusted");
    }), layer));
  });

  it("checkPromotion() promotes trusted→expert at threshold", async () => {
    const layer = makeLayer(mockLLM);
    const skill = makeSkill({ confidence: "trusted", useCount: 25, successRate: 0.92 });
    await Effect.runPromise(Effect.provide(Effect.gen(function* () {
      const store = yield* SkillStoreService;
      yield* store.store(skill);
      const evo = yield* SkillEvolutionService;
      const result = yield* evo.checkPromotion(skill);
      expect(result.promoted).toBe(true);
      expect(result.newConfidence).toBe("expert");
    }), layer));
  });

  it("checkPromotion() does not promote when below threshold", async () => {
    const layer = makeLayer(mockLLM);
    const skill = makeSkill({ confidence: "tentative", useCount: 3, successRate: 0.5 });
    await Effect.runPromise(Effect.provide(Effect.gen(function* () {
      const store = yield* SkillStoreService;
      yield* store.store(skill);
      const evo = yield* SkillEvolutionService;
      const result = yield* evo.checkPromotion(skill);
      expect(result.promoted).toBe(false);
    }), layer));
  });
});
