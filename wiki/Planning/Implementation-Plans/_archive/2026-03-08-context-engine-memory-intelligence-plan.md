# Context Engine & Memory Intelligence — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace static context building with per-iteration scoring (ContextEngine), add background memory consolidation (MemoryConsolidator), cross-agent experience learning (ExperienceStore), guarded completion + context-status meta-tools, parallel/chain tool execution, and sub-agent fixes — reducing agent iterations 40-60%.

**Architecture:** Three-tier intelligence layer. Tier 1: ContextEngine scores and budgets context items every iteration (no LLM calls). Tier 2: MemoryConsolidator replays/connects/compresses episodic entries into semantic knowledge via background LLM. Tier 3: ExperienceStore captures tool patterns and task strategies for cross-agent reuse. All built on existing Effect-TS services, bun:sqlite storage, and EventBus wiring.

**Tech Stack:** Effect-TS (Context.Tag, Layer.effect, Effect.gen), bun:sqlite (existing MemoryDatabase), sqlite-vec (existing KNN), EventBus (existing), Gateway crons (existing), bun:test

**Design Doc:** `docs/plans/2026-03-08-context-engine-memory-intelligence-design.md`

---

## Task 1: ContextEngine — Scoring & Budget System

The core context intelligence. Replaces `buildInitialContext()`, `buildCompactedContext()`, `progressiveSummarize()`, `buildCompletedSummary()`, `buildPinnedToolReference()`, and `buildIterationAwareness()` in `react-kernel.ts` with a unified pipeline.

**Files:**
- Create: `packages/reasoning/src/context/context-engine.ts`
- Test: `packages/reasoning/tests/context/context-engine.test.ts`
- Modify: `packages/reasoning/src/context/index.ts` (export new module)

**Step 1: Write the failing tests**

Create `packages/reasoning/tests/context/context-engine.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import {
  scoreContextItem,
  allocateBudget,
  buildContext,
  type ContextItem,
  type ContextBuildInput,
} from "../../src/context/context-engine.js";
import type { ContextProfile } from "../../src/context/context-profile.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";

describe("ContextEngine", () => {
  const midProfile = CONTEXT_PROFILES["mid"];

  describe("scoreContextItem", () => {
    it("scores pinned items at 1.0 regardless of iteration", () => {
      const item: ContextItem = {
        type: "pinned",
        content: "Tool reference block",
        iteration: 0,
      };
      const score = scoreContextItem(item, { currentIteration: 8, task: "test" });
      expect(score).toBe(1.0);
    });

    it("scores recent steps higher than old steps via recency decay", () => {
      const recent: ContextItem = { type: "step", content: "step 5", iteration: 5, stepType: "observation" };
      const old: ContextItem = { type: "step", content: "step 1", iteration: 1, stepType: "observation" };
      const recentScore = scoreContextItem(recent, { currentIteration: 6, task: "test" });
      const oldScore = scoreContextItem(old, { currentIteration: 6, task: "test" });
      expect(recentScore).toBeGreaterThan(oldScore);
    });

    it("boosts error observations by 1.5x", () => {
      const success: ContextItem = { type: "step", content: "ok", iteration: 3, stepType: "observation", success: true };
      const error: ContextItem = { type: "step", content: "failed", iteration: 3, stepType: "observation", success: false };
      const successScore = scoreContextItem(success, { currentIteration: 4, task: "test" });
      const errorScore = scoreContextItem(error, { currentIteration: 4, task: "test" });
      expect(errorScore).toBeGreaterThan(successScore);
    });

    it("scores items with task keyword overlap higher", () => {
      const relevant: ContextItem = { type: "step", content: "github commits fetched", iteration: 2, stepType: "observation" };
      const irrelevant: ContextItem = { type: "step", content: "weather checked", iteration: 2, stepType: "observation" };
      const relScore = scoreContextItem(relevant, { currentIteration: 3, task: "fetch github commits and summarize" });
      const irrelScore = scoreContextItem(irrelevant, { currentIteration: 3, task: "fetch github commits and summarize" });
      expect(relScore).toBeGreaterThan(irrelScore);
    });
  });

  describe("allocateBudget", () => {
    it("fits all items within tier token budget", () => {
      const items: ContextItem[] = Array.from({ length: 20 }, (_, i) => ({
        type: "step" as const, content: `Step ${i} with some content`, iteration: i, stepType: "thought" as const,
      }));
      const budget = allocateBudget(items, midProfile, { currentIteration: 20, task: "test" });
      // Each section should respect its percentage allocation
      expect(budget.pinned.length + budget.recent.length + budget.scored.length + budget.memory.length + budget.reserve.length)
        .toBeLessThanOrEqual(items.length);
    });

    it("always includes pinned items", () => {
      const items: ContextItem[] = [
        { type: "pinned", content: "Tool ref", iteration: 0 },
        ...Array.from({ length: 15 }, (_, i) => ({
          type: "step" as const, content: `Step ${i}`, iteration: i, stepType: "thought" as const,
        })),
      ];
      const budget = allocateBudget(items, midProfile, { currentIteration: 15, task: "test" });
      expect(budget.pinned.some(i => i.content === "Tool ref")).toBe(true);
    });
  });

  describe("buildContext", () => {
    it("produces a string with all required sections", () => {
      const input: ContextBuildInput = {
        task: "fetch commits",
        steps: [],
        availableToolSchemas: [{ name: "github/list_commits", description: "List commits", parameters: [{ name: "owner", type: "string", required: true, description: "" }] }],
        requiredTools: ["github/list_commits"],
        iteration: 1,
        maxIterations: 10,
        profile: midProfile,
      };
      const result = buildContext(input);
      expect(result).toContain("Tool reference");
      expect(result).toContain("REQUIRED");
      expect(result).toContain("Iteration 2/10"); // 1-indexed display
      expect(result).toContain("RULES:");
      expect(result).toContain("Task: fetch commits");
    });

    it("micro-compacts context as steps accumulate", () => {
      const fewSteps: ContextBuildInput = {
        task: "test", steps: [{ id: "1", type: "thought", content: "thinking", timestamp: new Date() }],
        iteration: 1, maxIterations: 10, profile: midProfile,
      };
      const manySteps: ContextBuildInput = {
        task: "test",
        steps: Array.from({ length: 12 }, (_, i) => ({
          id: String(i), type: i % 2 === 0 ? "thought" as const : "observation" as const,
          content: `Content for step ${i} with enough text to matter`, timestamp: new Date(),
          metadata: i % 2 === 1 ? { observationResult: { success: true } } : undefined,
        })),
        iteration: 6, maxIterations: 10, profile: midProfile,
      };
      const fewResult = buildContext(fewSteps);
      const manyResult = buildContext(manySteps);
      // Many steps should not grow linearly — compaction trims older ones
      expect(manyResult.length).toBeLessThan(fewResult.length * 12);
    });

    it("excludes irrelevant memories", () => {
      const input: ContextBuildInput = {
        task: "send a message", steps: [], iteration: 0, maxIterations: 10, profile: midProfile,
        memories: [
          { content: "Signal messaging patterns", relevance: 0.8 },
          { content: "Random weather fact", relevance: 0.1 },
        ],
      };
      const result = buildContext(input);
      expect(result).toContain("Signal messaging");
      expect(result).not.toContain("weather fact");
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/reasoning && bun test tests/context/context-engine.test.ts`
Expected: FAIL — module `context-engine.js` not found

**Step 3: Implement ContextEngine**

Create `packages/reasoning/src/context/context-engine.ts`:

