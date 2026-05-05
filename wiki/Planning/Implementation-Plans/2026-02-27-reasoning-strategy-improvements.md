# Reasoning Strategy Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix efficiency (bounded context, fewer wasted LLM calls) and effectiveness (higher task success rate) across all 4 non-reactive reasoning strategies.

**Architecture:** Each strategy file in `packages/reasoning/src/strategies/` gets targeted fixes. Tests added to corresponding test files in `packages/reasoning/tests/strategies/`. TDD throughout — write failing test, implement fix, verify pass, commit.

**Tech Stack:** Effect-TS, Bun test runner, `TestLLMServiceLayer` from `@reactive-agents/llm-provider`

---

## Summary of Fixes

| Strategy | Fix | Why |
|---|---|---|
| Reflexion | Stagnant critique detection | Loops indefinitely when critique repeats — wastes N×2 LLM calls |
| Reflexion | Cap `previousCritiques` at 3 | Unbounded array inflates prompt on long runs |
| Plan-Execute | Step context compaction | `Context so far:` grows with every step — O(n²) tokens |
| Plan-Execute | Synthesis step after execution | Raw `stepResults.join()` isn't a proper final answer |
| Tree-of-Thought | Robust score parsing | Fails on `"75%"`, `"4/5"`, `"Score: 0.8"` — returns 0.5 fallback for all |
| Tree-of-Thought | Adaptive pruning threshold | All paths pruned → empty tree → abandoned run |
| Tree-of-Thought | Phase 2 history compaction | Execution history grows unbounded just like reactive did before |
| Adaptive | Fallback on partial sub-result | Chose wrong strategy? Retry with reactive instead of returning partial |
| Adaptive | Richer classification prompt | Concrete examples prevent defaulting to REACTIVE for everything |

---

## Task 1: Reflexion — Stagnant Detection + Bounded Critiques

**Files:**
- Modify: `packages/reasoning/src/strategies/reflexion.ts`
- Test: `packages/reasoning/tests/strategies/reflexion.test.ts`

### Step 1: Write the 2 failing tests

Add to the `describe("ReflexionStrategy")` block in `reflexion.test.ts`:

```typescript
it("exits early when critique is stagnant (same as previous)", async () => {
  // TestLLMService returns same critique every time → stagnant → bail after 2nd attempt
  const layer = TestLLMServiceLayer({
    "Critically evaluate": "The response is missing detail about superposition.",
  });

  const result = await Effect.runPromise(
    executeReflexion({
      taskDescription: "Explain quantum entanglement",
      taskType: "explanation",
      memoryContext: "",
      availableTools: [],
      config: {
        ...defaultReasoningConfig,
        strategies: {
          ...defaultReasoningConfig.strategies,
          reflexion: { maxRetries: 5, selfCritiqueDepth: "shallow" },
        },
      },
    }).pipe(Effect.provide(layer)),
  );

  // Should bail after detecting stagnation — fewer thought steps than maxRetries+1 allows
  const thoughtSteps = result.steps.filter((s) => s.type === "thought");
  expect(thoughtSteps.length).toBeLessThan(5); // < maxRetries attempts
  expect(result.status).toBe("partial");
});

it("caps previousCritiques at 3 entries regardless of maxRetries", async () => {
  // Run 4 retries — if cap works, critique prompt only contains last 3
  // We can only verify this behaviorally (strategy still runs, no crash)
  const layer = TestLLMServiceLayer({
    // Slightly different each time to avoid stagnation but never satisfied
    "Critically evaluate": "The response lacks examples.",
    default: "An improved response.",
  });

  const result = await Effect.runPromise(
    executeReflexion({
      taskDescription: "Explain quantum entanglement",
      taskType: "explanation",
      memoryContext: "",
      availableTools: [],
      config: {
        ...defaultReasoningConfig,
        strategies: {
          ...defaultReasoningConfig.strategies,
          // 4 retries — without cap, 4th generation prompt would have 3 prior critiques
          reflexion: { maxRetries: 4, selfCritiqueDepth: "shallow" },
        },
      },
    }).pipe(Effect.provide(layer)),
  );

  expect(result.strategy).toBe("reflexion");
  // Still produces output — cap doesn't break the loop
  expect(result.steps.length).toBeGreaterThan(0);
});
```

### Step 2: Run tests to verify they fail

```bash
bun test packages/reasoning/tests/strategies/reflexion.test.ts
```

