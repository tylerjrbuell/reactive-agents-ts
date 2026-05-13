import { describe, it, expect, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import {
  SkillStoreService,
  SkillStoreServiceLive,
  MemoryDatabaseLive,
  exportSkillToMarkdown,
  importSkillFromMarkdown,
} from "../src/index.js";
import type { SkillRecord, SkillFragmentConfig } from "@reactive-agents/core";
import { defaultMemoryConfig } from "../src/types.js";
import * as fs from "node:fs";
import * as path from "node:path";

const TEST_DB_DIR = "/tmp/test-skill-cross-session";
const TEST_DB = path.join(TEST_DB_DIR, "skills.db");

const config = (): SkillFragmentConfig => ({
  strategy: "reactive",
  temperature: 0.7,
  maxIterations: 5,
  promptTemplateId: "default",
  systemPromptTokens: 0,
  compressionEnabled: false,
});

const makeSkill = (overrides: Partial<SkillRecord> = {}): SkillRecord => ({
  id: overrides.id!,
  name: overrides.name!,
  description: overrides.description ?? "",
  agentId: overrides.agentId ?? "research-agent",
  source: overrides.source ?? "learned",
  instructions: overrides.instructions ?? "Do the thing.",
  version: overrides.version ?? 1,
  versionHistory: [],
  config: overrides.config ?? config(),
  evolutionMode: "auto",
  confidence: overrides.confidence ?? "trusted",
  successRate: overrides.successRate ?? 0.85,
  useCount: overrides.useCount ?? 10,
  refinementCount: 0,
  taskCategories: overrides.taskCategories ?? [],
  modelAffinities: overrides.modelAffinities ?? [],
  base: null,
  avgPostActivationEntropyDelta: 0,
  avgConvergenceIteration: 0,
  convergenceSpeedTrend: [],
  conflictsWith: [],
  lastActivatedAt: null,
  lastRefinedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  contentVariants: {
    full: overrides.instructions ?? "Do the thing.",
    summary: null,
    condensed: null,
  },
});

// Fixture: 10 skills across 5 task categories
const fixtureSkills = (agentId = "research-agent"): SkillRecord[] => [
  makeSkill({ id: "s-web-1", name: "web-search-deep", agentId, taskCategories: ["web-search", "research"], successRate: 0.92, useCount: 50 }),
  makeSkill({ id: "s-web-2", name: "web-search-fast", agentId, taskCategories: ["web-search"], successRate: 0.75, useCount: 30 }),
  makeSkill({ id: "s-code-1", name: "code-edit-careful", agentId, taskCategories: ["code-editing", "refactor"], successRate: 0.88, useCount: 40 }),
  makeSkill({ id: "s-code-2", name: "code-debug", agentId, taskCategories: ["code-editing", "debugging"], successRate: 0.82, useCount: 25 }),
  makeSkill({ id: "s-math-1", name: "math-verify", agentId, taskCategories: ["math", "verification"], successRate: 0.95, useCount: 60 }),
  makeSkill({ id: "s-plan-1", name: "task-planning", agentId, taskCategories: ["planning"], successRate: 0.78, useCount: 35 }),
  makeSkill({ id: "s-summ-1", name: "summarization", agentId, taskCategories: ["summarization", "compression"], successRate: 0.85, useCount: 45 }),
  makeSkill({ id: "s-data-1", name: "data-extract", agentId, taskCategories: ["data-extraction", "parsing"], successRate: 0.90, useCount: 55 }),
  makeSkill({ id: "s-tool-1", name: "tool-orchestration", agentId, taskCategories: ["tool-use", "orchestration"], successRate: 0.86, useCount: 38 }),
  makeSkill({ id: "s-mem-1", name: "memory-recall", agentId, taskCategories: ["memory", "recall"], successRate: 0.83, useCount: 28 }),
];

// Query → expected top-1 skill id
const recallQueries: { categories: string[]; expectedTop1: string }[] = [
  { categories: ["web-search"], expectedTop1: "s-web-1" },        // highest success+use
  { categories: ["research"], expectedTop1: "s-web-1" },
  { categories: ["code-editing"], expectedTop1: "s-code-1" },     // higher success*use
  { categories: ["refactor"], expectedTop1: "s-code-1" },
  { categories: ["debugging"], expectedTop1: "s-code-2" },
  { categories: ["math"], expectedTop1: "s-math-1" },
  { categories: ["planning"], expectedTop1: "s-plan-1" },
  { categories: ["summarization"], expectedTop1: "s-summ-1" },
  { categories: ["data-extraction"], expectedTop1: "s-data-1" },
  { categories: ["tool-use"], expectedTop1: "s-tool-1" },
];

const cleanup = () => {
  try {
    fs.unlinkSync(TEST_DB);
    fs.unlinkSync(TEST_DB + "-wal");
    fs.unlinkSync(TEST_DB + "-shm");
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(TEST_DB_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
};

describe("skill cross-session recall (M6 acceptance: >70%)", () => {
  afterEach(cleanup);

  it("recalls >70% of skills by task category after DB close/reopen", async () => {
    const memConfig = { ...defaultMemoryConfig("test-agent"), dbPath: TEST_DB };

    // ── Session 1: store the fixture ──
    {
      const layer = SkillStoreServiceLive.pipe(Layer.provide(MemoryDatabaseLive(memConfig)));
      await Effect.runPromise(
        Effect.scoped(
          Effect.provide(
            Effect.gen(function* () {
              const store = yield* SkillStoreService;
              for (const skill of fixtureSkills()) {
                yield* store.store(skill);
              }
            }),
            layer,
          ),
        ),
      );
    }

    // DB is now closed (Effect.scoped finalizer ran).
    expect(fs.existsSync(TEST_DB)).toBe(true);

    // ── Session 2: reopen, query ──
    let hits = 0;
    {
      const layer = SkillStoreServiceLive.pipe(Layer.provide(MemoryDatabaseLive(memConfig)));
      await Effect.runPromise(
        Effect.scoped(
          Effect.provide(
            Effect.gen(function* () {
              const store = yield* SkillStoreService;
              for (const q of recallQueries) {
                const matches = yield* store.findByTask("research-agent", q.categories);
                if (matches.length > 0 && matches[0]!.id === q.expectedTop1) {
                  hits++;
                }
              }
            }),
            layer,
          ),
        ),
      );
    }

    const recallRate = hits / recallQueries.length;
    // Tier 1 success criterion from ROADMAP: >70% cross-session recall
    expect(recallRate).toBeGreaterThan(0.7);
  });

  it("round-trips skills via SKILL.md across a wipe", async () => {
    const memConfig = { ...defaultMemoryConfig("test-agent"), dbPath: TEST_DB };

    // Session 1: store skills, export to markdown
    const exported: string[] = [];
    {
      const layer = SkillStoreServiceLive.pipe(Layer.provide(MemoryDatabaseLive(memConfig)));
      await Effect.runPromise(
        Effect.scoped(
          Effect.provide(
            Effect.gen(function* () {
              const store = yield* SkillStoreService;
              for (const skill of fixtureSkills()) {
                yield* store.store(skill);
              }
              const all = yield* store.listAll("research-agent");
              for (const s of all) exported.push(exportSkillToMarkdown(s));
            }),
            layer,
          ),
        ),
      );
    }
    expect(exported).toHaveLength(10);

    // Wipe DB entirely (simulate disaster recovery / agent migration)
    cleanup();

    // Session 2: fresh DB, import from markdown, verify recall
    let hits = 0;
    {
      const layer = SkillStoreServiceLive.pipe(Layer.provide(MemoryDatabaseLive(memConfig)));
      await Effect.runPromise(
        Effect.scoped(
          Effect.provide(
            Effect.gen(function* () {
              const store = yield* SkillStoreService;
              for (const md of exported) {
                const skill = importSkillFromMarkdown(md);
                yield* store.store(skill);
              }
              for (const q of recallQueries) {
                const matches = yield* store.findByTask("research-agent", q.categories);
                if (matches.length > 0 && matches[0]!.id === q.expectedTop1) hits++;
              }
            }),
            layer,
          ),
        ),
      );
    }

    const recallRate = hits / recallQueries.length;
    expect(recallRate).toBeGreaterThan(0.7);
  });

  it("rebinds agentId on import to support skill sharing between agents", async () => {
    const memConfig = { ...defaultMemoryConfig("test-agent"), dbPath: TEST_DB };
    const sourceSkill = makeSkill({
      id: "shared-1",
      name: "shared-skill",
      agentId: "agent-alpha",
      taskCategories: ["analysis"],
    });
    const md = exportSkillToMarkdown(sourceSkill);

    const layer = SkillStoreServiceLive.pipe(Layer.provide(MemoryDatabaseLive(memConfig)));
    await Effect.runPromise(
      Effect.scoped(
        Effect.provide(
          Effect.gen(function* () {
            const store = yield* SkillStoreService;
            const rebound = importSkillFromMarkdown(md, {
              agentId: "agent-beta",
              id: "regenerate",
            });
            yield* store.store(rebound);
            const found = yield* store.findByTask("agent-beta", ["analysis"]);
            expect(found).toHaveLength(1);
            expect(found[0]!.agentId).toBe("agent-beta");
            expect(found[0]!.name).toBe("shared-skill");
            // Original agent should NOT see the shared skill
            const alphaResults = yield* store.findByTask("agent-alpha", ["analysis"]);
            expect(alphaResults).toHaveLength(0);
          }),
          layer,
        ),
      ),
    );
  });
});
