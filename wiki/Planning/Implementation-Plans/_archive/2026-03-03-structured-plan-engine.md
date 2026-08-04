# Structured Plan Engine — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite plan-execute-reflect with structured JSON plans, a reusable structured output pipeline, provider-adaptive JSON extraction, persistent SQLite storage, and hybrid step execution (direct dispatch + scoped kernel).

**Architecture:** LLM generates content-only JSON plan steps. Framework hydrates metadata (IDs, timestamps, status). Steps execute by type: `tool_call` → direct dispatch, `analysis` → goal-anchored kernel, `composite` → scoped kernel. Plans persist in SQLite for cross-run learning and crash recovery. A 4-layer structured output pipeline (prompt → repair → validate → retry) ensures reliable JSON extraction from any provider.

**Tech Stack:** Effect-TS (Schema, Context.Tag, Layer, Ref), bun:sqlite (WAL mode), bun:test, TypeScript strict mode, existing `@reactive-agents/llm-provider`, `@reactive-agents/memory`, `@reactive-agents/reasoning` packages.

---

### Task 1: Plan Type Definitions

**Files:**
- Create: `packages/reasoning/src/types/plan.ts`
- Modify: `packages/reasoning/src/types/index.ts`

**Step 1: Write the failing test**

Create `packages/reasoning/tests/types/plan.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import {
  LLMPlanStepSchema,
  LLMPlanOutputSchema,
  PlanStepStatusSchema,
  PlanStatusSchema,
  hydratePlan,
  shortId,
  resolveStepReferences,
} from "../../src/types/plan.js";
import type { Plan, PlanStep, LLMPlanOutput } from "../../src/types/plan.js";

describe("Plan types", () => {
  it("decodes a valid LLMPlanOutput", () => {
    const raw = {
      steps: [
        { title: "Fetch data", instruction: "Get commits", type: "tool_call", toolName: "github/list_commits", toolArgs: { owner: "acme", repo: "app" } },
        { title: "Summarize", instruction: "Draft a summary", type: "analysis" },
      ],
    };
    const parsed = Schema.decodeSync(LLMPlanOutputSchema)(raw);
    expect(parsed.steps.length).toBe(2);
    expect(parsed.steps[0].type).toBe("tool_call");
    expect(parsed.steps[1].toolName).toBeUndefined();
  });

  it("rejects LLMPlanOutput with invalid step type", () => {
    const raw = { steps: [{ title: "X", instruction: "Y", type: "invalid" }] };
    expect(() => Schema.decodeSync(LLMPlanOutputSchema)(raw)).toThrow();
  });

  it("shortId generates short unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => shortId()));
    expect(ids.size).toBe(100); // all unique
    for (const id of ids) {
      expect(id.length).toBeLessThanOrEqual(8);
      expect(id.startsWith("p_")).toBe(true);
    }
  });

  it("hydratePlan assigns deterministic step IDs and metadata", () => {
    const llmOutput: LLMPlanOutput = {
      steps: [
        { title: "Step A", instruction: "Do A", type: "tool_call", toolName: "web-search", toolArgs: { query: "test" } },
        { title: "Step B", instruction: "Do B", type: "analysis" },
        { title: "Step C", instruction: "Do C", type: "composite", toolHints: ["file-read"] },
      ],
    };
    const plan = hydratePlan(llmOutput, {
      taskId: "task-1",
      agentId: "agent-1",
      goal: "Test goal",
      planMode: "linear",
    });

    expect(plan.id).toMatch(/^p_/);
    expect(plan.taskId).toBe("task-1");
    expect(plan.agentId).toBe("agent-1");
    expect(plan.goal).toBe("Test goal");
    expect(plan.mode).toBe("linear");
    expect(plan.status).toBe("active");
    expect(plan.version).toBe(1);
    expect(plan.steps.length).toBe(3);
    expect(plan.steps[0].id).toBe("s1");
    expect(plan.steps[1].id).toBe("s2");
    expect(plan.steps[2].id).toBe("s3");
    expect(plan.steps[0].status).toBe("pending");
    expect(plan.steps[0].retries).toBe(0);
    expect(plan.steps[0].tokensUsed).toBe(0);
    expect(plan.steps[2].toolHints).toEqual(["file-read"]);
  });

  it("resolveStepReferences replaces {{from_step:sN}} with results", () => {
    const completedSteps: PlanStep[] = [
      { id: "s1", seq: 0, title: "A", instruction: "A", type: "tool_call", status: "completed", retries: 0, tokensUsed: 0, result: "commit data here" },
      { id: "s2", seq: 1, title: "B", instruction: "B", type: "analysis", status: "completed", retries: 0, tokensUsed: 0, result: "Morning Brief: 5 commits landed" },
    ];
    const args = { recipient: "+123", message: "{{from_step:s2}}" };
    const resolved = resolveStepReferences(args, completedSteps);
    expect(resolved.message).toBe("Morning Brief: 5 commits landed");
  });

  it("resolveStepReferences with {{from_step:sN:summary}} truncates to 500 chars", () => {
    const longResult = "x".repeat(1000);
    const completedSteps: PlanStep[] = [
      { id: "s1", seq: 0, title: "A", instruction: "A", type: "tool_call", status: "completed", retries: 0, tokensUsed: 0, result: longResult },
    ];
    const args = { data: "{{from_step:s1:summary}}" };
    const resolved = resolveStepReferences(args, completedSteps);
    expect(resolved.data.length).toBe(500);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/reasoning && bun test tests/types/plan.test.ts`
Expected: FAIL — module `../../src/types/plan.js` not found

**Step 3: Write the implementation**

Create `packages/reasoning/src/types/plan.ts`:

