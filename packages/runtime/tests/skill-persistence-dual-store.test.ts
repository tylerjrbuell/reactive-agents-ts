// Run: bun test packages/runtime/tests/skill-persistence-dual-store.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { Effect, Context, Layer } from "effect";
import { ProceduralMemoryService } from "@reactive-agents/memory";
import { SkillStoreService } from "@reactive-agents/memory";
import { skillFragmentToSkillRecord } from "@reactive-agents/reactive-intelligence";

const testFragment = {
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
  convergenceIteration: 2,
  finalComposite: 0.3,
  meanComposite: 0.25,
};

// Simulates what local-learning.ts does when skillSynthesized is true
function storeSkillToSkillStoreService(params: {
  fragment: typeof testFragment;
  agentId: string;
  taskCategory: string;
  modelId: string;
}) {
  return Effect.gen(function* () {
    const record = skillFragmentToSkillRecord(params);
    const svcOpt = yield* Effect.serviceOption(SkillStoreService);
    if (svcOpt._tag === "Some") {
      yield* svcOpt.value.store(record).pipe(
        Effect.catchAll(() => Effect.void),
      );
      return "stored";
    }
    return "skipped";
  });
}

describe("skill persistence dual-store", () => {
  it("stores SkillRecord to SkillStoreService when service is available", async () => {
    const storedRecords: unknown[] = [];

    const MockSkillStoreLayer = Layer.succeed(SkillStoreService, {
      store: (record: any) => {
        storedRecords.push(record);
        return Effect.succeed(record.id as string);
      },
      get: (_id: any) => Effect.succeed(null),
      getByName: (_agentId: any, _name: any) => Effect.succeed(null),
      findByTask: (_agentId: any, _cats: any, _modelId?: any) => Effect.succeed([]),
      update: (_id: any, _partial: any) => Effect.void,
      promote: (_id: any, _confidence: any) => Effect.void,
      rollback: (_id: any) => Effect.void,
      listAll: (_agentId: any) => Effect.succeed([]),
      delete: (_id: any) => Effect.void,
      addVersion: (_skillId: any, _version: any) => Effect.void,
    });

    const result = await Effect.runPromise(
      storeSkillToSkillStoreService({
        fragment: testFragment,
        agentId: "agent-test",
        taskCategory: "analysis",
        modelId: "claude-sonnet-4",
      }).pipe(Effect.provide(MockSkillStoreLayer)),
    );

    expect(result).toBe("stored");
    expect(storedRecords).toHaveLength(1);
    const stored = storedRecords[0] as any;
    expect(stored.name).toBe("analysis:claude-sonnet-4");
    expect(stored.source).toBe("learned");
    expect(stored.confidence).toBe("tentative");
    expect(stored.agentId).toBe("agent-test");
  }, 15000);

  it("skips SkillStoreService write when service is absent (graceful degrade)", async () => {
    const result = await Effect.runPromise(
      storeSkillToSkillStoreService({
        fragment: testFragment,
        agentId: "agent-test",
        taskCategory: "analysis",
        modelId: "claude-sonnet-4",
      }),
      // No layer — SkillStoreService absent
    );

    expect(result).toBe("skipped");
  }, 15000);

  it("SkillStoreService write failure does not propagate (catchAll)", async () => {
    const MockFailingSkillStoreLayer = Layer.succeed(SkillStoreService, {
      store: (_record: any) => Effect.fail(new Error("DB write failed") as any),
      get: (_id: any) => Effect.succeed(null),
      getByName: (_agentId: any, _name: any) => Effect.succeed(null),
      findByTask: (_agentId: any, _cats: any, _modelId?: any) => Effect.succeed([]),
      update: (_id: any, _partial: any) => Effect.void,
      promote: (_id: any, _confidence: any) => Effect.void,
      rollback: (_id: any) => Effect.void,
      listAll: (_agentId: any) => Effect.succeed([]),
      delete: (_id: any) => Effect.void,
      addVersion: (_skillId: any, _version: any) => Effect.void,
    });

    // Should not throw — failure is swallowed
    const result = await Effect.runPromise(
      storeSkillToSkillStoreService({
        fragment: testFragment,
        agentId: "agent-test",
        taskCategory: "analysis",
        modelId: "claude-sonnet-4",
      }).pipe(Effect.provide(MockFailingSkillStoreLayer)),
    );

    // Returns "stored" because store was called (even though it failed internally + caught)
    expect(result).toBe("stored");
  }, 15000);
});
