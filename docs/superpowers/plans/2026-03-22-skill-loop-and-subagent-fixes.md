# Skill Learning Loop & Sub-Agent Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the skill learning loop so agents get smarter with every task, and fix sub-agent result quality so delegated work actually returns useful values.

**Architecture:** The learning loop wires the existing `LearningEngineService` into the execution engine's completion phase. When a run succeeds with converging entropy, the skill fragment is extracted and stored as a `ProceduralEntry` in SQLite. On subsequent runs, bootstrap retrieves matching skills and applies their config. Sub-agent fixes target result passthrough (raw values instead of narratives) and a more directive prompt.

**Tech Stack:** TypeScript, Effect-TS, bun:test, bun:sqlite

---

## File Structure

### Modified Files

| File | What Changes |
|------|-------------|
| `packages/runtime/src/execution-engine.ts` | Call `LearningEngineService.onRunCompleted()` after telemetry; apply retrieved skills in bootstrap |
| `packages/reactive-intelligence/src/learning/learning-engine.ts` | When `skillSynthesized=true`, call `extractSkillFragment()` and return fragment; accept optional `ProceduralMemoryService` to persist |
| `packages/reactive-intelligence/src/learning/skill-synthesis.ts` | Add `skillFragmentToProceduralEntry()` converter |
| `packages/runtime/src/runtime.ts` | Wire `LearningEngineService` into the layer stack when RI is enabled |
| `packages/tools/src/adapters/agent-tool-adapter.ts` | Improve sub-agent result: extract final answer only, add directive system prompt |
| `packages/tools/src/skills/builtin.ts` | Update spawn-agent tool description for clarity |

### New Files

| File | Responsibility |
|------|---------------|
| `packages/reactive-intelligence/tests/learning/skill-loop-integration.test.ts` | End-to-end tests for skill extraction → storage → retrieval → application |
| `packages/tools/tests/sub-agent-result-quality.test.ts` | Tests for result passthrough improvements |

---

## Part 1: Skill Learning Loop

### Task 1: Skill Fragment to Procedural Entry Converter

**Files:**
- Modify: `packages/reactive-intelligence/src/learning/skill-synthesis.ts`
- Create: `packages/reactive-intelligence/tests/learning/skill-loop-integration.test.ts`

- [ ] **Step 1: Write test for converter**

```typescript
import { describe, test, expect } from "bun:test";
import { skillFragmentToProceduralEntry } from "../../src/learning/skill-synthesis.js";
import type { SkillFragment } from "../../src/telemetry/types.js";

describe("skillFragmentToProceduralEntry", () => {
  test("converts fragment to procedural entry with correct fields", () => {
    const fragment: SkillFragment = {
      promptTemplateId: "default",
      systemPromptTokens: 0,
      contextStrategy: {
        compressionEnabled: false,
        maxIterations: 10,
        temperature: 0.7,
        toolFilteringMode: "adaptive",
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/reactive-intelligence && bun test tests/learning/skill-loop-integration.test.ts`

- [ ] **Step 3: Implement the converter**

Add to `packages/reactive-intelligence/src/learning/skill-synthesis.ts`:

```typescript
import type { SkillFragment } from "../telemetry/types.js";

export function skillFragmentToProceduralEntry(params: {
  fragment: SkillFragment;
  agentId: string;
  taskCategory: string;
  modelId: string;
}) {
  const { fragment, agentId, taskCategory, modelId } = params;
  const now = new Date();
  return {
    id: crypto.randomUUID(),       // MemoryId — generated fresh
    agentId,
    name: `${taskCategory}:${modelId}`,
    description: `Learned skill for ${taskCategory} tasks on ${modelId} (entropy: ${fragment.meanComposite.toFixed(2)}, convergence at iter ${fragment.convergenceIteration ?? "?"})`,
    pattern: JSON.stringify(fragment),
    successRate: 1.0,
    useCount: 1,
    tags: [taskCategory, modelId, fragment.reasoningConfig.strategy],
    createdAt: now,
    updatedAt: now,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

```
git add packages/reactive-intelligence/src/learning/skill-synthesis.ts packages/reactive-intelligence/tests/learning/skill-loop-integration.test.ts
git commit -m "feat(reactive-intelligence): add skill fragment to procedural entry converter"
```

---

### Task 2: Wire Learning Engine to Extract and Persist Skills

**Files:**
- Modify: `packages/reactive-intelligence/src/learning/learning-engine.ts`
- Modify: `packages/reactive-intelligence/tests/learning/skill-loop-integration.test.ts`

- [ ] **Step 1: Write test for skill extraction + persistence**

Add to the integration test file:

```typescript
import { LearningEngineServiceLive, type RunCompletedData } from "../../src/learning/learning-engine.js";
import { CalibrationStore } from "../../src/calibration/calibration-store.js";
import { BanditStore } from "../../src/learning/bandit-store.js";