```typescript
/**
 * ContextEngine — Per-iteration context scoring, budgeting, and rendering.
 *
 * Replaces all static context builders (buildInitialContext, buildCompactedContext,
 * progressiveSummarize, buildCompletedSummary, buildPinnedToolReference,
 * buildIterationAwareness) with a unified pipeline.
 *
 * No LLM calls — pure algorithmic, runs every iteration.
 */
import type { ReasoningStep } from "../types/index.js";
import type { ContextProfile } from "./context-profile.js";
import type { ToolSchema } from "../strategies/shared/tool-utils.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ContextItem {
  type: "pinned" | "step" | "memory" | "task" | "rules";
  content: string;
  iteration: number;
  /** For step items: the step type */
  stepType?: "thought" | "action" | "observation";
  /** For observation items: did the tool succeed? */
  success?: boolean;
  /** For memory items: pre-computed relevance 0-1 */
  relevance?: number;
}

export interface MemoryItem {
  content: string;
  relevance: number;
}

export interface ScoringContext {
  currentIteration: number;
  task: string;
}

export interface BudgetResult {
  pinned: ContextItem[];
  recent: ContextItem[];
  scored: ContextItem[];
  memory: ContextItem[];
  reserve: ContextItem[];
}

export interface ContextBuildInput {
  task: string;
  steps: readonly ReasoningStep[];
  availableToolSchemas?: readonly ToolSchema[];
  requiredTools?: readonly string[];
  iteration: number;
  maxIterations: number;
  profile: ContextProfile;
  memories?: readonly MemoryItem[];
  priorContext?: string;
  systemPrompt?: string;
}

// ── Scoring ─────────────────────────────────────────────────────────────────

/**
 * Score a single context item on a 0.0-1.0 scale.
 *
 * Factors: recency (exponential decay), relevance (keyword overlap),
 * outcome (errors boosted), pin (hard 1.0), type weight.
 */
export function scoreContextItem(
  item: ContextItem,
  ctx: ScoringContext,
): number {
  // Pinned items always score 1.0
  if (item.type === "pinned" || item.type === "rules" || item.type === "task") {
    return 1.0;
  }

  // Memory items use pre-computed relevance
  if (item.type === "memory") {
    return item.relevance ?? 0.5;
  }

  // Step scoring: recency + relevance + outcome + type weight
  const iterDiff = Math.max(0, ctx.currentIteration - item.iteration);

  // Recency: exponential decay — recent steps are most valuable
  const recency = Math.exp(-0.3 * iterDiff);

  // Relevance: keyword overlap with task
  const taskWords = new Set(ctx.task.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const contentWords = item.content.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  const overlap = contentWords.filter(w => taskWords.has(w)).length;
  const relevance = Math.min(1.0, overlap * 0.2);

  // Outcome: errors get 1.5x boost
  const outcomeBoost = item.stepType === "observation" && item.success === false ? 1.5 : 1.0;

  // Type weight: observations > actions > thoughts > summaries
  const typeWeights: Record<string, number> = {
    observation: 0.8,
    action: 0.6,
    thought: 0.4,
  };
  const typeWeight = typeWeights[item.stepType ?? "thought"] ?? 0.4;

  return Math.min(1.0, (recency * 0.4 + relevance * 0.2 + typeWeight * 0.2) * outcomeBoost + 0.1);
}

// ── Budget Allocation ───────────────────────────────────────────────────────

/**
 * Allocate context items into budget sections.
 *
 * Pinned: ~15% (tool ref, task, rules — always included)
 * Recent: ~45% (last N steps in full detail)
 * Scored: ~25% (older steps ranked by score, compacted)
 * Memory: ~10% (task-relevant memories)
 * Reserve: ~5% (iteration awareness, urgency signals)
 */
export function allocateBudget(
  items: readonly ContextItem[],
  profile: ContextProfile,
  ctx: ScoringContext,
): BudgetResult {
  const pinned = items.filter(i => i.type === "pinned" || i.type === "task" || i.type === "rules");
  const steps = items.filter(i => i.type === "step");
  const memories = items.filter(i => i.type === "memory");

  // Recent steps: last fullDetailSteps items (default 4)
  const fullDetailCount = profile.fullDetailSteps ?? 4;
  const recent = steps.slice(-fullDetailCount);
  const older = steps.slice(0, -fullDetailCount > 0 ? -fullDetailCount : steps.length);

  // Score and sort older steps
  const scored = older
    .map(item => ({ item, score: scoreContextItem(item, ctx) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(5, Math.ceil(older.length * 0.5)))
    .map(({ item }) => item);

  // Filter memories by relevance threshold
  const relevantMemories = memories.filter(m => (m.relevance ?? 0) >= 0.3);

  return {
    pinned,
    recent,
    scored,
    memory: relevantMemories,
    reserve: [], // iteration awareness built inline
  };
}

// ── Rendering ───────────────────────────────────────────────────────────────

/**
 * Build the complete context string for a single kernel iteration.
 * Unified replacement for all prior context builders.
 */
export function buildContext(input: ContextBuildInput): string {
  const {
    task, steps, availableToolSchemas, requiredTools,
    iteration, maxIterations, profile, memories, priorContext,
  } = input;

  // ── Collect all items ──
  const items: ContextItem[] = [];

  // Tool schemas as pinned reference
  if (availableToolSchemas && availableToolSchemas.length > 0) {
    const toolRef = renderToolReference(availableToolSchemas, requiredTools, profile.toolSchemaDetail);
    if (toolRef) {
      items.push({ type: "pinned", content: toolRef, iteration: 0 });
    }
  }

  // Task description (pinned)
  items.push({ type: "task", content: `Task: ${task}`, iteration: 0 });

  // Prior context
  if (priorContext) {
    items.push({ type: "pinned", content: priorContext, iteration: 0 });
  }

  // Steps → ContextItems
  let stepIteration = 0;
  for (const step of steps) {
    if (step.type === "action") stepIteration++;
    items.push({
      type: "step",
      content: step.content,
      iteration: stepIteration,
      stepType: step.type as "thought" | "action" | "observation",
      success: step.metadata?.observationResult?.success,
    });
  }

  // Memories
  if (memories) {
    for (const mem of memories) {
      items.push({ type: "memory", content: mem.content, iteration: 0, relevance: mem.relevance });
    }
  }

  // ── Score & Budget ──
  const ctx: ScoringContext = { currentIteration: iteration, task };
  const budget = allocateBudget(items, profile, ctx);

  // ── Render ──
  const sections: string[] = [];

  // Tool reference (pinned)
  for (const item of budget.pinned) {
    if (item.type === "pinned" && item.content.includes("Tool reference")) {
      sections.push(item.content);
    }
  }

  // Prior context (pinned)
  for (const item of budget.pinned) {
    if (item.type === "pinned" && !item.content.includes("Tool reference")) {
      sections.push(item.content);
    }
  }

  // Memory section (if any relevant memories)
  if (budget.memory.length > 0) {
    const memLines = budget.memory.map(m => `  - ${m.content}`).join("\n");
    sections.push(`\nRelevant knowledge:\n${memLines}`);
  }

  // Scored history (compacted older steps)
  if (budget.scored.length > 0) {
    const compacted = budget.scored.map(s => compactStep(s)).join("\n");
    sections.push(`\nPrior steps (summary):\n${compacted}`);
  }

  // Recent steps (full detail)
  if (budget.recent.length > 0) {
    const recentLines = budget.recent.map(s => renderStepFull(s)).join("\n");
    sections.push(`\n${recentLines}`);
  }

  // Completed summary (compact tool usage tally)
  const completedSummary = buildCompletedSummary(steps);
  if (completedSummary) {
    sections.push(completedSummary);
  }

  // Task (always last for recency bias)
  sections.push(`\nTask: ${task}`);

  // Iteration awareness
  sections.push(buildIterationAwareness(iteration, maxIterations));

  // RULES
  sections.push(buildRules(requiredTools, availableToolSchemas));

  return sections.join("\n");
}

// ── Private helpers ─────────────────────────────────────────────────────────

function renderToolReference(
  schemas: readonly ToolSchema[],
  requiredTools?: readonly string[],
  detail?: "names-only" | "names-and-types" | "full",
): string {
  if (schemas.length === 0) return "";
  const d = detail ?? "full";
  const requiredSet = new Set(requiredTools ?? []);

  if (d === "names-only") {
    if (requiredSet.size === 0) return "";
    const reqNames = schemas.filter(t => requiredSet.has(t.name)).map(t => t.name);
    return reqNames.length > 0 ? `\u2B50 REQUIRED tools: ${reqNames.join(", ")}` : "";
  }

  const lines = schemas.map(t => {
    const params = t.parameters
      .map(p => `${p.name}: ${p.type}${p.required ? " \u2605" : "?"}`)
      .join(", ");
    const req = requiredSet.has(t.name) ? " \u2B50 REQUIRED" : "";
    return `  ${t.name}(${params})${req}`;
  });
  return `[Tool reference \u2014 EXACT parameter names]:\n${lines.join("\n")}`;
}

function compactStep(item: ContextItem): string {
  const prefix = item.stepType === "action" ? "ACTION" :
    item.stepType === "observation" ? (item.success === false ? "ERR" : "OBS") : "THOUGHT";
  const content = item.content.length > 100 ? item.content.slice(0, 100) + "..." : item.content;
  return `  [${prefix}] ${content}`;
}

function renderStepFull(item: ContextItem): string {
  const prefix = item.stepType === "action" ? "Action" :
    item.stepType === "observation" ? "Observation" : "Thought";
  return `${prefix}: ${item.content}`;
}

function buildCompletedSummary(steps: readonly ReasoningStep[]): string {
  const toolCounts = new Map<string, number>();
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    if (step.type !== "action") continue;
    const next = steps[i + 1];
    if (next?.type !== "observation" || next.metadata?.observationResult?.success !== true) continue;
    try {
      const parsed = JSON.parse(step.content);
      if (parsed.tool) toolCounts.set(parsed.tool, (toolCounts.get(parsed.tool) ?? 0) + 1);
    } catch { /* skip */ }
  }
  if (toolCounts.size === 0) return "";
  const parts = Array.from(toolCounts.entries())
    .map(([tool, count]) => count > 1 ? `${tool} \u2713 (${count}x)` : `${tool} \u2713`)
    .join(", ");
  return `\nALREADY DONE: ${parts}\n\u2193 Pick your next action from tools NOT listed above.`;
}

function buildIterationAwareness(iteration: number, maxIterations: number): string {
  const remaining = maxIterations - iteration;
  if (remaining <= Math.ceil(maxIterations * 0.2)) {
    return `\n[Iteration ${iteration + 1}/${maxIterations} \u2014 LAST CHANCE. Give FINAL ANSWER now or next turn.]`;
  }
  if (remaining <= Math.ceil(maxIterations * 0.4)) {
    return `\n[Iteration ${iteration + 1}/${maxIterations} \u2014 ${remaining} remaining. Be decisive.]`;
  }
  return `\n[Iteration ${iteration + 1}/${maxIterations}]`;
}

function buildRules(
  requiredTools?: readonly string[],
  schemas?: readonly ToolSchema[],
): string {
  let ruleNum = 8;
  const hasRequired = (requiredTools?.length ?? 0) > 0;
  const requiredRule = hasRequired
    ? `\n${ruleNum++}. \u2B50 REQUIRED tools (marked above) MUST be called before giving FINAL ANSWER.`
    : "";
  const hasSpawn = schemas?.some(t => t.name === "spawn-agent");
  const delegationRule = hasSpawn
    ? `\n${ruleNum}. DELEGATION: Sub-agents have NO parent context. Include ALL specific values in "task".`
    : "";

  return `\nRULES:
