// Run: bun test packages/reactive-intelligence/tests/learning/skill-persistence-e2e.test.ts --timeout 15000
import { describe, it, expect, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import {
  SkillStoreService,
  SkillStoreServiceLive,
  MemoryDatabaseLive,
} from "@reactive-agents/memory";
import { defaultMemoryConfig } from "@reactive-agents/memory";
import { skillFragmentToSkillRecord, makeSkillResolverService } from "@reactive-agents/reactive-intelligence";
import { SkillResolverService } from "@reactive-agents/reactive-intelligence";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const tmpDirs: string[] = [];

function makeTestDb(): { dir: string; dbPath: string } {
  const dir = path.join(os.tmpdir(), `test-skill-persistence-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  tmpDirs.push(dir);
  return { dir, dbPath: path.join(dir, "skills.db") };
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

const testFragment = {
  promptTemplateId: "default",
  systemPromptTokens: 128,
  contextStrategy: {
    compressionEnabled: false,
    maxIterations: 5,
    temperature: 0.7,
    toolFilteringMode: "adaptive" as const,
    requiredToolsCount: 1,
  },
  memoryConfig: {
    tier: "standard",
    semanticLines: 3,
    episodicLines: 5,
    consolidationEnabled: false,
  },
  reasoningConfig: {
    strategy: "reactive",
    strategySwitchingEnabled: false,
    adaptiveEnabled: false,
  },
  convergenceIteration: 2,
  finalComposite: 0.2,
  meanComposite: 0.3,
};

describe("skill-persistence e2e: store → resolve → find", () => {
  it("resolver finds a learned skill stored via SkillStoreService", async () => {
    const { dir, dbPath } = makeTestDb();
    const memConfig = { ...defaultMemoryConfig("e2e-agent"), dbPath };
    const agentId = "e2e-agent";

    // ── Session 1: synthesise and store a learned skill ──
    const skillRecord = skillFragmentToSkillRecord({
      fragment: testFragment,
      agentId,
      taskCategory: "code-generation",
      modelId: "test-model",
    });

    {
      const storeLayer = SkillStoreServiceLive.pipe(
        Layer.provide(MemoryDatabaseLive(memConfig)),
      );
      await Effect.runPromise(
        Effect.scoped(
          Effect.provide(
            Effect.gen(function* () {
              const store = yield* SkillStoreService;
              yield* store.store(skillRecord);
            }),
            storeLayer,
          ),
        ),
      );
    }

    expect(fs.existsSync(dbPath)).toBe(true);

    // ── Session 2: resolver reads from the same DB and finds the skill ──
    {
      const storeLayer = SkillStoreServiceLive.pipe(
        Layer.provide(MemoryDatabaseLive(memConfig)),
      );
      const resolverLayer = makeSkillResolverService({
        customPaths: [],
        agentId,
        projectRoot: dir,
      }).pipe(Layer.provide(storeLayer));

      await Effect.runPromise(
        Effect.scoped(
          Effect.provide(
            Effect.gen(function* () {
              const resolver = yield* SkillResolverService;
              const result = yield* resolver.resolve({
                taskDescription: "write some code",
                modelId: "test-model",
                agentId,
              });

              const found = result.all.find((s) => s.name === skillRecord.name);
              expect(found).toBeDefined();
              expect(found!.source).toBe("learned");
              expect(found!.confidence).toBe("tentative");
              expect(found!.agentId).toBe(agentId);
            }),
            resolverLayer,
          ),
        ),
      );
    }
  }, 15000);

  it("tentative learned skills do NOT appear in autoActivate", async () => {
    const { dir: dir2, dbPath: dbPath2 } = makeTestDb();
    const memConfig = { ...defaultMemoryConfig("e2e-agent-2"), dbPath: dbPath2 };
    const agentId = "e2e-agent-2";

    const tentativeSkill = skillFragmentToSkillRecord({
      fragment: testFragment,
      agentId,
      taskCategory: "data-analysis",
      modelId: "test-model",
    });
    // Confirm it starts as tentative
    expect(tentativeSkill.confidence).toBe("tentative");

    {
      const storeLayer = SkillStoreServiceLive.pipe(
        Layer.provide(MemoryDatabaseLive(memConfig)),
      );
      await Effect.runPromise(
        Effect.scoped(
          Effect.provide(
            Effect.gen(function* () {
              const store = yield* SkillStoreService;
              yield* store.store(tentativeSkill);
            }),
            storeLayer,
          ),
        ),
      );
    }

    {
      const storeLayer = SkillStoreServiceLive.pipe(
        Layer.provide(MemoryDatabaseLive(memConfig)),
      );
      const resolverLayer = makeSkillResolverService({
        customPaths: [],
        agentId,
        projectRoot: dir2,
      }).pipe(Layer.provide(storeLayer));

      await Effect.runPromise(
        Effect.scoped(
          Effect.provide(
            Effect.gen(function* () {
              const resolver = yield* SkillResolverService;
              const result = yield* resolver.resolve({
                taskDescription: "analyse some data",
                modelId: "test-model",
                agentId,
              });

              // Skill should appear in all
              expect(result.all.length).toBeGreaterThanOrEqual(1);

              // Tentative skills must NOT auto-activate (only expert confidence does)
              const autoActivateNames = result.autoActivate.map((s) => s.name);
              expect(autoActivateNames).not.toContain(tentativeSkill.name);
            }),
            resolverLayer,
          ),
        ),
      );
    }
  }, 15000);

  it("multiple stored skills are all returned by resolver", async () => {
    const { dir: dir3, dbPath: dbPath3 } = makeTestDb();
    const memConfig = { ...defaultMemoryConfig("e2e-agent-3"), dbPath: dbPath3 };
    const agentId = "e2e-agent-3";

    const skills = ["task-a", "task-b", "task-c"].map((cat) =>
      skillFragmentToSkillRecord({
        fragment: testFragment,
        agentId,
        taskCategory: cat,
        modelId: "test-model",
      }),
    );

    {
      const storeLayer = SkillStoreServiceLive.pipe(
        Layer.provide(MemoryDatabaseLive(memConfig)),
      );
      await Effect.runPromise(
        Effect.scoped(
          Effect.provide(
            Effect.gen(function* () {
              const store = yield* SkillStoreService;
              for (const s of skills) {
                yield* store.store(s);
              }
            }),
            storeLayer,
          ),
        ),
      );
    }

    {
      const storeLayer = SkillStoreServiceLive.pipe(
        Layer.provide(MemoryDatabaseLive(memConfig)),
      );
      const resolverLayer = makeSkillResolverService({
        customPaths: [],
        agentId,
        projectRoot: dir3,
      }).pipe(Layer.provide(storeLayer));

      await Effect.runPromise(
        Effect.scoped(
          Effect.provide(
            Effect.gen(function* () {
              const resolver = yield* SkillResolverService;
              const result = yield* resolver.resolve({
                taskDescription: "do some work",
                modelId: "test-model",
                agentId,
              });

              // All 3 stored skills must appear (may be more if global skill paths are populated)
              expect(result.all.length).toBeGreaterThanOrEqual(3);
              for (const skill of skills) {
                const found = result.all.find((s) => s.name === skill.name);
                expect(found).toBeDefined();
                expect(found!.source).toBe("learned");
              }
            }),
            resolverLayer,
          ),
        ),
      );
    }
  }, 15000);
});