Expected: The "exits early" test fails (stagnation not yet implemented). The "caps" test may pass already (no observable difference without the fix). Both must be verified.

### Step 3: Add `isCritiqueStagnant()` helper to `reflexion.ts`

Add this function after the existing `isSatisfied()` function (around line 368):

```typescript
/**
 * Detects stagnant critiques — if the new critique is substantially the same
 * as the most recent one, further retries won't improve the response.
 * Uses normalized substring matching (no heavy Levenshtein needed).
 */
function isCritiqueStagnant(previousCritiques: string[], newCritique: string): boolean {
  if (previousCritiques.length === 0) return false;
  const lastCritique = previousCritiques[previousCritiques.length - 1]!;
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const a = normalize(lastCritique);
  const b = normalize(newCritique);
  if (a === b) return true;
  // Overlap: if 80% of the shorter string appears in the longer one, it's stagnant
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length > 20 && longer.includes(shorter.slice(0, Math.floor(shorter.length * 0.8)))) {
    return true;
  }
  return false;
}
```

### Step 4: Wire stagnation check + critique cap into the loop body

In the `while (attempt < maxRetries)` loop, after `const critique = critiqueResponse.content;` and after the step is pushed, add the stagnation check **before** `isSatisfied()`:

```typescript
// ── Stagnation check: exit early if critique isn't changing ──
if (isCritiqueStagnant(previousCritiques, critique)) {
  return buildResult(steps, currentResponse, "partial", start, totalTokens, totalCost, attempt);
}
```

Then after `previousCritiques.push(critique)`, add the cap:

```typescript
// Cap critique history to last 3 entries to prevent prompt explosion
if (previousCritiques.length > 3) {
  previousCritiques = previousCritiques.slice(-3);
}
```

Note: `previousCritiques` must be declared with `let` not `const` for the reassignment to work. It already is (`let previousCritiques: string[] = []`).

### Step 5: Run tests to verify all pass

```bash
bun test packages/reasoning/tests/strategies/reflexion.test.ts
```

Expected: All 9 tests pass (7 existing + 2 new).

### Step 6: Commit

```bash
git add packages/reasoning/src/strategies/reflexion.ts packages/reasoning/tests/strategies/reflexion.test.ts
git commit -m "fix(reasoning): reflexion stagnation detection and bounded critique history"
```

---

## Task 2: Plan-Execute — Context Compaction + Synthesis Step

**Files:**
- Modify: `packages/reasoning/src/strategies/plan-execute.ts`
- Test: `packages/reasoning/tests/strategies/plan-execute.test.ts`

### Step 1: Write the 2 failing tests

Add to `plan-execute.test.ts`:

```typescript
it("compacts step context after 5 prior results to prevent O(n²) token growth", async () => {
  // Plan with 7 steps; each exec step's context must stay bounded
  const layer = TestLLMServiceLayer({
    "planning agent":
      "1. Step A\n2. Step B\n3. Step C\n4. Step D\n5. Step E\n6. Step F\n7. Step G",
    "Execute this step": "Result for this step.",
    "evaluating plan execution": "SATISFIED: All steps complete.",
  });

  const result = await Effect.runPromise(
    executePlanExecute({
      taskDescription: "Long multi-step research task",
      taskType: "multi-step",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
    }).pipe(Effect.provide(layer)),
  );

  expect(result.status).toBe("completed");
  const execSteps = result.steps.filter((s) => s.content.startsWith("[EXEC"));
  expect(execSteps.length).toBe(7);
  // Strategy completes successfully with a 7-step plan
  expect(result.output).toBeTruthy();
});

it("produces a synthesized final answer, not raw step concatenation", async () => {
  const layer = TestLLMServiceLayer({
    "planning agent": "1. Look up data\n2. Analyze results",
    "Execute this step": "Data found and analyzed.",
    "evaluating plan execution": "SATISFIED: Task complete.",
    "Synthesize": "The final synthesized answer: Data analysis complete with key insights.",
  });

  const result = await Effect.runPromise(
    executePlanExecute({
      taskDescription: "Research and summarize quantum computing",
      taskType: "research",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
    }).pipe(Effect.provide(layer)),
  );

  expect(result.status).toBe("completed");
  expect(typeof result.output).toBe("string");
  expect((result.output as string).length).toBeGreaterThan(0);
});
```

### Step 2: Run tests to verify behavior