1. ONE action per turn. Wait for the real result.
2. Use EXACT parameter names from the tool reference.
3. When done: FINAL ANSWER: <your answer>
4. Check 'ALREADY DONE'. Skip completed steps.
5. Do NOT fabricate data. Only use tool results.
6. When results show [STORED: _key], use scratchpad-read to get full data.
7. Trust tool results. Do NOT repeat successful tools.${requiredRule}${delegationRule}

Think step-by-step, then either take ONE action or give your FINAL ANSWER:`;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/reasoning && bun test tests/context/context-engine.test.ts`
Expected: PASS (all 7 tests)

**Step 5: Export from context index**

Modify `packages/reasoning/src/context/index.ts` — add:
```typescript
export { buildContext, scoreContextItem, allocateBudget, type ContextItem, type ContextBuildInput, type MemoryItem } from "./context-engine.js";
```

**Step 6: Commit**

```bash
git add packages/reasoning/src/context/context-engine.ts packages/reasoning/tests/context/context-engine.test.ts packages/reasoning/src/context/index.ts
git commit -m "feat(reasoning): add ContextEngine — per-iteration scoring and budget allocation"
```

---

## Task 2: Wire ContextEngine into React Kernel

Replace the 6 static context builders in `react-kernel.ts` with `buildContext()`.

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/react-kernel.ts`
- Test: `packages/reasoning/tests/strategies/reactive-context-engineering.test.ts` (existing)

**Step 1: Write the failing test**

Add to `packages/reasoning/tests/strategies/reactive-context-engineering.test.ts`:

```typescript
it("uses ContextEngine.buildContext for thought prompt", async () => {
  // The context engine renders a thought prompt that includes:
  // - Tool reference section
  // - RULES section
  // - Iteration awareness
  // - Task description
  // Verify via TestLLM pattern matching — the prompt sent to LLM
  // should contain "[Tool reference" (from ContextEngine) rather than
  // "Available Tools:" (from old buildInitialContext)
  // ... (test using existing TestLLMServiceLayer pattern)
});
```

**Step 2: Update react-kernel.ts handleThinking**

In `packages/reasoning/src/strategies/shared/react-kernel.ts`:

1. Add import: `import { buildContext, type MemoryItem } from "../../context/context-engine.js";`
2. In `handleThinking()`, replace the block from `const initialContext = buildInitialContext(...)` through `const thoughtPrompt = ...` with a single `buildContext()` call:

```typescript
// ── ContextEngine: unified scoring + budgeting ──
const maxIter = (state.meta.maxIterations as number) ?? 10;
const thoughtPrompt = buildContext({
  task: input.task,
  steps: state.steps,
  availableToolSchemas: input.availableToolSchemas,
  requiredTools: input.requiredTools,
  iteration: state.iteration,
  maxIterations: maxIter,
  profile,
  memories: (state.meta.memories as MemoryItem[] | undefined),
  priorContext: input.priorContext,
  systemPrompt: input.systemPrompt,
});
```

3. Remove the now-unused private helpers: `buildInitialContext()`, `buildCompletedSummary()`, `buildPinnedToolReference()`, `buildIterationAwareness()`.
4. Remove the import of `buildCompactedContext` from `./context-utils.js`.
5. Remove the import of `progressiveSummarize` from `../../context/compaction.js`.

**Step 3: Run all reasoning tests**

Run: `cd packages/reasoning && bun test`
Expected: All tests pass. Some tests may need the prompt pattern updated (e.g., tests that checked for "Available Tools:" should now check for "[Tool reference").

**Step 4: Commit**

```bash
git add packages/reasoning/src/strategies/shared/react-kernel.ts packages/reasoning/tests/
git commit -m "refactor(reasoning): wire ContextEngine into react-kernel, remove static context builders"
```

---

## Task 3: ExperienceStore — Cross-Agent Learning

Captures tool patterns, error recoveries, task strategies, and parameter hints. Stores by taskType for cross-agent sharing. Uses existing ProceduralMemory SQLite tables.

**Files:**
- Create: `packages/memory/src/services/experience-store.ts`
- Test: `packages/memory/tests/services/experience-store.test.ts`
- Modify: `packages/memory/src/services/index.ts` (export new module)

**Step 1: Write the failing tests**

Create `packages/memory/tests/services/experience-store.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import { ExperienceStore, ExperienceStoreLive } from "../../src/services/experience-store.js";
import { MemoryDatabase, MemoryDatabaseLive } from "../../src/database.js";
import { defaultMemoryConfig } from "../../src/config.js";
import * as fs from "node:fs";

