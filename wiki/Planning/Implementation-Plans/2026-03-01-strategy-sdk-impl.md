# Strategy SDK: Shared Kernel & Utilities — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract a shared `react-kernel` execution primitive and utility library from the 5 reasoning strategies, so each strategy specializes in its algorithm while sharing tool execution, EventBus publishing, context compaction, and quality assessment.

**Architecture:** New `packages/reasoning/src/strategies/shared/` directory contains 6 files (tool-utils, quality-utils, context-utils, service-utils, step-utils, react-kernel) + barrel export. Reactive's inner ReAct loop is extracted into `react-kernel.ts`. Reflexion, Plan-Execute, and Tree-of-Thought are refactored to call the kernel for execution steps — giving them full tool awareness. See design doc: `spec/plans/2026-03-01-strategy-sdk-shared-kernel.md`.

**Tech Stack:** Effect-TS, Bun test runner, `TestLLMServiceLayer` from `@reactive-agents/llm-provider`, `ulid`

**Parallelization note:** Tasks 1–4 are fully independent and can be run in parallel via build-coordinator. Task 5 (kernel) depends on 1–4. Tasks 6–10 (strategy refactors) depend on 5 and can run in parallel. Task 11 (integration) is last.

---

## Task 1: shared/tool-utils.ts — Pure Tool Parsing & Formatting

**Files:**
- Create: `packages/reasoning/src/strategies/shared/tool-utils.ts`
- Create: `packages/reasoning/tests/strategies/shared/tool-utils.test.ts`

**Context:** `reactive.ts` has `parseToolRequest`, `parseAllToolRequests`, `parseToolRequestWithTransform`, `hasFinalAnswer`, `extractFinalAnswer`, `evaluateTransform`, `formatToolSchema`. `tree-of-thought.ts` duplicates almost all of these under `tot*` prefixes. These are all pure functions — no Effect, no services.

### Step 1: Write failing tests

Create `packages/reasoning/tests/strategies/shared/tool-utils.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import {
  parseToolRequest,
  parseAllToolRequests,
  hasFinalAnswer,
  extractFinalAnswer,
  evaluateTransform,
  formatToolSchemas,
} from "../../../src/strategies/shared/tool-utils.js";

describe("parseToolRequest", () => {
  it("parses simple tool request with JSON args", () => {
    const thought = `I'll write the file.\nACTION: file-write({"path": "./out.txt", "content": "hello"})`;
    const result = parseToolRequest(thought);
    expect(result).not.toBeNull();
    expect(result?.tool).toBe("file-write");
    expect(result?.input).toBe('{"path": "./out.txt", "content": "hello"}');
  });

  it("parses namespaced MCP tool names (github/list_commits)", () => {
    const thought = `ACTION: github/list_commits({"owner": "tylerjrbuell", "repo": "test"})`;
    const result = parseToolRequest(thought);
    expect(result?.tool).toBe("github/list_commits");
  });

  it("returns null when no ACTION present", () => {
    expect(parseToolRequest("Just a thought with no action.")).toBeNull();
  });

  it("extracts | transform: expression after args", () => {
    const thought = `ACTION: web-search({"query": "Effect TS"}) | transform: result.results[0].content`;
    const result = parseToolRequest(thought);
    expect(result?.transform).toBe("result.results[0].content");
  });

  it("handles no-arg tools with empty parens", () => {
    const thought = `ACTION: list_allowed_directories()`;
    const result = parseToolRequest(thought);
    expect(result?.tool).toBe("list_allowed_directories");
    expect(result?.input).toBe("{}");
  });
});

describe("parseAllToolRequests", () => {
  it("returns all ACTION requests in order", () => {
    const thought = `Step 1: ACTION: file-read({"path": "./a.txt"})\nStep 2: ACTION: file-write({"path": "./b.txt", "content": "x"})`;
    const results = parseAllToolRequests(thought);
    expect(results).toHaveLength(2);
    expect(results[0]?.tool).toBe("file-read");
    expect(results[1]?.tool).toBe("file-write");
  });

  it("returns empty array when no actions present", () => {
    expect(parseAllToolRequests("No tools here.")).toHaveLength(0);
  });

  it("handles transform in first action, plain in second", () => {
    const thought = `ACTION: web-search({"query": "test"}) | transform: result[0]\nACTION: file-write({"path": "./x"})`;
    const results = parseAllToolRequests(thought);
    expect(results[0]?.transform).toBe("result[0]");
    expect(results[1]?.transform).toBeUndefined();
  });
});

