// File: tests/context/context-engine.test.ts
import { describe, test, expect } from "bun:test";
import {
  scoreContextItem,
  allocateContextBudget,
  buildContext,
  type ContextItem,
  type ScoringContext,
  type ContextBuildInput,
  type MemoryItem,
} from "../../src/context/context-engine.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";
import type { ToolSchema } from "../../src/strategies/shared/tool-utils.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    type: "observation",
    content: "some observation content",
    iteration: 3,
    pinned: false,
    ...overrides,
  };
}

function makeScoringCtx(overrides: Partial<ScoringContext> = {}): ScoringContext {
  return {
    currentIteration: 5,
    taskDescription: "search the web and write a file",
    maxIterations: 10,
    ...overrides,
  };
}

const sampleTools: readonly ToolSchema[] = [
  {
    name: "web-search",
    description: "Search the web",
    parameters: [{ name: "query", type: "string", required: true }],
  },
  {
    name: "file-write",
    description: "Write to a file",
    parameters: [
      { name: "path", type: "string", required: true },
      { name: "content", type: "string", required: true },
    ],
  },
];

// ── scoreContextItem ──────────────────────────────────────────────────────────

describe("scoreContextItem", () => {
  test("pinned items score 1.0", () => {
    const item = makeItem({ pinned: true, type: "rules" });
    const ctx = makeScoringCtx();
    expect(scoreContextItem(item, ctx)).toBe(1.0);
  });

  test("pinned task items score 1.0", () => {
    const item = makeItem({ pinned: true, type: "task" });
    const ctx = makeScoringCtx();
    expect(scoreContextItem(item, ctx)).toBe(1.0);
  });

  test("recent steps score higher than old steps", () => {
    const ctx = makeScoringCtx({ currentIteration: 8 });
    const recentItem = makeItem({ iteration: 7, type: "observation" });
    const oldItem = makeItem({ iteration: 2, type: "observation" });
    const recentScore = scoreContextItem(recentItem, ctx);
    const oldScore = scoreContextItem(oldItem, ctx);
    expect(recentScore).toBeGreaterThan(oldScore);
  });

  test("error observations get 1.5x boost", () => {
    const ctx = makeScoringCtx({ currentIteration: 5 });
    const errorItem = makeItem({
      iteration: 3,
      type: "observation",
      failed: true,
    });
    const successItem = makeItem({
      iteration: 3,
      type: "observation",
      failed: false,
    });
    const errorScore = scoreContextItem(errorItem, ctx);
    const successScore = scoreContextItem(successItem, ctx);
    expect(errorScore).toBeGreaterThan(successScore);
    // Error boost is 1.5x on the outcome component
    expect(errorScore / successScore).toBeGreaterThan(1.1);
  });

  test("task keyword overlap increases score", () => {
    const ctx = makeScoringCtx({ taskDescription: "search the web for results" });
    const relevantItem = makeItem({
      iteration: 3,
      type: "observation",
      content: "web search returned 5 results",
    });
    const irrelevantItem = makeItem({
      iteration: 3,
      type: "observation",
      content: "database connection established",
    });
    const relevantScore = scoreContextItem(relevantItem, ctx);
    const irrelevantScore = scoreContextItem(irrelevantItem, ctx);
    expect(relevantScore).toBeGreaterThan(irrelevantScore);
  });

  test("type weights: observations > actions > thoughts", () => {
    const ctx = makeScoringCtx({ currentIteration: 5 });
    const obsItem = makeItem({ iteration: 4, type: "observation" });
    const actItem = makeItem({ iteration: 4, type: "action" });
    const thoughtItem = makeItem({ iteration: 4, type: "thought" });
    const obsScore = scoreContextItem(obsItem, ctx);
    const actScore = scoreContextItem(actItem, ctx);
    const thoughtScore = scoreContextItem(thoughtItem, ctx);
    expect(obsScore).toBeGreaterThan(actScore);
    expect(actScore).toBeGreaterThan(thoughtScore);
  });
});

// ── allocateContextBudget ─────────────────────────────────────────────────────

describe("allocateContextBudget", () => {
  test("always includes pinned items", () => {
    const pinnedItem = makeItem({ pinned: true, type: "rules", content: "RULES block" });
    const regularItem = makeItem({ type: "observation", content: "obs" });
    const items = [pinnedItem, regularItem];
    const profile = CONTEXT_PROFILES.mid;
    const ctx = makeScoringCtx();

    const result = allocateContextBudget(items, profile, ctx);
    expect(result.pinned).toContain(pinnedItem);
  });

  test("recent items placed in recent section", () => {
    const ctx = makeScoringCtx({ currentIteration: 5 });
    const recentItem = makeItem({ iteration: 4, type: "observation" });
    const oldItem = makeItem({ iteration: 0, type: "observation" });
    const items = [oldItem, recentItem];
    const profile = CONTEXT_PROFILES.mid;

    const result = allocateContextBudget(items, profile, ctx);
    expect(result.recent).toContain(recentItem);
  });

  test("old items placed in scored section", () => {
    const ctx = makeScoringCtx({ currentIteration: 10 });
    // Create enough items that some must be "old"
    const items: ContextItem[] = [];
    for (let i = 0; i < 8; i++) {
      items.push(makeItem({ iteration: i, type: "observation", content: `obs ${i}` }));
    }
    const profile = CONTEXT_PROFILES.mid;
    const result = allocateContextBudget(items, profile, ctx);
    // The oldest items should be in scored, not recent
    expect(result.scored.length).toBeGreaterThan(0);
  });

  test("budget result sections sum to total items minus memories", () => {
    const ctx = makeScoringCtx({ currentIteration: 5 });
    const items: ContextItem[] = [
      makeItem({ pinned: true, type: "rules" }),
      makeItem({ iteration: 0, type: "thought" }),
      makeItem({ iteration: 1, type: "action" }),
      makeItem({ iteration: 2, type: "observation" }),
      makeItem({ iteration: 4, type: "observation" }),
    ];
    const profile = CONTEXT_PROFILES.mid;
    const result = allocateContextBudget(items, profile, ctx);
    const total = result.pinned.length + result.recent.length + result.scored.length;
    expect(total).toBe(items.length);
  });
});