```typescript
import { Schema } from "effect";

// ── Short ID generation (deterministic, token-friendly) ──

let _idCounter = 0;
export function shortId(): string {
  _idCounter++;
  const rand = Math.random().toString(36).slice(2, 6);
  return `p_${rand}`;
}

// ── LLM-generated types (content only — no metadata) ──

export const LLMPlanStepSchema = Schema.Struct({
  title: Schema.String,
  instruction: Schema.String,
  type: Schema.Literal("tool_call", "analysis", "composite"),
  toolName: Schema.optional(Schema.String),
  toolArgs: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  toolHints: Schema.optional(Schema.Array(Schema.String)),
  dependsOn: Schema.optional(Schema.Array(Schema.String)),
});
export type LLMPlanStep = typeof LLMPlanStepSchema.Type;

export const LLMPlanOutputSchema = Schema.Struct({
  steps: Schema.Array(LLMPlanStepSchema),
});
export type LLMPlanOutput = typeof LLMPlanOutputSchema.Type;

// ── Framework-hydrated types (full metadata) ──

export const PlanStepStatusSchema = Schema.Literal("pending", "in_progress", "completed", "failed", "skipped");
export type PlanStepStatus = typeof PlanStepStatusSchema.Type;

export const PlanStatusSchema = Schema.Literal("active", "completed", "failed", "abandoned");
export type PlanStatus = typeof PlanStatusSchema.Type;

export interface PlanStep {
  readonly id: string;
  readonly seq: number;
  readonly title: string;
  readonly instruction: string;
  readonly type: "tool_call" | "analysis" | "composite";
  readonly status: PlanStepStatus;
  readonly toolName?: string;
  readonly toolArgs?: Record<string, unknown>;
  readonly toolHints?: string[];
  readonly dependsOn?: string[];
  readonly result?: string;
  readonly error?: string;
  readonly retries: number;
  readonly tokensUsed: number;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export interface Plan {
  readonly id: string;
  readonly taskId: string;
  readonly agentId: string;
  readonly goal: string;
  readonly mode: "linear" | "dag";
  readonly steps: PlanStep[];
  readonly status: PlanStatus;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly totalTokens: number;
  readonly totalCost: number;
}

// ── Hydration: LLM output → full Plan ──

export interface PlanContext {
  readonly taskId: string;
  readonly agentId: string;
  readonly goal: string;
  readonly planMode: "linear" | "dag";
}

export function hydratePlan(raw: LLMPlanOutput, context: PlanContext): Plan {
  const planId = shortId();
  const now = new Date().toISOString();

  return {
    id: planId,
    taskId: context.taskId,
    agentId: context.agentId,
    goal: context.goal,
    mode: context.planMode,
    status: "active",
    version: 1,
    createdAt: now,
    updatedAt: now,
    totalTokens: 0,
    totalCost: 0,
    steps: raw.steps.map((s, i) => ({
      id: `s${i + 1}`,
      seq: i,
      title: s.title,
      instruction: s.instruction,
      type: s.type,
      status: "pending" as const,
      toolName: s.toolName,
      toolArgs: s.toolArgs,
      toolHints: s.toolHints,
      dependsOn: s.dependsOn,
      result: undefined,
      error: undefined,
      retries: 0,
      tokensUsed: 0,
      startedAt: undefined,
      completedAt: undefined,
    })),
  };
}

// ── Step reference resolution ──

export function resolveStepReferences(
  args: Record<string, unknown>,
  completedSteps: readonly PlanStep[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      result[key] = value.replace(
        /\{\{from_step:(\w+)(?::summary)?\}\}/g,
        (match, stepId: string) => {
          const step = completedSteps.find((s) => s.id === stepId);
          if (!step?.result) return match;
          const isSummary = match.includes(":summary");
          return isSummary ? step.result.slice(0, 500) : step.result;
        },
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}
```

**Step 4: Update barrel export**

Add to `packages/reasoning/src/types/index.ts`:

```typescript
export {
  LLMPlanStepSchema,
  LLMPlanOutputSchema,
  PlanStepStatusSchema,
  PlanStatusSchema,
  hydratePlan,
  shortId,
  resolveStepReferences,
} from "./plan.js";
export type {
  LLMPlanStep,
  LLMPlanOutput,
  PlanStepStatus,
  PlanStatus,
  PlanStep,
  Plan,
  PlanContext,
} from "./plan.js";
```

**Step 5: Run test to verify it passes**

Run: `cd packages/reasoning && bun test tests/types/plan.test.ts`
Expected: 6 tests PASS

**Step 6: Commit**

```bash
git add packages/reasoning/src/types/plan.ts packages/reasoning/src/types/index.ts packages/reasoning/tests/types/plan.test.ts
git commit -m "feat(reasoning): Plan type definitions — LLMPlanOutput schema, hydratePlan, resolveStepReferences"
```

---

### Task 2: JSON Repair Utilities

**Files:**
- Create: `packages/reasoning/src/structured-output/json-repair.ts`
- Create: `packages/reasoning/src/structured-output/index.ts`

**Step 1: Write the failing test**

Create `packages/reasoning/tests/structured-output/json-repair.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { extractJsonBlock, repairJson } from "../../src/structured-output/json-repair.js";

describe("extractJsonBlock", () => {
  it("extracts JSON from markdown code fences", () => {
    const input = 'Here is the plan:\n```json\n{"steps": [{"title": "A"}]}\n```\nDone.';
    expect(extractJsonBlock(input)).toBe('{"steps": [{"title": "A"}]}');
  });

  it("extracts first { ... } block from mixed text", () => {
    const input = 'Sure! {"steps": []} is the plan.';
    expect(extractJsonBlock(input)).toBe('{"steps": []}');
  });

  it("handles nested braces correctly", () => {
    const input = '{"steps": [{"args": {"a": 1}}]}';
    expect(extractJsonBlock(input)).toBe('{"steps": [{"args": {"a": 1}}]}');
  });

  it("extracts array blocks", () => {
    const input = 'Result: [{"id": 1}, {"id": 2}]';
    expect(extractJsonBlock(input)).toBe('[{"id": 1}, {"id": 2}]');
  });

  it("returns null when no JSON found", () => {
    expect(extractJsonBlock("No JSON here")).toBeNull();
  });
});

describe("repairJson", () => {
  it("fixes trailing commas", () => {
    const input = '{"steps": [{"title": "A",},]}';
    const result = JSON.parse(repairJson(input));
    expect(result.steps[0].title).toBe("A");
  });

  it("fixes single quotes to double quotes", () => {
    const input = "{'steps': [{'title': 'A'}]}";
    const result = JSON.parse(repairJson(input));
    expect(result.steps[0].title).toBe("A");
  });

  it("closes unclosed braces (truncated JSON)", () => {
    const input = '{"steps": [{"title": "A"';
    const repaired = repairJson(input);
    const result = JSON.parse(repaired);
    expect(result.steps[0].title).toBe("A");
  });

  it("closes unclosed brackets (truncated array)", () => {
    const input = '{"steps": [{"title": "A"}';
    const repaired = repairJson(input);
    const result = JSON.parse(repaired);
    expect(result.steps[0].title).toBe("A");
  });

  it("handles unescaped newlines in strings", () => {
    const input = '{"instruction": "line 1\nline 2"}';
    const repaired = repairJson(input);
    const result = JSON.parse(repaired);
    expect(result.instruction).toContain("line 1");
  });

  it("returns valid JSON unchanged", () => {
    const input = '{"steps": []}';
    expect(repairJson(input)).toBe(input);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/reasoning && bun test tests/structured-output/json-repair.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `packages/reasoning/src/structured-output/json-repair.ts`:

```typescript
/**
 * JSON extraction and repair utilities.
 * Pure functions — no LLM calls. Used as Layer 2 of the structured output pipeline.
 */

/**
 * Extract a JSON block from mixed text.
 * Strips markdown fences, finds the first `{` or `[`, and matches to its closing bracket.
 */
export function extractJsonBlock(text: string): string | null {
  // Strip markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    const inner = fenceMatch[1]!.trim();
    if (inner.startsWith("{") || inner.startsWith("[")) return inner;
  }

  // Find first { or [
  const startObj = text.indexOf("{");
  const startArr = text.indexOf("[");
  let start: number;
  let open: string;
  let close: string;

  if (startObj === -1 && startArr === -1) return null;
  if (startObj === -1) { start = startArr; open = "["; close = "]"; }
  else if (startArr === -1) { start = startObj; open = "{"; close = "}"; }
  else if (startObj < startArr) { start = startObj; open = "{"; close = "}"; }
  else { start = startArr; open = "["; close = "]"; }

  // Brace-matching scan
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === open || ch === "{" || ch === "[") depth++;
    if (ch === close || ch === "}" || ch === "]") depth--;
    if (depth === 0) return text.slice(start, i + 1);
  }

  // If we ran out of text, return from start to end (will need repair)
  return text.slice(start);
}

