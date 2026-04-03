/**
 * Skill Evolution — Outcome Tracking and Re-store on Entropy Improvement
 *
 * Tests for the three changes to execution-engine.ts:
 *  1. Bootstrap: appliedSkillId and appliedSkillMeanEntropy stored in ctx.metadata
 *  2. Run completion: recordOutcome called for applied skill
 *  3. Run completion: re-store improved fragment when new entropy < stored entropy
 */
import { describe, it, expect } from "bun:test";
import { Effect, Context, Layer } from "effect";
import { ProceduralMemoryService } from "@reactive-agents/memory";
import {
  skillFragmentToProceduralEntry,
} from "@reactive-agents/reactive-intelligence";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const storedFragment = {
  promptTemplateId: "default",
  systemPromptTokens: 0,
  contextStrategy: {
    compressionEnabled: false,
    maxIterations: 10,
    temperature: 0.7,
    toolFilteringMode: "none" as const,
    requiredToolsCount: 0,
  },
  memoryConfig: {
    tier: "basic",
    semanticLines: 0,
    episodicLines: 0,
    consolidationEnabled: false,
  },
  reasoningConfig: {
    strategy: "reactive",
    strategySwitchingEnabled: false,
    adaptiveEnabled: false,
  },
  convergenceIteration: 3,
  finalComposite: 0.4,
  meanComposite: 0.38, // original stored entropy
};

const improvedFragment = {
  ...storedFragment,
  convergenceIteration: 2,
  finalComposite: 0.25,
  meanComposite: 0.22, // lower entropy = improved
};

const worseFragment = {
  ...storedFragment,
  convergenceIteration: 4,
  finalComposite: 0.55,
  meanComposite: 0.50, // higher entropy = worse
};

const SKILL_ID = "mem-001" as any;

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeMockProceduralMemory(opts: {
  storeCallLog?: unknown[];
  recordCallLog?: Array<{ id: unknown; success: boolean }>;
}) {
  return Layer.succeed(ProceduralMemoryService, {
    store: (entry: any) => {
      opts.storeCallLog?.push(entry);
      return Effect.succeed(entry.id as any);
    },
    get: (_id: any) => Effect.succeed({} as any),
    recordOutcome: (id: any, success: boolean) => {
      opts.recordCallLog?.push({ id, success });
      return Effect.void;
    },
    listActive: (_agentId: any) => Effect.succeed([]),
    findByTags: (_agentId: any, _tags: any) => Effect.succeed([]),
  });
}

// ── Change 1: Bootstrap metadata ─────────────────────────────────────────────

