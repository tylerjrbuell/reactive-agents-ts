import { describe, test, expect } from "bun:test";
import { skillFragmentToProceduralEntry } from "../../src/learning/skill-synthesis.js";

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