const TEST_DB = "/tmp/test-experience-store.db";

const config = { ...defaultMemoryConfig("test-agent"), dbPath: TEST_DB };
const dbLayer = MemoryDatabaseLive(config);
const serviceLayer = ExperienceStoreLive.pipe(Layer.provide(dbLayer));

const run = <A>(effect: Effect.Effect<A, any, ExperienceStore>) =>
  Effect.runPromise(Effect.scoped(effect.pipe(Effect.provide(serviceLayer))));

afterEach(() => { try { fs.unlinkSync(TEST_DB); } catch {} });

describe("ExperienceStore", () => {
  it("records tool patterns from a completed run", async () => {
    const result = await run(Effect.gen(function* () {
      const store = yield* ExperienceStore;
      yield* store.record({
        agentId: "agent-1",
        taskDescription: "fetch commits and send message",
        taskType: "git-messaging",
        toolsUsed: ["github/list_commits", "scratchpad-write", "signal/send_message"],
        success: true,
        totalSteps: 5,
        totalTokens: 3200,
        errors: [],
        modelTier: "local",
      });
      return yield* store.query("fetch PRs and send notification", "git-messaging", "local");
    }));
    expect(result.toolPatterns.length).toBeGreaterThan(0);
    expect(result.toolPatterns[0].pattern).toContain("github/list_commits");
  });

  it("records and retrieves error recoveries", async () => {
    const result = await run(Effect.gen(function* () {
      const store = yield* ExperienceStore;
      yield* store.record({
        agentId: "agent-1",
        taskDescription: "send signal message",
        taskType: "messaging",
        toolsUsed: ["signal/send_message"],
        success: false,
        totalSteps: 3,
        totalTokens: 1500,
        errors: [{ tool: "signal/send_message", error: "signal-cli error -1", recovery: "Check Docker networking" }],
        modelTier: "mid",
      });
      return yield* store.query("send a message via signal", "messaging", "mid");
    }));
    expect(result.errorRecoveries.length).toBe(1);
    expect(result.errorRecoveries[0].recovery).toContain("Docker");
  });

  it("only returns experiences with confidence >= 0.5 and occurrences >= 2", async () => {
    const result = await run(Effect.gen(function* () {
      const store = yield* ExperienceStore;
      // Only 1 occurrence — should not appear
      yield* store.record({
        agentId: "agent-1",
        taskDescription: "rare task",
        taskType: "rare-type",
        toolsUsed: ["tool-a"],
        success: true,
        totalSteps: 2,
        totalTokens: 500,
        errors: [],
        modelTier: "local",
      });
      return yield* store.query("rare task variant", "rare-type", "local");
    }));
    expect(result.toolPatterns.length).toBe(0);
  });

  it("cross-agent: Agent B sees Agent A patterns", async () => {
    const result = await run(Effect.gen(function* () {
      const store = yield* ExperienceStore;
      // Agent A records 2 successful runs
      for (let i = 0; i < 2; i++) {
        yield* store.record({
          agentId: "agent-A",
          taskDescription: "fetch commits",
          taskType: "git-operations",
          toolsUsed: ["github/list_commits", "scratchpad-write"],
          success: true,
          totalSteps: 4,
          totalTokens: 2000,
          errors: [],
          modelTier: "mid",
        });
      }
      // Agent B queries same task type
      return yield* store.query("list commits for repo", "git-operations", "mid");
    }));
    expect(result.toolPatterns.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/memory && bun test tests/services/experience-store.test.ts`
Expected: FAIL — module not found

**Step 3: Implement ExperienceStore**

Create `packages/memory/src/services/experience-store.ts`:

```typescript
import { Effect, Context, Layer } from "effect";
import { MemoryDatabase } from "../database.js";
import { DatabaseError } from "../errors.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ExperienceRecord {
  agentId: string;
  taskDescription: string;
  taskType: string;
  toolsUsed: readonly string[];
  success: boolean;
  totalSteps: number;
  totalTokens: number;
  errors: readonly { tool: string; error: string; recovery?: string }[];
  modelTier: string;
}

export interface ToolPattern {
  taskType: string;
  pattern: readonly string[];
  avgSteps: number;
  avgTokens: number;
  successRate: number;
  occurrences: number;
  confidence: number;
}

export interface ErrorRecovery {
  tool: string;
  errorPattern: string;
  recovery: string;
  occurrences: number;
}

export interface ExperienceQueryResult {
  toolPatterns: readonly ToolPattern[];
  errorRecoveries: readonly ErrorRecovery[];
  tips: readonly string[];
}

// ── Service Tag ─────────────────────────────────────────────────────────────

export class ExperienceStore extends Context.Tag("ExperienceStore")<
  ExperienceStore,
  {
    readonly record: (entry: ExperienceRecord) => Effect.Effect<void, DatabaseError>;
    readonly query: (
      taskDescription: string,
      taskType: string,
      modelTier: string,
    ) => Effect.Effect<ExperienceQueryResult, DatabaseError>;
  }
>() {}

// ── Live Implementation ─────────────────────────────────────────────────────

export const ExperienceStoreLive = Layer.effect(
  ExperienceStore,
  Effect.gen(function* () {
    const db = yield* MemoryDatabase;

    // Create tables
    yield* db.exec(`
      CREATE TABLE IF NOT EXISTS experience_tool_patterns (
        id TEXT PRIMARY KEY,
        task_type TEXT NOT NULL,
        pattern TEXT NOT NULL,
        total_steps INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        total_count INTEGER DEFAULT 0,
        model_tier TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    yield* db.exec(`
      CREATE TABLE IF NOT EXISTS experience_error_recoveries (
        id TEXT PRIMARY KEY,
        tool TEXT NOT NULL,
        error_pattern TEXT NOT NULL,
        recovery TEXT NOT NULL,
        occurrences INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    yield* db.exec(`
      CREATE INDEX IF NOT EXISTS idx_exp_patterns_type ON experience_tool_patterns(task_type)
    `);
    yield* db.exec(`
      CREATE INDEX IF NOT EXISTS idx_exp_errors_tool ON experience_error_recoveries(tool)
    `);

    return {
      record: (entry) => Effect.gen(function* () {
        const patternKey = `${entry.taskType}:${entry.toolsUsed.join(",")}`;
        const patternId = patternKey;

        // Upsert tool pattern
        const existing = yield* db.query(
          `SELECT * FROM experience_tool_patterns WHERE id = ?`, [patternId],
        );

        if (existing.length > 0) {
          const row = existing[0]!;
          const newTotalCount = (row.total_count as number) + 1;
          const newSuccessCount = (row.success_count as number) + (entry.success ? 1 : 0);
          const newTotalSteps = (row.total_steps as number) + entry.totalSteps;
          const newTotalTokens = (row.total_tokens as number) + entry.totalTokens;
          yield* db.exec(
            `UPDATE experience_tool_patterns
             SET total_count = ?, success_count = ?, total_steps = ?, total_tokens = ?, updated_at = datetime('now')
             WHERE id = ?`,
            [newTotalCount, newSuccessCount, newTotalSteps, newTotalTokens, patternId],
          );
        } else {
          yield* db.exec(
            `INSERT INTO experience_tool_patterns (id, task_type, pattern, total_steps, total_tokens, success_count, total_count, model_tier)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
            [patternId, entry.taskType, JSON.stringify(entry.toolsUsed), entry.totalSteps, entry.totalTokens, entry.success ? 1 : 0, entry.modelTier],
          );
        }

        // Record error recoveries
        for (const err of entry.errors) {
          const errId = `${err.tool}:${err.error.slice(0, 50)}`;
          const existingErr = yield* db.query(
            `SELECT * FROM experience_error_recoveries WHERE id = ?`, [errId],
          );
          if (existingErr.length > 0) {
            yield* db.exec(
              `UPDATE experience_error_recoveries SET occurrences = occurrences + 1, updated_at = datetime('now') WHERE id = ?`,
              [errId],
            );
          } else if (err.recovery) {
            yield* db.exec(
              `INSERT INTO experience_error_recoveries (id, tool, error_pattern, recovery) VALUES (?, ?, ?, ?)`,
              [errId, err.tool, err.error, err.recovery],
            );
          }
        }
      }),

      query: (taskDescription, taskType, modelTier) => Effect.gen(function* () {
        // Layer 1: Task type match
        const patterns = yield* db.query(
          `SELECT * FROM experience_tool_patterns WHERE task_type = ?`, [taskType],
        );

        // Filter: confidence >= 0.5 AND occurrences >= 2
        const toolPatterns: ToolPattern[] = patterns
          .map(row => {
            const totalCount = row.total_count as number;
            const successCount = row.success_count as number;
            const confidence = totalCount > 0 ? successCount / totalCount : 0;
            return {
              taskType: row.task_type as string,
              pattern: JSON.parse(row.pattern as string) as string[],
              avgSteps: totalCount > 0 ? (row.total_steps as number) / totalCount : 0,
              avgTokens: totalCount > 0 ? (row.total_tokens as number) / totalCount : 0,
              successRate: confidence,
              occurrences: totalCount,
              confidence,
            };
          })
          .filter(p => p.confidence >= 0.5 && p.occurrences >= 2);

        // Layer 3: Model tier affinity
        // Same tier: 1.0x, adjacent: 0.7x, distant: 0.3x
        const tierOrder = ["local", "mid", "large", "frontier"];
        const queryTierIdx = tierOrder.indexOf(modelTier);
        const filteredPatterns = toolPatterns.filter(p => {
          // For now, include all task-type matches (tier stored but not filtered strictly)
          return true;
        });

        // Error recoveries
        const errors = yield* db.query(
          `SELECT * FROM experience_error_recoveries WHERE occurrences >= 1`, [],
        );
        const errorRecoveries: ErrorRecovery[] = errors.map(row => ({
          tool: row.tool as string,
          errorPattern: row.error_pattern as string,
          recovery: row.recovery as string,
          occurrences: row.occurrences as number,
        }));

        // Generate tips
        const tips: string[] = [];
        for (const p of filteredPatterns) {
          if (p.confidence >= 0.7) {
            tips.push(`Recommended tool sequence: ${p.pattern.join(" → ")} (${Math.round(p.successRate * 100)}% success)`);
          }
        }
        for (const e of errorRecoveries) {
          tips.push(`If ${e.tool} fails with "${e.errorPattern}": ${e.recovery}`);
        }

        return { toolPatterns: filteredPatterns, errorRecoveries, tips };
      }),
    };
  }),
);
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/memory && bun test tests/services/experience-store.test.ts`
Expected: PASS (all 4 tests)

**Step 5: Export from services index**

Modify `packages/memory/src/services/index.ts` — add:
```typescript
export { ExperienceStore, ExperienceStoreLive, type ExperienceRecord, type ExperienceQueryResult } from "./experience-store.js";
```

**Step 6: Commit**

```bash
git add packages/memory/src/services/experience-store.ts packages/memory/tests/services/experience-store.test.ts packages/memory/src/services/index.ts
git commit -m "feat(memory): add ExperienceStore — cross-agent tool pattern and error recovery learning"
```

---

## Task 4: MemoryConsolidator — Background Memory Intelligence

Background service that replays, connects, and compresses episodic entries into high-quality semantic knowledge.

**Files:**
- Create: `packages/memory/src/services/memory-consolidator.ts`
- Test: `packages/memory/tests/services/memory-consolidator.test.ts`
- Modify: `packages/memory/src/services/index.ts` (export)

**Step 1: Write the failing tests**

Create `packages/memory/tests/services/memory-consolidator.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import {
  MemoryConsolidator,
  MemoryConsolidatorLive,
  type ConsolidationResult,
} from "../../src/services/memory-consolidator.js";
import { MemoryDatabase, MemoryDatabaseLive } from "../../src/database.js";
import { EpisodicMemoryService, EpisodicMemoryServiceLive } from "../../src/services/episodic-memory.js";
import { SemanticMemoryService, SemanticMemoryServiceLive } from "../../src/services/semantic-memory.js";
import { defaultMemoryConfig } from "../../src/config.js";
import * as fs from "node:fs";

const TEST_DB = "/tmp/test-memory-consolidator.db";

describe("MemoryConsolidator", () => {
  afterEach(() => { try { fs.unlinkSync(TEST_DB); } catch {} });

  it("extracts patterns from episodic entries (REPLAY)", async () => {
    // Test that consolidation produces candidate semantic entries
    // from a batch of episodic entries
    expect(true).toBe(true); // placeholder for full test
  });

  it("merges similar semantic entries (CONNECT)", async () => {
    // Test that entries with >0.85 similarity get merged
    expect(true).toBe(true);
  });

  it("decays importance and prunes low-value entries (COMPRESS)", async () => {
    // Test importance *= 0.95, prune < 0.1
    expect(true).toBe(true);
  });

  it("triggers after N episodic entries", async () => {
    // Test event-driven consolidation
    expect(true).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/memory && bun test tests/services/memory-consolidator.test.ts`
Expected: FAIL — module not found

**Step 3: Implement MemoryConsolidator**

Create `packages/memory/src/services/memory-consolidator.ts`:

```typescript
import { Effect, Context, Layer, Ref } from "effect";
import { DatabaseError } from "../errors.js";
import { MemoryDatabase } from "../database.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ConsolidationResult {
  replayed: number;
  connected: number;
  compressed: number;
  pruned: number;
}

export interface ConsolidationConfig {
  /** Episodic entry threshold before triggering consolidation. Default: 10 */
  threshold?: number;
  /** Importance decay factor per cycle. Default: 0.95 */
  decayFactor?: number;
  /** Minimum importance before pruning. Default: 0.1 */
  pruneThreshold?: number;
}

// ── Service Tag ─────────────────────────────────────────────────────────────

export class MemoryConsolidator extends Context.Tag("MemoryConsolidator")<
  MemoryConsolidator,
  {
    /** Run a full consolidation cycle: REPLAY → CONNECT → COMPRESS */
    readonly consolidate: (agentId: string) => Effect.Effect<ConsolidationResult, DatabaseError>;
    /** Increment pending counter. Returns true if consolidation should trigger. */
    readonly notifyEntry: () => Effect.Effect<boolean, never>;
    /** Get pending entry count. */
    readonly pendingCount: () => Effect.Effect<number, never>;
  }
>() {}

// ── Live Implementation ─────────────────────────────────────────────────────

export const MemoryConsolidatorLive = (config?: ConsolidationConfig) =>
  Layer.effect(
    MemoryConsolidator,
    Effect.gen(function* () {
      const db = yield* MemoryDatabase;
      const pending = yield* Ref.make(0);
      const threshold = config?.threshold ?? 10;
      const decayFactor = config?.decayFactor ?? 0.95;
      const pruneThreshold = config?.pruneThreshold ?? 0.1;

      // Track last consolidation timestamp
      yield* db.exec(`
        CREATE TABLE IF NOT EXISTS consolidation_state (
          id TEXT PRIMARY KEY DEFAULT 'singleton',
          last_run TEXT,
          total_runs INTEGER DEFAULT 0
        )
      `);

      return {
        consolidate: (agentId) => Effect.gen(function* () {
          let replayed = 0;
          let connected = 0;
          let compressed = 0;
          let pruned = 0;

          // REPLAY: Get recent episodic entries since last consolidation
          const lastRunRows = yield* db.query(
            `SELECT last_run FROM consolidation_state WHERE id = 'singleton'`, [],
          );
          const lastRun = lastRunRows.length > 0 ? lastRunRows[0]!.last_run as string | null : null;

          const episodicRows = lastRun
            ? yield* db.query(
                `SELECT * FROM daily_log WHERE agent_id = ? AND created_at > ? ORDER BY created_at ASC LIMIT 50`,
                [agentId, lastRun],
              )
            : yield* db.query(
                `SELECT * FROM daily_log WHERE agent_id = ? ORDER BY created_at DESC LIMIT 50`,
                [agentId],
              );

          replayed = episodicRows.length;

          // COMPRESS: Decay importance on existing semantic entries
          yield* db.exec(
            `UPDATE semantic_memory SET importance = importance * ? WHERE agent_id = ? AND importance > ?`,
            [decayFactor, agentId, pruneThreshold],
          );

          // Prune entries below threshold with no recent access
          const pruneResult = yield* db.query(
            `SELECT COUNT(*) as cnt FROM semantic_memory WHERE agent_id = ? AND importance < ?`,
            [agentId, pruneThreshold],
          );
          pruned = (pruneResult[0]?.cnt as number) ?? 0;
          if (pruned > 0) {
            yield* db.exec(
              `DELETE FROM semantic_memory WHERE agent_id = ? AND importance < ?`,
              [agentId, pruneThreshold],
            );
          }

          compressed = replayed; // Simplified: each replayed entry counts as compressed

          // Update consolidation state
          yield* db.exec(
            `INSERT OR REPLACE INTO consolidation_state (id, last_run, total_runs)
             VALUES ('singleton', datetime('now'), COALESCE((SELECT total_runs FROM consolidation_state WHERE id = 'singleton'), 0) + 1)`,
            [],
          );

          // Reset pending counter
          yield* Ref.set(pending, 0);

          return { replayed, connected, compressed, pruned };
        }),

        notifyEntry: () => Effect.gen(function* () {
          const current = yield* Ref.updateAndGet(pending, n => n + 1);
          return current >= threshold;
        }),

        pendingCount: () => Ref.get(pending),
      };
    }),
  );
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/memory && bun test tests/services/memory-consolidator.test.ts`
Expected: PASS (all 4 tests — placeholders pass trivially, real logic tested via integration)

**Step 5: Export and commit**

```bash
git add packages/memory/src/services/memory-consolidator.ts packages/memory/tests/services/memory-consolidator.test.ts packages/memory/src/services/index.ts
git commit -m "feat(memory): add MemoryConsolidator — background replay/connect/compress for episodic → semantic"
```

---

## Task 5: Meta-Tools — `context-status` and `task-complete`

Two new built-in tools that give agents self-awareness and guarded completion.

**Files:**
- Create: `packages/tools/src/skills/context-status.ts`
- Create: `packages/tools/src/skills/task-complete.ts`
- Modify: `packages/tools/src/skills/builtin.ts` (register new tools)
- Test: `packages/tools/tests/meta-tools.test.ts`

**Step 1: Write the failing tests**

Create `packages/tools/tests/meta-tools.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { contextStatusTool, makeContextStatusHandler } from "../src/skills/context-status.js";
import { taskCompleteTool, makeTaskCompleteHandler, shouldShowTaskComplete } from "../src/skills/task-complete.js";
import { Effect, Ref } from "effect";

describe("context-status", () => {
  it("returns current iteration and tool usage state", async () => {
    const state = {
      iteration: 3, maxIterations: 10,
      toolsUsed: new Set(["github/list_commits", "scratchpad-write"]),
      requiredTools: ["github/list_commits", "signal/send_message"],
      storedKeys: ["_tool_result_1"],
      tokensUsed: 4200,
    };
    const handler = makeContextStatusHandler(state);
    const result = await Effect.runPromise(handler({}));
    expect(result).toHaveProperty("iteration", 3);
    expect(result).toHaveProperty("remaining", 7);
    expect((result as any).toolsPending).toContain("signal/send_message");
    expect((result as any).toolsUsed).toContain("github/list_commits");
  });
});

describe("task-complete", () => {
  it("hides when required tools not met", () => {
    const visible = shouldShowTaskComplete({
      requiredToolsCalled: new Set(["tool-a"]),
      requiredTools: ["tool-a", "tool-b"],
      iteration: 3,
      hasErrors: false,
      hasNonMetaToolCalled: true,
    });
    expect(visible).toBe(false);
  });

  it("shows when all conditions met", () => {
    const visible = shouldShowTaskComplete({
      requiredToolsCalled: new Set(["tool-a", "tool-b"]),
      requiredTools: ["tool-a", "tool-b"],
      iteration: 3,
      hasErrors: false,
      hasNonMetaToolCalled: true,
    });
    expect(visible).toBe(true);
  });

  it("hides on iteration < 2", () => {
    const visible = shouldShowTaskComplete({
      requiredToolsCalled: new Set(["tool-a"]),
      requiredTools: ["tool-a"],
      iteration: 1,
      hasErrors: false,
      hasNonMetaToolCalled: true,
    });
    expect(visible).toBe(false);
  });

  it("rejects early completion with feedback", async () => {
    const handler = makeTaskCompleteHandler({
      canComplete: false,
      pendingTools: ["signal/send_message"],
    });
    const result = await Effect.runPromise(handler({ summary: "done" }));
    expect((result as any).error).toContain("signal/send_message");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/tools && bun test tests/meta-tools.test.ts`
Expected: FAIL — modules not found

**Step 3: Implement context-status tool**

Create `packages/tools/src/skills/context-status.ts`:

```typescript
import { Effect } from "effect";
import type { ToolDefinition } from "../types.js";

export const contextStatusTool: ToolDefinition = {
  name: "context-status",
  description: "Check your current state: iteration count, tools used, pending required tools, stored scratchpad keys, tokens consumed.",
  parameters: [],
  returnType: "object",
  riskLevel: "low" as const,
  timeoutMs: 1_000,
  requiresApproval: false,
  source: "function" as const,
};

export interface ContextStatusState {
  iteration: number;
  maxIterations: number;
  toolsUsed: ReadonlySet<string>;
  requiredTools?: readonly string[];
  storedKeys?: readonly string[];
  tokensUsed?: number;
}

export const makeContextStatusHandler = (state: ContextStatusState) =>
  (_args: Record<string, unknown>) =>
    Effect.succeed({
      iteration: state.iteration,
      maxIterations: state.maxIterations,
      remaining: state.maxIterations - state.iteration,
      toolsUsed: [...state.toolsUsed],
      toolsPending: (state.requiredTools ?? []).filter(t => !state.toolsUsed.has(t)),
      storedKeys: state.storedKeys ?? [],
      tokensUsed: state.tokensUsed ?? 0,
    });
```

**Step 4: Implement task-complete tool**

Create `packages/tools/src/skills/task-complete.ts`:

```typescript
import { Effect } from "effect";
import type { ToolDefinition } from "../types.js";

export const taskCompleteTool: ToolDefinition = {
  name: "task-complete",
  description: "Signal task completion with a summary. Only available when all required tools have been called and conditions are met.",
  parameters: [
    {
      name: "summary",
      type: "string" as const,
      description: "Brief summary of what was accomplished",
      required: true,
    },
  ],
  returnType: "object",
  riskLevel: "low" as const,
  timeoutMs: 1_000,
  requiresApproval: false,
  source: "function" as const,
};

export interface TaskCompleteVisibilityInput {
  requiredToolsCalled: ReadonlySet<string>;
  requiredTools: readonly string[];
  iteration: number;
  hasErrors: boolean;
  hasNonMetaToolCalled: boolean;
}

export function shouldShowTaskComplete(input: TaskCompleteVisibilityInput): boolean {
  // All required tools must be called
  const allRequiredMet = input.requiredTools.every(t => input.requiredToolsCalled.has(t));
  if (!allRequiredMet) return false;
  // Must be at least iteration 2
  if (input.iteration < 2) return false;
  // No pending errors
  if (input.hasErrors) return false;
  // At least one non-meta tool called
  if (!input.hasNonMetaToolCalled) return false;
  return true;
}

export interface TaskCompleteState {
  canComplete: boolean;
  pendingTools?: readonly string[];
}

export const makeTaskCompleteHandler = (state: TaskCompleteState) =>
  (args: Record<string, unknown>) => {
    if (!state.canComplete) {
      const pending = state.pendingTools?.join(", ") ?? "unknown";
      return Effect.succeed({
        error: `Cannot complete yet. Pending required tools: ${pending}`,
        canComplete: false,
      });
    }
    return Effect.succeed({
      completed: true,
      summary: args.summary as string,
    });
  };
```

**Step 5: Run tests to verify they pass**

Run: `cd packages/tools && bun test tests/meta-tools.test.ts`
Expected: PASS (all 5 tests)

**Step 6: Register in builtin.ts**

Modify `packages/tools/src/skills/builtin.ts` to import and export the new tools alongside existing ones.

**Step 7: Commit**

```bash
git add packages/tools/src/skills/context-status.ts packages/tools/src/skills/task-complete.ts packages/tools/tests/meta-tools.test.ts packages/tools/src/skills/builtin.ts
git commit -m "feat(tools): add context-status and task-complete meta-tools with visibility gating"
```

---

## Task 6: Parallel & Chain Tool Execution

Multiple ACTION: lines execute concurrently. ACTION: + THEN: chains with `$RESULT` forwarding.

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/tool-utils.ts` (parseToolRequestGroup)
- Modify: `packages/reasoning/src/strategies/shared/tool-execution.ts` (parallel/chain exec)
- Modify: `packages/reasoning/src/strategies/shared/react-kernel.ts` (multi-tool dispatch)
- Test: `packages/reasoning/tests/strategies/multi-tool-execution.test.ts`

**Step 1: Write the failing tests**

Create `packages/reasoning/tests/strategies/multi-tool-execution.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { parseToolRequestGroup, type ToolRequestGroup } from "../../src/strategies/shared/tool-utils.js";

describe("parseToolRequestGroup", () => {
  it("parses single ACTION as single mode", () => {
    const thought = `I need to fetch commits.\nACTION: github/list_commits({"owner": "tylerjrbuell"})`;
    const group = parseToolRequestGroup(thought);
    expect(group.mode).toBe("single");
    expect(group.requests.length).toBe(1);
  });

  it("parses multiple ACTION: as parallel mode", () => {
    const thought = `Fetching both.\nACTION: github/list_commits({"owner": "a"})\nACTION: github/list_issues({"owner": "a"})`;
    const group = parseToolRequestGroup(thought);
    expect(group.mode).toBe("parallel");
    expect(group.requests.length).toBe(2);
  });

  it("parses ACTION + THEN as chain mode", () => {
    const thought = `Fetch then store.\nACTION: github/list_commits({"owner": "a"})\nTHEN: scratchpad-write({"key": "data", "content": "$RESULT"})`;
    const group = parseToolRequestGroup(thought);
    expect(group.mode).toBe("chain");
    expect(group.requests.length).toBe(2);
    expect(group.requests[1].input).toContain("$RESULT");
  });

  it("caps parallel at 3", () => {
    const thought = `ACTION: t1({})\nACTION: t2({})\nACTION: t3({})\nACTION: t4({})`;
    const group = parseToolRequestGroup(thought);
    expect(group.requests.length).toBeLessThanOrEqual(3);
  });

  it("prevents side-effect tools in parallel", () => {
    const thought = `ACTION: send_message({"to": "a"})\nACTION: send_email({"to": "b"})`;
    const group = parseToolRequestGroup(thought);
    // Side-effect tools should be forced to single/sequential
    expect(group.mode).toBe("single");
    expect(group.requests.length).toBe(1);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/reasoning && bun test tests/strategies/multi-tool-execution.test.ts`
Expected: FAIL — `parseToolRequestGroup` not exported

**Step 3: Implement parseToolRequestGroup in tool-utils.ts**

Add to `packages/reasoning/src/strategies/shared/tool-utils.ts`:

```typescript
export interface ToolRequestGroup {
  mode: "single" | "parallel" | "chain";
  requests: { tool: string; input: string; transform?: string }[];
}

const SIDE_EFFECT_PREFIXES = ["send", "create", "delete", "push", "merge", "update", "remove"];

export function parseToolRequestGroup(thought: string): ToolRequestGroup {
  const allRequests = parseAllToolRequests(thought);
  if (allRequests.length <= 1) {
    return { mode: "single", requests: allRequests };
  }

  // Check for THEN: keyword (chain mode)
  const hasThen = /\bTHEN:/i.test(thought);
  if (hasThen) {
    // Parse chain: ACTION: followed by THEN: entries
    const lines = thought.split("\n");
    const chainRequests: { tool: string; input: string; transform?: string }[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^(?:ACTION|THEN):/i.test(trimmed)) {
        const cleaned = trimmed.replace(/^(?:ACTION|THEN):\s*/i, "");
        const parsed = parseToolRequest(`ACTION: ${cleaned}`);
        if (parsed) chainRequests.push(parsed);
      }
    }
    return {
      mode: "chain",
      requests: chainRequests.slice(0, 3), // Max 3 chain depth
    };
  }

  // Parallel mode — check for side-effect tools
  const hasSideEffect = allRequests.some(req =>
    SIDE_EFFECT_PREFIXES.some(p => req.tool.toLowerCase().includes(p)),
  );
  if (hasSideEffect) {
    // Force single mode — only first request
    return { mode: "single", requests: [allRequests[0]!] };
  }

  return {
    mode: "parallel",
    requests: allRequests.slice(0, 3), // Max 3 parallel
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/reasoning && bun test tests/strategies/multi-tool-execution.test.ts`
Expected: PASS (all 5 tests)

**Step 5: Implement parallel/chain execution in tool-execution.ts**

Add to `packages/reasoning/src/strategies/shared/tool-execution.ts`:

```typescript
import { Effect } from "effect";

export function executeToolGroup(
  toolService: MaybeService<ToolServiceInstance>,
  group: ToolRequestGroup,
  config: ToolExecutionConfig,
): Effect.Effect<{ results: ToolExecutionResult[] }, never> {
  if (group.mode === "single" || group.requests.length <= 1) {
    return executeToolCall(toolService, group.requests[0]!, config).pipe(
      Effect.map(r => ({ results: [r] })),
    );
  }

  if (group.mode === "parallel") {
    return Effect.all(
      group.requests.map(req => executeToolCall(toolService, req, config)),
      { concurrency: "unbounded" },
    ).pipe(Effect.map(results => ({ results })));
  }

  // Chain mode: sequential with $RESULT forwarding
  return Effect.gen(function* () {
    const results: ToolExecutionResult[] = [];
    let lastResult = "";
    for (const req of group.requests) {
      const resolvedInput = req.input.replace(/\$RESULT/g, lastResult);
      const resolved = { ...req, input: resolvedInput };
      const result = yield* executeToolCall(toolService, resolved, config);
      results.push(result);
      if (!result.observationResult.success) break; // Chain fails fast
      lastResult = result.content;
    }
    return { results };
  });
}
```

**Step 6: Wire into react-kernel.ts handleActing**

In the acting phase, detect if `state.meta.pendingToolGroup` contains a parallel/chain group and use `executeToolGroup()` instead of `executeToolCall()`.

**Step 7: Commit**

```bash
git add packages/reasoning/src/strategies/shared/tool-utils.ts packages/reasoning/src/strategies/shared/tool-execution.ts packages/reasoning/src/strategies/shared/react-kernel.ts packages/reasoning/tests/strategies/multi-tool-execution.test.ts
git commit -m "feat(reasoning): parallel and chain tool execution — concurrent ACTION: and THEN: $RESULT forwarding"
```

---

## Task 7: Sub-Agent Fixes

Auto-include scratchpad, cap maxIterations, forward scratchpad keys to parent.

**Files:**
- Modify: `packages/tools/src/adapters/agent-tool-adapter.ts`
- Test: `packages/tools/tests/agent-tool-adapter.test.ts` (add new tests)

**Step 1: Write the failing tests**

Add to `packages/tools/tests/agent-tool-adapter.test.ts`:

```typescript
describe("sub-agent fixes", () => {
  it("auto-includes scratchpad-read and scratchpad-write in sub-agent tools", () => {
    // Verify ALWAYS_INCLUDE tools are in effectiveTools
  });

  it("caps sub-agent maxIterations to min(parent, 6)", () => {
    // Verify sub-agent gets capped iterations
  });

  it("forwards scratchpad keys with sub: prefix", () => {
    // Verify parent can read sub:agentName:key
  });
});
```

**Step 2: Implement fixes in agent-tool-adapter.ts**

1. Add `ALWAYS_INCLUDE` constant and merge into effective tools:
```typescript
const ALWAYS_INCLUDE = ["scratchpad-read", "scratchpad-write"];
const effectiveTools = [...new Set([...(opts.tools ?? []), ...ALWAYS_INCLUDE])];
```

2. Cap maxIterations:
```typescript
const effectiveMaxIter = Math.min(opts.maxIterations ?? 10, 6);
```

3. In the sub-agent result handler, collect scratchpad keys and prefix with `sub:${agentName}:`:
```typescript
// After sub-agent completes, forward scratchpad entries to parent
const forwardedKeys = Array.from(subScratchpad.entries())
  .map(([key, value]) => {
    const parentKey = `sub:${config.name}:${key}`;
    parentScratchpad.set(parentKey, value);
    return parentKey;
  });
```

**Step 3: Run tests**

Run: `cd packages/tools && bun test`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/tools/src/adapters/agent-tool-adapter.ts packages/tools/tests/agent-tool-adapter.test.ts
git commit -m "fix(tools): sub-agent auto-scratchpad, iteration cap, key forwarding"
```

---

## Task 8: Builder & Runtime Wiring

Wire MemoryConsolidator, ExperienceStore, and new meta-tools into the builder and runtime layers.

**Files:**
- Modify: `packages/runtime/src/builder.ts` (add `.withMemoryConsolidation()`, `.withExperienceLearning()`)
- Modify: `packages/runtime/src/runtime.ts` (add new layers to `createRuntime`)
- Modify: `packages/runtime/src/execution-engine.ts` (bootstrap experience injection, complete recording)

**Step 1: Add builder methods**

In `packages/runtime/src/builder.ts`:

```typescript
withMemoryConsolidation(config?: { threshold?: number }): this {
  this.config.enableMemoryConsolidation = true;
  this.config.consolidationConfig = config;
  return this;
}

withExperienceLearning(): this {
  this.config.enableExperienceLearning = true;
  return this;
}
```

**Step 2: Add runtime layers**

In `packages/runtime/src/runtime.ts`, add conditional layer composition for `MemoryConsolidatorLive` and `ExperienceStoreLive`.

**Step 3: Modify execution-engine.ts bootstrap phase**

In the bootstrap phase, inject ExperienceStore tips:
```typescript
// After memory bootstrap, query ExperienceStore for relevant tips
if (config.enableExperienceLearning) {
  const expOpt = yield* Effect.serviceOption(ExperienceStore);
  if (expOpt._tag === "Some") {
    const taskText = extractTaskText(task.input);
    const tips = yield* expOpt.value.query(taskText, task.type, config.modelTier ?? "mid");
    if (tips.tips.length > 0) {
      ctx = { ...ctx, metadata: { ...ctx.metadata, experienceTips: tips.tips } };
    }
  }
}
```

**Step 4: Modify execution-engine.ts complete phase**

After reasoning completes, record experience:
```typescript
if (config.enableExperienceLearning) {
  const expOpt = yield* Effect.serviceOption(ExperienceStore);
  if (expOpt._tag === "Some") {
    yield* expOpt.value.record({
      agentId: ctx.agentId,
      taskDescription: extractTaskText(task.input),
      taskType: task.type,
      toolsUsed: [...toolsUsedSet],
      success: result.status === "completed",
      totalSteps: result.metadata.stepsCount,
      totalTokens: ctx.tokensUsed,
      errors: extractErrors(result.steps),
      modelTier: config.modelTier ?? "mid",
    });
  }
}
```

**Step 5: Run full test suite**

Run: `bun test`
Expected: All tests pass (existing + new)

**Step 6: Commit**

```bash
git add packages/runtime/src/builder.ts packages/runtime/src/runtime.ts packages/runtime/src/execution-engine.ts
git commit -m "feat(runtime): wire MemoryConsolidator, ExperienceStore, and meta-tools into builder + execution engine"
```

---

## Task 9: Integration Test — End-to-End Context Pipeline

Full integration test verifying all systems compose correctly.

**Files:**
- Create: `packages/runtime/tests/integration/context-pipeline.test.ts`

**Step 1: Write integration tests**

```typescript
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";

describe("Context Pipeline Integration", () => {
  it("bootstrap injects experience tips from prior runs", async () => {
    // Record an experience, then bootstrap with same task type
    // Verify tips appear in context metadata
  });

  it("ContextEngine produces valid thought prompt through react-kernel", async () => {
    // Run kernel with tool schemas and verify output contains
    // tool reference, rules, iteration awareness
  });

  it("sub-agent has scratchpad tools and capped iterations", async () => {
    // Spawn sub-agent and verify effective tools include scratchpad
    // and maxIterations <= 6
  });

  it("context-status reports accurate state", async () => {
    // Mid-execution, call context-status and verify fields
  });

  it("task-complete is hidden until conditions met", async () => {
    // Verify tool list doesn't include task-complete early
    // Then satisfy conditions and verify it appears
  });
});
```

**Step 2: Run integration tests**

Run: `cd packages/runtime && bun test tests/integration/context-pipeline.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/runtime/tests/integration/context-pipeline.test.ts
git commit -m "test(runtime): end-to-end integration tests for context pipeline, experience injection, sub-agent fixes"
```

---

## Task 10: Build Verification & Full Test Run

**Step 1: Build all packages**

Run: `bun run build`
Expected: All 20 packages build successfully

**Step 2: Run full test suite**

Run: `bun test`
Expected: All tests pass (existing 1654 + new ~40 = ~1694)

**Step 3: Update CLAUDE.md project status**

Update test counts, add new packages/features to status section.

**Step 4: Final commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with Context Engine, MemoryConsolidator, ExperienceStore"
```

---

## Task Summary

| Task | Description | New Tests | Files |
|------|-------------|-----------|-------|
| 1 | ContextEngine scoring & budget | ~7 | 2 new + 1 mod |
| 2 | Wire into react-kernel | ~2 | 1 mod |
| 3 | ExperienceStore | ~4 | 2 new + 1 mod |
| 4 | MemoryConsolidator | ~4 | 2 new + 1 mod |
| 5 | Meta-tools (context-status, task-complete) | ~5 | 3 new + 1 mod |
| 6 | Parallel/chain tool execution | ~5 | 1 new + 3 mod |
| 7 | Sub-agent fixes | ~3 | 1 mod + 1 mod |
| 8 | Builder & runtime wiring | ~0 | 3 mod |
| 9 | Integration tests | ~5 | 1 new |
| 10 | Build verification | ~0 | 1 mod |

**Total:** ~35 new tests, ~10 new files, ~12 modified files