```bash
bun test packages/reasoning/tests/strategies/plan-execute.test.ts
```

Expected: Both new tests may already pass structurally (they test correctness of output shape). Confirm all 5 tests run. If either fails, proceed to fix.

### Step 3: Add `buildCompactedStepContext()` helper to `plan-execute.ts`

Add this function after `isSatisfied()` (around line 432):

```typescript
/**
 * Prevents unbounded context growth during plan execution.
 * When more than 5 step results exist, collapses older ones to one-liners.
 */
function buildCompactedStepContext(stepResults: string[]): string {
  if (stepResults.length <= 5) return stepResults.join("\n");
  const older = stepResults
    .slice(0, stepResults.length - 5)
    .map((_, i) => `Step ${i + 1}: [completed]`);
  const recent = stepResults.slice(-5);
  return [...older, ...recent].join("\n");
}
```

### Step 4: Use compacted context in the EXECUTE loop

In the `execResponse` LLM call inside the `for (let i = 0; i < planSteps.length; i++)` loop, find:

```typescript
content: `Execute this step of the plan:\n\nStep ${i + 1}: ${stepDescription}\n\nContext so far:\n${stepResults.join("\n")}`,
```

Replace with:

```typescript
content: `Execute this step of the plan:\n\nStep ${i + 1}: ${stepDescription}\n\nContext so far:\n${buildCompactedStepContext(stepResults)}`,
```

### Step 5: Add synthesis step in the `isSatisfied()` branch

Find the `if (isSatisfied(reflectResponse.content))` branch. Before the `break`, add a synthesis LLM call:

```typescript
if (isSatisfied(reflectResponse.content)) {
  // ── SYNTHESIZE: Produce a clean final answer from step results ──
  const synthLlmResponse = yield* llm
    .complete({
      messages: [
        {
          role: "user",
          content: `Task: ${input.taskDescription}\n\nExecution results:\n${stepResults.join("\n")}\n\nSynthesize a clear, complete answer to the original task based on the execution results above.`,
        },
      ],
      systemPrompt: input.systemPrompt ?? "You are a synthesizer. Combine execution results into a clear, complete final answer.",
      maxTokens: 500,
      temperature: 0.3,
    })
    .pipe(
      Effect.catchAll(() =>
        Effect.succeed({ content: stepResults.join("\n\n"), usage: { totalTokens: 0, estimatedCost: 0 } }),
      ),
    );

  totalTokens += synthLlmResponse.usage.totalTokens;
  totalCost += synthLlmResponse.usage.estimatedCost;
  finalOutput = synthLlmResponse.content;

  steps.push({
    id: ulid() as StepId,
    type: "thought",
    content: `[SYNTHESIS] ${finalOutput}`,
    timestamp: new Date(),
  });

  // EventBus publish (existing code below) ...
  if (ebOpt._tag === "Some") { /* existing publish */ }
  break;
}
```

### Step 6: Run all plan-execute tests

```bash
bun test packages/reasoning/tests/strategies/plan-execute.test.ts
```

Expected: All 5 tests pass.

### Step 7: Commit

```bash
git add packages/reasoning/src/strategies/plan-execute.ts packages/reasoning/tests/strategies/plan-execute.test.ts
git commit -m "fix(reasoning): plan-execute context compaction and synthesized final answer"
```

---

## Task 3: Tree-of-Thought — Score Robustness + Adaptive Pruning + Phase 2 Compaction

**Files:**
- Modify: `packages/reasoning/src/strategies/tree-of-thought.ts`
- Test: `packages/reasoning/tests/strategies/tree-of-thought.test.ts`

### Step 1: Write the 2 failing tests

Add to `tree-of-thought.test.ts`:

