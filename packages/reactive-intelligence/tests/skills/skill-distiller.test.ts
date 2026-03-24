import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { SkillDistillerService, makeSkillDistillerService } from "../../src/skills/skill-distiller.js";
import type { SkillRecord, SkillFragmentConfig } from "@reactive-agents/core";
import type { SkillDistillerDeps } from "../../src/skills/skill-distiller.js";

const defaultConfig: SkillFragmentConfig = {
  strategy: "reactive",
  temperature: 0.7,
  maxIterations: 5,
  promptTemplateId: "default",
  systemPromptTokens: 0,
  compressionEnabled: false,
};

const makeSkill = (overrides: Partial<SkillRecord> = {}): SkillRecord => ({
  id: overrides.id ?? "skill-1",
  name: "test-skill",
  description: "test",
  agentId: "agent-1",
  source: "learned",
  instructions: "Do the thing",
  version: 1,
  versionHistory: [],
  config: defaultConfig,
  evolutionMode: overrides.evolutionMode ?? "auto",
  confidence: "tentative",
  successRate: 0.5,
  useCount: 3,
  refinementCount: 0,
  taskCategories: ["coding"],
  modelAffinities: [],
  base: null,
  avgPostActivationEntropyDelta: 0,
  avgConvergenceIteration: 0,
  convergenceSpeedTrend: [],
  conflictsWith: [],
  lastActivatedAt: null,
  lastRefinedAt: overrides.lastRefinedAt ?? null,
  createdAt: new Date("2026-03-01"),
  updatedAt: new Date(),
  contentVariants: { full: "Do the thing", summary: null, condensed: null },
  ...overrides,
});

const makeEpisode = (content: string, provider?: string) => ({
  content,
  provider,
  createdAt: new Date(),
});

describe("SkillDistillerService", () => {
  it("distill() triggers refinement when episodic count >= threshold", async () => {
    let refineCalled = false;
    const deps: SkillDistillerDeps = {
      listSkills: () => Effect.succeed([makeSkill()]),
      getRecentEpisodes: () =>
        Effect.succeed([
          makeEpisode("Run 1 succeeded"),
          makeEpisode("Run 2 succeeded"),
          makeEpisode("Run 3 partial"),
          makeEpisode("Run 4 succeeded"),
          makeEpisode("Run 5 succeeded"),
          makeEpisode("Run 6 succeeded"),
        ]),
      refineSkill: (skill, _episodes) => {
        refineCalled = true;
        return Effect.succeed(skill);
      },
    };
    const layer = makeSkillDistillerService(deps);
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const distiller = yield* SkillDistillerService;
          return yield* distiller.distill("agent-1");
        }),
        layer,
      ),
    );
    expect(result.refined).toBe(1);
    expect(refineCalled).toBe(true);
  });

  it("distill() skips when episodic count < threshold", async () => {
    const deps: SkillDistillerDeps = {
      listSkills: () => Effect.succeed([makeSkill()]),
      getRecentEpisodes: () => Effect.succeed([makeEpisode("Only one"), makeEpisode("Two")]),
      refineSkill: () => Effect.succeed(makeSkill()),
    };
    const layer = makeSkillDistillerService(deps);
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const d = yield* SkillDistillerService;
          return yield* d.distill("agent-1");
        }),
        layer,
      ),
    );
    expect(result.refined).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("distill() filters out test-provider episodic entries", async () => {
    const deps: SkillDistillerDeps = {
      listSkills: () => Effect.succeed([makeSkill()]),
      getRecentEpisodes: () =>
        Effect.succeed([
          makeEpisode("Real 1", "anthropic"),
          makeEpisode("Test 1", "test"),
          makeEpisode("Real 2", "anthropic"),
          makeEpisode("Test 2", "test-scenario-1"),
          makeEpisode("Real 3"), // no provider = assume real
          makeEpisode("Test 3", "test"),
        ]),
      refineSkill: () => Effect.succeed(makeSkill()),
    };
    const layer = makeSkillDistillerService(deps);
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const d = yield* SkillDistillerService;
          return yield* d.distill("agent-1");
        }),
        layer,
      ),
    );
    // Only 3 real episodes — below default threshold of 5
    expect(result.refined).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("distill() skips locked skills", async () => {
    let refineCalled = false;
    const deps: SkillDistillerDeps = {
      listSkills: () => Effect.succeed([makeSkill({ evolutionMode: "locked" })]),
      getRecentEpisodes: () => Effect.succeed(Array(10).fill(makeEpisode("ok"))),
      refineSkill: () => {
        refineCalled = true;
        return Effect.succeed(makeSkill());
      },
    };
    const layer = makeSkillDistillerService(deps);
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const d = yield* SkillDistillerService;
          return yield* d.distill("agent-1");
        }),
        layer,
      ),
    );
    expect(result.refined).toBe(0);
    expect(result.skipped).toBe(0); // locked skills aren't even counted as skipped
    expect(refineCalled).toBe(false);
  });

  it("distill() processes multiple skills independently", async () => {
    let refineCount = 0;
    const deps: SkillDistillerDeps = {
      listSkills: () =>
        Effect.succeed([
          makeSkill({ id: "s1", name: "skill-a" }),
          makeSkill({ id: "s2", name: "skill-b" }),
        ]),
      getRecentEpisodes: (_agentId, _since, _limit) => {
        // both skills get 7 entries (qualifies)
        return Effect.succeed(Array(7).fill(makeEpisode("ok")));
      },
      refineSkill: () => {
        refineCount++;
        return Effect.succeed(makeSkill());
      },
    };
    const layer = makeSkillDistillerService(deps);
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const d = yield* SkillDistillerService;
          return yield* d.distill("agent-1");
        }),
        layer,
      ),
    );
    expect(result.refined).toBe(2);
    expect(refineCount).toBe(2);
  });
});