describe("LearningEngineService skill persistence", () => {
  test("extracts and returns skill fragment when synthesis qualifies", () => {
    const calStore = new CalibrationStore();
    const banditStore = new BanditStore();
    const storedSkills: any[] = [];

    // Create layer with mock procedural store
    const layer = LearningEngineServiceLive(calStore, banditStore, {
      store: (entry) => { storedSkills.push(entry); return Effect.succeed("id-1"); },
    });

    const data: RunCompletedData = {
      modelId: "cogito:14b",
      taskDescription: "Write a fizzbuzz function",
      strategy: "reactive",
      outcome: "success",
      entropyHistory: [
        { composite: 0.6, trajectory: { shape: "diverging" } },
        { composite: 0.4, trajectory: { shape: "flat" } },
        { composite: 0.2, trajectory: { shape: "converging" } },
      ],
      totalTokens: 500,
      durationMs: 3000,
      temperature: 0.7,
      maxIterations: 10,
    };

    // Run and check result
    const result = Effect.runSync(
      LearningEngineService.pipe(
        Effect.flatMap((svc) => svc.onRunCompleted(data)),
        Effect.provide(layer),
      ),
    );

    expect(result.skillSynthesized).toBe(true);
    expect(result.skillFragment).toBeDefined();
    expect(storedSkills).toHaveLength(1);
    expect(storedSkills[0].tags).toContain("code-generation");
  });

  test("does not extract skill when outcome is failure", () => {
    const calStore = new CalibrationStore();
    const banditStore = new BanditStore();
    const storedSkills: any[] = [];

    const layer = LearningEngineServiceLive(calStore, banditStore, {
      store: (entry) => { storedSkills.push(entry); return Effect.succeed("id-1"); },
    });

    const data: RunCompletedData = {
      modelId: "cogito:14b",
      taskDescription: "Write code",
      strategy: "reactive",
      outcome: "failure",
      entropyHistory: [{ composite: 0.8, trajectory: { shape: "diverging" } }],
      totalTokens: 500,
      durationMs: 3000,
      temperature: 0.7,
      maxIterations: 10,
    };

    const result = Effect.runSync(
      LearningEngineService.pipe(
        Effect.flatMap((svc) => svc.onRunCompleted(data)),
        Effect.provide(layer),
      ),
    );

    expect(result.skillSynthesized).toBe(false);
    expect(result.skillFragment).toBeUndefined();
    expect(storedSkills).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Update LearningEngineService to extract and persist**

In `packages/reactive-intelligence/src/learning/learning-engine.ts`:

1. Add `extractSkillFragment` and `skillFragmentToProceduralEntry` imports
2. Accept an optional `skillStore` parameter in `LearningEngineServiceLive`
3. When `skillSynthesized === true`, call `extractSkillFragment(data)` → `skillFragmentToProceduralEntry()` → `skillStore.store()`
4. Return `skillFragment` in the `LearningResult`

Update the `LearningResult` type:

```typescript
export type LearningResult = {
  readonly calibrationUpdated: boolean;
  readonly banditUpdated: boolean;
  readonly skillSynthesized: boolean;
  readonly skillFragment?: SkillFragment;  // NEW
  readonly taskCategory: string;
};
```

The `skillStore` parameter type should be a minimal structural interface (not a full `ProceduralMemoryService` dependency — keep it decoupled):

```typescript
type SkillStore = {
  store: (entry: { agentId: string; name: string; description: string; pattern: string; successRate: number; useCount: number; tags: string[] }) => Effect.Effect<unknown, unknown>;
};
```

- [ ] **Step 3: Run tests**

Run: `cd packages/reactive-intelligence && bun test tests/learning/skill-loop-integration.test.ts`

- [ ] **Step 4: Update existing learning engine tests if needed**

The existing tests in `packages/reactive-intelligence/tests/learning/learning-engine.test.ts` may need updating since the function signature changed (optional `skillStore` param).

- [ ] **Step 5: Commit**

```
git add packages/reactive-intelligence/src/learning/learning-engine.ts packages/reactive-intelligence/tests/learning/
git commit -m "feat(reactive-intelligence): extract and persist skill fragments on successful convergent runs"
```

---

### Task 3: Wire Execution Engine to Call Learning Engine

**Files:**
- Modify: `packages/runtime/src/execution-engine.ts`
- Modify: `packages/runtime/src/runtime.ts`

- [ ] **Step 1: Read the telemetry section of execution-engine.ts**

Read lines ~2560-2607 to understand where the `RunReport` is built and `TelemetryClient.send()` is called. The learning engine call goes right after.

- [ ] **Step 2: Add LearningEngineService call after telemetry**

After the telemetry block (around line 2607), add:

```typescript
// ── Local Learning: update calibration, bandit, and skill store ──
if (config.enableReactiveIntelligence && entropyLog.length > 0) {
  yield* Effect.serviceOption(
    Context.GenericTag<{
      onRunCompleted: (data: any) => Effect.Effect<any, never>;
    }>("LearningEngineService"),
  ).pipe(
    Effect.flatMap((opt) => {
      if (opt._tag !== "Some") return Effect.void;
      return opt.value.onRunCompleted({
        modelId,
        taskDescription: taskText,
        strategy: ctx.selectedStrategy ?? "reactive",
        outcome,
        entropyHistory: entropyLog,
        totalTokens: ctx.tokensUsed,
        durationMs: executionDurationMs,
        temperature: (config as any).temperature ?? 0.7,
        maxIterations: config.maxIterations ?? 10,
        toolFilteringMode: (config as any).toolFilteringMode,
        requiredToolsCount: toolCallLog.length,
        memoryTier: (config as any).memoryTier ?? "basic",
        semanticLines: 0,
        episodicLines: 0,
        consolidationEnabled: false,
        strategySwitchingEnabled: (config as any).enableStrategySwitching ?? false,
        adaptiveEnabled: (config as any).adaptive?.enabled ?? false,
      });
    }),
    Effect.catchAll(() => Effect.void),
  );
}
```

- [ ] **Step 3: Wire LearningEngineService into runtime layer stack**

Two files need changes:

**A) `packages/reactive-intelligence/src/runtime.ts`** — Find `createReactiveIntelligenceLayer()`. Currently `CalibrationStore` is created inside `EntropySensorService` (not shared). Refactor:
1. Instantiate `CalibrationStore` and `BanditStore` (import from `./learning/bandit-store.js`, no-arg constructor = in-memory) once at the top of the factory
2. Pass the shared `CalibrationStore` to both `EntropySensorService` and `LearningEngineServiceLive`
3. Pass `BanditStore` to `LearningEngineServiceLive`
4. Accept an optional `skillStore` parameter (structural type) — if not provided, skills are checked but not persisted
5. Include `LearningEngineServiceLive` in the returned layer merge

**B) `packages/runtime/src/runtime.ts`** — Find where `createReactiveIntelligenceLayer()` is called (search for `enableReactiveIntelligence`). If memory is enabled, get `ProceduralMemoryService` from the memory layer and pass its `store` method as the `skillStore` parameter. Use structural typing to avoid importing the full memory package.

- [ ] **Step 4: Run full test suite**

Run: `bun test`
Expected: All 2,676+ tests pass.

- [ ] **Step 5: Commit**

```
git add packages/runtime/src/execution-engine.ts packages/runtime/src/runtime.ts
git commit -m "feat(runtime): wire learning engine into execution completion for skill persistence"
```

---

### Task 4: Apply Retrieved Skills in Bootstrap

**Files:**
- Modify: `packages/runtime/src/execution-engine.ts`

- [ ] **Step 1: Read the bootstrap phase**

Read lines ~516-578 to understand how `memoryContext` is retrieved and used.

- [ ] **Step 2: Apply skills from activeWorkflows**

After bootstrap retrieves `memoryContext`, check for `activeWorkflows` (procedural entries). If matching skills exist, apply their config:

```typescript
// ── Apply learned skills from procedural memory ──
if (memoryContext?.activeWorkflows?.length > 0) {
  const taskCategory = classifyTaskCategoryFn(task.input);
  const modelId = String(config.model ?? config.provider ?? "unknown");
  const matchingSkill = memoryContext.activeWorkflows.find(
    (w: any) => w.tags?.includes(taskCategory) && w.tags?.includes(modelId),
  );

  if (matchingSkill?.pattern) {
    try {
      const fragment = JSON.parse(matchingSkill.pattern);
      // Apply skill config as hints (don't override explicit user config)
      if (obs) {
        yield* obs.info(`Applying learned skill: ${matchingSkill.name}`, {
          convergenceIteration: fragment.convergenceIteration,
          meanEntropy: fragment.meanComposite,
        }).pipe(Effect.catchAll(() => Effect.void));
      }
    } catch {
      // Invalid pattern — ignore
    }
  }
}
```

**NOTE:** For V1 we log the skill application. Actually applying config overrides (temperature, strategy) is a follow-up — it requires threading the skill into the reasoning layer which is more complex. The key deliverable is: skills are extracted, stored, retrieved, and logged. Application is the evolution step.

- [ ] **Step 3: Run tests**

Run: `bun test`
Expected: All pass.

- [ ] **Step 4: Commit**

```
git add packages/runtime/src/execution-engine.ts
git commit -m "feat(runtime): retrieve and log matching skills during bootstrap"
```

---

## Part 2: Sub-Agent Improvements

### Task 5: Improve Sub-Agent Result Passthrough

**Files:**
- Modify: `packages/tools/src/adapters/agent-tool-adapter.ts`
- Create: `packages/tools/tests/sub-agent-result-quality.test.ts`

- [ ] **Step 1: Read the current result formatting**

Read `packages/tools/src/adapters/agent-tool-adapter.ts` to find where `SubAgentResult` is constructed — specifically the `summary` field and how `result.output` is processed before being returned to the parent.

- [ ] **Step 2: Write test for improved result format**

```typescript
import { describe, test, expect } from "bun:test";

describe("sub-agent result quality", () => {
  test("short factual answer passes through without narrative wrapping", () => {
    // The sub-agent executor should detect when the output is a short
    // direct answer (e.g., "120") and return it as-is, not wrap it in
    // "The sub-agent completed successfully. Result: 120"
    const rawOutput = "120";
    // Simulate the formatting logic
    const formatted = formatSubAgentResult(rawOutput);
    expect(formatted).toBe("120");
  });

  test("long output is truncated with tail preserved", () => {
    const rawOutput = "x".repeat(2000);
    const formatted = formatSubAgentResult(rawOutput);
    expect(formatted.length).toBeLessThanOrEqual(1500);
    // Should keep head + tail, not just head
    expect(formatted).toContain("...");
  });
});
```

- [ ] **Step 3: Improve the result formatting in agent-tool-adapter.ts**

Find where the `SubAgentResult.summary` is built. Currently it truncates to 1200 chars and strips ReAct markers. Improve:

1. **Raw passthrough for short answers** — if output is ≤ 500 chars, return as-is (no narrative wrapping)
2. **Better truncation** — keep first 600 + last 400 chars (instead of just first 1200)
3. **Strip "FINAL ANSWER:" prefix** — call `extractFinalAnswer` on the output before returning

- [ ] **Step 4: Run tests**

Run: `cd packages/tools && bun test`
Expected: All pass.

- [ ] **Step 5: Commit**

```
git add packages/tools/src/adapters/agent-tool-adapter.ts packages/tools/tests/sub-agent-result-quality.test.ts
git commit -m "fix(tools): improve sub-agent result passthrough — raw values for short answers"
```

---

### Task 6: Add Directive Sub-Agent System Prompt

**Files:**
- Modify: `packages/tools/src/adapters/agent-tool-adapter.ts`

- [ ] **Step 1: Find where the sub-agent system prompt is composed**

Search for `systemPrompt` in the file — it's built from parent context + persona + config.

- [ ] **Step 2: Add a directive prefix to the sub-agent system prompt**

Before any user-configured system prompt, prepend:

```
You are a focused sub-agent. Complete your assigned task efficiently:
- Use tools when they help. Do not explain what you're about to do — just do it.
- When you have the answer, respond with FINAL ANSWER: <your complete result>.
- Include raw values (numbers, code, data) in your answer — not descriptions of them.
- Do not ask follow-up questions. Do not offer alternatives.
```

This should go in the system prompt composition logic, before persona or user systemPrompt.

- [ ] **Step 3: Run tests**

Run: `bun test`
Expected: All pass.

- [ ] **Step 4: Commit**

```
git add packages/tools/src/adapters/agent-tool-adapter.ts
git commit -m "feat(tools): add directive system prompt for sub-agents to improve task focus"
```

---

### Task 7: Integration Verification

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: All 2,676+ tests pass.

- [ ] **Step 2: Run build**

Run: `bun run build`
Expected: All 22 packages build.

- [ ] **Step 3: Commit any fixes**

```
git add <specific files>
git commit -m "fix: integration fixes for skill loop and sub-agent improvements"
```