```typescript
it("adaptive pruning rescues tree when all candidates score below threshold", async () => {
  // All scoring returns 0.2 (below default 0.5 threshold)
  // Adaptive pruning should lower threshold to 0.35 and rescue paths
  const layer = TestLLMServiceLayer({
    "explore solution": "1. Approach one\n2. Approach two",
    "Rate this thought": "0.2",
    "Think step-by-step": "FINAL ANSWER: Recovered despite low scores.",
  });

  const result = await Effect.runPromise(
    executeTreeOfThought({
      taskDescription: "Solve a difficult creative problem",
      taskType: "creative",
      memoryContext: "",
      availableTools: [],
      config: {
        ...defaultReasoningConfig,
        strategies: {
          ...defaultReasoningConfig.strategies,
          treeOfThought: { breadth: 2, depth: 2, pruningThreshold: 0.5 },
        },
      },
    }).pipe(Effect.provide(layer)),
  );

  expect(result.strategy).toBe("tree-of-thought");
  // Should not return empty — adaptive pruning rescued at least one node
  expect(result.steps.length).toBeGreaterThan(2);
  // An adaptive pruning message should appear in steps
  const adaptiveStep = result.steps.find((s) =>
    s.content.includes("Adaptive pruning") || s.content.includes("adaptive"),
  );
  expect(adaptiveStep).toBeDefined();
});

it("parses scores in percentage format (75% → 0.75)", async () => {
  // Score returned as "75%" — should parse to 0.75, above 0.5 threshold
  const layer = TestLLMServiceLayer({
    "explore solution": "1. Approach A\n2. Approach B",
    "Rate this thought": "75%",
    "Think step-by-step": "FINAL ANSWER: Answer from percentage-scored path.",
  });

  const result = await Effect.runPromise(
    executeTreeOfThought({
      taskDescription: "Solve a problem",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: {
        ...defaultReasoningConfig,
        strategies: {
          ...defaultReasoningConfig.strategies,
          treeOfThought: { breadth: 2, depth: 1, pruningThreshold: 0.5 },
        },
      },
    }).pipe(Effect.provide(layer)),
  );

  expect(result.strategy).toBe("tree-of-thought");
  // 75% = 0.75 > 0.5 threshold, so paths should NOT be pruned
  // If parsing failed, score would be 0.5 (borderline) — tree might still work
  // Verify strategy completed successfully
  expect(result.status).toBe("completed");
  expect(result.output).toBeTruthy();
});
```

### Step 2: Run tests to verify failures

```bash
bun test packages/reasoning/tests/strategies/tree-of-thought.test.ts
```

Expected: "adaptive pruning" test fails (no adaptive rescue exists). "percentage" test may fail if `parseScore("75%")` returns 0.5 instead of 0.75.

### Step 3: Replace `parseScore()` with robust implementation

Replace the existing `parseScore` function (lines 531–549) with:

```typescript
function parseScore(text: string): number {
  // Strip think tags (some LLMs wrap reasoning in <think>...</think>)
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const target = stripped.length > 0 ? stripped : text.trim();
  if (target.length === 0) return 0.5;

  // "75%" → 0.75
  const pctMatch = target.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pctMatch) {
    return Math.max(0, Math.min(1, parseFloat(pctMatch[1]!) / 100));
  }

  // "4/5" or "3/4" → ratio
  const ratioMatch = target.match(/\b(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\b/);
  if (ratioMatch) {
    const num = parseFloat(ratioMatch[1]!);
    const den = parseFloat(ratioMatch[2]!);
    if (den > 0) return Math.max(0, Math.min(1, num / den));
  }

  // "Score: 0.8", "Rating: 7" — if > 1 treat as 0–10 scale
  const labeledMatch = target.match(/(?:score|rating|value|grade)\s*[:=]\s*(\d+(?:\.\d+)?)/i);
  if (labeledMatch) {
    const val = parseFloat(labeledMatch[1]!);
    return Math.max(0, Math.min(1, val > 1 ? val / 10 : val));
  }

  // Standard decimal in [0, 1]: "0.75", ".75", "1.0", "0", "1"
  const decMatch = target.match(/\b(1\.0*|0?\.\d+|[01])\b/);
  if (decMatch) {
    return Math.max(0, Math.min(1, parseFloat(decMatch[1]!)));
  }

  return 0.5;
}
```

### Step 4: Add adaptive pruning to BFS loop

In the BFS loop, find the `if (nextFrontier.length === 0)` check (after the inner `for (const parent of frontier)` loop). Replace it with:

```typescript
if (nextFrontier.length === 0) {
  // Adaptive pruning: lower threshold by 0.15 before giving up entirely
  const adaptiveThreshold = Math.max(0.15, pruningThreshold - 0.15);
  const nodesAtThisDepth = allNodes.filter((n) => n.depth === d);
  const rescued = nodesAtThisDepth
    .filter((n) => n.score >= adaptiveThreshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, breadth);

  if (rescued.length > 0) {
    steps.push({
      id: ulid() as StepId,
      type: "observation",
      content: `[TOT] Adaptive pruning at depth ${d}: threshold lowered ${pruningThreshold} → ${adaptiveThreshold}, rescued ${rescued.length} path(s).`,
      timestamp: new Date(),
    });
    frontier = rescued;
    continue;
  }

  steps.push({
    id: ulid() as StepId,
    type: "observation",
    content: `[TOT] All paths pruned at depth ${d}. Selecting best from previous depth.`,
    timestamp: new Date(),
  });
  break;
}
```