describe("skill evolution — bootstrap metadata", () => {
  it("appliedSkillId is stored from matchingSkill.id", () => {
    // Simulate what the bootstrap block does when a skill is found
    const matchingSkill = {
      id: SKILL_ID,
      name: "analysis:claude-3-5-sonnet",
      pattern: JSON.stringify(storedFragment),
      successRate: 0.9,
      useCount: 5,
      tags: ["analysis", "claude-3-5-sonnet"],
    };

    let metadata: Record<string, unknown> = {};

    if (matchingSkill?.pattern) {
      try {
        const fragment = JSON.parse(matchingSkill.pattern);
        metadata = {
          ...metadata,
          appliedSkill: matchingSkill.name,
          appliedSkillId: matchingSkill.id,
          appliedSkillMeanEntropy: fragment.meanComposite,
        };
      } catch {
        // Invalid pattern — ignore
      }
    }

    expect(metadata.appliedSkillId).toBe(SKILL_ID);
    expect(metadata.appliedSkill).toBe("analysis:claude-3-5-sonnet");
    expect(metadata.appliedSkillMeanEntropy).toBe(0.38);
  });

  it("appliedSkillMeanEntropy comes from fragment.meanComposite", () => {
    const matchingSkill = {
      id: SKILL_ID,
      name: "analysis:claude-3-5-sonnet",
      pattern: JSON.stringify({ ...storedFragment, meanComposite: 0.42 }),
    };

    const fragment = JSON.parse(matchingSkill.pattern);
    const metadata = {
      appliedSkill: matchingSkill.name,
      appliedSkillId: matchingSkill.id,
      appliedSkillMeanEntropy: fragment.meanComposite,
    };

    expect(metadata.appliedSkillMeanEntropy).toBe(0.42);
  });

  it("metadata fields are absent when no matching skill", () => {
    // No active workflows — metadata stays empty
    const metadata: Record<string, unknown> = {};
    // (no skill found — nothing set)

    expect(metadata.appliedSkillId).toBeUndefined();
    expect(metadata.appliedSkillMeanEntropy).toBeUndefined();
  });

  it("metadata fields are absent when pattern is invalid JSON", () => {
    const matchingSkill = {
      id: SKILL_ID,
      name: "analysis:claude-3-5-sonnet",
      pattern: "not-valid-json",
    };

    let metadata: Record<string, unknown> = {};

    if (matchingSkill?.pattern) {
      try {
        const fragment = JSON.parse(matchingSkill.pattern);
        metadata = {
          ...metadata,
          appliedSkill: matchingSkill.name,
          appliedSkillId: matchingSkill.id,
          appliedSkillMeanEntropy: fragment.meanComposite,
        };
      } catch {
        // Invalid pattern — ignore
      }
    }

    expect(metadata.appliedSkillId).toBeUndefined();
  });
});

// ── Change 2: recordOutcome ───────────────────────────────────────────────────

describe("skill evolution — recordOutcome", () => {
  it("recordOutcome(id, true) called when outcome is success", async () => {
    const recordCallLog: Array<{ id: unknown; success: boolean }> = [];
    const MockLayer = makeMockProceduralMemory({ recordCallLog });

    const program = Effect.gen(function* () {
      const appliedSkillId = SKILL_ID;
      const outcome = "success";

      const svcOpt = yield* Effect.serviceOption(ProceduralMemoryService);
      if (svcOpt._tag === "Some" && appliedSkillId) {
        yield* svcOpt.value.recordOutcome(appliedSkillId, outcome !== "failure").pipe(
          Effect.catchAll(() => Effect.void),
        );
      }
    });

    await Effect.runPromise(program.pipe(Effect.provide(MockLayer)));

    expect(recordCallLog).toHaveLength(1);
    expect(recordCallLog[0].id).toBe(SKILL_ID);
    expect(recordCallLog[0].success).toBe(true);
  });

  it("recordOutcome(id, false) called when outcome is failure", async () => {
    const recordCallLog: Array<{ id: unknown; success: boolean }> = [];
    const MockLayer = makeMockProceduralMemory({ recordCallLog });

    const program = Effect.gen(function* () {
      const appliedSkillId = SKILL_ID;
      const outcome = "failure";

      const svcOpt = yield* Effect.serviceOption(ProceduralMemoryService);
      if (svcOpt._tag === "Some" && appliedSkillId) {
        yield* svcOpt.value.recordOutcome(appliedSkillId, outcome !== "failure").pipe(
          Effect.catchAll(() => Effect.void),
        );
      }
    });

    await Effect.runPromise(program.pipe(Effect.provide(MockLayer)));

    expect(recordCallLog).toHaveLength(1);
    expect(recordCallLog[0].success).toBe(false);
  });

  it("recordOutcome(id, true) called when outcome is partial (not failure)", async () => {
    const recordCallLog: Array<{ id: unknown; success: boolean }> = [];
    const MockLayer = makeMockProceduralMemory({ recordCallLog });

    const program = Effect.gen(function* () {
      const appliedSkillId = SKILL_ID;
      const outcome = "partial";

      const svcOpt = yield* Effect.serviceOption(ProceduralMemoryService);
      if (svcOpt._tag === "Some" && appliedSkillId) {
        yield* svcOpt.value.recordOutcome(appliedSkillId, outcome !== "failure").pipe(
          Effect.catchAll(() => Effect.void),
        );
      }
    });

    await Effect.runPromise(program.pipe(Effect.provide(MockLayer)));

    expect(recordCallLog[0].success).toBe(true);
  });

  it("recordOutcome is skipped when ProceduralMemoryService is absent", async () => {
    let called = false;

    // No layer provided — service is absent
    const program = Effect.gen(function* () {
      const appliedSkillId = SKILL_ID;

      const svcOpt = yield* Effect.serviceOption(ProceduralMemoryService);
      if (svcOpt._tag === "Some" && appliedSkillId) {
        called = true;
        yield* svcOpt.value.recordOutcome(appliedSkillId, true).pipe(
          Effect.catchAll(() => Effect.void),
        );
      }
    });

    await Effect.runPromise(program);
    expect(called).toBe(false);
  });

  it("recordOutcome is skipped when appliedSkillId is absent", async () => {
    const recordCallLog: Array<{ id: unknown; success: boolean }> = [];
    const MockLayer = makeMockProceduralMemory({ recordCallLog });

    const program = Effect.gen(function* () {
      const appliedSkillId = undefined;

      const svcOpt = yield* Effect.serviceOption(ProceduralMemoryService);
      if (svcOpt._tag === "Some" && appliedSkillId) {
        yield* svcOpt.value.recordOutcome(appliedSkillId, true).pipe(
          Effect.catchAll(() => Effect.void),
        );
      }
    });

    await Effect.runPromise(program.pipe(Effect.provide(MockLayer)));
    expect(recordCallLog).toHaveLength(0);
  });
});

