import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import {
  SkillResolverService,
  makeSkillResolverService,
} from "../../src/skills/skill-resolver.js";
import type { SkillRecord, SkillFragmentConfig } from "@reactive-agents/core";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const TMP_DIR = path.join(os.tmpdir(), "test-skill-resolver");

const defaultConfig: SkillFragmentConfig = {
  strategy: "reactive",
  temperature: 0.7,
  maxIterations: 5,
  promptTemplateId: "default",
  systemPromptTokens: 0,
  compressionEnabled: false,
};

const writeSkill = (dir: string, name: string, desc: string) => {
  const skillDir = path.join(dir, name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${desc}\n---\n\nInstructions for ${name}.`,
  );
};

describe("SkillResolverService", () => {
  beforeEach(() => fs.mkdirSync(TMP_DIR, { recursive: true }));
  afterEach(() => fs.rmSync(TMP_DIR, { recursive: true, force: true }));

  // Layer without SkillStoreService (no SQLite, only filesystem).
  // `skipGlobalPaths: true` keeps resolution hermetic (HS-25): otherwise the
  // user's `~/.agents/skills` and `~/.reactive-agents/skills` directories
  // leak into test fixtures.
  const makeLayer = (customPaths: string[]) =>
    makeSkillResolverService({ customPaths, agentId: "agent-1", projectRoot: TMP_DIR, skipGlobalPaths: true });

  const run = <A>(
    layer: Layer.Layer<SkillResolverService, unknown, never>,
    effect: Effect.Effect<A, unknown, SkillResolverService>,
  ) => Effect.runPromise(Effect.provide(effect, layer));

  it("resolve() discovers filesystem skills", async () => {
    writeSkill(path.join(TMP_DIR, "skills"), "skill-a", "Skill A");
    const layer = makeLayer([path.join(TMP_DIR, "skills")]);
    await run(
      layer,
      Effect.gen(function* () {
        const resolver = yield* SkillResolverService;
        const result = yield* resolver.resolve({
          taskDescription: "test",
          modelId: "test",
          agentId: "agent-1",
        });
        expect(result.all.length).toBeGreaterThanOrEqual(1);
        const skillA = result.all.find((s) => s.name === "skill-a");
        expect(skillA).toBeDefined();
        expect(skillA!.source).toBe("installed");
        expect(skillA!.evolutionMode).toBe("locked");
      }),
    );
  });

  it("resolve() sets correct defaults on installed skill records", async () => {
    writeSkill(path.join(TMP_DIR, "skills"), "my-skill", "My Skill");
    const layer = makeLayer([path.join(TMP_DIR, "skills")]);
    await run(
      layer,
      Effect.gen(function* () {
        const resolver = yield* SkillResolverService;
        const result = yield* resolver.resolve({
          taskDescription: "test",
          modelId: "test",
          agentId: "agent-1",
        });
        const skill = result.all.find((s) => s.name === "my-skill");
        expect(skill).toBeDefined();
        expect(skill!.confidence).toBe("trusted");
        expect(skill!.evolutionMode).toBe("locked");
        expect(skill!.source).toBe("installed");
        expect(skill!.version).toBe(1);
        expect(skill!.versionHistory).toHaveLength(0);
        expect(skill!.contentVariants.full).toContain("Instructions for my-skill");
        expect(skill!.contentVariants.summary).toBeNull();
        expect(skill!.contentVariants.condensed).toBeNull();
      }),
    );
  });

  it("generateCatalogXml() produces correct XML", async () => {
    const layer = makeLayer([]);
    await run(
      layer,
      Effect.gen(function* () {
        const resolver = yield* SkillResolverService;
        const skills: SkillRecord[] = [
          {
            id: "s1",
            name: "test-skill",
            description: "Does things",
            agentId: "a1",
            source: "installed",
            instructions: "# Test",
            version: 1,
            versionHistory: [],
            config: defaultConfig,
            evolutionMode: "locked",
            confidence: "trusted",
            successRate: 0.9,
            useCount: 10,
            refinementCount: 0,
            taskCategories: [],
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
            contentVariants: { full: "# Test", summary: null, condensed: null },
          },
        ];
        const xml = resolver.generateCatalogXml(skills);
        expect(xml).toContain("<available_skills>");
        expect(xml).toContain("<name>test-skill</name>");
        expect(xml).toContain("<description>Does things</description>");
        expect(xml).toContain("<source>installed</source>");
        expect(xml).toContain("<confidence>trusted</confidence>");
        expect(xml).toContain("</available_skills>");
      }),
    );
  });

  it("generateCatalogXml() adds catalog-only hint when requested", async () => {
    const layer = makeLayer([]);
    await run(
      layer,
      Effect.gen(function* () {
        const resolver = yield* SkillResolverService;
        const skills: SkillRecord[] = [
          {
            id: "s1",
            name: "big-skill",
            description: "Big skill",
            agentId: "a1",
            source: "installed",
            instructions: "# Big",
            version: 1,
            versionHistory: [],
            config: defaultConfig,
            evolutionMode: "locked",
            confidence: "tentative",
            successRate: 0,
            useCount: 0,
            refinementCount: 0,
            taskCategories: [],
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
            contentVariants: { full: "# Big", summary: null, condensed: null },
          },
        ];
        const xml = resolver.generateCatalogXml(skills, { catalogOnlyHint: true });
        expect(xml).toContain("get_skill_section");
        expect(xml).toContain('get_skill_section("big-skill", "full")');
        expect(xml).toContain("condensed");
      }),
    );
  });

  it("generateCatalogXml() does not add hint when summary is available", async () => {
    const layer = makeLayer([]);
    await run(
      layer,
      Effect.gen(function* () {
        const resolver = yield* SkillResolverService;
        const skills: SkillRecord[] = [
          {
            id: "s1",
            name: "skill-with-summary",
            description: "Has summary",
            agentId: "a1",
            source: "learned",
            instructions: "# Full instructions",
            version: 2,
            versionHistory: [],
            config: defaultConfig,
            evolutionMode: "auto",
            confidence: "expert",
            successRate: 0.95,
            useCount: 50,
            refinementCount: 3,
            taskCategories: ["code-review"],
            modelAffinities: [],
            base: null,
            avgPostActivationEntropyDelta: -0.1,
            avgConvergenceIteration: 2.5,
            convergenceSpeedTrend: [],
            conflictsWith: [],
            lastActivatedAt: null,
            lastRefinedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            contentVariants: {
              full: "# Full instructions",
              summary: "Short summary",
              condensed: null,
            },
          },
        ];
        const xml = resolver.generateCatalogXml(skills, { catalogOnlyHint: true });
        // Should NOT add the hint because summary is non-null
        expect(xml).not.toContain("get_skill_section");
        expect(xml).toContain("<name>skill-with-summary</name>");
      }),
    );
  });

  it("resolve() classifies expert skills as autoActivate", async () => {
    // Without store, installed skills default to "trusted" — so autoActivate should be empty
    const layer = makeLayer([]);
    await run(
      layer,
      Effect.gen(function* () {
        const resolver = yield* SkillResolverService;
        const result = yield* resolver.resolve({
          taskDescription: "test",
          modelId: "test",
          agentId: "agent-1",
        });
        expect(result.autoActivate).toHaveLength(0);
      }),
    );
  });

  // ── Activation: explicit + relevance (2026-08-06) ──
  // Installed skills are "trusted", never "expert", so before this they could
  // never auto-activate — the model saw the catalog but never a skill's
  // instructions and improvised. `activate` (explicit) and task relevance now
  // promote installed skills into autoActivate (= full-content injection).
  const makeLayerAct = (customPaths: string[], activate?: string[]) =>
    makeSkillResolverService({
      customPaths,
      agentId: "agent-1",
      projectRoot: TMP_DIR,
      skipGlobalPaths: true,
      ...(activate ? { activate } : {}),
    });

  it("resolve() activates an explicitly-named installed skill (bypasses trusted floor)", async () => {
    const dir = path.join(TMP_DIR, "explicit");
    writeSkill(dir, "gws-drive", "google drive helper");
    writeSkill(dir, "cooking", "recipes and meals");
    await run(
      makeLayerAct([dir], ["gws-drive"]),
      Effect.gen(function* () {
        const resolver = yield* SkillResolverService;
        const result = yield* resolver.resolve({
          taskDescription: "do something unrelated",
          modelId: "test",
          agentId: "agent-1",
        });
        const names = result.autoActivate.map((s) => s.name);
        expect(names).toContain("gws-drive");
        expect(names).not.toContain("cooking");
      }),
    );
  });

  it("resolve() activates a task-relevant skill above the floor, not an unrelated one", async () => {
    const dir = path.join(TMP_DIR, "relevance");
    writeSkill(dir, "google-workspace", "manage google workspace drive and docs");
    writeSkill(dir, "cooking", "recipes and meals");
    await run(
      makeLayerAct([dir]),
      Effect.gen(function* () {
        const resolver = yield* SkillResolverService;
        const result = yield* resolver.resolve({
          taskDescription: "list files in my google workspace drive",
          modelId: "test",
          agentId: "agent-1",
        });
        const names = result.autoActivate.map((s) => s.name);
        expect(names).toContain("google-workspace");
        expect(names).not.toContain("cooking");
      }),
    );
  });

  it("resolve() does NOT activate on a weak incidental match (floor holds)", async () => {
    const dir = path.join(TMP_DIR, "weak");
    // "list" is < 4 chars filtered out; nothing else overlaps → score 0.
    writeSkill(dir, "cooking", "recipes and meals");
    await run(
      makeLayerAct([dir]),
      Effect.gen(function* () {
        const resolver = yield* SkillResolverService;
        const result = yield* resolver.resolve({
          taskDescription: "list the files please",
          modelId: "test",
          agentId: "agent-1",
        });
        expect(result.autoActivate).toHaveLength(0);
      }),
    );
  });

  it("resolve() caps relevance-activated skills but keeps all explicit ones", async () => {
    const dir = path.join(TMP_DIR, "cap");
    for (let i = 0; i < 5; i++) writeSkill(dir, `drive-tool-${i}`, "google drive workspace helper");
    await run(
      makeLayerAct([dir], ["drive-tool-0", "drive-tool-1", "drive-tool-2"]),
      Effect.gen(function* () {
        const resolver = yield* SkillResolverService;
        const result = yield* resolver.resolve({
          taskDescription: "google drive workspace files",
          modelId: "test",
          agentId: "agent-1",
        });
        // 3 explicit (unbounded) + up to 2 relevance = 5 here, but relevance is
        // capped at 2 so total never exceeds explicit + 2.
        expect(result.autoActivate.length).toBeLessThanOrEqual(5);
        expect(result.autoActivate.length).toBeGreaterThanOrEqual(3);
        const names = result.autoActivate.map((s) => s.name);
        expect(names).toContain("drive-tool-0");
        expect(names).toContain("drive-tool-1");
        expect(names).toContain("drive-tool-2");
      }),
    );
  });

  // ── Prerequisite dependency auto-activation (2026-08-06) ──
  const writeSkillBody = (dir: string, name: string, desc: string, body: string) => {
    const skillDir = path.join(dir, name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${desc}\n---\n\n${body}`,
    );
  };

  it("resolve() auto-activates a linked PREREQUISITE skill", async () => {
    const dir = path.join(TMP_DIR, "prereq");
    writeSkillBody(
      dir,
      "gws-drive",
      "drive",
      "> **PREREQUISITE:** Read `../gws-shared/SKILL.md` for auth and syntax.",
    );
    writeSkill(dir, "gws-shared", "shared auth and syntax");
    await run(
      makeLayerAct([dir], ["gws-drive"]),
      Effect.gen(function* () {
        const resolver = yield* SkillResolverService;
        const result = yield* resolver.resolve({
          taskDescription: "unrelated",
          modelId: "test",
          agentId: "agent-1",
        });
        const names = result.autoActivate.map((s) => s.name);
        expect(names).toContain("gws-drive");
        expect(names).toContain("gws-shared");
      }),
    );
  });

  it("resolve() does NOT treat a bare '## Prerequisites' heading as a dependency", async () => {
    const dir = path.join(TMP_DIR, "heading");
    writeSkillBody(dir, "solo", "solo skill", "## Prerequisites\n\nOrient first, then act.");
    writeSkill(dir, "gws-shared", "shared");
    await run(
      makeLayerAct([dir], ["solo"]),
      Effect.gen(function* () {
        const resolver = yield* SkillResolverService;
        const result = yield* resolver.resolve({
          taskDescription: "unrelated",
          modelId: "test",
          agentId: "agent-1",
        });
        const names = result.autoActivate.map((s) => s.name);
        expect(names).toContain("solo");
        expect(names).not.toContain("gws-shared");
      }),
    );
  });

  it("resolve() skips a prerequisite that was not discovered (no crash)", async () => {
    const dir = path.join(TMP_DIR, "missing-prereq");
    writeSkillBody(
      dir,
      "gws-drive",
      "drive",
      "> **PREREQUISITE:** Read `../gws-shared/SKILL.md`.",
    );
    // gws-shared NOT written.
    await run(
      makeLayerAct([dir], ["gws-drive"]),
      Effect.gen(function* () {
        const resolver = yield* SkillResolverService;
        const result = yield* resolver.resolve({
          taskDescription: "unrelated",
          modelId: "test",
          agentId: "agent-1",
        });
        const names = result.autoActivate.map((s) => s.name);
        expect(names).toEqual(["gws-drive"]);
      }),
    );
  });

  it("resolve() resolves prerequisites transitively and survives a cycle", async () => {
    const dir = path.join(TMP_DIR, "transitive");
    writeSkillBody(dir, "a", "a", "> **PREREQUISITE:** `../b/SKILL.md`");
    writeSkillBody(dir, "b", "b", "> **PREREQUISITE:** `../c/SKILL.md`");
    // c points back at a → cycle; must terminate.
    writeSkillBody(dir, "c", "c", "> **PREREQUISITE:** `../a/SKILL.md`");
    await run(
      makeLayerAct([dir], ["a"]),
      Effect.gen(function* () {
        const resolver = yield* SkillResolverService;
        const result = yield* resolver.resolve({
          taskDescription: "unrelated",
          modelId: "test",
          agentId: "agent-1",
        });
        const names = result.autoActivate.map((s) => s.name).sort();
        expect(names).toEqual(["a", "b", "c"]);
      }),
    );
  });

  it("resolve() sorts by confidence then score", async () => {
    const skillsDir = path.join(TMP_DIR, "multi-skills");
    writeSkill(skillsDir, "skill-a", "A");
    writeSkill(skillsDir, "skill-b", "B");
    const layer = makeLayer([skillsDir]);
    await run(
      layer,
      Effect.gen(function* () {
        const resolver = yield* SkillResolverService;
        const result = yield* resolver.resolve({
          taskDescription: "test",
          modelId: "test",
          agentId: "agent-1",
        });
        expect(result.all.length).toBe(2);
        // All installed skills default to "trusted" confidence
        expect(result.all.every((s) => s.confidence === "trusted")).toBe(true);
      }),
    );
  });

  it("resolve() returns empty when no paths and no store", async () => {
    const layer = makeLayer([]);
    await run(
      layer,
      Effect.gen(function* () {
        const resolver = yield* SkillResolverService;
        const result = yield* resolver.resolve({
          taskDescription: "anything",
          modelId: "test",
          agentId: "agent-1",
        });
        expect(result.all).toHaveLength(0);
        expect(result.autoActivate).toHaveLength(0);
        expect(result.catalog).toHaveLength(0);
      }),
    );
  });

  it("resolve() learned skills win on name collision with installed", async () => {
    // This test uses a mock SkillStoreService layer to inject a learned skill
    // that has the same name as an installed skill
    const skillsDir = path.join(TMP_DIR, "collision-skills");
    writeSkill(skillsDir, "shared-skill", "Installed version");

    // Build a mock SkillStoreService that returns a learned skill named "shared-skill"
    const { SkillStoreService } = await import("@reactive-agents/memory");
    const mockLearnedSkill: SkillRecord = {
      id: "learned-shared-skill",
      name: "shared-skill",
      description: "Learned version",
      agentId: "agent-1",
      source: "learned",
      instructions: "# Learned instructions",
      version: 3,
      versionHistory: [],
      config: defaultConfig,
      evolutionMode: "auto",
      confidence: "expert",
      successRate: 0.92,
      useCount: 30,
      refinementCount: 2,
      taskCategories: ["general"],
      modelAffinities: [],
      base: null,
      avgPostActivationEntropyDelta: -0.05,
      avgConvergenceIteration: 2.1,
      convergenceSpeedTrend: [],
      conflictsWith: [],
      lastActivatedAt: null,
      lastRefinedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      contentVariants: { full: "# Learned instructions", summary: null, condensed: null },
    };

    const mockStoreLayer = Layer.succeed(SkillStoreService, {
      store: () => Effect.succeed("learned-shared-skill"),
      get: () => Effect.succeed(null),
      getByName: () => Effect.succeed(null),
      findByTask: () => Effect.succeed([]),
      update: () => Effect.succeed(undefined),
      promote: () => Effect.succeed(undefined),
      rollback: () => Effect.succeed(undefined),
      listAll: () => Effect.succeed([mockLearnedSkill]),
      delete: () => Effect.succeed(undefined),
      addVersion: () => Effect.succeed(undefined),
    });

    const resolverLayer = makeSkillResolverService({
      customPaths: [skillsDir],
      agentId: "agent-1",
      projectRoot: TMP_DIR,
    });

    // Combine layers: resolver needs store available
    const combinedLayer = resolverLayer.pipe(Layer.provide(mockStoreLayer));

    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const resolver = yield* SkillResolverService;
          const result = yield* resolver.resolve({
            taskDescription: "test",
            modelId: "test",
            agentId: "agent-1",
          });

          // Only one "shared-skill" should exist (no duplicates)
          const sharedSkills = result.all.filter((s) => s.name === "shared-skill");
          expect(sharedSkills).toHaveLength(1);

          // The learned version wins
          expect(sharedSkills[0]!.source).toBe("learned");
          expect(sharedSkills[0]!.description).toBe("Learned version");

          // Expert learned skill should be in autoActivate
          expect(result.autoActivate).toHaveLength(1);
          expect(result.autoActivate[0]!.name).toBe("shared-skill");
        }),
        combinedLayer,
      ),
    );
  });

  it("generateCatalogXml() produces correct structure for multiple skills", async () => {
    const layer = makeLayer([]);
    await run(
      layer,
      Effect.gen(function* () {
        const resolver = yield* SkillResolverService;
        const skills: SkillRecord[] = [
          {
            id: "s1",
            name: "expert-skill",
            description: "Expert level",
            agentId: "a1",
            source: "learned",
            instructions: "# Expert",
            version: 5,
            versionHistory: [],
            config: defaultConfig,
            evolutionMode: "auto",
            confidence: "expert",
            successRate: 0.98,
            useCount: 100,
            refinementCount: 5,
            taskCategories: [],
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
            contentVariants: { full: "# Expert", summary: null, condensed: null },
          },
          {
            id: "s2",
            name: "tentative-skill",
            description: "New skill",
            agentId: "a1",
            source: "installed",
            instructions: "# New",
            version: 1,
            versionHistory: [],
            config: defaultConfig,
            evolutionMode: "locked",
            confidence: "tentative",
            successRate: 0,
            useCount: 0,
            refinementCount: 0,
            taskCategories: [],
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
            contentVariants: { full: "# New", summary: null, condensed: null },
          },
        ];
        const xml = resolver.generateCatalogXml(skills);
        // Count skill entries
        const skillMatches = xml.match(/<skill>/g) ?? [];
        expect(skillMatches).toHaveLength(2);
        // XML structure
        expect(xml.startsWith("<available_skills>")).toBe(true);
        expect(xml.endsWith("</available_skills>")).toBe(true);
      }),
    );
  });
});
