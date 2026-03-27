import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { skillFragmentToProceduralEntry } from "../../src/learning/skill-synthesis.js";
import { CalibrationStore } from "../../src/calibration/calibration-store.js";
import { computeCalibration } from "../../src/calibration/conformal.js";
import { BanditStore } from "../../src/learning/bandit-store.js";
import {
  LearningEngineService,
  LearningEngineServiceLive,
  type SkillStore,
} from "../../src/learning/learning-engine.js";

// --- skillFragmentToProceduralEntry tests (from Task 1) ---

describe("skillFragmentToProceduralEntry", () => {
  test("converts fragment to procedural entry with correct fields", () => {
    const fragment = {
      promptTemplateId: "default",
      systemPromptTokens: 0,
      contextStrategy: {
        compressionEnabled: false,
        maxIterations: 10,
        temperature: 0.7,
        toolFilteringMode: "adaptive" as const,
        requiredToolsCount: 2,
      },
      memoryConfig: {
        tier: "enhanced",
        semanticLines: 5,
        episodicLines: 10,
        consolidationEnabled: true,
      },
      reasoningConfig: {
        strategy: "reactive",
        strategySwitchingEnabled: true,
        adaptiveEnabled: true,
      },
      convergenceIteration: 3,
      finalComposite: 0.2,
      meanComposite: 0.35,
    };

    const entry = skillFragmentToProceduralEntry({
      fragment,
      agentId: "test-agent",
      taskCategory: "code-generation",
      modelId: "cogito:14b",
    });

    expect(entry.id).toBeDefined();
    expect(entry.agentId).toBe("test-agent");
    expect(entry.name).toBe("code-generation:cogito:14b");
    expect(entry.tags).toContain("code-generation");
    expect(entry.tags).toContain("cogito:14b");
    expect(entry.successRate).toBe(1.0);
    expect(entry.useCount).toBe(1);
    expect(entry.createdAt).toBeInstanceOf(Date);
    expect(entry.updatedAt).toBeInstanceOf(Date);
    expect(JSON.parse(entry.pattern)).toEqual(fragment);
  });

  test("includes reasoning strategy in tags", () => {
    const fragment = {
      promptTemplateId: "default",
      systemPromptTokens: 0,
      contextStrategy: {
        compressionEnabled: false,
        maxIterations: 5,
        temperature: 0.5,
        toolFilteringMode: "static" as const,
        requiredToolsCount: 0,
      },
      memoryConfig: {
        tier: "basic",
        semanticLines: 3,
        episodicLines: 5,
        consolidationEnabled: false,
      },
      reasoningConfig: {
        strategy: "plan-execute-reflect",
        strategySwitchingEnabled: false,
        adaptiveEnabled: false,
      },
      convergenceIteration: null,
      finalComposite: 0.4,
      meanComposite: 0.45,
    };

    const entry = skillFragmentToProceduralEntry({
      fragment,
      agentId: "agent-2",
      taskCategory: "research",
      modelId: "claude-sonnet-4",
    });

    expect(entry.tags).toContain("plan-execute-reflect");
    expect(entry.tags).toHaveLength(3);
  });

  test("description includes convergence iteration and mean entropy", () => {
    const fragment = {
      promptTemplateId: "default",
      systemPromptTokens: 0,
      contextStrategy: {
        compressionEnabled: true,
        maxIterations: 8,
        temperature: 0.6,
        toolFilteringMode: "adaptive" as const,
        requiredToolsCount: 1,
      },
      memoryConfig: {
        tier: "standard",
        semanticLines: 4,
        episodicLines: 8,
        consolidationEnabled: true,
      },
      reasoningConfig: {
        strategy: "reactive",
        strategySwitchingEnabled: false,
        adaptiveEnabled: true,
      },
      convergenceIteration: 5,
      finalComposite: 0.18,
      meanComposite: 0.3,
    };

    const entry = skillFragmentToProceduralEntry({
      fragment,
      agentId: "agent-3",
      taskCategory: "summarization",
      modelId: "gpt-4o-mini",
    });

    expect(entry.description).toContain("summarization");
    expect(entry.description).toContain("gpt-4o-mini");
    expect(entry.description).toContain("0.30"); // meanComposite formatted to 2dp
    expect(entry.description).toContain("5");    // convergenceIteration
  });

  test("uses '?' for null convergenceIteration in description", () => {
    const fragment = {
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
        semanticLines: 2,
        episodicLines: 4,
        consolidationEnabled: false,
      },
      reasoningConfig: {
        strategy: "reactive",
        strategySwitchingEnabled: false,
        adaptiveEnabled: false,
      },
      convergenceIteration: null,
      finalComposite: 0.5,
      meanComposite: 0.55,
    };

    const entry = skillFragmentToProceduralEntry({
      fragment,
      agentId: "agent-4",
      taskCategory: "analysis",
      modelId: "llama3",
    });

    expect(entry.description).toContain("iter ?");
  });
});