describe("hasFinalAnswer", () => {
  it("returns true for FINAL ANSWER: prefix", () => {
    expect(hasFinalAnswer("FINAL ANSWER: The answer is 42")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(hasFinalAnswer("Final Answer: done")).toBe(true);
  });

  it("returns false when absent", () => {
    expect(hasFinalAnswer("I'm still thinking...")).toBe(false);
  });
});

describe("extractFinalAnswer", () => {
  it("extracts text after FINAL ANSWER:", () => {
    const result = extractFinalAnswer("FINAL ANSWER: The water cycle has 3 stages.");
    expect(result).toBe("The water cycle has 3 stages.");
  });

  it("handles multiline answers", () => {
    const result = extractFinalAnswer("FINAL ANSWER: Step 1: do A\nStep 2: do B");
    expect(result).toBe("Step 1: do A\nStep 2: do B");
  });

  it("returns full text when no FINAL ANSWER: marker", () => {
    const text = "Just a response without the marker";
    expect(extractFinalAnswer(text)).toBe(text);
  });
});

describe("evaluateTransform", () => {
  it("evaluates a simple property access", () => {
    const result = evaluateTransform("result.title", { title: "Hello World" });
    expect(result).toBe("Hello World");
  });

  it("returns error string on invalid expression", () => {
    const result = evaluateTransform("result.x.y.z.undefined.property", null);
    expect(result).toContain("[Transform error:");
  });
});

describe("formatToolSchemas", () => {
  const schemas = [
    {
      name: "file-write",
      description: "Write content to a file",
      parameters: [
        { name: "path", type: "string", description: "File path", required: true },
        { name: "content", type: "string", description: "Content", required: true },
      ],
    },
  ];

  it("formats compact schema by default", () => {
    const result = formatToolSchemas(schemas);
    expect(result).toContain("file-write");
    expect(result).toContain("path");
  });

  it("formats verbose schema with parameter details", () => {
    const result = formatToolSchemas(schemas, true);
    expect(result).toContain("required");
    expect(result).toContain("Write content to a file");
  });
});
```

### Step 2: Run tests to verify they fail

```bash
bun test packages/reasoning/tests/strategies/shared/tool-utils.test.ts
```

Expected: `Cannot find module '../../../src/strategies/shared/tool-utils.js'`

### Step 3: Create `shared/tool-utils.ts`

Create `packages/reasoning/src/strategies/shared/tool-utils.ts`. Copy these functions verbatim from `reactive.ts` — **do not modify logic, only move and export**:

- `parseToolRequest` (line ~751) → export as-is
- `parseAllToolRequests` (line ~807) → export as-is
- `parseToolRequestWithTransform` (line ~822) → already exported in reactive.ts, re-export here
- `evaluateTransform` (already exported in reactive.ts) → re-export here
- `hasFinalAnswer` (line ~742) → export as-is
- `extractFinalAnswer` (line ~746) → export as-is

Add the new `formatToolSchemas` function:

```typescript
interface ToolParamSchema {
  readonly name: string;
  readonly type: string;
  readonly description?: string;
  readonly required?: boolean;
}

interface ToolSchema {
  readonly name: string;
  readonly description: string;
  readonly parameters: readonly ToolParamSchema[];
}

/** Format tool schemas for LLM consumption.
 * compact (default): "tool_name({param: type}) — description"
 * verbose: multi-line with required/optional markers
 */
export function formatToolSchemas(schemas: readonly ToolSchema[], verbose = false): string {
  if (verbose) {
    return schemas
      .map((s) => {
        const params = s.parameters
          .map((p) => `  - ${p.name} (${p.type}${p.required ? ", required" : ""}): ${p.description ?? ""}`)
          .join("\n");
        return `${s.name}: ${s.description}\n${params}`;
      })
      .join("\n\n");
  }
  return schemas
    .map((s) => {
      if (s.parameters.length === 0) return `- ${s.name}() — ${s.description}`;
      const params = s.parameters
        .map((p) => `"${p.name}": "${p.type}${p.required ? " (required)" : " (optional)"}"`)
        .join(", ");
      return `- ${s.name}({${params}}) — ${s.description}`;
    })
    .join("\n");
}
```

The file imports: nothing except the function bodies (all pure). Make sure all imports needed by the functions (none — they're pure) are included.

### Step 4: Run tests to verify pass

```bash
bun test packages/reasoning/tests/strategies/shared/tool-utils.test.ts
```

Expected: All tests pass.

### Step 5: Commit

```bash
git add packages/reasoning/src/strategies/shared/tool-utils.ts packages/reasoning/tests/strategies/shared/tool-utils.test.ts
git commit -m "feat(reasoning): shared/tool-utils — extract pure tool parsing from reactive and ToT"
```

---

## Task 2: shared/quality-utils.ts — Satisfaction & Score Parsing

**Files:**
- Create: `packages/reasoning/src/strategies/shared/quality-utils.ts`
- Create: `packages/reasoning/tests/strategies/shared/quality-utils.test.ts`

**Context:** `isSatisfied` is duplicated in `reflexion.ts` and `plan-execute.ts`. `isCritiqueStagnant` is in `reflexion.ts`. `parseScore` is in `tree-of-thought.ts`.

### Step 1: Write failing tests

Create `packages/reasoning/tests/strategies/shared/quality-utils.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { isSatisfied, isCritiqueStagnant, parseScore } from "../../../src/strategies/shared/quality-utils.js";

describe("isSatisfied", () => {
  it("returns true for SATISFIED: prefix", () => {
    expect(isSatisfied("SATISFIED: The response is complete and accurate.")).toBe(true);
  });

  it("returns true for SATISFIED with space", () => {
    expect(isSatisfied("SATISFIED The result meets requirements.")).toBe(true);
  });

  it("returns false for improvement-needed text", () => {
    expect(isSatisfied("The response needs more examples.")).toBe(false);
  });

  it("returns false for text that contains SATISFIED mid-sentence", () => {
    expect(isSatisfied("I am not satisfied with this response.")).toBe(false);
  });
});

describe("isCritiqueStagnant", () => {
  it("returns false when no previous critiques", () => {
    expect(isCritiqueStagnant([], "new critique")).toBe(false);
  });

  it("returns true when critique is identical to last", () => {
    const prev = ["The response lacks examples."];
    expect(isCritiqueStagnant(prev, "The response lacks examples.")).toBe(true);
  });

  it("returns true for normalized match (different whitespace/case)", () => {
    const prev = ["The response  lacks  examples."];
    expect(isCritiqueStagnant(prev, "the response lacks examples.")).toBe(true);
  });

  it("returns true when critique is 80%+ substring overlap with last", () => {
    const prev = ["The response is missing detail about quantum states and entanglement"];
    // New critique is mostly the same (first 80% matches)
    expect(isCritiqueStagnant(prev, "The response is missing detail about quantum states and entanglement phenomena")).toBe(true);
  });

  it("returns false for genuinely different critiques", () => {
    const prev = ["Lacks concrete examples"];
    expect(isCritiqueStagnant(prev, "Grammar and spelling errors throughout the text")).toBe(false);
  });

  it("only compares against the LAST critique, not all previous ones", () => {
    const prev = ["Old critique 1", "Old critique 2", "Recent: lacks depth"];
    // Same as "Old critique 1" but not same as most recent
    expect(isCritiqueStagnant(prev, "Old critique 1")).toBe(false);
  });
});

describe("parseScore", () => {
  it("parses percentage: '75%' → 0.75", () => {
    expect(parseScore("75%")).toBe(0.75);
  });

  it("parses ratio: '3/4' → 0.75", () => {
    expect(parseScore("3/4")).toBeCloseTo(0.75);
  });

  it("parses decimal: '0.8' → 0.8", () => {
    expect(parseScore("0.8")).toBe(0.8);
  });

  it("parses labeled decimal: 'Score: 0.7' → 0.7", () => {
    expect(parseScore("Score: 0.7")).toBe(0.7);
  });

  it("parses labeled integer (0–10 scale): 'Rating: 7' → 0.7", () => {
    expect(parseScore("Rating: 7")).toBeCloseTo(0.7);
  });

  it("clamps to [0, 1]: '150%' → 1.0", () => {
    expect(parseScore("150%")).toBe(1.0);
  });

  it("strips <think>...</think> tags before parsing", () => {
    expect(parseScore("<think>Some reasoning here</think>\n0.8")).toBe(0.8);
  });

  it("returns 0.5 as safe default for unparseable input", () => {
    expect(parseScore("I think this response is quite good")).toBe(0.5);
  });

  it("returns 0.5 for empty string", () => {
    expect(parseScore("")).toBe(0.5);
  });
});
```

### Step 2: Run tests to verify they fail

```bash
bun test packages/reasoning/tests/strategies/shared/quality-utils.test.ts
```

### Step 3: Create `shared/quality-utils.ts`

Create `packages/reasoning/src/strategies/shared/quality-utils.ts`:

```typescript
// File: src/strategies/shared/quality-utils.ts
/**
 * Shared quality assessment utilities.
 * Used by: Reflexion (isSatisfied, isCritiqueStagnant),
 *           Plan-Execute (isSatisfied), Tree-of-Thought (parseScore).
 */

/**
 * Returns true if the LLM response signals that the task is complete.
 * Matches "SATISFIED:" or "SATISFIED " at the start of the text (line-level).
 */
export function isSatisfied(text: string): boolean {
  return /^SATISFIED[:\s]/m.test(text.trim());
}

/**
 * Detects stagnant critiques — if the new critique is substantially the same
 * as the most recent previous one, further retries won't improve the response.
 * Uses normalized substring matching (no heavy Levenshtein needed).
 */
export function isCritiqueStagnant(
  previousCritiques: string[],
  newCritique: string,
): boolean {
  if (previousCritiques.length === 0) return false;
  const lastCritique = previousCritiques[previousCritiques.length - 1]!;
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const a = normalize(lastCritique);
  const b = normalize(newCritique);
  if (a === b) return true;
  // 80% overlap check: if the shorter string's first 80% appears in the longer one
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (
    shorter.length > 20 &&
    longer.includes(shorter.slice(0, Math.floor(shorter.length * 0.8)))
  ) {
    return true;
  }
  return false;
}

/**
 * Robustly parse an LLM-produced score into a [0, 1] float.
 * Handles: "75%", "3/4", "0.8", ".75", "Score: 0.7", "Rating: 7", "1"
 * Strips <think>...</think> tags (some LLMs wrap reasoning in them).
 * Returns 0.5 as a safe default for unparseable input.
 */
export function parseScore(text: string): number {
  // Strip think tags
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
  const labeledMatch = target.match(
    /(?:score|rating|value|grade)\s*[:=]\s*(\d+(?:\.\d+)?)/i,
  );
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

### Step 4: Run tests

```bash
bun test packages/reasoning/tests/strategies/shared/quality-utils.test.ts
```

Expected: All tests pass.

### Step 5: Commit

```bash
git add packages/reasoning/src/strategies/shared/quality-utils.ts packages/reasoning/tests/strategies/shared/quality-utils.test.ts
git commit -m "feat(reasoning): shared/quality-utils — isSatisfied, isCritiqueStagnant, parseScore"
```

---

## Task 3: shared/context-utils.ts — History Compaction

**Files:**
- Create: `packages/reasoning/src/strategies/shared/context-utils.ts`
- Create: `packages/reasoning/tests/strategies/shared/context-utils.test.ts`

**Context:** `reactive.ts` has `buildCompactedContext(initialContext, steps, profile)` at line ~1061. `plan-execute.ts` has `buildCompactedStepContext(stepResults: string[])`. `tree-of-thought.ts` has `rawHistory.slice(-8)` inline. All do the same thing: keep recent steps in full, summarize older ones.

### Step 1: Write failing tests

Create `packages/reasoning/tests/strategies/shared/context-utils.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { buildCompactedContext, formatStepForContext } from "../../../src/strategies/shared/context-utils.js";

const makeStep = (type: string, content: string) => ({
  id: "01JTEST",
  type,
  content,
  timestamp: new Date(),
});

describe("buildCompactedContext", () => {
  it("returns initialContext + formatted steps when steps are few", () => {
    const steps = [
      makeStep("thought", "I'll search for this"),
      makeStep("observation", "Search returned 3 results"),
    ];
    const result = buildCompactedContext("Task: find info", steps as any, undefined);
    expect(result).toContain("Task: find info");
    expect(result).toContain("Search returned 3 results");
    expect(result).not.toContain("[Earlier steps summary");
  });

  it("compacts older steps when over compactAfterSteps threshold", () => {
    const steps = Array.from({ length: 8 }, (_, i) =>
      makeStep(i % 2 === 0 ? "thought" : "observation", `Content for step ${i + 1}`),
    );
    const result = buildCompactedContext("Task: test", steps as any, {
      compactAfterSteps: 6,
      fullDetailSteps: 4,
    } as any);
    expect(result).toContain("[Earlier steps summary");
    expect(result).toContain("[Recent steps]");
    // Recent 4 steps should be in full detail
    expect(result).toContain("Content for step 5");
    expect(result).toContain("Content for step 8");
  });

  it("handles empty steps gracefully", () => {
    const result = buildCompactedContext("Task: empty", [], undefined);
    expect(result).toBe("Task: empty");
  });

  it("uses default thresholds when no profile provided", () => {
    // Default: compactAfterSteps=6, fullDetailSteps=4
    const steps = Array.from({ length: 7 }, (_, i) =>
      makeStep("thought", `Step ${i + 1}`),
    );
    const result = buildCompactedContext("Task", steps as any, undefined);
    expect(result).toContain("[Earlier steps summary");
  });
});

describe("formatStepForContext", () => {
  it("prefixes observations with 'Observation:'", () => {
    const step = makeStep("observation", "Tool returned 5 results");
    expect(formatStepForContext(step as any)).toContain("Observation:");
  });

  it("prefixes actions with 'Action:'", () => {
    const step = makeStep("action", "ACTION: file-write(...)");
    expect(formatStepForContext(step as any)).toContain("Action:");
  });

  it("returns thought content as-is", () => {
    const step = makeStep("thought", "I should search first.");
    expect(formatStepForContext(step as any)).toBe("I should search first.");
  });
});
```

### Step 2: Run tests to verify they fail

```bash
bun test packages/reasoning/tests/strategies/shared/context-utils.test.ts
```

### Step 3: Create `shared/context-utils.ts`

Copy `buildCompactedContext` and `formatStepForContext` verbatim from `reactive.ts` (lines ~1061–1095), make them exported, and parameterize the profile type:

```typescript
// File: src/strategies/shared/context-utils.ts
import type { ReasoningStep } from "../../types/index.js";
import type { ContextProfile } from "../../context/context-profile.js";

/**
 * Format a single reasoning step in ReAct style for inclusion in context.
 * Observations get "Observation:" prefix; actions get "Action:" prefix;
 * thoughts are returned as-is.
 */
export function formatStepForContext(step: ReasoningStep): string {
  if (step.type === "observation") return `Observation: ${step.content}`;
  if (step.type === "action") return `Action: ${step.content}`;
  return step.content;
}

/**
 * Build a compacted context string from initial context + step history.
 * Keeps the most recent `fullDetailSteps` steps in full detail (ReAct format).
 * Older steps are summarized to one line each to prevent O(n²) token growth.
 *
 * Thresholds come from the context profile (defaults: compactAfterSteps=6, fullDetailSteps=4).
 */
export function buildCompactedContext(
  initialContext: string,
  steps: readonly ReasoningStep[],
  profile: Pick<ContextProfile, "compactAfterSteps" | "fullDetailSteps"> | undefined,
): string {
  const compactAfterSteps = profile?.compactAfterSteps ?? 6;
  const fullDetailSteps = profile?.fullDetailSteps ?? 4;

  if (steps.length === 0) return initialContext;

  if (steps.length <= compactAfterSteps) {
    const stepLines = steps.map(formatStepForContext).join("\n");
    return `${initialContext}\n\n${stepLines}`;
  }

  const cutoff = steps.length - fullDetailSteps;
  const oldSteps = steps.slice(0, cutoff);
  const recentSteps = steps.slice(cutoff);

  const summaryLines = oldSteps.map((s) => {
    const formatted = formatStepForContext(s);
    return formatted.length > 120 ? formatted.slice(0, 120) + "..." : formatted;
  });
  const summary = `[Earlier steps summary — ${oldSteps.length} steps]:\n${summaryLines.join("\n")}`;
  const recentLines = recentSteps.map(formatStepForContext).join("\n");

  return `${initialContext}\n\n${summary}\n\n[Recent steps]:\n${recentLines}`;
}
```

### Step 4: Run tests

```bash
bun test packages/reasoning/tests/strategies/shared/context-utils.test.ts
```

Expected: All tests pass.

### Step 5: Commit

```bash
git add packages/reasoning/src/strategies/shared/context-utils.ts packages/reasoning/tests/strategies/shared/context-utils.test.ts
git commit -m "feat(reasoning): shared/context-utils — unified buildCompactedContext"
```

---

## Task 4: shared/service-utils.ts + shared/step-utils.ts

**Files:**
- Create: `packages/reasoning/src/strategies/shared/service-utils.ts`
- Create: `packages/reasoning/src/strategies/shared/step-utils.ts`
- Create: `packages/reasoning/tests/strategies/shared/step-utils.test.ts`

**Context:** All 5 strategies open with ~20 lines of identical service resolution. `compilePromptOrFallback` is copy-pasted. EventBus publish is `if (ebOpt._tag === "Some") { yield* ... .catchAll(() => void) }` repeated 20+ times.

### Step 1: Write failing tests

Create `packages/reasoning/tests/strategies/shared/step-utils.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { makeStep, buildStrategyResult } from "../../../src/strategies/shared/step-utils.js";
import { publishReasoningStep } from "../../../src/strategies/shared/service-utils.js";

describe("makeStep", () => {
  it("creates step with correct type and content", () => {
    const step = makeStep("thought", "I should search for this");
    expect(step.type).toBe("thought");
    expect(step.content).toBe("I should search for this");
  });

  it("generates a valid non-empty id", () => {
    const step = makeStep("observation", "result here");
    expect(step.id).toBeTruthy();
    expect(typeof step.id).toBe("string");
  });

  it("sets timestamp to roughly now", () => {
    const before = Date.now();
    const step = makeStep("action", "ACTION: file-write(...)");
    const after = Date.now();
    expect(step.timestamp.getTime()).toBeGreaterThanOrEqual(before);
    expect(step.timestamp.getTime()).toBeLessThanOrEqual(after);
  });

  it("includes metadata when provided", () => {
    const step = makeStep("action", "ACTION: file-write(...)", { toolUsed: "file-write" });
    expect(step.metadata?.toolUsed).toBe("file-write");
  });
});

describe("buildStrategyResult", () => {
  it("builds a valid ReasoningResult with completed status", () => {
    const result = buildStrategyResult({
      strategy: "reflexion",
      steps: [],
      output: "The answer",
      status: "completed",
      start: Date.now() - 1000,
      totalTokens: 500,
      totalCost: 0.001,
    });
    expect(result.strategy).toBe("reflexion");
    expect(result.status).toBe("completed");
    expect(result.metadata.tokensUsed).toBe(500);
    expect(result.metadata.cost).toBeCloseTo(0.001);
    expect(result.metadata.confidence).toBe(0.8);
    expect(result.metadata.duration).toBeGreaterThan(0);
  });

  it("uses 0.4 confidence for partial status", () => {
    const result = buildStrategyResult({
      strategy: "reflexion",
      steps: [],
      output: null,
      status: "partial",
      start: Date.now(),
      totalTokens: 100,
      totalCost: 0,
    });
    expect(result.metadata.confidence).toBe(0.4);
  });

  it("merges extraMetadata into result metadata", () => {
    const result = buildStrategyResult({
      strategy: "adaptive",
      steps: [],
      output: "done",
      status: "completed",
      start: Date.now(),
      totalTokens: 200,
      totalCost: 0,
      extraMetadata: { selectedStrategy: "reflexion", fallbackOccurred: false },
    });
    expect((result.metadata as any).selectedStrategy).toBe("reflexion");
    expect((result.metadata as any).fallbackOccurred).toBe(false);
  });

  it("sets stepsCount from steps array length", () => {
    const steps = [makeStep("thought", "a"), makeStep("observation", "b")];
    const result = buildStrategyResult({
      strategy: "reactive",
      steps,
      output: "x",
      status: "completed",
      start: Date.now(),
      totalTokens: 0,
      totalCost: 0,
    });
    expect(result.metadata.stepsCount).toBe(2);
  });
});

describe("publishReasoningStep", () => {
  it("completes without error when eventBus is None", async () => {
    const noneEventBus = { _tag: "None" as const };
    await Effect.runPromise(
      publishReasoningStep(noneEventBus as any, {
        _tag: "ReasoningStepCompleted",
        taskId: "test",
        strategy: "reactive",
        step: 1,
        totalSteps: 5,
        thought: "test thought",
      } as any),
    );
    // Should complete without throwing
  });
});
```

### Step 2: Run tests to verify they fail

```bash
bun test packages/reasoning/tests/strategies/shared/step-utils.test.ts
```

### Step 3: Create `shared/step-utils.ts`

Create `packages/reasoning/src/strategies/shared/step-utils.ts`:

```typescript
// File: src/strategies/shared/step-utils.ts
import { ulid } from "ulid";
import type { ReasoningResult, ReasoningStep, ReasoningStrategy } from "../../types/index.js";
import type { StepId } from "../../types/step.js";

/**
 * Create a ReasoningStep with auto-generated id and current timestamp.
 * Replaces the repeated `{ id: ulid() as StepId, type, content, timestamp: new Date() }` pattern.
 */
export function makeStep(
  type: ReasoningStep["type"],
  content: string,
  metadata?: ReasoningStep["metadata"],
): ReasoningStep {
  return {
    id: ulid() as StepId,
    type,
    content,
    timestamp: new Date(),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

/**
 * Build the final ReasoningResult consistently across all strategies.
 * Handles confidence scoring (completed → 0.8, partial → 0.4) and
 * merges any strategy-specific extraMetadata (e.g. selectedStrategy, fallbackOccurred).
 */
export function buildStrategyResult(params: {
  strategy: ReasoningStrategy;
  steps: ReasoningStep[];
  output: unknown;
  status: "completed" | "partial" | "failed";
  /** Date.now() captured at strategy start */
  start: number;
  totalTokens: number;
  totalCost: number;
  /** Strategy-specific metadata fields (adaptive: selectedStrategy, fallbackOccurred) */
  extraMetadata?: Record<string, unknown>;
}): ReasoningResult {
  return {
    strategy: params.strategy,
    steps: [...params.steps],
    output: params.output,
    metadata: {
      duration: Date.now() - params.start,
      cost: params.totalCost,
      tokensUsed: params.totalTokens,
      stepsCount: params.steps.length,
      confidence: params.status === "completed" ? 0.8 : 0.4,
      ...params.extraMetadata,
    },
    status: params.status,
  };
}
```

### Step 4: Create `shared/service-utils.ts`

Create `packages/reasoning/src/strategies/shared/service-utils.ts`:

```typescript
// File: src/strategies/shared/service-utils.ts
import { Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { ToolService } from "@reactive-agents/tools";
import { PromptService } from "@reactive-agents/prompts";
import { EventBus } from "@reactive-agents/core";

// ── Internal types mirroring how strategies access optional services ──

type MaybeService<T> = { _tag: "Some"; value: T } | { _tag: "None" };

type ToolServiceInstance = {
  readonly execute: (input: {
    toolName: string;
    arguments: Record<string, unknown>;
    agentId: string;
    sessionId: string;
  }) => Effect.Effect<{ result: unknown; success?: boolean }, unknown>;
  readonly getTool: (name: string) => Effect.Effect<{
    parameters: Array<{ name: string; type: string; required?: boolean }>;
  }, unknown>;
};

type PromptServiceInstance = {
  compile: (
    id: string,
    vars: Record<string, unknown>,
    options?: { tier?: string },
  ) => Effect.Effect<{ content: string }, unknown>;
};

type EventBusInstance = {
  publish: (event: unknown) => Effect.Effect<void, unknown>;
};

export type StrategyServices = {
  llm: LLMService["Service"];
  toolService: MaybeService<ToolServiceInstance>;
  promptService: MaybeService<PromptServiceInstance>;
  eventBus: MaybeService<EventBusInstance>;
};

/**
 * Resolve all optional services needed by reasoning strategies in a single Effect call.
 * Replaces the identical ~20-line service acquisition block in every strategy file.
 */
export const resolveStrategyServices: Effect.Effect<
  StrategyServices,
  never,
  LLMService
> = Effect.gen(function* () {
  const llm = yield* LLMService;

  const toolServiceOptRaw = yield* Effect.serviceOption(ToolService);
  const toolService = toolServiceOptRaw as MaybeService<ToolServiceInstance>;

  const promptServiceOptRaw = yield* Effect.serviceOption(PromptService).pipe(
    Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
  );
  const promptService = promptServiceOptRaw as MaybeService<PromptServiceInstance>;

  const ebOptRaw = yield* Effect.serviceOption(EventBus).pipe(
    Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
  );
  const eventBus = ebOptRaw as MaybeService<EventBusInstance>;

  return { llm, toolService, promptService, eventBus };
});

/**
 * Compile a prompt template with fallback to a hardcoded string.
 * Replaces the identical compilePromptOrFallback() defined in all 5 strategy files.
 */
export function compilePromptOrFallback(
  promptService: MaybeService<PromptServiceInstance>,
  templateId: string,
  variables: Record<string, unknown>,
  fallback: string,
  tier?: string,
): Effect.Effect<string, never> {
  if (promptService._tag === "None") {
    return Effect.succeed(fallback);
  }
  return promptService.value
    .compile(templateId, variables, tier ? { tier } : undefined)
    .pipe(
      Effect.map((compiled) => compiled.content),
      Effect.catchAll(() => Effect.succeed(fallback)),
    );
}

/**
 * Publish a reasoning step event to EventBus if available.
 * Replaces the repeated `if (eb._tag === "Some") { yield* eb.value.publish(...).catchAll(void) }` pattern.
 */
export function publishReasoningStep(
  eventBus: MaybeService<EventBusInstance>,
  payload: unknown,
): Effect.Effect<void, never> {
  if (eventBus._tag === "None") return Effect.void;
  return eventBus.value.publish(payload).pipe(Effect.catchAll(() => Effect.void));
}
```

### Step 5: Run tests

```bash
bun test packages/reasoning/tests/strategies/shared/step-utils.test.ts
```

Expected: All tests pass.

### Step 6: Commit

```bash
git add packages/reasoning/src/strategies/shared/service-utils.ts packages/reasoning/src/strategies/shared/step-utils.ts packages/reasoning/tests/strategies/shared/step-utils.test.ts
git commit -m "feat(reasoning): shared/service-utils and step-utils — eliminate boilerplate across all strategies"
```

---

## Task 5: shared/react-kernel.ts — The Execution Primitive

**Files:**
- Create: `packages/reasoning/src/strategies/shared/react-kernel.ts`
- Create: `packages/reasoning/tests/strategies/shared/react-kernel.test.ts`

**Context:** This is the core extraction. The kernel is `reactive.ts`'s inner loop (lines ~95–390) made reusable. Key components to move into the kernel: the think→act→observe loop, `runToolObservation` (lines ~410–535), `resolveToolArgs` (lines ~535–605). The kernel takes `task`, `priorContext`, `availableToolSchemas`, `maxIterations` as input instead of the full `ReactiveInput`.

**Important:** Do NOT modify `reactive.ts` yet in this task — just create the kernel as a new file. Reactive will be refactored in Task 6.

### Step 1: Write failing tests

Create `packages/reasoning/tests/strategies/shared/react-kernel.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { executeReActKernel } from "../../../src/strategies/shared/react-kernel.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

describe("executeReActKernel", () => {
  it("produces a final answer for a simple task (no tools)", async () => {
    const layer = TestLLMServiceLayer({
      "Task:": "FINAL ANSWER: The answer is 42.",
    });
    const result = await Effect.runPromise(
      executeReActKernel({
        task: "What is 6 times 7?",
        maxIterations: 3,
      }).pipe(Effect.provide(layer)),
    );
    expect(result.output).toBe("The answer is 42.");
    expect(result.terminatedBy).toBe("final_answer");
    expect(result.iterations).toBe(1);
  });

  it("terminates at maxIterations when no final answer produced", async () => {
    const layer = TestLLMServiceLayer({
      "Task:": "I need to think more about this complex problem.",
    });
    const result = await Effect.runPromise(
      executeReActKernel({
        task: "Solve an extremely hard problem",
        maxIterations: 2,
      }).pipe(Effect.provide(layer)),
    );
    expect(result.terminatedBy).toBe("max_iterations");
    expect(result.iterations).toBe(2);
    expect(result.steps.length).toBe(2);
  });

  it("injects priorContext into the thought prompt", async () => {
    // The TestLLM matches on "critique says" — proving priorContext was injected
    const layer = TestLLMServiceLayer({
      "critique says": "FINAL ANSWER: Improved response incorporating the critique feedback.",
    });
    const result = await Effect.runPromise(
      executeReActKernel({
        task: "Explain quantum computing",
        priorContext: "A previous critique says: add more concrete examples",
        maxIterations: 2,
      }).pipe(Effect.provide(layer)),
    );
    expect(result.output).toContain("Improved response");
    expect(result.terminatedBy).toBe("final_answer");
  });

  it("records steps for each iteration", async () => {
    const layer = TestLLMServiceLayer({
      "Task:": "FINAL ANSWER: Done.",
    });
    const result = await Effect.runPromise(
      executeReActKernel({ task: "Simple task", maxIterations: 3 }).pipe(
        Effect.provide(layer),
      ),
    );
    expect(result.steps.length).toBeGreaterThanOrEqual(1);
    expect(result.steps[0]?.type).toBe("thought");
  });

  it("returns tokens and cost from LLM usage", async () => {
    const layer = TestLLMServiceLayer({
      "Task:": "FINAL ANSWER: Result.",
    });
    const result = await Effect.runPromise(
      executeReActKernel({ task: "Simple task" }).pipe(Effect.provide(layer)),
    );
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  it("handles early end_turn termination on substantive response (no tools)", async () => {
    // end_turn with ≥50 chars and no tool call should terminate as "end_turn"
    const longResponse = "A".repeat(60);
    const layer = TestLLMServiceLayer({
      "Task:": longResponse,
    });
    const result = await Effect.runPromise(
      executeReActKernel({ task: "Simple task", maxIterations: 3 }).pipe(
        Effect.provide(layer),
      ),
    );
    // Either end_turn or final_answer depending on mock behavior — just verify it terminates
    expect(["end_turn", "final_answer", "max_iterations"]).toContain(result.terminatedBy);
  });
});
```

### Step 2: Run tests to verify they fail

```bash
bun test packages/reasoning/tests/strategies/shared/react-kernel.test.ts
```

### Step 3: Create `shared/react-kernel.ts`

Create `packages/reasoning/src/strategies/shared/react-kernel.ts`. This extracts the inner loop from `reactive.ts`. Structure:

```typescript
// File: src/strategies/shared/react-kernel.ts
/**
 * ReAct Kernel — the shared execution primitive for all reasoning strategies.
 *
 * Implements: Think → Parse Action → Execute Tool → Observe → Repeat
 *
 * This kernel is what makes every strategy "tool-aware". Strategies define
 * their outer control loop (how many kernel calls, when to retry, how to
 * assess quality). The kernel handles all tool interaction.
 *
 * Extracted from reactive.ts's inner loop. Uses the full tool execution pipeline:
 * - Tool result compression (JSON array/object/text previews)
 * - Scratchpad overflow storage (auto-stores large results as _tool_result_N)
 * - Pipe transform evaluation (| transform: expr)
 * - Completed action deduplication
 * - Stop sequences to prevent observation hallucination
 */
import { Effect } from "effect";
import type { ReasoningResult, ReasoningStep } from "../../types/index.js";
import type { ResultCompressionConfig, ToolDefinition, ToolOutput } from "@reactive-agents/tools";
import { ToolService } from "@reactive-agents/tools";
import { LLMService } from "@reactive-agents/llm-provider";
import { compressToolResult } from "@reactive-agents/tools";  // import from tools package
import { ExecutionError } from "../../errors/errors.js";
import type { ContextProfile } from "../../context/context-profile.js";
import { CONTEXT_PROFILES } from "../../context/context-profile.js";
import { categorizeToolName, deriveResultKind } from "../../types/observation.js";
import type { ObservationResult } from "../../types/observation.js";
import {
  parseAllToolRequests,
  hasFinalAnswer,
  extractFinalAnswer,
  evaluateTransform,
  formatToolSchemas,
} from "./tool-utils.js";
import { resolveStrategyServices } from "./service-utils.js";
import { publishReasoningStep } from "./service-utils.js";
import { makeStep } from "./step-utils.js";
import { buildCompactedContext } from "./context-utils.js";

// ... (ToolSchema type, ToolServiceInstance type — copy from reactive.ts)
// ... (resolveToolArgs — copy from reactive.ts lines 535–605)
// ... (runKernelToolObservation — adapted from runToolObservation in reactive.ts)
// ... (main executeReActKernel function)
```

**Implementation guidance:** The body of `executeReActKernel` is the `while (iteration < maxIter)` loop from `reactive.ts` starting at line ~100, with these changes:
1. Replace `input.config.strategies.reactive.maxIterations` with `input.maxIterations ?? 5`
2. Replace `input.config.strategies.reactive.temperature` with `input.temperature ?? 0.7`
3. Replace `buildInitialContext(input, ...)` with directly building: `Task: ${task}\n\n${priorContext ?? ""}\n\nTools: ${formatToolSchemas(...)}`
4. Keep `buildCompactedContext` but import from context-utils instead of local
5. Keep `runToolObservation` but rename to `runKernelToolObservation` (private to this file)
6. Keep `resolveToolArgs` (private to this file, needs ToolService)
7. Replace `strategy: "reactive"` in EventBus payloads with `parentStrategy ?? "kernel"`

The interface:

```typescript
export interface ReActKernelInput {
  /** The task or sub-task to solve. */
  task: string;
  /** System prompt for the LLM (fully composed by outer strategy). */
  systemPrompt?: string;
  /** Tool schemas (enables tool use; omit for pure-LLM execution). */
  availableToolSchemas?: readonly ToolSchema[];
  /**
   * Additional context injected before the think loop.
   * Reflexion: inject critiques. Plan-Execute: inject step context.
   * Tree-of-Thought: inject best path from Phase 1.
   */
  priorContext?: string;
  /** Max think→act→observe iterations (default: 5). */
  maxIterations?: number;
  /** Context profile for model-adaptive compaction thresholds (default: "mid"). */
  contextProfile?: ContextProfile;
  /** Tool result compression config (default: budget=800, previewItems=3). */
  resultCompression?: ResultCompressionConfig;
  /** Temperature for thought generation (default: 0.7). */
  temperature?: number;
  /** TaskId for EventBus correlation. */
  taskId?: string;
  /** Parent strategy name for step tagging. */
  parentStrategy?: string;
}

export interface ReActKernelResult {
  output: string;
  steps: ReasoningStep[];
  totalTokens: number;
  totalCost: number;
  toolsUsed: string[];
  iterations: number;
  terminatedBy: "final_answer" | "max_iterations" | "end_turn";
}

export const executeReActKernel = (
  input: ReActKernelInput,
): Effect.Effect<ReActKernelResult, ExecutionError, LLMService> =>
  Effect.gen(function* () {
    // ... implementation
  });
```

### Step 4: Run kernel tests

```bash
bun test packages/reasoning/tests/strategies/shared/react-kernel.test.ts
```

Expected: All 6 kernel tests pass.

### Step 5: Run full reasoning test suite (verify no regressions)

```bash
bun test packages/reasoning/
```

Expected: All existing tests pass. The kernel is new code — existing strategies are unchanged.

### Step 6: Create barrel export

Create `packages/reasoning/src/strategies/shared/index.ts`:

```typescript
export * from "./tool-utils.js";
export * from "./quality-utils.js";
export * from "./context-utils.js";
export * from "./service-utils.js";
export * from "./step-utils.js";
export * from "./react-kernel.js";
```

### Step 7: Commit

```bash
git add packages/reasoning/src/strategies/shared/react-kernel.ts packages/reasoning/src/strategies/shared/index.ts packages/reasoning/tests/strategies/shared/react-kernel.test.ts
git commit -m "feat(reasoning): shared/react-kernel — extracted ReAct execution primitive from reactive.ts"
```

---

## Task 6: Refactor reactive.ts — Use Shared Utils (No Algorithm Change)

**Files:**
- Modify: `packages/reasoning/src/strategies/reactive.ts`

**Goal:** Replace duplicated code in reactive.ts with shared imports. The algorithm does NOT change.

### Step 1: Run existing reactive tests to establish baseline

```bash
bun test packages/reasoning/tests/strategies/reactive.test.ts
bun test packages/reasoning/tests/strategies/reactive-tool-integration.test.ts
bun test packages/reasoning/tests/strategies/reactive-compression.test.ts
bun test packages/reasoning/tests/strategies/reactive-context-engineering.test.ts
```

Note how many tests pass.

### Step 2: Replace private helpers with shared imports

In `reactive.ts`, add these imports at the top:

```typescript
import {
  parseToolRequest,
  parseAllToolRequests,
  parseToolRequestWithTransform,
  evaluateTransform,
  hasFinalAnswer,
  extractFinalAnswer,
} from "./shared/tool-utils.js";
import { buildCompactedContext, formatStepForContext } from "./shared/context-utils.js";
import { compilePromptOrFallback } from "./shared/service-utils.js";
import { makeStep } from "./shared/step-utils.js";
```

Then **delete** these private function definitions from reactive.ts (they are now imported):
- `hasFinalAnswer` (line ~742)
- `extractFinalAnswer` (line ~746)
- `parseToolRequest` (line ~751) — **keep the export wrapper that re-exports from shared**
- `parseAllToolRequests` (line ~807)
- `parseToolRequestWithTransform` (line ~822) — **keep as re-export for backwards compat**
- `evaluateTransform` — **keep as re-export for backwards compat**
- `formatStepForContext` (line ~1055)
- `buildCompactedContext` (line ~1061)

For functions that are currently exported from reactive.ts and used externally (`parseToolRequestWithTransform`, `evaluateTransform`), keep them as re-exports:

```typescript
// Re-export shared utilities for backwards compatibility
export { parseToolRequestWithTransform, evaluateTransform } from "./shared/tool-utils.js";
```

Replace all `steps.push({ id: ulid() as StepId, type: ..., content: ..., timestamp: new Date() })` with `steps.push(makeStep(type, content))`.

Replace the service resolution block (the ~20 lines at the top of `executeReactive`) with:

```typescript
const { llm, toolService: toolServiceOpt, promptService: promptServiceOpt, eventBus: ebOpt } =
  yield* resolveStrategyServices;
const profile: ContextProfile = input.contextProfile ?? CONTEXT_PROFILES["mid"];
```

Keep `compilePromptOrFallback` calls — they now use the imported version.

**Do NOT change** the algorithm, loop logic, prompt content, `buildInitialContext`, `buildCompletedSummary`, `getRulesForComplexity`, `runToolObservation`, `resolveToolArgs`, or `buildResult`.

### Step 3: Run all reactive tests

```bash
bun test packages/reasoning/tests/strategies/reactive.test.ts
bun test packages/reasoning/tests/strategies/reactive-tool-integration.test.ts
bun test packages/reasoning/tests/strategies/reactive-compression.test.ts
bun test packages/reasoning/tests/strategies/reactive-context-engineering.test.ts
```

Expected: Same number of tests pass as in Step 1. Zero regressions.

### Step 4: Commit

```bash
git add packages/reasoning/src/strategies/reactive.ts
git commit -m "refactor(reasoning): reactive.ts uses shared utilities (no algorithm change)"
```

---

## Task 7: Refactor reflexion.ts — Tool-Aware via ReAct Kernel

**Files:**
- Modify: `packages/reasoning/src/strategies/reflexion.ts`
- Modify: `packages/reasoning/tests/strategies/reflexion.test.ts`

**Goal:** Reflexion's generation and improvement passes call `executeReActKernel` instead of a single `llm.complete`. Critique pass stays as a pure LLM call (no tools needed for quality judgment). This makes Reflexion tool-aware for the first time.

### Step 1: Write 2 new failing tests for tool-aware reflexion

Add to `packages/reasoning/tests/strategies/reflexion.test.ts`:

```typescript
it("generation pass uses tool schemas when available in input", async () => {
  // Verify that the strategy accepts availableToolSchemas
  // (kernel integration — tools would be available in the generation loop)
  const layer = TestLLMServiceLayer({
    "Critically evaluate": "SATISFIED: The response is thorough and well-researched.",
    default: "FINAL ANSWER: A complete response generated with tool awareness.",
  });

  const result = await Effect.runPromise(
    executeReflexion({
      taskDescription: "Research and explain quantum computing",
      taskType: "research",
      memoryContext: "",
      availableTools: [],
      availableToolSchemas: [
        { name: "web-search", description: "Search the web", parameters: [] },
      ],
      config: defaultReasoningConfig,
    }).pipe(Effect.provide(layer)),
  );

  expect(result.strategy).toBe("reflexion");
  expect(result.status).toBe("completed");
});

it("improvement pass includes critique in the task context", async () => {
  let capturedContext = "";
  const layer = TestLLMServiceLayer({
    "Critically evaluate": "The response lacks concrete examples of quantum entanglement.",
    // Second call (improvement): critique should be visible
    "quantum entanglement": (prompt: string) => {
      capturedContext = prompt;
      return "FINAL ANSWER: Improved explanation with entanglement examples.";
    },
    default: "Initial response about quantum computing.",
  });

  const result = await Effect.runPromise(
    executeReflexion({
      taskDescription: "Explain quantum entanglement",
      taskType: "explanation",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
    }).pipe(Effect.provide(layer)),
  );

  expect(result.status).toBe("completed");
  expect(result.output).toContain("Improved explanation");
});
```

### Step 2: Run tests to check baseline

```bash
bun test packages/reasoning/tests/strategies/reflexion.test.ts
```

Note which tests pass. The 2 new tests should fail (schema field not yet in type).

### Step 3: Update reflexion.ts

**Add `availableToolSchemas` to `ReflexionInput`:**

```typescript
interface ReflexionInput {
  // ... existing fields ...
  readonly availableToolSchemas?: readonly ToolSchema[];
}
```

(Copy the `ToolSchema` / `ToolParamSchema` interface definitions from reactive.ts or shared/tool-utils.ts.)

**Replace the service resolution block** with:

```typescript
const { llm, toolService, promptService: promptServiceOpt, eventBus: ebOpt } =
  yield* resolveStrategyServices;
```

**Replace the initial generation LLM call** with:

```typescript
const genResult = yield* executeReActKernel({
  task: buildGenerationPrompt(input, null),
  systemPrompt: genSystemPrompt,
  availableToolSchemas: input.availableToolSchemas,
  maxIterations: 3,
  temperature: 0.7,
  taskId: input.taskId,
  parentStrategy: "reflexion",
}).pipe(
  Effect.mapError((err) => new ExecutionError({
    strategy: "reflexion",
    message: "Initial generation failed",
    step: 0,
    cause: err,
  })),
);
let currentResponse = genResult.output;
totalTokens += genResult.totalTokens;
totalCost += genResult.totalCost;
steps.push(...genResult.steps);
```

**Keep the critique call as a pure llm.complete** (no kernel — critique is pure evaluation).

**Replace the improvement LLM call** with:

```typescript
const improveResult = yield* executeReActKernel({
  task: buildGenerationPrompt(input, critique),
  systemPrompt: improveSystemPrompt,
  availableToolSchemas: input.availableToolSchemas,
  maxIterations: 3,
  temperature: 0.6,
  taskId: input.taskId,
  parentStrategy: "reflexion",
}).pipe(
  Effect.mapError((err) => new ExecutionError({
    strategy: "reflexion",
    message: `Improvement failed at attempt ${attempt}`,
    step: attempt,
    cause: err,
  })),
);
currentResponse = improveResult.output || currentResponse;
totalTokens += improveResult.totalTokens;
totalCost += improveResult.totalCost;
steps.push(...improveResult.steps);
```

**Replace remaining boilerplate:**
- `steps.push({ id: ulid()... })` → `steps.push(makeStep(...))`
- EventBus publish calls → `yield* publishReasoningStep(ebOpt, {...})`
- `compilePromptOrFallback` → `yield* compilePromptOrFallback(promptServiceOpt, ...)` (now an Effect)
- `isSatisfied` → import from `shared/quality-utils.js`
- `isCritiqueStagnant` → import from `shared/quality-utils.js`
- `buildResult(...)` → `buildStrategyResult({...})`

**Imports to add:**
```typescript
import { executeReActKernel } from "./shared/react-kernel.js";
import { resolveStrategyServices, compilePromptOrFallback, publishReasoningStep } from "./shared/service-utils.js";
import { makeStep, buildStrategyResult } from "./shared/step-utils.js";
import { isSatisfied, isCritiqueStagnant } from "./shared/quality-utils.js";
```

**Delete from reflexion.ts** (now in shared):
- `compilePromptOrFallback` function definition
- `isSatisfied` function definition
- `isCritiqueStagnant` function definition
- The per-file `PromptServiceOpt` type alias

### Step 4: Run reflexion tests

```bash
bun test packages/reasoning/tests/strategies/reflexion.test.ts
```

Expected: All 10 existing tests pass + 2 new tests pass = 12 total.

### Step 5: Commit

```bash
git add packages/reasoning/src/strategies/reflexion.ts packages/reasoning/tests/strategies/reflexion.test.ts
git commit -m "feat(reasoning): reflexion uses ReAct kernel — generation and improvement are now tool-aware"
```

---

## Task 8: Refactor plan-execute.ts — Tool-Aware Step Execution

**Files:**
- Modify: `packages/reasoning/src/strategies/plan-execute.ts`
- Modify: `packages/reasoning/tests/strategies/plan-execute.test.ts`

**Goal:** Each step execution calls `executeReActKernel` with `maxIterations=2` instead of a single `llm.complete("Execute this step...")`. This allows each step to use real tools.

### Step 1: Write 2 new failing tests

Add to `packages/reasoning/tests/strategies/plan-execute.test.ts`:

```typescript
it("step execution uses kernel with provided tool schemas", async () => {
  const layer = TestLLMServiceLayer({
    "planning agent": "1. Search for data\n2. Write summary",
    "Execute this step": "FINAL ANSWER: Step executed with tool awareness.",
    "evaluating plan execution": "SATISFIED: All steps complete.",
    "Synthesize": "The final synthesized answer combining all step results.",
  });

  const result = await Effect.runPromise(
    executePlanExecute({
      taskDescription: "Research quantum computing trends",
      taskType: "research",
      memoryContext: "",
      availableTools: [],
      availableToolSchemas: [
        { name: "web-search", description: "Search the web", parameters: [] },
      ],
      config: defaultReasoningConfig,
    }).pipe(Effect.provide(layer)),
  );

  expect(result.strategy).toBe("plan-execute-reflect");
  expect(result.status).toBe("completed");
});

it("step context is compacted after 5 steps", async () => {
  const layer = TestLLMServiceLayer({
    "planning agent": "1. A\n2. B\n3. C\n4. D\n5. E\n6. F\n7. G",
    "Execute this step": "FINAL ANSWER: Step result.",
    "evaluating plan execution": "SATISFIED: Done.",
    "Synthesize": "Final answer.",
  });

  const result = await Effect.runPromise(
    executePlanExecute({
      taskDescription: "Seven step task",
      taskType: "multi-step",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
    }).pipe(Effect.provide(layer)),
  );

  expect(result.status).toBe("completed");
  // All 7 steps executed without context explosion
  const execSteps = result.steps.filter((s) => s.content.includes("[EXEC"));
  expect(execSteps.length).toBe(7);
});
```

### Step 2: Run tests to check baseline

```bash
bun test packages/reasoning/tests/strategies/plan-execute.test.ts
```

### Step 3: Update plan-execute.ts

**Add `availableToolSchemas` to `PlanExecuteInput`:**

```typescript
interface PlanExecuteInput {
  // ... existing fields ...
  readonly availableToolSchemas?: readonly ToolSchema[];
}
```

**Replace the service resolution block** with `resolveStrategyServices`.

**Replace each step's LLM execution call:**

Find the `execResponse` LLM call inside the `for (let i = 0; i < planSteps.length; i++)` loop. Replace the entire step execution block (both the `parseToolFromStep` branch AND the LLM fallback branch) with:

```typescript
const stepContext = buildCompactedStepContext(stepResults);
const execResult = yield* executeReActKernel({
  task: `Execute this step of the plan:\n\nStep ${i + 1}: ${stepDescription}\n\nContext so far:\n${stepContext}`,
  systemPrompt: input.systemPrompt ?? "You are a precise task executor. Complete the given step using available tools if needed.",
  availableToolSchemas: input.availableToolSchemas,
  maxIterations: 2,  // Each step should be focused, not a long loop
  temperature: 0.5,
  taskId: input.taskId,
  parentStrategy: "plan-execute",
}).pipe(
  Effect.mapError((err) => new ExecutionError({
    strategy: "plan-execute-reflect",
    message: `Step ${i + 1} execution failed`,
    step: i,
    cause: err,
  })),
);
const stepResult = execResult.output || `[Step ${i + 1} completed]`;
totalTokens += execResult.totalTokens;
totalCost += execResult.totalCost;
stepResults.push(`Step ${i + 1}: ${stepResult}`);
steps.push(makeStep("observation", `[EXEC Step ${i + 1}] ${stepResult}`));
steps.push(...execResult.steps.filter(s => s.type !== "thought" || s.content.includes("FINAL ANSWER")));
```

**Replace boilerplate** throughout (same pattern as reflexion: makeStep, publishReasoningStep, compilePromptOrFallback, isSatisfied, buildStrategyResult).

**Keep** `parsePlanSteps`, `buildPlanPrompt`, `buildReflectPrompt`, synthesis LLM call — these are algorithm-specific.

**Remove** `parseToolFromStep` (line ~440 in plan-execute.ts) — it's replaced by the kernel's tool parsing.

### Step 4: Run tests

```bash
bun test packages/reasoning/tests/strategies/plan-execute.test.ts
```

Expected: All existing tests pass + 2 new tests pass.

### Step 5: Commit

```bash
git add packages/reasoning/src/strategies/plan-execute.ts packages/reasoning/tests/strategies/plan-execute.test.ts
git commit -m "feat(reasoning): plan-execute step execution uses ReAct kernel — each step now tool-aware"
```

---

## Task 9: Refactor tree-of-thought.ts — Kernel for Phase 2

**Files:**
- Modify: `packages/reasoning/src/strategies/tree-of-thought.ts`
- Modify: `packages/reasoning/tests/strategies/tree-of-thought.test.ts`

**Goal:** Replace ToT's inline Phase 2 ReAct loop (and its duplicated `totParseAllToolRequests`, `totExecTool`, etc.) with a single `executeReActKernel` call. Phase 1 (BFS exploration + scoring) stays pure LLM — no change.

### Step 1: Write 1 new test verifying Phase 2 uses kernel properly

Add to `packages/reasoning/tests/strategies/tree-of-thought.test.ts`:

```typescript
it("Phase 2 execution produces a structured final answer via kernel", async () => {
  const layer = TestLLMServiceLayer({
    "explore solution": "1. Approach A with recursion\n2. Approach B with iteration",
    "Rate this thought": "0.8",
    // Phase 2 kernel call
    "Selected Approach": "FINAL ANSWER: The best approach uses iteration for O(n) complexity.",
  });

  const result = await Effect.runPromise(
    executeTreeOfThought({
      taskDescription: "Find the most efficient sorting algorithm",
      taskType: "analysis",
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
  expect(result.status).toBe("completed");
  expect(result.output).toContain("iteration");
});
```

### Step 2: Run existing ToT tests to establish baseline

```bash
bun test packages/reasoning/tests/strategies/tree-of-thought.test.ts
```

### Step 3: Replace ToT Phase 2 inline loop with kernel call

In `tree-of-thought.ts`, find the Phase 2 section (the `while (execIter < execMaxIter)` loop). Replace the entire Phase 2 execution block with:

```typescript
// ── Phase 2: Execute best path using ReAct kernel ──
const bestPathSummary = bestPath.join("\n→ ");
const execResult = yield* executeReActKernel({
  task: input.taskDescription,
  systemPrompt: input.systemPrompt ?? "You are a systematic problem solver. Execute the given approach to produce a final answer.",
  availableToolSchemas: input.availableToolSchemas,
  priorContext: `Selected Approach (from planning phase):\n${bestPathSummary}`,
  maxIterations: input.config.strategies.treeOfThought.depth ?? 3,
  temperature: input.config.strategies.reactive?.temperature ?? 0.7,
  taskId: input.taskId,
  parentStrategy: "tree-of-thought",
}).pipe(
  Effect.mapError((err) => new ExecutionError({
    strategy: "tree-of-thought",
    message: "Phase 2 execution failed",
    step: 0,
    cause: err,
  })),
);
totalTokens += execResult.totalTokens;
totalCost += execResult.totalCost;
steps.push(...execResult.steps);
const finalOutput = execResult.output;
```

**Delete from tree-of-thought.ts** (now in shared or replaced by kernel):
- `totParseToolRequest` function
- `totParseAllToolRequests` function
- `totHasFinalAnswer` function
- `totExtractFinalAnswer` function
- `totExecTool` function
- `totBuildExecPrompt` function
- `totFormatToolSchema` function (replaced by `formatToolSchemas` from shared)

**Add `availableToolSchemas` to `TreeOfThoughtInput`** (same as reflexion/plan-execute pattern).

**Replace boilerplate** (makeStep, publishReasoningStep, compilePromptOrFallback, parseScore → import from quality-utils, buildStrategyResult).

### Step 4: Run all ToT tests

```bash
bun test packages/reasoning/tests/strategies/tree-of-thought.test.ts
```

Expected: All existing 5 tests + 1 new test pass.

### Step 5: Commit

```bash
git add packages/reasoning/src/strategies/tree-of-thought.ts packages/reasoning/tests/strategies/tree-of-thought.test.ts
git commit -m "feat(reasoning): tree-of-thought Phase 2 uses ReAct kernel — removes duplicate tool parsing"
```

---

## Task 10: Refactor adaptive.ts — Shared Utils Cleanup

**Files:**
- Modify: `packages/reasoning/src/strategies/adaptive.ts`

**Goal:** Clean up adaptive.ts using shared utilities. No algorithm change — adaptive just needs the boilerplate removed.

### Step 1: Apply shared utilities

Replace in adaptive.ts:
- Service resolution block → `resolveStrategyServices`
- `compilePromptOrFallback` definition → import from `service-utils`
- EventBus publish calls → `publishReasoningStep`
- `steps.push({ id: ulid()... })` → `makeStep`
- Final result construction → `buildStrategyResult` with `extraMetadata: { selectedStrategy, fallbackOccurred }`
- `availableToolSchemas` pass-through: when dispatching to sub-strategies, pass `input.availableToolSchemas`

### Step 2: Verify adaptive tests still pass

```bash
bun test packages/reasoning/tests/strategies/adaptive.test.ts
```

Expected: All 5 existing tests pass.

### Step 3: Commit

```bash
git add packages/reasoning/src/strategies/adaptive.ts
git commit -m "refactor(reasoning): adaptive.ts uses shared utilities (boilerplate cleanup)"
```

---

## Task 11: Full Integration, main.ts Live Tests, Feature Gap Doc

**Files:**
- Modify: `main.ts`
- Create: `spec/plans/2026-03-01-feature-gap-analysis.md`

### Step 1: Run full test suite

```bash
bun test
```

Expected: 909+ tests pass, 0 regressions. If any fail, fix before proceeding.

### Step 2: Build all packages

```bash
bun run build
```

Expected: All packages build without type errors.

### Step 3: Update main.ts with all 4 strategy live tests

Replace `main.ts` content with a 4-strategy test suite (run sequentially):

```typescript
import { ReactiveAgents } from "reactive-agents";

// ── Test 1: Reflexion — Strength task (pure analytical, no tools) ──
// Tests: iterative quality improvement, stagnation detection, critique depth
await using agent1 = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("cogito:14b")
  .withReasoning({ defaultStrategy: "reflexion" })
  .withObservability({ verbosity: "normal", live: true })
  .build();

const r1 = await agent1.run(
  "Analyze the v0.5.5 reasoning strategy improvements (reflexion stagnation detection, " +
  "plan-execute context compaction, ToT score parsing, adaptive fallback) and write a " +
  "3-paragraph technical blog post explaining: what each problem was, the solution applied, " +
  "and why it matters for production agent quality.",
);
console.log("\n=== REFLEXION (strength) ===");
console.log("Status:", r1.status, "| Steps:", r1.metadata.stepsCount, "| Tokens:", r1.metadata.tokensUsed);

// ── Test 2: Reflexion — Tool task (GitHub MCP + iterative quality) ──
// Tests: new kernel integration — generation with tools, critique without, improve with tools
await using agent2 = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("cogito:14b")
  .withMCP({
    name: "github",
    transport: "stdio",
    command: "docker",
    args: ["-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "ghcr.io/github/github-mcp-server"],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? "" },
  })
  .withTools()
  .withReasoning({ defaultStrategy: "reflexion" })
  .withObservability({ verbosity: "normal", live: true })
  .build();

const r2 = await agent2.run(
  "Using the GitHub tools, fetch the last 10 commits from tylerjrbuell/reactive-agents-ts. " +
  "Produce a structured release notes document with: commit categories (feat/fix/refactor/docs), " +
  "a 1-sentence summary per category, and any breaking changes. Self-critique and improve the format.",
);
console.log("\n=== REFLEXION (tools) ===");
console.log("Status:", r2.status, "| Steps:", r2.metadata.stepsCount, "| Tokens:", r2.metadata.tokensUsed);

// ── Test 3: Plan-Execute — Multi-step research task ──
// Tests: per-step kernel execution, synthesis quality, context compaction
await using agent3 = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("cogito:14b")
  .withMCP({
    name: "github",
    transport: "stdio",
    command: "docker",
    args: ["-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "ghcr.io/github/github-mcp-server"],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? "" },
  })
  .withTools()
  .withReasoning({ defaultStrategy: "plan-execute" })
  .withObservability({ verbosity: "normal", live: true })
  .build();

const r3 = await agent3.run(
  "Create a 5-step implementation plan for the Docker sandboxing feature (v0.6.0). " +
  "For each step: (1) what to build, (2) which files to modify, (3) what tests to write, " +
  "(4) acceptance criteria. Use the GitHub MCP to check the current codebase structure first.",
);
console.log("\n=== PLAN-EXECUTE ===");
console.log("Status:", r3.status, "| Steps:", r3.metadata.stepsCount, "| Tokens:", r3.metadata.tokensUsed);

// ── Test 4: Tree-of-Thought — Architectural exploration ──
// Tests: Phase 1 BFS, score parsing, Phase 2 kernel execution
await using agent4 = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("cogito:14b")
  .withReasoning({ defaultStrategy: "tree-of-thought" })
  .withObservability({ verbosity: "normal", live: true })
  .build();

const r4 = await agent4.run(
  "Design 3 different architectures for implementing voice agent support in the " +
  "reactive-agents-ts framework. For each: technical approach, tradeoffs, estimated " +
  "complexity (low/medium/high), and which existing packages would be extended. " +
  "Then recommend the best approach with justification.",
);
console.log("\n=== TREE-OF-THOUGHT ===");
console.log("Status:", r4.status, "| Steps:", r4.metadata.stepsCount, "| Tokens:", r4.metadata.tokensUsed);
```

### Step 4: Run live tests

```bash
bun run main.ts 2>&1 | tee /tmp/strategy-live-test.log
```

**Observe for each strategy:**
- Does it produce a final answer (`status: "completed"`)?
- Are step counts reasonable? (reflexion: 3–15, plan-execute: 8–20, ToT: 6–15)
- Are token counts reasonable? (<5000 per task is ideal)
- Does reflexion with tools actually call GitHub MCP in Phase 1/2?
- Does plan-execute show per-step tool calls in the timeline?

**If any strategy shows issues** (runaway loops, stuck, partial result on solvable task): debug by reading the live output, checking which iteration caused the issue, and applying targeted fixes.

### Step 5: Write feature gap analysis

Create `spec/plans/2026-03-01-feature-gap-analysis.md` based on live test observations + Vision/Roadmap review. Cover:
- Gaps discovered during testing (immediate fixes to apply)
- Roadmap items confirmed as highest priority from testing
- Any new efficiency opportunities identified

### Step 6: Run final full test suite

```bash
bun test
```

Expected: At least 934 tests pass (909 existing + 25 new shared utility tests).

### Step 7: Final commit

```bash
git add main.ts spec/plans/2026-03-01-feature-gap-analysis.md
git commit -m "test: live strategy tests + feature gap analysis for v0.5.6 planning"
```

---

## Acceptance Criteria

- [ ] `shared/` directory has 6 files + barrel export
- [ ] `compilePromptOrFallback` removed from all 5 strategy files — imported from `service-utils`
- [ ] `isSatisfied` removed from reflexion + plan-execute — imported from `quality-utils`
- [ ] `parseAllToolRequests` / `totParseAllToolRequests` removed — use `tool-utils` version
- [ ] `parseScore` removed from tree-of-thought — imported from `quality-utils`
- [ ] Service resolution block removed from all 5 strategies — replaced by `resolveStrategyServices`
- [ ] Reflexion generation + improvement calls use `executeReActKernel`
- [ ] Plan-Execute step execution uses `executeReActKernel` per step
- [ ] Tree-of-Thought Phase 2 replaced with single `executeReActKernel` call
- [ ] All 909+ existing tests pass (zero regressions)
- [ ] 25+ new tests in `shared/` test files
- [ ] Live test: reflexion with GitHub MCP produces structured release notes
- [ ] Live test: plan-execute shows tool calls within individual steps
- [ ] Feature gap analysis document created