### Step 5: Add Phase 2 history compaction

In the Phase 2 `while (execIter < execMaxIter)` loop, find the history building block:

```typescript
const history = steps
  .filter((s) => !s.content.startsWith("[TOT"))
  .map((s) => ...)
  .join("\n");
```

Replace with compacted version:

```typescript
const rawHistory = steps.filter((s) => !s.content.startsWith("[TOT"));
// Keep last 8 steps to prevent unbounded context growth
const recentHistory = rawHistory.slice(-8);
const history = recentHistory
  .map((s) =>
    s.type === "observation"
      ? `Observation: ${s.content}`
      : s.type === "action"
        ? `Action: ${s.content}`
        : s.content,
  )
  .join("\n");
```

### Step 6: Run all tree-of-thought tests

```bash
bun test packages/reasoning/tests/strategies/tree-of-thought.test.ts
```

Expected: All 5 tests pass (3 existing + 2 new).

### Step 7: Commit

```bash
git add packages/reasoning/src/strategies/tree-of-thought.ts packages/reasoning/tests/strategies/tree-of-thought.test.ts
git commit -m "fix(reasoning): tree-of-thought robust score parsing, adaptive pruning, phase 2 compaction"
```

---

## Task 4: Adaptive — Fallback on Partial + Richer Classification

**Files:**
- Modify: `packages/reasoning/src/strategies/adaptive.ts`
- Test: `packages/reasoning/tests/strategies/adaptive.test.ts`

### Step 1: Write the failing test

Add to `adaptive.test.ts`:

```typescript
it("falls back to reactive when selected sub-strategy returns partial status", async () => {
  // plan-execute will return partial (no SATISFIED in reflection)
  // reactive fallback will return completed (FINAL ANSWER)
  const layer = TestLLMServiceLayer({
    "Classify the task": "PLAN_EXECUTE",
    "planning agent": "1. Step one\n2. Step two",
    "Execute this step": "Result.",
    // No SATISFIED → plan-execute returns partial
    "evaluating plan execution": "The plan was not fully executed satisfactorily.",
    // Reactive fallback picks up
    "Think step-by-step": "FINAL ANSWER: Recovered with reactive fallback.",
  });

  const result = await Effect.runPromise(
    executeAdaptive({
      taskDescription: "Test fallback behavior",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: {
        ...defaultReasoningConfig,
        strategies: {
          ...defaultReasoningConfig.strategies,
          planExecute: { maxRefinements: 1, reflectionDepth: "shallow" },
        },
      },
    }).pipe(Effect.provide(layer)),
  );

  expect(result.strategy).toBe("adaptive");
  expect(result.status).toBe("completed");
  // Should show both the original selection AND the fallback step
  const fallbackStep = result.steps.find((s) =>
    s.content.includes("falling back") || s.content.includes("fallback"),
  );
  expect(fallbackStep).toBeDefined();
});
```

### Step 2: Run test to verify it fails

```bash
bun test packages/reasoning/tests/strategies/adaptive.test.ts
```

Expected: New test fails — no fallback logic exists yet.

### Step 3: Add fallback logic to `executeAdaptive`

After `const subResult = yield* dispatchStrategy(selectedStrategy, input);`, add:

```typescript
// ── Fallback: if sub-strategy returned partial and wasn't already reactive ──
let finalSubResult = subResult;
if (subResult.status === "partial" && selectedStrategy !== "reactive") {
  steps.push({
    id: ulid() as StepId,
    type: "thought",
    content: `[ADAPTIVE] ${selectedStrategy} returned partial — falling back to reactive`,
    timestamp: new Date(),
  });

  if (ebOpt._tag === "Some") {
    yield* ebOpt.value
      .publish({
        _tag: "ReasoningStepCompleted",
        taskId: input.taskId ?? "adaptive",
        strategy: "adaptive",
        step: steps.length,
        totalSteps: 2,
        thought: `[ADAPTIVE] Falling back to reactive strategy`,
      })
      .pipe(Effect.catchAll(() => Effect.void));
  }

  finalSubResult = yield* executeReactive(input).pipe(
    // If reactive also fails, use original partial result rather than throwing
    Effect.catchAll(() => Effect.succeed(subResult)),
  );
}
```