/**
 * Attempt to repair malformed JSON.
 * Fixes: trailing commas, single quotes, unescaped newlines, truncated brackets.
 */
export function repairJson(input: string): string {
  // If already valid, return as-is
  try { JSON.parse(input); return input; } catch { /* proceed with repair */ }

  let text = input;

  // Fix single quotes → double quotes (outside of existing double-quoted strings)
  text = fixSingleQuotes(text);

  // Fix unescaped newlines inside strings
  text = fixUnescapedNewlines(text);

  // Fix trailing commas: ,] → ] and ,} → }
  text = text.replace(/,\s*([\]}])/g, "$1");

  // Close unclosed brackets/braces
  text = closeUnclosed(text);

  return text;
}

function fixSingleQuotes(text: string): string {
  // Simple heuristic: if text has single-quoted keys/values, swap to double
  // Only do this if the text doesn't parse as-is
  const result: string[] = [];
  let inDouble = false;
  let inSingle = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) { result.push(ch); escape = false; continue; }
    if (ch === "\\") { result.push(ch); escape = true; continue; }

    if (ch === '"' && !inSingle) { inDouble = !inDouble; result.push(ch); continue; }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      result.push('"');
      continue;
    }
    result.push(ch);
  }
  return result.join("");
}

function fixUnescapedNewlines(text: string): string {
  const result: string[] = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) { result.push(ch); escape = false; continue; }
    if (ch === "\\") { result.push(ch); escape = true; continue; }
    if (ch === '"') { inString = !inString; result.push(ch); continue; }
    if (inString && ch === "\n") { result.push("\\n"); continue; }
    if (inString && ch === "\r") { result.push("\\r"); continue; }
    result.push(ch);
  }
  return result.join("");
}

function closeUnclosed(text: string): string {
  const stack: string[] = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }

  // Close any open string
  if (inString) text += '"';

  // Close open brackets in reverse order
  while (stack.length > 0) {
    text += stack.pop();
  }

  return text;
}
```

Create `packages/reasoning/src/structured-output/index.ts`:

```typescript
export { extractJsonBlock, repairJson } from "./json-repair.js";
```

**Step 4: Run test to verify it passes**

Run: `cd packages/reasoning && bun test tests/structured-output/json-repair.test.ts`
Expected: 11 tests PASS

**Step 5: Commit**

```bash
git add packages/reasoning/src/structured-output/ packages/reasoning/tests/structured-output/
git commit -m "feat(reasoning): JSON repair utilities — extractJsonBlock, repairJson for structured output pipeline"
```

---

### Task 3: Structured Output Pipeline

**Files:**
- Create: `packages/reasoning/src/structured-output/pipeline.ts`
- Modify: `packages/reasoning/src/structured-output/index.ts`

**Step 1: Write the failing test**

Create `packages/reasoning/tests/structured-output/pipeline.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { Effect, Schema } from "effect";
import { extractStructuredOutput } from "../../src/structured-output/pipeline.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

const TestSchema = Schema.Struct({
  name: Schema.String,
  count: Schema.Number,
});