// ── buildContext ───────────────────────────────────────────────────────────────

describe("buildContext", () => {
  function makeInput(overrides: Partial<ContextBuildInput> = {}): ContextBuildInput {
    return {
      task: "Search the web and write results to a file",
      steps: [],
      iteration: 0,
      maxIterations: 10,
      profile: CONTEXT_PROFILES.mid,
      availableToolSchemas: sampleTools,
      ...overrides,
    };
  }

  test("produces tool reference section", () => {
    const input = makeInput();
    const ctx = buildContext(input);
    expect(ctx).toContain("web-search");
    expect(ctx).toContain("file-write");
  });

  test("produces RULES block", () => {
    const input = makeInput();
    const ctx = buildContext(input);
    expect(ctx).toContain("RULES:");
  });

  test("produces iteration awareness", () => {
    const input = makeInput({ iteration: 3 });
    const ctx = buildContext(input);
    expect(ctx).toContain("Iteration");
    expect(ctx).toContain("4/10"); // 1-indexed display
  });

  test("produces task description", () => {
    const input = makeInput({ task: "Find all commits from last week" });
    const ctx = buildContext(input);
    expect(ctx).toContain("Find all commits from last week");
  });

  test("context compacts as steps accumulate (not linear growth)", () => {
    const fewSteps = Array.from({ length: 3 }, (_, i) => ({
      id: `s${i}` as any,
      type: "observation" as const,
      content: `Observation result number ${i} with some detail about what happened in the tool execution step`,
      timestamp: new Date(),
    }));
    const manySteps = Array.from({ length: 12 }, (_, i) => ({
      id: `s${i}` as any,
      type: "observation" as const,
      content: `Observation result number ${i} with some detail about what happened in the tool execution step`,
      timestamp: new Date(),
    }));

    const ctxFew = buildContext(makeInput({ steps: fewSteps, iteration: 3 }));
    const ctxMany = buildContext(makeInput({ steps: manySteps, iteration: 12 }));

    // With 4x the steps, context should NOT be 4x larger (compaction kicks in)
    const ratio = ctxMany.length / ctxFew.length;
    expect(ratio).toBeLessThan(3.5);
  });

  test("includes required tool markers when requiredTools provided", () => {
    const input = makeInput({ requiredTools: ["file-write"] });
    const ctx = buildContext(input);
    expect(ctx).toContain("REQUIRED");
  });

  test("includes delegation rule when spawn-agent available", () => {
    const tools: readonly ToolSchema[] = [
      ...sampleTools,
      { name: "spawn-agent", description: "Spawn a sub-agent", parameters: [] },
    ];
    const input = makeInput({ availableToolSchemas: tools });
    const ctx = buildContext(input);
    expect(ctx).toContain("DELEGATION");
  });

  test("includes completed summary when steps have successful actions", () => {
    const steps = [
      {
        id: "s1" as any,
        type: "action" as const,
        content: JSON.stringify({ tool: "web-search", input: '{"query":"test"}' }),
        timestamp: new Date(),
        metadata: { toolUsed: "web-search" },
      },
      {
        id: "s2" as any,
        type: "observation" as const,
        content: "Search results found",
        timestamp: new Date(),
        metadata: { observationResult: { success: true, toolName: "web-search", displayText: "ok", category: "web-search" as const, resultKind: "data" as const, preserveOnCompaction: false } },
      },
    ];
    const input = makeInput({ steps, iteration: 1 });
    const ctx = buildContext(input);
    expect(ctx).toContain("ALREADY DONE");
  });

  test("irrelevant memories excluded (relevance < 0.3)", () => {
    const memories: MemoryItem[] = [
      { content: "Relevant memory about web search", relevance: 0.8 },
      { content: "Irrelevant memory about cooking", relevance: 0.1 },
    ];
    const input = makeInput({ memories });
    const ctx = buildContext(input);
    expect(ctx).toContain("Relevant memory about web search");
    expect(ctx).not.toContain("Irrelevant memory about cooking");
  });

  test("relevant memories included when relevance >= 0.3", () => {
    const memories: MemoryItem[] = [
      { content: "Memory about prior search results", relevance: 0.5 },
    ];
    const input = makeInput({ memories });
    const ctx = buildContext(input);
    expect(ctx).toContain("Memory about prior search results");
  });

  test("progressive urgency at high iterations", () => {
    const input = makeInput({ iteration: 8, maxIterations: 10 });
    const ctx = buildContext(input);
    expect(ctx).toContain("LAST CHANCE");
  });

  test("no tools produces 'No tools available' message", () => {
    const input = makeInput({ availableToolSchemas: undefined });
    const ctx = buildContext(input);
    expect(ctx).toContain("No tools available");
  });
});