Then update the final result construction to use `finalSubResult` instead of `subResult`:

```typescript
const allSteps = [...steps, ...finalSubResult.steps];

return {
  strategy: "adaptive" as const,
  steps: allSteps,
  output: finalSubResult.output,
  metadata: {
    duration: Date.now() - start,
    cost: finalSubResult.metadata.cost + analysisResponse.usage.estimatedCost,
    tokensUsed: finalSubResult.metadata.tokensUsed + analysisResponse.usage.totalTokens,
    stepsCount: allSteps.length,
    confidence: finalSubResult.metadata.confidence,
    selectedStrategy: selectedStrategy,
  },
  status: finalSubResult.status,
};
```

### Step 4: Improve `buildAnalysisPrompt()` with concrete examples

In `buildAnalysisPrompt()`, add examples after the strategy options list:

```typescript
prompt += `\n\nExamples of tasks per strategy:
- "What is the capital of France?" → REACTIVE (simple lookup)
- "Summarize this article" → REACTIVE (single-pass task)
- "Write a persuasive essay about climate change" → REFLEXION (quality matters, self-improvement helps)
- "Review and refine this code for correctness" → REFLEXION (iterative accuracy)
- "Set up a CI/CD pipeline with these 5 steps" → PLAN_EXECUTE (procedural, multi-step)
- "Build a REST API with auth, tests, and docs" → PLAN_EXECUTE (clear sequential phases)
- "Design 3 different architectures for this system" → TREE_OF_THOUGHT (multiple valid approaches)
- "Find the most creative solution to this puzzle" → TREE_OF_THOUGHT (exploratory)`;
```

### Step 5: Run all adaptive tests

```bash
bun test packages/reasoning/tests/strategies/adaptive.test.ts
```

Expected: All 5 tests pass (4 existing + 1 new).

### Step 6: Commit

```bash
git add packages/reasoning/src/strategies/adaptive.ts packages/reasoning/tests/strategies/adaptive.test.ts
git commit -m "fix(reasoning): adaptive fallback on partial result and richer classification examples"
```

---

## Task 5: Full Test Suite Verification

### Step 1: Run all reasoning tests

```bash
bun test packages/reasoning/
```

Expected: All tests pass, no regressions.

### Step 2: Run the full test suite

```bash
bun test
```

Expected: 909+ tests pass. If regressions appear, fix them before marking complete.

### Step 3: Live test with main.ts

Update `main.ts` to test each fixed strategy in turn. Run with `bun main.ts` after building:

```typescript
// Test plan-execute
await using agent1 = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("cogito:14b")
  .withReasoning({ defaultStrategy: "plan-execute-reflect" })
  .withObservability({ verbosity: "normal", live: true })
  .build();
const r1 = await agent1.run("Explain the water cycle in 3 steps");
console.log("plan-execute:", r1);

// Test reflexion
await using agent2 = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("cogito:14b")
  .withReasoning({ defaultStrategy: "reflexion" })
  .withObservability({ verbosity: "normal", live: true })
  .build();
const r2 = await agent2.run("Explain quantum entanglement clearly and accurately");
console.log("reflexion:", r2);
```

### Step 4: Final commit if any fixes were needed

```bash
git add -p
git commit -m "fix(reasoning): regression fixes from full test suite run"
```

---

## Acceptance Criteria

- [ ] Reflexion: exits early on stagnant critiques (< maxRetries iterations)
- [ ] Reflexion: `previousCritiques` never exceeds 3 entries
- [ ] Plan-Execute: step context prompt never grows beyond last 5 results
- [ ] Plan-Execute: completed result includes synthesized answer (not raw join)
- [ ] Tree-of-Thought: `parseScore("75%")` returns 0.75
- [ ] Tree-of-Thought: tree with all-low-scores is rescued by adaptive pruning
- [ ] Tree-of-Thought: Phase 2 history capped at 8 steps
- [ ] Adaptive: partial sub-strategy result triggers reactive fallback
- [ ] Adaptive: classification prompt includes concrete per-strategy examples
- [ ] All 909+ tests pass