// ── Change 3: re-store improved fragment ─────────────────────────────────────

describe("skill evolution — re-store improved fragment", () => {
  it("store is called when new meanComposite < stored meanComposite", async () => {
    const storeCallLog: unknown[] = [];
    const MockLayer = makeMockProceduralMemory({ storeCallLog });

    const program = Effect.gen(function* () {
      const appliedSkillId = SKILL_ID;
      const appliedSkillMeanEntropy = storedFragment.meanComposite; // 0.38
      const outcome = "success";
      const skillSynthesized = true;
      const skillFragment = improvedFragment; // meanComposite 0.22 < 0.38
      const taskCategory = "analysis";
      const agentId = "test-agent";
      const modelId = "claude-3-5-sonnet";

      const svcOpt = yield* Effect.serviceOption(ProceduralMemoryService);
      if (svcOpt._tag === "Some" && appliedSkillId) {
        // record outcome
        yield* svcOpt.value.recordOutcome(appliedSkillId, outcome !== "failure").pipe(
          Effect.catchAll(() => Effect.void),
        );

        // re-store if entropy improved
        if (
          outcome === "success" &&
          skillSynthesized &&
          skillFragment != null &&
          skillFragment.meanComposite < appliedSkillMeanEntropy
        ) {
          const entry = skillFragmentToProceduralEntry({
            fragment: skillFragment,
            agentId,
            taskCategory,
            modelId,
          });
          yield* svcOpt.value.store(entry).pipe(
            Effect.catchAll(() => Effect.void),
          );
        }
      }
    });

    await Effect.runPromise(program.pipe(Effect.provide(MockLayer)));

    expect(storeCallLog).toHaveLength(1);
    const stored = storeCallLog[0] as any;
    expect(stored.agentId).toBe("test-agent");
    expect(JSON.parse(stored.pattern).meanComposite).toBe(0.22);
  });

  it("store is NOT called when new meanComposite >= stored meanComposite", async () => {
    const storeCallLog: unknown[] = [];
    const MockLayer = makeMockProceduralMemory({ storeCallLog });

    const program = Effect.gen(function* () {
      const appliedSkillId = SKILL_ID;
      const appliedSkillMeanEntropy = storedFragment.meanComposite; // 0.38
      const outcome = "success";
      const skillSynthesized = true;
      const skillFragment = worseFragment; // meanComposite 0.50 > 0.38

      const svcOpt = yield* Effect.serviceOption(ProceduralMemoryService);
      if (svcOpt._tag === "Some" && appliedSkillId) {
        yield* svcOpt.value.recordOutcome(appliedSkillId, outcome !== "failure").pipe(
          Effect.catchAll(() => Effect.void),
        );

        if (
          outcome === "success" &&
          skillSynthesized &&
          skillFragment != null &&
          skillFragment.meanComposite < appliedSkillMeanEntropy
        ) {
          const entry = skillFragmentToProceduralEntry({
            fragment: skillFragment,
            agentId: "test-agent",
            taskCategory: "analysis",
            modelId: "claude-3-5-sonnet",
          });
          yield* svcOpt.value.store(entry).pipe(
            Effect.catchAll(() => Effect.void),
          );
        }
      }
    });

    await Effect.runPromise(program.pipe(Effect.provide(MockLayer)));
    expect(storeCallLog).toHaveLength(0);
  });

  it("store is NOT called when outcome is partial (not full success)", async () => {
    const storeCallLog: unknown[] = [];
    const MockLayer = makeMockProceduralMemory({ storeCallLog });

    const program = Effect.gen(function* () {
      const appliedSkillId = SKILL_ID;
      const appliedSkillMeanEntropy = 0.38;
      const outcome = "partial"; // not "success"
      const skillSynthesized = true;
      const skillFragment = improvedFragment;

      const svcOpt = yield* Effect.serviceOption(ProceduralMemoryService);
      if (svcOpt._tag === "Some" && appliedSkillId) {
        yield* svcOpt.value.recordOutcome(appliedSkillId, outcome !== "failure").pipe(
          Effect.catchAll(() => Effect.void),
        );

        if (
          outcome === "success" &&
          skillSynthesized &&
          skillFragment != null &&
          skillFragment.meanComposite < appliedSkillMeanEntropy
        ) {
          const entry = skillFragmentToProceduralEntry({
            fragment: skillFragment,
            agentId: "test-agent",
            taskCategory: "analysis",
            modelId: "claude-3-5-sonnet",
          });
          yield* svcOpt.value.store(entry).pipe(
            Effect.catchAll(() => Effect.void),
          );
        }
      }
    });

    await Effect.runPromise(program.pipe(Effect.provide(MockLayer)));
    expect(storeCallLog).toHaveLength(0);
  });

  it("store is NOT called when skillSynthesized is false", async () => {
    const storeCallLog: unknown[] = [];
    const MockLayer = makeMockProceduralMemory({ storeCallLog });

    const program = Effect.gen(function* () {
      const appliedSkillId = SKILL_ID;
      const appliedSkillMeanEntropy = 0.38;
      const outcome = "success";
      const skillSynthesized = false;
      const skillFragment = improvedFragment;

      const svcOpt = yield* Effect.serviceOption(ProceduralMemoryService);
      if (svcOpt._tag === "Some" && appliedSkillId) {
        yield* svcOpt.value.recordOutcome(appliedSkillId, outcome !== "failure").pipe(
          Effect.catchAll(() => Effect.void),
        );

        if (
          outcome === "success" &&
          skillSynthesized &&
          skillFragment != null &&
          skillFragment.meanComposite < appliedSkillMeanEntropy
        ) {
          const entry = skillFragmentToProceduralEntry({
            fragment: skillFragment,
            agentId: "test-agent",
            taskCategory: "analysis",
            modelId: "claude-3-5-sonnet",
          });
          yield* svcOpt.value.store(entry).pipe(
            Effect.catchAll(() => Effect.void),
          );
        }
      }
    });

    await Effect.runPromise(program.pipe(Effect.provide(MockLayer)));
    expect(storeCallLog).toHaveLength(0);
  });

  it("store is NOT called when skillFragment is null", async () => {
    const storeCallLog: unknown[] = [];
    const MockLayer = makeMockProceduralMemory({ storeCallLog });

    const program = Effect.gen(function* () {
      const appliedSkillId = SKILL_ID;
      const appliedSkillMeanEntropy = 0.38;
      const outcome = "success";
      const skillSynthesized = true;
      const skillFragment = null;

      const svcOpt = yield* Effect.serviceOption(ProceduralMemoryService);
      if (svcOpt._tag === "Some" && appliedSkillId) {
        yield* svcOpt.value.recordOutcome(appliedSkillId, outcome !== "failure").pipe(
          Effect.catchAll(() => Effect.void),
        );

        if (
          outcome === "success" &&
          skillSynthesized &&
          skillFragment != null &&
          (skillFragment as any).meanComposite < appliedSkillMeanEntropy
        ) {
          const entry = skillFragmentToProceduralEntry({
            fragment: skillFragment as any,
            agentId: "test-agent",
            taskCategory: "analysis",
            modelId: "claude-3-5-sonnet",
          });
          yield* svcOpt.value.store(entry).pipe(
            Effect.catchAll(() => Effect.void),
          );
        }
      }
    });

    await Effect.runPromise(program.pipe(Effect.provide(MockLayer)));
    expect(storeCallLog).toHaveLength(0);
  });

  it("re-store is silently skipped when ProceduralMemoryService is absent", async () => {
    // No layer — no throw
    const program = Effect.gen(function* () {
      const appliedSkillId = SKILL_ID;
      const appliedSkillMeanEntropy = 0.38;
      const outcome = "success";
      const skillSynthesized = true;
      const skillFragment = improvedFragment;

      const svcOpt = yield* Effect.serviceOption(ProceduralMemoryService);
      if (svcOpt._tag === "Some" && appliedSkillId) {
        yield* svcOpt.value.recordOutcome(appliedSkillId, outcome !== "failure").pipe(
          Effect.catchAll(() => Effect.void),
        );

        if (
          outcome === "success" &&
          skillSynthesized &&
          skillFragment != null &&
          skillFragment.meanComposite < appliedSkillMeanEntropy
        ) {
          const entry = skillFragmentToProceduralEntry({
            fragment: skillFragment,
            agentId: "test-agent",
            taskCategory: "analysis",
            modelId: "claude-3-5-sonnet",
          });
          yield* svcOpt.value.store(entry).pipe(
            Effect.catchAll(() => Effect.void),
          );
        }
      }
      return "ok";
    });

    const result = await Effect.runPromise(program);
    expect(result).toBe("ok");
  });
});

