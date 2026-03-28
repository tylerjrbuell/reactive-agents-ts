// File: tests/context/context-engine.test.ts
import { describe, test, expect } from "bun:test";
import {
  scoreContextItem,
  allocateContextBudget,
  type ContextItem,
  type ScoringContext,
} from "../../src/context/context-engine.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";

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