describe("extractStructuredOutput", () => {
  it("extracts valid JSON on first attempt", async () => {
    const layer = TestLLMServiceLayer({
      "Extract": '{"name": "test", "count": 42}',
    });

    const result = await Effect.runPromise(
      extractStructuredOutput({
        schema: TestSchema,
        prompt: "Extract the data",
        maxRetries: 0,
      }).pipe(Effect.provide(layer)),
    );

    expect(result.data.name).toBe("test");
    expect(result.data.count).toBe(42);
    expect(result.attempts).toBe(1);
    expect(result.repaired).toBe(false);
  });

  it("repairs JSON with markdown fences", async () => {
    const layer = TestLLMServiceLayer({
      "Extract": '```json\n{"name": "fixed", "count": 7}\n```',
    });

    const result = await Effect.runPromise(
      extractStructuredOutput({
        schema: TestSchema,
        prompt: "Extract the data",
        maxRetries: 0,
      }).pipe(Effect.provide(layer)),
    );

    expect(result.data.name).toBe("fixed");
    expect(result.repaired).toBe(true);
  });

  it("repairs trailing commas", async () => {
    const layer = TestLLMServiceLayer({
      "Extract": '{"name": "comma", "count": 3,}',
    });

    const result = await Effect.runPromise(
      extractStructuredOutput({
        schema: TestSchema,
        prompt: "Extract the data",
        maxRetries: 0,
      }).pipe(Effect.provide(layer)),
    );

    expect(result.data.name).toBe("comma");
    expect(result.repaired).toBe(true);
  });

  it("retries with error feedback on schema validation failure", async () => {
    // First call returns wrong shape, retry prompt contains error feedback
    const layer = TestLLMServiceLayer({
      "Extract the data": '{"wrong": "shape"}',
      "previous response was not valid": '{"name": "retried", "count": 99}',
    });

    const result = await Effect.runPromise(
      extractStructuredOutput({
        schema: TestSchema,
        prompt: "Extract the data",
        maxRetries: 1,
      }).pipe(Effect.provide(layer)),
    );

    expect(result.data.name).toBe("retried");
    expect(result.attempts).toBe(2);
  });

  it("uses custom system prompt", async () => {
    const layer = TestLLMServiceLayer({
      "planning agent": '{"name": "planned", "count": 1}',
    });

    const result = await Effect.runPromise(
      extractStructuredOutput({
        schema: TestSchema,
        prompt: "Generate plan",
        systemPrompt: "You are a planning agent",
        maxRetries: 0,
      }).pipe(Effect.provide(layer)),
    );

    expect(result.data.name).toBe("planned");
  });

  it("includes few-shot examples in prompt", async () => {
    const layer = TestLLMServiceLayer({
      "Example": '{"name": "with-example", "count": 5}',
    });

    const result = await Effect.runPromise(
      extractStructuredOutput({
        schema: TestSchema,
        prompt: "Extract data",
        examples: [{ name: "Example item", count: 10 }],
        maxRetries: 0,
      }).pipe(Effect.provide(layer)),
    );

    expect(result.data.name).toBe("with-example");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/reasoning && bun test tests/structured-output/pipeline.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `packages/reasoning/src/structured-output/pipeline.ts`:

```typescript
/**
 * Structured Output Pipeline — reliable JSON extraction from any LLM.
 *
 * 4-layer fallback:
 *   Layer 1: High-signal prompting (schema as example, few-shot, "JSON only")
 *   Layer 2: JSON extraction & repair (pure functions, no LLM)
 *   Layer 3: Schema validation with Effect-TS coercion
 *   Layer 4: Retry with error feedback
 */
import { Effect, Schema } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { extractJsonBlock, repairJson } from "./json-repair.js";

export interface StructuredOutputConfig<T> {
  readonly schema: Schema.Schema<T>;
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly examples?: readonly T[];
  readonly maxRetries?: number;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface StructuredOutputResult<T> {
  readonly data: T;
  readonly raw: string;
  readonly attempts: number;
  readonly repaired: boolean;
}

/**
 * Extract typed structured output from an LLM response.
 * Attempts parsing, repair, validation, and retry with error feedback.
 */
export const extractStructuredOutput = <T>(
  config: StructuredOutputConfig<T>,
): Effect.Effect<StructuredOutputResult<T>, Error, LLMService> =>
  Effect.gen(function* () {
    const llm = yield* LLMService;
    const maxRetries = config.maxRetries ?? 2;
    const temp = config.temperature ?? 0.3;
    const maxTokens = config.maxTokens ?? 2000;

    let lastError: string | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Build prompt
      const prompt = attempt === 0
        ? buildStructuredPrompt(config)
        : buildRetryPrompt(config, lastError ?? "Unknown error");

      const systemPrompt = config.systemPrompt
        ? `${config.systemPrompt}\n\nRespond with ONLY valid JSON. No markdown, no explanation.`
        : "Respond with ONLY valid JSON. No markdown, no explanation.";

      // Layer 1: LLM call
      const response = yield* llm.complete({
        messages: [{ role: "user", content: prompt }],
        systemPrompt,
        maxTokens,
        temperature: attempt === 0 ? temp : 0.1,
      }).pipe(
        Effect.mapError((e) => new Error(`LLM call failed: ${String(e)}`)),
      );

      const raw = response.content;
      let repaired = false;

      // Layer 2: Extract and repair JSON
      let jsonText = raw.trim();
      try {
        JSON.parse(jsonText);
      } catch {
        const extracted = extractJsonBlock(jsonText);
        if (extracted) {
          jsonText = extracted;
          repaired = true;
        }
        try {
          JSON.parse(jsonText);
        } catch {
          jsonText = repairJson(jsonText);
          repaired = true;
        }
      }

      // Layer 3: Schema validation
      try {
        const parsed = JSON.parse(jsonText);
        const data = Schema.decodeUnknownSync(config.schema)(parsed);
        return { data, raw, attempts: attempt + 1, repaired };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        if (attempt === maxRetries) {
          return yield* Effect.fail(
            new Error(`Structured output failed after ${attempt + 1} attempts. Last error: ${lastError}`),
          );
        }
        // Layer 4: Continue to retry loop
      }
    }

    // Unreachable but TypeScript needs it
    return yield* Effect.fail(new Error("Structured output exhausted all retries"));
  });

// ── Prompt builders ──

function buildStructuredPrompt<T>(config: StructuredOutputConfig<T>): string {
  const parts: string[] = [config.prompt];

  if (config.examples && config.examples.length > 0) {
    parts.push("\nExample output:");
    for (const ex of config.examples) {
      parts.push(JSON.stringify(ex, null, 2));
    }
  }

  parts.push("\nRespond with ONLY a JSON object matching the schema above. No markdown fences, no explanation.");
  return parts.join("\n");
}

function buildRetryPrompt<T>(config: StructuredOutputConfig<T>, error: string): string {
  return `Your previous response was not valid JSON. Error: ${error}

Original request: ${config.prompt}

Please respond with ONLY a valid JSON object. No markdown, no explanation.`;
}
```

**Step 4: Update barrel export**

Add to `packages/reasoning/src/structured-output/index.ts`:

```typescript
export { extractStructuredOutput } from "./pipeline.js";
export type { StructuredOutputConfig, StructuredOutputResult } from "./pipeline.js";
```

**Step 5: Run test to verify it passes**

Run: `cd packages/reasoning && bun test tests/structured-output/pipeline.test.ts`
Expected: 6 tests PASS

**Step 6: Commit**

```bash
git add packages/reasoning/src/structured-output/ packages/reasoning/tests/structured-output/
git commit -m "feat(reasoning): structured output pipeline — 4-layer JSON extraction with repair and retry"
```

---

### Task 4: Provider Structured Output Capabilities

**Files:**
- Modify: `packages/llm-provider/src/llm-service.ts` (add `getStructuredOutputCapabilities`)
- Modify: `packages/llm-provider/src/types.ts` (add `StructuredOutputCapabilities`)
- Modify: `packages/llm-provider/src/testing.ts` (TestLLMService returns capabilities)
- Modify: each provider in `packages/llm-provider/src/providers/` (6 files)

**Step 1: Write the failing test**

Create `packages/llm-provider/tests/structured-output-caps.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { LLMService, TestLLMServiceLayer } from "../src/index.js";
import type { StructuredOutputCapabilities } from "../src/types.js";

describe("StructuredOutputCapabilities", () => {
  it("TestLLMService reports all capabilities as true", async () => {
    const layer = TestLLMServiceLayer({});
    const caps = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.getStructuredOutputCapabilities();
      }).pipe(Effect.provide(layer)),
    );

    expect(caps.nativeJsonMode).toBe(true);
    expect(caps.jsonSchemaEnforcement).toBe(false);
    expect(caps.prefillSupport).toBe(false);
    expect(caps.grammarConstraints).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/llm-provider && bun test tests/structured-output-caps.test.ts`
Expected: FAIL — `getStructuredOutputCapabilities` does not exist

**Step 3: Add StructuredOutputCapabilities type to types.ts**

Add to end of `packages/llm-provider/src/types.ts` (before the final newline):

```typescript
// ── Structured Output Capabilities ──

/**
 * Provider-reported capabilities for structured JSON output.
 * Used by the structured output pipeline to select the optimal extraction strategy.
 */
export type StructuredOutputCapabilities = {
  /** Provider supports forcing JSON-only output (OpenAI, Gemini, Ollama) */
  readonly nativeJsonMode: boolean;
  /** Provider can enforce a JSON Schema on the output (OpenAI structured outputs) */
  readonly jsonSchemaEnforcement: boolean;
  /** Provider supports assistant message prefill to start response with "{" (Anthropic) */
  readonly prefillSupport: boolean;
  /** Provider supports GBNF grammar constraints for exact schema matching (Ollama/llama.cpp) */
  readonly grammarConstraints: boolean;
};
```

**Step 4: Add method to LLMService interface**

In `packages/llm-provider/src/llm-service.ts`, add after `getModelConfig`:

```typescript
    /**
     * Report structured output capabilities for this provider.
     * Used by the structured output pipeline to select optimal JSON extraction strategy.
     */
    readonly getStructuredOutputCapabilities: () => Effect.Effect<StructuredOutputCapabilities, never>;
```

Add import: `import type { StructuredOutputCapabilities } from "./types.js";`

**Step 5: Update TestLLMService**

In `packages/llm-provider/src/testing.ts`, add to the returned service object:

```typescript
getStructuredOutputCapabilities: () =>
  Effect.succeed({
    nativeJsonMode: true,
    jsonSchemaEnforcement: false,
    prefillSupport: false,
    grammarConstraints: false,
  }),
```

**Step 6: Update each provider adapter**

For each provider file in `packages/llm-provider/src/providers/`, add `getStructuredOutputCapabilities` to the service object returned by the Layer:

| Provider | `nativeJsonMode` | `jsonSchemaEnforcement` | `prefillSupport` | `grammarConstraints` |
|---|---|---|---|---|
| `anthropic.ts` | `false` | `false` | `true` | `false` |
| `openai.ts` | `true` | `true` | `false` | `false` |
| `gemini.ts` | `true` | `false` | `false` | `false` |
| `local.ts` (Ollama) | `true` | `false` | `false` | `true` |
| `litellm.ts` | `false` | `false` | `false` | `false` |

Each implementation is a one-liner: `getStructuredOutputCapabilities: () => Effect.succeed({ ... })`.

**Step 7: Run tests**

Run: `cd packages/llm-provider && bun test tests/structured-output-caps.test.ts`
Expected: PASS

Run: `cd packages/llm-provider && bun test`
Expected: All existing tests PASS (no interface break since new method is added, not changed)

**Step 8: Commit**

```bash
git add packages/llm-provider/src/ packages/llm-provider/tests/structured-output-caps.test.ts
git commit -m "feat(llm-provider): StructuredOutputCapabilities — per-provider JSON mode, schema enforcement, prefill support"
```

---

### Task 5: PlanExecuteConfig Extension

**Files:**
- Modify: `packages/reasoning/src/types/config.ts`

**Step 1: Write the failing test**

Create `packages/reasoning/tests/types/plan-config.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import { PlanExecuteConfigSchema, defaultReasoningConfig } from "../../src/types/config.js";

describe("PlanExecuteConfig extensions", () => {
  it("accepts new planMode field", () => {
    const config = Schema.decodeSync(PlanExecuteConfigSchema)({
      maxRefinements: 1,
      reflectionDepth: "deep",
      planMode: "dag",
    });
    expect(config.planMode).toBe("dag");
  });

  it("accepts stepRetries and patchStrategy", () => {
    const config = Schema.decodeSync(PlanExecuteConfigSchema)({
      maxRefinements: 2,
      reflectionDepth: "shallow",
      stepRetries: 2,
      patchStrategy: "replan-remaining",
    });
    expect(config.stepRetries).toBe(2);
    expect(config.patchStrategy).toBe("replan-remaining");
  });

  it("defaults are backward compatible", () => {
    const config = defaultReasoningConfig.strategies.planExecute;
    expect(config.maxRefinements).toBe(2);
    expect(config.reflectionDepth).toBe("deep");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/reasoning && bun test tests/types/plan-config.test.ts`
Expected: FAIL — `planMode` not in schema

**Step 3: Update PlanExecuteConfigSchema**

In `packages/reasoning/src/types/config.ts`, replace the existing `PlanExecuteConfigSchema` (lines 13-17):

```typescript
export const PlanExecuteConfigSchema = Schema.Struct({
  maxRefinements: Schema.Number.pipe(Schema.int(), Schema.positive()),
  reflectionDepth: Schema.Literal("shallow", "deep"),
  stepKernelMaxIterations: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
  planMode: Schema.optional(Schema.Literal("linear", "dag")),
  stepRetries: Schema.optional(Schema.Number.pipe(Schema.int())),
  patchStrategy: Schema.optional(Schema.Literal("in-place", "replan-remaining")),
});
```

No changes to default config needed — the new fields are all `Schema.optional`.

**Step 4: Run test to verify it passes**

Run: `cd packages/reasoning && bun test tests/types/plan-config.test.ts`
Expected: 3 tests PASS

Run: `cd packages/reasoning && bun test`
Expected: All existing tests PASS

**Step 5: Commit**

```bash
git add packages/reasoning/src/types/config.ts packages/reasoning/tests/types/plan-config.test.ts
git commit -m "feat(reasoning): extend PlanExecuteConfig — planMode, stepRetries, patchStrategy"
```

---

### Task 6: SQLite Plan Tables

**Files:**
- Modify: `packages/memory/src/database.ts`

**Step 1: Write the failing test**

Create `packages/memory/tests/plan-tables.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "bun:test";
import { Effect } from "effect";
import { MemoryDatabase, MemoryDatabaseLive } from "../src/database.js";
import { defaultMemoryConfig } from "../src/types.js";
import * as fs from "node:fs";
import * as path from "node:path";

const TEST_DB_DIR = "/tmp/test-plan-tables";
const TEST_DB = path.join(TEST_DB_DIR, "test.db");

afterEach(() => {
  try { fs.unlinkSync(TEST_DB); } catch {}
  try { fs.unlinkSync(TEST_DB + "-wal"); } catch {}
  try { fs.unlinkSync(TEST_DB + "-shm"); } catch {}
  try { fs.rmSync(TEST_DB_DIR, { recursive: true }); } catch {}
});

describe("Plan SQLite tables", () => {
  it("creates plans table on database init", async () => {
    const config = { ...defaultMemoryConfig("test-agent"), dbPath: TEST_DB };
    const layer = MemoryDatabaseLive(config);

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const db = yield* MemoryDatabase;
          return yield* db.query<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='plans'",
          );
        }).pipe(Effect.provide(layer)),
      ),
    );
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("plans");
  });

  it("creates plan_steps table on database init", async () => {
    const config = { ...defaultMemoryConfig("test-agent"), dbPath: TEST_DB };
    const layer = MemoryDatabaseLive(config);

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const db = yield* MemoryDatabase;
          return yield* db.query<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='plan_steps'",
          );
        }).pipe(Effect.provide(layer)),
      ),
    );
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("plan_steps");
  });

  it("inserts and reads back a plan", async () => {
    const config = { ...defaultMemoryConfig("test-agent"), dbPath: TEST_DB };
    const layer = MemoryDatabaseLive(config);

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const db = yield* MemoryDatabase;
          yield* db.exec(
            `INSERT INTO plans (id, task_id, agent_id, goal, mode, status, version, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ["p_test", "task-1", "agent-1", "Test goal", "linear", "active", 1, "2026-03-03T00:00:00Z", "2026-03-03T00:00:00Z"],
          );
          return yield* db.query<{ id: string; goal: string }>("SELECT id, goal FROM plans WHERE id = ?", ["p_test"]);
        }).pipe(Effect.provide(layer)),
      ),
    );
    expect(result.length).toBe(1);
    expect(result[0].goal).toBe("Test goal");
  });

  it("inserts plan steps with foreign key to plans", async () => {
    const config = { ...defaultMemoryConfig("test-agent"), dbPath: TEST_DB };
    const layer = MemoryDatabaseLive(config);

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const db = yield* MemoryDatabase;
          yield* db.exec(
            `INSERT INTO plans (id, task_id, agent_id, goal, mode, status, version, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ["p_fk", "task-1", "agent-1", "FK test", "linear", "active", 1, "2026-03-03T00:00:00Z", "2026-03-03T00:00:00Z"],
          );
          yield* db.exec(
            `INSERT INTO plan_steps (id, plan_id, seq, title, instruction, type, status)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ["s1", "p_fk", 0, "Step 1", "Do something", "tool_call", "pending"],
          );
          return yield* db.query<{ id: string; title: string }>("SELECT id, title FROM plan_steps WHERE plan_id = ?", ["p_fk"]);
        }).pipe(Effect.provide(layer)),
      ),
    );
    expect(result.length).toBe(1);
    expect(result[0].title).toBe("Step 1");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/memory && bun test tests/plan-tables.test.ts`
Expected: FAIL — no `plans` table

**Step 3: Add plan tables to SCHEMA_SQL**

In `packages/memory/src/database.ts`, add before the closing backtick of `SCHEMA_SQL` (before line 166):

```sql

  -- Plan persistence tables
  CREATE TABLE IF NOT EXISTS plans (
    id          TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL,
    agent_id    TEXT NOT NULL,
    goal        TEXT NOT NULL,
    mode        TEXT NOT NULL DEFAULT 'linear',
    status      TEXT NOT NULL DEFAULT 'active',
    version     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    total_tokens INTEGER DEFAULT 0,
    total_cost  REAL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_plans_agent_status ON plans(agent_id, status);
  CREATE INDEX IF NOT EXISTS idx_plans_task ON plans(task_id);

  CREATE TABLE IF NOT EXISTS plan_steps (
    id          TEXT PRIMARY KEY,
    plan_id     TEXT NOT NULL REFERENCES plans(id),
    seq         INTEGER NOT NULL,
    title       TEXT NOT NULL,
    instruction TEXT NOT NULL,
    type        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    tool_name   TEXT,
    tool_args   TEXT,
    tool_hints  TEXT,
    depends_on  TEXT,
    result      TEXT,
    error       TEXT,
    retries     INTEGER DEFAULT 0,
    tokens_used INTEGER DEFAULT 0,
    started_at  TEXT,
    completed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_plan_steps_plan ON plan_steps(plan_id, seq);
```

**Step 4: Run test to verify it passes**

Run: `cd packages/memory && bun test tests/plan-tables.test.ts`
Expected: 4 tests PASS

**Step 5: Commit**

```bash
git add packages/memory/src/database.ts packages/memory/tests/plan-tables.test.ts
git commit -m "feat(memory): plans + plan_steps SQLite tables for structured plan persistence"
```

---

### Task 7: PlanStore Service

**Files:**
- Create: `packages/memory/src/services/plan-store.ts`
- Modify: `packages/memory/src/index.ts`

**Step 1: Write the failing test**

Create `packages/memory/tests/plan-store.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "bun:test";
import { Effect } from "effect";
import { MemoryDatabaseLive } from "../src/database.js";
import { PlanStoreService, PlanStoreServiceLive } from "../src/services/plan-store.js";
import { defaultMemoryConfig } from "../src/types.js";
import type { Plan } from "@reactive-agents/reasoning";
import * as fs from "node:fs";
import * as path from "node:path";

const TEST_DB_DIR = "/tmp/test-plan-store";
const TEST_DB = path.join(TEST_DB_DIR, "test.db");

const makeLayer = () => PlanStoreServiceLive.pipe(
  Effect.Layer.provide(MemoryDatabaseLive({ ...defaultMemoryConfig("test-agent"), dbPath: TEST_DB })),
);

const makePlan = (id: string, goal: string): Plan => ({
  id,
  taskId: "task-1",
  agentId: "agent-1",
  goal,
  mode: "linear",
  status: "active",
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  totalTokens: 0,
  totalCost: 0,
  steps: [
    { id: "s1", seq: 0, title: "Step 1", instruction: "Do A", type: "tool_call", status: "pending", retries: 0, tokensUsed: 0, toolName: "web-search", toolArgs: { query: "test" } },
    { id: "s2", seq: 1, title: "Step 2", instruction: "Analyze", type: "analysis", status: "pending", retries: 0, tokensUsed: 0 },
  ],
});

afterEach(() => {
  try { fs.unlinkSync(TEST_DB); } catch {}
  try { fs.unlinkSync(TEST_DB + "-wal"); } catch {}
  try { fs.unlinkSync(TEST_DB + "-shm"); } catch {}
  try { fs.rmSync(TEST_DB_DIR, { recursive: true }); } catch {}
});

describe("PlanStoreService", () => {
  it("saves and retrieves a plan with steps", async () => {
    const plan = makePlan("p_save1", "Test save");

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* PlanStoreService;
          yield* store.savePlan(plan);
          return yield* store.getPlan("p_save1");
        }).pipe(Effect.provide(makeLayer())),
      ),
    );

    expect(result).not.toBeNull();
    expect(result!.id).toBe("p_save1");
    expect(result!.goal).toBe("Test save");
    expect(result!.steps.length).toBe(2);
    expect(result!.steps[0].toolName).toBe("web-search");
    expect(result!.steps[1].type).toBe("analysis");
  });

  it("getActivePlan returns active plan for agent+task", async () => {
    const plan = makePlan("p_active1", "Active test");

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* PlanStoreService;
          yield* store.savePlan(plan);
          return yield* store.getActivePlan("agent-1", "task-1");
        }).pipe(Effect.provide(makeLayer())),
      ),
    );

    expect(result).not.toBeNull();
    expect(result!.id).toBe("p_active1");
  });

  it("updateStepStatus marks step as completed", async () => {
    const plan = makePlan("p_step1", "Step status test");

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* PlanStoreService;
          yield* store.savePlan(plan);
          yield* store.updateStepStatus("s1", {
            status: "completed",
            result: "Search returned 10 results",
            tokensUsed: 150,
          });
          return yield* store.getPlan("p_step1");
        }).pipe(Effect.provide(makeLayer())),
      ),
    );

    expect(result!.steps[0].status).toBe("completed");
    expect(result!.steps[0].result).toBe("Search returned 10 results");
    expect(result!.steps[0].tokensUsed).toBe(150);
  });

  it("patchRemainingSteps replaces steps from given seq", async () => {
    const plan = makePlan("p_patch1", "Patch test");

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* PlanStoreService;
          yield* store.savePlan(plan);
          // Mark step 1 as completed
          yield* store.updateStepStatus("s1", { status: "completed", result: "Done" });
          // Patch from seq=1 (replace step 2 with new steps)
          yield* store.patchRemainingSteps("p_patch1", 1, [
            { id: "s2_new", seq: 1, title: "New Step 2", instruction: "Better approach", type: "composite", status: "pending", retries: 0, tokensUsed: 0, toolHints: ["file-read"] },
            { id: "s3_new", seq: 2, title: "Step 3", instruction: "Final step", type: "analysis", status: "pending", retries: 0, tokensUsed: 0 },
          ]);
          return yield* store.getPlan("p_patch1");
        }).pipe(Effect.provide(makeLayer())),
      ),
    );

    expect(result!.steps.length).toBe(3);
    expect(result!.steps[0].status).toBe("completed");
    expect(result!.steps[1].id).toBe("s2_new");
    expect(result!.steps[1].title).toBe("New Step 2");
    expect(result!.steps[2].id).toBe("s3_new");
  });

  it("getRecentPlans returns plans ordered by creation", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* PlanStoreService;
          yield* store.savePlan(makePlan("p_r1", "First"));
          yield* store.savePlan(makePlan("p_r2", "Second"));
          return yield* store.getRecentPlans("agent-1", 5);
        }).pipe(Effect.provide(makeLayer())),
      ),
    );

    expect(result.length).toBe(2);
  });

  it("returns null for nonexistent plan", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* PlanStoreService;
          return yield* store.getPlan("nonexistent");
        }).pipe(Effect.provide(makeLayer())),
      ),
    );

    expect(result).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/memory && bun test tests/plan-store.test.ts`
Expected: FAIL — module not found

**Step 3: Write PlanStoreService implementation**

Create `packages/memory/src/services/plan-store.ts` — this is a full Effect-TS service following the existing patterns in the memory package. The service provides: `savePlan`, `getPlan`, `getActivePlan`, `updateStepStatus`, `patchRemainingSteps`, `getRecentPlans`.

Implementation follows the exact pattern of `EpisodicMemoryService`: `Context.Tag("PlanStoreService")`, `Layer.effect(PlanStoreService, Effect.gen(function* () { const db = yield* MemoryDatabase; ... }))`.

Key methods:
- `savePlan(plan)` — INSERT plan row + INSERT each step row
- `getPlan(id)` — SELECT plan + SELECT steps WHERE plan_id, join in code
- `getActivePlan(agentId, taskId)` — SELECT plan WHERE agent_id AND task_id AND status='active'
- `updateStepStatus(stepId, update)` — UPDATE plan_steps SET status, result, error, tokens_used, completed_at
- `patchRemainingSteps(planId, fromSeq, newSteps)` — DELETE plan_steps WHERE plan_id AND seq >= fromSeq, INSERT new steps
- `getRecentPlans(agentId, limit)` — SELECT plans WHERE agent_id ORDER BY created_at DESC LIMIT

**Step 4: Add export to index.ts**

Add to `packages/memory/src/index.ts`:

```typescript
export {
  PlanStoreService,
  PlanStoreServiceLive,
} from "./services/plan-store.js";
```

**Step 5: Run test to verify it passes**

Run: `cd packages/memory && bun test tests/plan-store.test.ts`
Expected: 6 tests PASS

**Step 6: Commit**

```bash
git add packages/memory/src/services/plan-store.ts packages/memory/src/index.ts packages/memory/tests/plan-store.test.ts
git commit -m "feat(memory): PlanStoreService — SQLite CRUD for structured plan persistence"
```

---

### Task 8: Plan Generation Prompts

**Files:**
- Create: `packages/reasoning/src/strategies/shared/plan-prompts.ts`
- Modify: `packages/reasoning/src/strategies/shared/index.ts`

**Step 1: Write the failing test**

Create `packages/reasoning/tests/strategies/shared/plan-prompts.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import {
  buildPlanGenerationPrompt,
  buildPatchPrompt,
  buildStepExecutionPrompt,
  buildReflectionPrompt,
} from "../../../src/strategies/shared/plan-prompts.js";
import type { PlanStep } from "../../../src/types/plan.js";