// --- Learning engine skill extraction + persistence tests ---

const convergingData = {
  modelId: "claude-3.5",
  taskDescription: "write a function to sort an array",
  strategy: "react",
  outcome: "success" as const,
  entropyHistory: [
    { composite: 0.6, trajectory: { shape: "flat" } },
    { composite: 0.4, trajectory: { shape: "converging" } },
    { composite: 0.3, trajectory: { shape: "converging" } },
  ],
  totalTokens: 1500,
  durationMs: 5000,
  temperature: 0.7,
  maxIterations: 10,
};

function makeCalibratedStore(): CalibrationStore {
  const store = new CalibrationStore(":memory:");
  // Pre-seed with 25 samples so calibration is active (requires 20+)
  const scores = Array.from({ length: 25 }, (_, i) => 0.3 + (i % 5) * 0.05);
  const cal = computeCalibration("claude-3.5", scores);
  store.save(cal);
  return store;
}

function runWithService(
  calibrationStore: CalibrationStore,
  banditStore: BanditStore,
  data: any,
  skillStore?: SkillStore,
) {
  const program = Effect.gen(function* () {
    const svc = yield* LearningEngineService;
    return yield* svc.onRunCompleted(data);
  });
  const layer = LearningEngineServiceLive(calibrationStore, banditStore, skillStore);
  return Effect.runPromise(Effect.provide(program, layer));
}

describe("LearningEngine skill extraction + persistence", () => {
  test("extracts and stores skill when synthesis qualifies", async () => {
    const calibrationStore = makeCalibratedStore();
    const banditStore = new BanditStore(":memory:");
    const stored: unknown[] = [];
    const skillStore: SkillStore = {
      store: (entry) =>
        Effect.sync(() => {
          stored.push(entry);
        }),
    };

    const result = await runWithService(
      calibrationStore,
      banditStore,
      convergingData,
      skillStore,
    );

    expect(result.skillSynthesized).toBe(true);
    expect(result.skillFragment).toBeDefined();
    expect(result.skillFragment!.reasoningConfig.strategy).toBe("react");
    expect(result.skillFragment!.contextStrategy.temperature).toBe(0.7);
    expect(result.skillFragment!.contextStrategy.maxIterations).toBe(10);

    // Verify store was called
    expect(stored).toHaveLength(1);
    const entry = stored[0] as any;
    expect(entry.name).toBe("code-write:claude-3.5");
    expect(entry.tags).toContain("code-write");
    expect(entry.tags).toContain("claude-3.5");
  });

  test("does not extract or store skill on failure outcome", async () => {
    const calibrationStore = makeCalibratedStore();
    const banditStore = new BanditStore(":memory:");
    const stored: unknown[] = [];
    const skillStore: SkillStore = {
      store: (entry) =>
        Effect.sync(() => {
          stored.push(entry);
        }),
    };

    const result = await runWithService(
      calibrationStore,
      banditStore,
      { ...convergingData, outcome: "failure" as const },
      skillStore,
    );

    expect(result.skillSynthesized).toBe(false);
    expect(result.skillFragment).toBeUndefined();
    expect(stored).toHaveLength(0);
  });

  test("extracts skill but does not error when no skillStore provided", async () => {
    const calibrationStore = makeCalibratedStore();
    const banditStore = new BanditStore(":memory:");

    // No skillStore — should not throw
    const result = await runWithService(
      calibrationStore,
      banditStore,
      convergingData,
    );

    expect(result.skillSynthesized).toBe(true);
    expect(result.skillFragment).toBeDefined();
    expect(result.skillFragment!.reasoningConfig.strategy).toBe("react");
  });

  test("skill store failure does not break learning pipeline", async () => {
    const calibrationStore = makeCalibratedStore();
    const banditStore = new BanditStore(":memory:");
    const skillStore: SkillStore = {
      store: () => Effect.fail(new Error("DB write failed")),
    };

    // Should succeed despite store failure
    const result = await runWithService(
      calibrationStore,
      banditStore,
      convergingData,
      skillStore,
    );

    expect(result.skillSynthesized).toBe(true);
    expect(result.skillFragment).toBeDefined();
    // calibration and bandit still updated
    expect(result.calibrationUpdated).toBe(true);
    expect(result.banditUpdated).toBe(true);
  });
});