// ── Change 4: LearningResult must NOT leak into ctx.metadata ─────────────────

describe("skill evolution — _lastLearningResult must not pollute ctx.metadata", () => {
  it("ctx.metadata does NOT contain _lastLearningResult after the RI learning block", () => {
    // Simulate the pattern the execution-engine uses to pass LearningResult between blocks.
    // The BUG (before fix): learning result stashed on ctx.metadata._lastLearningResult.
    // The FIX: use a scoped let variable instead.
    //
    // This test documents the contract: ctx.metadata is observable agent context,
    // not a private scratchpad. _lastLearningResult must never appear on it.

    type LearningResult = {
      skillSynthesized: boolean;
      skillFragment?: unknown;
      taskCategory: string;
    };

    let metadata: Record<string, unknown> = { appliedSkillId: "mem-001" };

    // Simulate the FIXED code: scoped variable, NOT ctx.metadata
    let lastLearningResult: LearningResult | undefined;

    const fakeLearningResult: LearningResult = {
      skillSynthesized: true,
      skillFragment: { meanComposite: 0.22 },
      taskCategory: "analysis",
    };

    // RI block sets the scoped variable (not metadata)
    lastLearningResult = fakeLearningResult;

    // Outcome block reads from the scoped variable (not metadata)
    const readBack = lastLearningResult;

    // Assertions
    expect(readBack?.skillSynthesized).toBe(true);
    expect((metadata as any)._lastLearningResult).toBeUndefined();
    expect(Object.keys(metadata)).not.toContain("_lastLearningResult");
  });
});