describe("Plan prompts", () => {
  it("buildPlanGenerationPrompt includes goal and tools", () => {
    const prompt = buildPlanGenerationPrompt({
      goal: "Send morning briefing",
      tools: [
        { name: "github/list_commits", signature: "({ owner, repo, perPage })" },
        { name: "signal/send_message_to_user", signature: "({ recipient, message })" },
      ],
      pastPatterns: [],
      modelTier: "mid",
    });

    expect(prompt).toContain("Send morning briefing");
    expect(prompt).toContain("github/list_commits");
    expect(prompt).toContain("signal/send_message_to_user");
    expect(prompt).toContain('"type"');
    expect(prompt).toContain("tool_call");
    expect(prompt).toContain("JSON");
  });

  it("buildPlanGenerationPrompt includes past patterns when available", () => {
    const prompt = buildPlanGenerationPrompt({
      goal: "Send briefing",
      tools: [],
      pastPatterns: ["3-step linear: tool_call → analysis → tool_call"],
      modelTier: "frontier",
    });

    expect(prompt).toContain("SIMILAR PAST PLANS");
    expect(prompt).toContain("3-step linear");
  });

  it("buildPatchPrompt shows completed and failed steps", () => {
    const steps: PlanStep[] = [
      { id: "s1", seq: 0, title: "Fetch", instruction: "Get data", type: "tool_call", status: "completed", retries: 0, tokensUsed: 100, result: "10 commits" },
      { id: "s2", seq: 1, title: "Draft", instruction: "Write msg", type: "analysis", status: "failed", retries: 1, tokensUsed: 50, error: "Empty response" },
      { id: "s3", seq: 2, title: "Send", instruction: "Send msg", type: "tool_call", status: "pending", retries: 0, tokensUsed: 0 },
    ];
    const prompt = buildPatchPrompt("Send briefing", steps);

    expect(prompt).toContain("s1");
    expect(prompt).toContain("completed");
    expect(prompt).toContain("failed");
    expect(prompt).toContain("Empty response");
    expect(prompt).toContain("pending");
  });

  it("buildStepExecutionPrompt includes overall goal and step context", () => {
    const prompt = buildStepExecutionPrompt({
      goal: "Send morning briefing",
      step: { id: "s2", seq: 1, title: "Draft briefing", instruction: "Analyze commits, write message", type: "analysis", status: "in_progress", retries: 0, tokensUsed: 0 },
      stepIndex: 1,
      totalSteps: 3,
      priorResults: [{ stepId: "s1", title: "Fetch commits", result: "10 commits found" }],
      scopedTools: [],
    });

    expect(prompt).toContain("OVERALL GOAL: Send morning briefing");
    expect(prompt).toContain("CURRENT STEP (2 of 3)");
    expect(prompt).toContain("Draft briefing");
    expect(prompt).toContain("10 commits found");
  });

  it("buildStepExecutionPrompt includes scoped tools for composite steps", () => {
    const prompt = buildStepExecutionPrompt({
      goal: "Research topic",
      step: { id: "s1", seq: 0, title: "Search", instruction: "Search web", type: "composite", status: "in_progress", retries: 0, tokensUsed: 0, toolHints: ["web-search"] },
      stepIndex: 0,
      totalSteps: 2,
      priorResults: [],
      scopedTools: [{ name: "web-search", signature: "({ query, maxResults? })" }],
    });

    expect(prompt).toContain("web-search");
    expect(prompt).toContain("query");
  });

  it("buildReflectionPrompt lists step results with status", () => {
    const prompt = buildReflectionPrompt("Send briefing", [
      { stepId: "s1", title: "Fetch", status: "completed", result: "10 commits" },
      { stepId: "s2", title: "Draft", status: "completed", result: "Message drafted" },
      { stepId: "s3", title: "Send", status: "completed", result: "Delivered" },
    ]);

    expect(prompt).toContain("SATISFIED");
    expect(prompt).toContain("s1");
    expect(prompt).toContain("10 commits");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/reasoning && bun test tests/strategies/shared/plan-prompts.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `packages/reasoning/src/strategies/shared/plan-prompts.ts` with the 4 prompt builder functions. Each is a pure function returning a string. The prompts follow the design doc:

- `buildPlanGenerationPrompt` — Role & Goal, Available Tools (scoped), Past Patterns, Schema & Output Instructions (tier-adaptive)
- `buildPatchPrompt` — Shows completed/failed/pending steps, asks LLM to rewrite failed+remaining
- `buildStepExecutionPrompt` — OVERALL GOAL header, CURRENT STEP (N of M), DATA FROM PREVIOUS STEPS, scoped tools
- `buildReflectionPrompt` — Lists all step results with status, asks for "SATISFIED:" or improvement description

**Step 4: Add to shared barrel export**

Add to `packages/reasoning/src/strategies/shared/index.ts`:

```typescript
export * from "./plan-prompts.js";
```

**Step 5: Run test to verify it passes**

Run: `cd packages/reasoning && bun test tests/strategies/shared/plan-prompts.test.ts`
Expected: 6 tests PASS

**Step 6: Commit**

```bash
git add packages/reasoning/src/strategies/shared/plan-prompts.ts packages/reasoning/src/strategies/shared/index.ts packages/reasoning/tests/strategies/shared/plan-prompts.test.ts
git commit -m "feat(reasoning): plan generation prompts — tier-adaptive plan/patch/step/reflect prompt builders"
```

---

### Task 9: Rewrite Plan-Execute Strategy

**Files:**
- Modify: `packages/reasoning/src/strategies/plan-execute.ts` (rewrite)
- Modify: `packages/reasoning/tests/strategies/plan-execute.test.ts` (update tests)

This is the largest task. The strategy is rewritten to use structured JSON plans instead of text parsing.

**Step 1: Write new tests**

Rewrite `packages/reasoning/tests/strategies/plan-execute.test.ts` with tests that verify:

1. **Structured plan generation** — LLM returns JSON, plan is hydrated with deterministic IDs
2. **tool_call direct dispatch** — tool_call step calls tool directly without LLM
3. **analysis step uses focused kernel** — analysis step runs scoped kernel, goal-anchored
4. **composite step uses scoped kernel** — only hinted tools visible
5. **Step reference resolution** — `{{from_step:s1}}` resolved in tool args
6. **Step retry on failure** — failed step retried once with error feedback
7. **Patch on double failure** — step fails twice → LLM generates patch for remaining steps
8. **Reflection produces SATISFIED** — successful execution produces synthesized output
9. **Backward compat** — existing test patterns still work (PLAN/EXEC/REFLECT step prefixes)
10. **Plan persistence when PlanStoreService available** — plan saved to store

Tests use `TestLLMServiceLayer` with pattern keys that match the new prompt structures. Tool calls need a mock `ToolService` layer.

**Step 2: Run tests to verify they fail**

Run: `cd packages/reasoning && bun test tests/strategies/plan-execute.test.ts`
Expected: FAIL — new tests reference new behavior

**Step 3: Rewrite plan-execute.ts**

The new strategy flow:

1. **Generate plan** — call `extractStructuredOutput` with `LLMPlanOutputSchema`, using `buildPlanGenerationPrompt`
2. **Hydrate plan** — `hydratePlan(llmOutput, context)` → typed `Plan` with `s1, s2, ...` IDs
3. **Persist plan** — if `PlanStoreService` in context, `savePlan(plan)`
4. **Execute steps** — for each step (topological order for DAG, sequential for linear):
   - `tool_call` with `toolName` + `toolArgs` → resolve references → `toolService.execute()` directly
   - `analysis` → `executeReActKernel` with `buildStepExecutionPrompt`, no tools, max 3 iterations
   - `composite` → `executeReActKernel` with scoped tools from `toolHints`, max 3 iterations
5. **Retry on failure** — if step fails, retry once with error context. If retry fails, call LLM to patch remaining steps via `buildPatchPrompt` + `extractStructuredOutput`
6. **Reflect** — after all steps complete, call LLM with `buildReflectionPrompt`. If "SATISFIED:", synthesize. Otherwise increment refinement.
7. **Persist final state** — update plan status in store

Key imports: `extractStructuredOutput`, `LLMPlanOutputSchema`, `hydratePlan`, `resolveStepReferences`, `buildPlanGenerationPrompt`, `buildPatchPrompt`, `buildStepExecutionPrompt`, `buildReflectionPrompt`, `executeReActKernel`, `PlanStoreService` (via `Effect.serviceOption`).

**Step 4: Run tests to verify they pass**

Run: `cd packages/reasoning && bun test tests/strategies/plan-execute.test.ts`
Expected: All tests PASS

Run: `cd packages/reasoning && bun test`
Expected: All reasoning tests PASS

**Step 5: Commit**

```bash
git add packages/reasoning/src/strategies/plan-execute.ts packages/reasoning/tests/strategies/plan-execute.test.ts
git commit -m "feat(reasoning): rewrite plan-execute — structured JSON plans, typed step dispatch, retry/patch"
```

---

### Task 10: Integration Testing + Build Verification

**Files:**
- No new files — verify everything works together

**Step 1: Run full reasoning test suite**

Run: `cd packages/reasoning && bun test`
Expected: All tests PASS (existing + new)

**Step 2: Run full memory test suite**

Run: `cd packages/memory && bun test`
Expected: All tests PASS (existing + new)

**Step 3: Run full llm-provider test suite**

Run: `cd packages/llm-provider && bun test`
Expected: All tests PASS (existing + new)

**Step 4: Build all packages**

Run: `bun run build`
Expected: All packages build successfully (ESM + DTS)

**Step 5: Run full project test suite**

Run: `bun test`
Expected: All tests PASS across all packages

**Step 6: Count test delta**

Record the new test count and file count for CHANGELOG/CLAUDE.md update.

**Step 7: Commit any fixes**

If any build issues or test failures were found and fixed:

```bash
git add -A
git commit -m "fix: integration issues from structured plan engine"
```

---

### Task 11: Documentation Updates

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md`

**Step 1: Update CHANGELOG.md**

Add to `[Unreleased]` section:

```markdown
### Structured Plan Engine

- **`packages/reasoning/src/types/plan.ts`** — `Plan`, `PlanStep`, `LLMPlanOutput` type-safe schemas. `hydratePlan()` generates deterministic short IDs (`s1`, `s2`). `resolveStepReferences()` for `{{from_step:sN}}` interpolation.
- **`packages/reasoning/src/structured-output/`** — Reusable 4-layer structured output pipeline: high-signal prompting → JSON repair → Schema validation → retry with error feedback. `extractJsonBlock()` and `repairJson()` handle markdown fences, trailing commas, single quotes, truncated JSON.
- **`packages/llm-provider`** — `StructuredOutputCapabilities` interface. Each provider reports JSON mode, schema enforcement, prefill, and grammar support.
- **`packages/memory`** — `plans` + `plan_steps` SQLite tables. `PlanStoreService` for persistent plan CRUD.
- **`packages/reasoning/src/strategies/plan-execute.ts`** — Rewritten with structured JSON plans, hybrid step execution (tool_call direct dispatch, analysis/composite scoped kernel), graduated retry → patch → replan, plan persistence.
- **`PlanExecuteConfig`** — Extended with `planMode` ("linear" | "dag"), `stepRetries`, `patchStrategy`.
```

**Step 2: Update CLAUDE.md**

Update test counts, add Structured Plan Engine milestone to history.

**Step 3: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: structured plan engine — CHANGELOG, CLAUDE.md updates"
```

---

## Dependency Graph

```
Task 1 (Plan types) ─────────────────────────────┐
Task 2 (JSON repair) ────────────────┐            │
Task 3 (Structured output pipeline) ←┘            │
Task 4 (Provider capabilities) ←── Task 3         │
Task 5 (Config extension) ───────────────────────→│
Task 6 (SQLite tables) ─────────────┐             │
Task 7 (PlanStore service) ←────────┘             │
Task 8 (Plan prompts) ───────────────────────────→│
Task 9 (Rewrite plan-execute) ←── ALL Tasks 1-8   │
Task 10 (Integration) ←── Task 9                  │
Task 11 (Docs) ←── Task 10                        │
```

**Parallel waves:**
- Wave 1: Tasks 1, 2, 4, 5, 6 (all independent)
- Wave 2: Tasks 3, 7, 8 (depend on Wave 1)
- Wave 3: Task 9 (depends on all)
- Wave 4: Tasks 10, 11 (sequential)
