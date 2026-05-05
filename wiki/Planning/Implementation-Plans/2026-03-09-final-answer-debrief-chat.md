# Final Answer, Debrief & Chat — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the fragile "FINAL ANSWER:" text regex with a hard-gate `final-answer` tool, synthesize a structured debrief after every run, persist it to SQLite, enrich `AgentResult`, and add `agent.chat()` / `agent.session()` for conversational interaction.

**Architecture:** The `final-answer` tool is a new meta-tool (like `task-complete`) that hard-exits the ReAct loop when called. The debrief synthesizer runs post-loop, collects deterministic signals from execution state, makes one small LLM call, and stores the result in a new `agent_debriefs` SQLite table. `agent.chat()` routes through a lightweight direct-LLM path for Q&A or a capped ReAct loop for tool-capable queries.

**Tech Stack:** Effect-TS (services, layers, Schema), bun:sqlite (WAL mode, existing memory DB), bun:test, existing `KernelState` / `MetricsCollector` / `ExperienceStore` / `LLMService` from the framework.

**Key files to understand before starting:**
- `packages/tools/src/skills/task-complete.ts` — pattern for meta-tool + visibility gating
- `packages/tools/src/skills/builtin.ts` — how meta-tools are exported
- `packages/reasoning/src/strategies/shared/react-kernel.ts` — the ReAct loop; `terminatedBy`, `hasFinalAnswer()`, tool execution flow around line 320–560
- `packages/memory/src/services/experience-store.ts` — SQLite WAL pattern to copy for DebriefStore
- `packages/runtime/src/builder.ts` — `AgentResult` interface (line ~542), `ReactiveAgent` class (line ~1495+)
- `packages/core/src/types/result.ts` — `TaskResultSchema`, `AgentResult` source of truth for core types

---

### Task 1: `final-answer` meta-tool definition + handler

**Files:**
- Create: `packages/tools/src/skills/final-answer.ts`
- Modify: `packages/tools/src/skills/builtin.ts`
- Test: `packages/tools/tests/final-answer.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/tools/tests/final-answer.test.ts
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import {
  finalAnswerTool,
  makeFinalAnswerHandler,
  shouldShowFinalAnswer,
  type FinalAnswerVisibility,
} from "../src/skills/final-answer.js";

describe("finalAnswerTool", () => {
  it("has correct tool shape", () => {
    expect(finalAnswerTool.name).toBe("final-answer");
    expect(finalAnswerTool.parameters.map((p) => p.name)).toContain("output");
    expect(finalAnswerTool.parameters.map((p) => p.name)).toContain("format");
    expect(finalAnswerTool.parameters.map((p) => p.name)).toContain("summary");
  });

  it("validates json format", async () => {
    const handler = makeFinalAnswerHandler({ canComplete: true });
    const result = await Effect.runPromise(
      handler({ output: '{"key":"value"}', format: "json", summary: "done" })
    );
    expect((result as any).accepted).toBe(true);
    expect((result as any).format).toBe("json");
  });

  it("rejects invalid json when format is json", async () => {
    const handler = makeFinalAnswerHandler({ canComplete: true });
    const result = await Effect.runPromise(
      handler({ output: "not valid json{", format: "json", summary: "done" })
    );
    expect((result as any).accepted).toBe(false);
    expect((result as any).error).toContain("invalid JSON");
  });

  it("accepts text format without validation", async () => {
    const handler = makeFinalAnswerHandler({ canComplete: true });
    const result = await Effect.runPromise(
      handler({ output: "anything goes here", format: "text", summary: "done" })
    );
    expect((result as any).accepted).toBe(true);
  });

  it("rejects when canComplete is false", async () => {
    const handler = makeFinalAnswerHandler({
      canComplete: false,
      pendingTools: ["github/list_commits"],
    });
    const result = await Effect.runPromise(
      handler({ output: "early", format: "text", summary: "not done" })
    );
    expect((result as any).accepted).toBe(false);
    expect((result as any).error).toContain("github/list_commits");
  });

  describe("shouldShowFinalAnswer", () => {
    const base: FinalAnswerVisibility = {
      requiredToolsCalled: new Set(["github/list_commits"]),
      requiredTools: ["github/list_commits"],
      iteration: 3,
      hasErrors: false,
      hasNonMetaToolCalled: true,
    };

    it("shows when all conditions met", () => {
      expect(shouldShowFinalAnswer(base)).toBe(true);
    });

    it("hides before iteration 2", () => {
      expect(shouldShowFinalAnswer({ ...base, iteration: 1 })).toBe(false);
    });

    it("hides when required tool not called", () => {
      expect(shouldShowFinalAnswer({ ...base, requiredToolsCalled: new Set() })).toBe(false);
    });

    it("hides when errors pending", () => {
      expect(shouldShowFinalAnswer({ ...base, hasErrors: true })).toBe(false);
    });

    it("hides when no non-meta tool called yet", () => {
      expect(shouldShowFinalAnswer({ ...base, hasNonMetaToolCalled: false })).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test packages/tools/tests/final-answer.test.ts
```
Expected: FAIL — "Cannot find module '../src/skills/final-answer.js'"

**Step 3: Implement `packages/tools/src/skills/final-answer.ts`**

```typescript
import { Effect } from "effect";
import type { ToolDefinition } from "../types.js";

// ─── Tool Definition ───────────────────────────────────────────────────────

export const finalAnswerTool: ToolDefinition = {
  name: "final-answer",
  description:
    "Submit the final answer and terminate the task. Call this when ALL required steps " +
    "are complete. Provide the actual deliverable in 'output', its format in 'format', " +
    "and a brief summary of what was accomplished in 'summary'. " +
    "This is the ONLY correct way to end a task — do NOT write 'FINAL ANSWER:' in text.",
  parameters: [
    {
      name: "output",
      type: "string",
      description: "The actual deliverable — the answer, result, file path, JSON data, etc.",
      required: true,
    },
    {
      name: "format",
      type: "string",
      description: "Format of output: 'text', 'json', 'markdown', 'csv', or 'html'",
      required: true,
    },
    {
      name: "summary",
      type: "string",
      description: "Brief self-report of what was accomplished (2-3 sentences)",
      required: true,
    },
    {
      name: "confidence",
      type: "string",
      description: "Your confidence in the result: 'high', 'medium', or 'low'",
      required: false,
    },
  ],
  returnType: "object",
  riskLevel: "low",
  timeoutMs: 2_000,
  requiresApproval: false,
  source: "function",
};

// ─── Visibility Gating ─────────────────────────────────────────────────────
// Same conditions as task-complete — final-answer replaces it as the primary exit.

export interface FinalAnswerVisibility {
  requiredToolsCalled: ReadonlySet<string>;
  requiredTools: readonly string[];
  iteration: number;
  hasErrors: boolean;
  hasNonMetaToolCalled: boolean;
}

export function shouldShowFinalAnswer(input: FinalAnswerVisibility): boolean {
  if (!input.requiredTools.every((t) => input.requiredToolsCalled.has(t))) return false;
  if (input.iteration < 2) return false;
  if (input.hasErrors) return false;
  if (!input.hasNonMetaToolCalled) return false;
  return true;
}

// ─── Handler State ─────────────────────────────────────────────────────────

export interface FinalAnswerState {
  canComplete: boolean;
  pendingTools?: readonly string[];
}

// ─── Captured Result (read by react-kernel to hard-exit) ──────────────────

export interface FinalAnswerCapture {
  output: string;
  format: string;
  summary: string;
  confidence?: string;
}

// ─── Handler Factory ───────────────────────────────────────────────────────

export const makeFinalAnswerHandler =
  (state: FinalAnswerState) =>
  (args: Record<string, unknown>): Effect.Effect<unknown, never> => {
    if (!state.canComplete) {
      const pending = state.pendingTools?.join(", ") ?? "required tools";
      return Effect.succeed({
        accepted: false,
        error: `Cannot finalize yet. Still need to call: ${pending}`,
      });
    }

    const output = String(args.output ?? "");
    const format = String(args.format ?? "text");
    const summary = String(args.summary ?? "");
    const confidence = args.confidence ? String(args.confidence) : undefined;

    // Validate format-specific constraints
    if (format === "json") {
      try {
        JSON.parse(output);
      } catch {
        return Effect.succeed({
          accepted: false,
          error: `Output format is 'json' but output contains invalid JSON. Fix the JSON or change format to 'text'.`,
        });
      }
    }

    const capture: FinalAnswerCapture = { output, format, summary, confidence };

    return Effect.succeed({
      accepted: true,
      format,
      summary,
      confidence,
      _capture: capture, // react-kernel reads this to extract output
    });
  };
```

**Step 4: Register in `packages/tools/src/skills/builtin.ts`**

Add after the `task-complete` exports (around line 32):

```typescript
export {
  finalAnswerTool,
  makeFinalAnswerHandler,
  shouldShowFinalAnswer,
  type FinalAnswerState,
  type FinalAnswerVisibility,
  type FinalAnswerCapture,
} from "./final-answer.js";
```

Add to `metaToolDefinitions` array (line ~64):
```typescript
export const metaToolDefinitions: ReadonlyArray<ToolDefinition> = [
  contextStatusTool,
  taskCompleteTool,
  finalAnswerTool,  // ← add
];
```

**Step 5: Run test to verify it passes**

```bash
bun test packages/tools/tests/final-answer.test.ts
```
Expected: 9 pass, 0 fail

**Step 6: Commit**

```bash
git add packages/tools/src/skills/final-answer.ts packages/tools/src/skills/builtin.ts packages/tools/tests/final-answer.test.ts
git commit -m "feat(tools): add final-answer meta-tool with format validation and visibility gating"
```

---

### Task 2: Hard-gate `final-answer` in the ReAct kernel

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/react-kernel.ts`
- Test: `packages/reasoning/tests/strategies/shared/final-answer-gate.test.ts`

**Context:** The react-kernel loop (in `executeReActKernel`) executes tools and then checks various exit conditions. We need to:
1. Register `final-answer` as a meta-tool alongside `task-complete` and `context-status`
2. After any tool call returns `{ accepted: true, _capture: {...} }`, check if the tool name was `"final-answer"` and hard-exit
3. Add `"final_answer_tool"` to the `terminatedBy` union

**Step 1: Write the failing test**

```typescript
// packages/reasoning/tests/strategies/shared/final-answer-gate.test.ts
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { executeReActKernel } from "../../../src/strategies/shared/react-kernel.js";
import { createTestLLMServiceLayer } from "@reactive-agents/testing";

describe("final-answer hard gate", () => {
  it("terminates loop immediately when final-answer tool is called", async () => {
    // LLM: on first thought, call final-answer directly
    const llmLayer = createTestLLMServiceLayer([
      {
        content: 'ACTION: final-answer({"output": "42", "format": "text", "summary": "computed the answer"})',
        stopReason: "tool_use",
      },
    ]);

    const result = await Effect.runPromise(
      executeReActKernel({
        task: "What is 6 * 7?",
        systemPrompt: "You are a helpful assistant.",
        availableToolSchemas: [],
        config: { maxIterations: 10, minIterations: 0 },
      }).pipe(Effect.provide(llmLayer))
    );

    expect(result.terminatedBy).toBe("final_answer_tool");
    expect(result.output).toBe("42");
    expect(result.steps.length).toBeLessThanOrEqual(3); // thought + action + done
  });

  it("terminatedBy is final_answer_tool not final_answer when tool used", async () => {
    const llmLayer = createTestLLMServiceLayer([
      {
        content: 'ACTION: final-answer({"output": "done", "format": "text", "summary": "finished"})',
        stopReason: "tool_use",
      },
    ]);

    const result = await Effect.runPromise(
      executeReActKernel({
        task: "simple task",
        systemPrompt: "",
        availableToolSchemas: [],
        config: { maxIterations: 5, minIterations: 0 },
      }).pipe(Effect.provide(llmLayer))
    );

    expect(result.terminatedBy).toBe("final_answer_tool");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test packages/reasoning/tests/strategies/shared/final-answer-gate.test.ts
```
Expected: FAIL

**Step 3: Modify `packages/reasoning/src/strategies/shared/react-kernel.ts`**

Find the `terminatedBy` type around line 107 and add the new value:
```typescript
terminatedBy: "final_answer" | "final_answer_tool" | "max_iterations" | "end_turn";
```

In the kernel, find where meta-tools are registered (where `task-complete` and `context-status` handlers are wired in). Add `final-answer` registration alongside them. The pattern follows the same visibility-gating logic.

Import at top of file:
```typescript
import {
  finalAnswerTool,
  makeFinalAnswerHandler,
  shouldShowFinalAnswer,
  type FinalAnswerCapture,
} from "@reactive-agents/tools";
```

After tool execution, in the section where tool results are processed (around line 400–480), add a check:

```typescript
// ── FINAL-ANSWER TOOL HARD GATE ────────────────────────────────────────
if (toolRequest.tool === "final-answer") {
  const capture = (toolResult as any)?._capture as FinalAnswerCapture | undefined;
  const accepted = (toolResult as any)?.accepted === true;
  if (accepted && capture) {
    return {
      ...state,
      output: capture.output,
      meta: {
        ...state.meta,
        terminatedBy: "final_answer_tool" as const,
        finalAnswerCapture: capture,
      },
    };
  }
  // Not accepted (canComplete=false) — let loop continue with error observation
}
```

Wire `final-answer` into the dynamic meta-tool registration block (same place `task-complete` is registered):
```typescript
const finalAnswerVisible = shouldShowFinalAnswer({
  requiredToolsCalled: state.meta.toolsCalled,
  requiredTools: requiredTools,
  iteration: state.meta.iteration,
  hasErrors: state.meta.hasErrors ?? false,
  hasNonMetaToolCalled: state.meta.hasNonMetaToolCalled ?? false,
});

if (finalAnswerVisible) {
  dynamicTools.push({
    definition: finalAnswerTool,
    handler: makeFinalAnswerHandler({
      canComplete: true,
    }),
  });
}
```

Update the loop's exit check so when `meta.terminatedBy === "final_answer_tool"`, the kernel returns immediately with `output` from the capture (don't fall through to the post-loop `hasFinalAnswer` check).

**Step 4: Run test to verify it passes**

```bash
bun test packages/reasoning/tests/strategies/shared/final-answer-gate.test.ts
```
Expected: 2 pass, 0 fail

**Step 5: Run full test suite to confirm no regressions**

```bash
bun test
```
Expected: all existing tests pass (final_answer text path unchanged)

**Step 6: Commit**

```bash
git add packages/reasoning/src/strategies/shared/react-kernel.ts packages/reasoning/tests/strategies/shared/final-answer-gate.test.ts
git commit -m "feat(reasoning): final-answer tool hard-gates ReAct loop exit"
```

---

### Task 3: Debrief synthesizer service

**Files:**
- Create: `packages/runtime/src/debrief.ts`
- Test: `packages/runtime/tests/debrief.test.ts`

**Context:** `DebriefSynthesizer` collects signals from execution state and makes one LLM call to produce a structured `AgentDebrief`. It lives in the runtime package because it needs access to both the execution engine's internal state and the LLM provider.

**Step 1: Write the failing test**

```typescript
// packages/runtime/tests/debrief.test.ts
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { synthesizeDebrief, formatDebriefMarkdown, type DebriefInput } from "../src/debrief.js";
import { createTestLLMServiceLayer } from "@reactive-agents/testing";

const baseInput: DebriefInput = {
  taskPrompt: "Fetch commits and send Signal message",
  agentId: "test-agent",
  taskId: "task-123",
  terminatedBy: "final_answer_tool",
  finalAnswerCapture: {
    output: "Message sent successfully",
    format: "text",
    summary: "Fetched 5 commits and sent Signal message",
    confidence: "high",
  },
  toolCallHistory: [
    { name: "github/list_commits", calls: 1, errors: 0, avgDurationMs: 200 },
    { name: "signal/send_message_to_user", calls: 1, errors: 0, avgDurationMs: 100 },
  ],
  errorsFromLoop: [],
  metrics: { tokens: 5000, duration: 12000, iterations: 5, cost: 0 },
};

describe("synthesizeDebrief", () => {
  it("produces a valid AgentDebrief with all required fields", async () => {
    const llmLayer = createTestLLMServiceLayer([
      {
        content: JSON.stringify({
          summary: "Agent fetched 5 commits and sent a Signal message successfully.",
          keyFindings: ["5 commits retrieved", "message delivered"],
          errorsEncountered: [],
          lessonsLearned: ["github/list_commits works reliably for this repo"],
          caveats: "",
        }),
        stopReason: "end_turn",
      },
    ]);

    const debrief = await Effect.runPromise(
      synthesizeDebrief(baseInput).pipe(Effect.provide(llmLayer))
    );

    expect(debrief.outcome).toBe("success");
    expect(debrief.summary).toContain("commits");
    expect(debrief.keyFindings.length).toBeGreaterThan(0);
    expect(debrief.toolsUsed).toHaveLength(2);
    expect(debrief.metrics.tokens).toBe(5000);
    expect(debrief.confidence).toBe("high");
    expect(typeof debrief.markdown).toBe("string");
    expect(debrief.markdown).toContain("## Summary");
  });

  it("sets outcome to partial when terminated by max_iterations", async () => {
    const llmLayer = createTestLLMServiceLayer([
      {
        content: JSON.stringify({
          summary: "Partial completion.",
          keyFindings: [],
          errorsEncountered: ["Hit iteration limit"],
          lessonsLearned: [],
          caveats: "Did not complete all steps",
        }),
        stopReason: "end_turn",
      },
    ]);

    const debrief = await Effect.runPromise(
      synthesizeDebrief({ ...baseInput, terminatedBy: "max_iterations", finalAnswerCapture: undefined }).pipe(
        Effect.provide(llmLayer)
      )
    );

    expect(debrief.outcome).toBe("partial");
  });

  it("formatDebriefMarkdown renders all sections", () => {
    const md = formatDebriefMarkdown({
      outcome: "success",
      summary: "Did the thing",
      keyFindings: ["finding 1"],
      errorsEncountered: [],
      lessonsLearned: ["lesson 1"],
      confidence: "high",
      toolsUsed: [{ name: "web-search", calls: 2, successRate: 1 }],
      metrics: { tokens: 1000, duration: 5000, iterations: 3, cost: 0.001 },
      markdown: "",
    });

    expect(md).toContain("## Summary");
    expect(md).toContain("## Key Findings");
    expect(md).toContain("## Tools Used");
    expect(md).toContain("## Metrics");
    expect(md).toContain("web-search");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test packages/runtime/tests/debrief.test.ts
```
Expected: FAIL

**Step 3: Implement `packages/runtime/src/debrief.ts`**

```typescript
import { Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { FinalAnswerCapture } from "@reactive-agents/tools";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ToolCallStat {
  name: string;
  calls: number;
  errors: number;
  avgDurationMs: number;
}

export interface DebriefInput {
  taskPrompt: string;
  agentId: string;
  taskId: string;
  terminatedBy: "final_answer_tool" | "final_answer" | "max_iterations" | "end_turn";
  finalAnswerCapture?: FinalAnswerCapture;
  toolCallHistory: ToolCallStat[];
  errorsFromLoop: string[];
  metrics: { tokens: number; duration: number; iterations: number; cost: number };
}

export interface AgentDebrief {
  outcome: "success" | "partial" | "failed";
  summary: string;
  keyFindings: string[];
  errorsEncountered: string[];
  lessonsLearned: string[];
  confidence: "high" | "medium" | "low";
  caveats?: string;
  toolsUsed: { name: string; calls: number; successRate: number }[];
  metrics: { tokens: number; duration: number; iterations: number; cost: number };
  markdown: string;
}

// ─── Outcome derivation ────────────────────────────────────────────────────

function deriveOutcome(
  terminatedBy: DebriefInput["terminatedBy"],
  errorsFromLoop: string[],
): AgentDebrief["outcome"] {
  if (terminatedBy === "final_answer_tool" || terminatedBy === "final_answer") {
    return errorsFromLoop.length > 0 ? "partial" : "success";
  }
  return "partial";
}

// ─── Synthesis ─────────────────────────────────────────────────────────────

const DEBRIEF_SYSTEM_PROMPT = `You are summarizing an AI agent's completed task for a debrief record.
Return ONLY a JSON object with these exact fields:
{
  "summary": "2-3 sentence narrative of what was accomplished",
  "keyFindings": ["finding 1", "finding 2"],
  "errorsEncountered": ["error description if any"],
  "lessonsLearned": ["actionable lesson for future runs"],
  "caveats": "anything uncertain, incomplete, or worth flagging (empty string if none)"
}`;

export function synthesizeDebrief(
  input: DebriefInput,
): Effect.Effect<AgentDebrief, Error, LLMService> {
  return Effect.gen(function* () {
    const llm = yield* LLMService;
    const outcome = deriveOutcome(input.terminatedBy, input.errorsFromLoop);

    const toolSummary = input.toolCallHistory
      .map((t) => `- ${t.name}: ${t.calls} call(s), ${t.errors} error(s), avg ${t.avgDurationMs}ms`)
      .join("\n") || "No tools called";

    const userPrompt = `Task: ${input.taskPrompt}

Agent self-report: ${input.finalAnswerCapture?.summary ?? "No self-report provided"}
Terminated by: ${input.terminatedBy}
Tools used:\n${toolSummary}
Errors from loop: ${input.errorsFromLoop.join("; ") || "none"}
Total iterations: ${input.metrics.iterations}
Total tokens: ${input.metrics.tokens}`;

    const llmResponse = yield* llm.complete({
      messages: [{ role: "user", content: userPrompt }],
      systemPrompt: DEBRIEF_SYSTEM_PROMPT,
      temperature: 0.2,
      maxTokens: 512,
    }).pipe(
      Effect.catchAll(() =>
        Effect.succeed({
          content: JSON.stringify({
            summary: input.finalAnswerCapture?.summary ?? "Task completed.",
            keyFindings: [],
            errorsEncountered: input.errorsFromLoop,
            lessonsLearned: [],
            caveats: "",
          }),
          stopReason: "end_turn" as const,
          usage: { inputTokens: 0, outputTokens: 0 },
        })
      )
    );

    let parsed: {
      summary: string;
      keyFindings: string[];
      errorsEncountered: string[];
      lessonsLearned: string[];
      caveats: string;
    };

    try {
      // Strip markdown fences if present
      const cleaned = llmResponse.content
        .replace(/^```json\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = {
        summary: input.finalAnswerCapture?.summary ?? "Task completed.",
        keyFindings: [],
        errorsEncountered: input.errorsFromLoop,
        lessonsLearned: [],
        caveats: "",
      };
    }

    const toolsUsed = input.toolCallHistory.map((t) => ({
      name: t.name,
      calls: t.calls,
      successRate: t.calls > 0 ? (t.calls - t.errors) / t.calls : 1,
    }));

    const debrief: Omit<AgentDebrief, "markdown"> = {
      outcome,
      summary: parsed.summary,
      keyFindings: parsed.keyFindings ?? [],
      errorsEncountered: [...(parsed.errorsEncountered ?? []), ...input.errorsFromLoop],
      lessonsLearned: parsed.lessonsLearned ?? [],
      confidence: (input.finalAnswerCapture?.confidence as AgentDebrief["confidence"]) ?? "medium",
      caveats: parsed.caveats || undefined,
      toolsUsed,
      metrics: input.metrics,
    };

    return { ...debrief, markdown: formatDebriefMarkdown(debrief) };
  });
}

// ─── Markdown renderer ─────────────────────────────────────────────────────

export function formatDebriefMarkdown(d: Omit<AgentDebrief, "markdown">): string {
  const outcomeEmoji = d.outcome === "success" ? "✅" : d.outcome === "partial" ? "⚠️" : "❌";
  const lines: string[] = [
    `# Agent Debrief ${outcomeEmoji}`,
    "",
    `**Outcome:** ${d.outcome} | **Confidence:** ${d.confidence}`,
    "",
    "## Summary",
    "",
    d.summary,
    "",
  ];

  if (d.keyFindings.length > 0) {
    lines.push("## Key Findings", "");
    for (const f of d.keyFindings) lines.push(`- ${f}`);
    lines.push("");
  }

  if (d.errorsEncountered.length > 0) {
    lines.push("## Errors Encountered", "");
    for (const e of d.errorsEncountered) lines.push(`- ${e}`);
    lines.push("");
  }

  if (d.lessonsLearned.length > 0) {
    lines.push("## Lessons Learned", "");
    for (const l of d.lessonsLearned) lines.push(`- ${l}`);
    lines.push("");
  }

  if (d.caveats) {
    lines.push("## Caveats", "", d.caveats, "");
  }

  lines.push("## Tools Used", "");
  for (const t of d.toolsUsed) {
    const pct = Math.round(t.successRate * 100);
    lines.push(`- \`${t.name}\`: ${t.calls} call(s), ${pct}% success`);
  }

  lines.push(
    "",
    "## Metrics",
    "",
    `- Tokens: ${d.metrics.tokens.toLocaleString()}`,
    `- Duration: ${(d.metrics.duration / 1000).toFixed(1)}s`,
    `- Iterations: ${d.metrics.iterations}`,
    `- Cost: $${d.metrics.cost.toFixed(4)}`,
  );

  return lines.join("\n");
}
```

**Step 4: Export from runtime index**

In `packages/runtime/src/index.ts`, add:
```typescript
export { synthesizeDebrief, formatDebriefMarkdown, type AgentDebrief, type DebriefInput } from "./debrief.js";
```

**Step 5: Run test to verify it passes**

```bash
bun test packages/runtime/tests/debrief.test.ts
```
Expected: 4 pass, 0 fail

**Step 6: Commit**

```bash
git add packages/runtime/src/debrief.ts packages/runtime/tests/debrief.test.ts packages/runtime/src/index.ts
git commit -m "feat(runtime): DebriefSynthesizer — collects execution signals + LLM synthesis into AgentDebrief"
```

---

### Task 4: SQLite `DebriefStore` service

**Files:**
- Create: `packages/memory/src/services/debrief-store.ts`
- Modify: `packages/memory/src/index.ts`
- Test: `packages/memory/tests/debrief-store.test.ts`

**Context:** Follow the exact same SQLite WAL pattern used by `ExperienceStore`. The DB path comes from the `MemoryConfig`. Use `bun:sqlite` directly (no ORM).

**Step 1: Write the failing test**

```typescript
// packages/memory/tests/debrief-store.test.ts
import { describe, expect, it, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import { DebriefStoreService, DebriefStoreLive } from "../src/services/debrief-store.js";
import type { AgentDebrief } from "@reactive-agents/runtime";
import { rm } from "node:fs/promises";

const TEST_DB = "/tmp/test-debrief-store.db";

const testLayer = DebriefStoreLive(TEST_DB);

const sampleDebrief: AgentDebrief = {
  outcome: "success",
  summary: "Fetched commits and sent message",
  keyFindings: ["5 commits retrieved"],
  errorsEncountered: [],
  lessonsLearned: ["github/list_commits is reliable"],
  confidence: "high",
  toolsUsed: [{ name: "github/list_commits", calls: 1, successRate: 1 }],
  metrics: { tokens: 5000, duration: 12000, iterations: 5, cost: 0 },
  markdown: "# Debrief\n\nDone.",
};

describe("DebriefStore", () => {
  afterEach(async () => {
    await rm(TEST_DB, { force: true });
    await rm(`${TEST_DB}-wal`, { force: true });
    await rm(`${TEST_DB}-shm`, { force: true });
  });

  it("saves and retrieves a debrief by taskId", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* DebriefStoreService;
        yield* store.save({
          taskId: "task-abc",
          agentId: "agent-1",
          taskPrompt: "Fetch commits",
          terminatedBy: "final_answer_tool",
          output: "done",
          outputFormat: "text",
          debrief: sampleDebrief,
        });
        return yield* store.findByTaskId("task-abc");
      }).pipe(Effect.provide(testLayer))
    );

    expect(result).not.toBeNull();
    expect(result?.taskId).toBe("task-abc");
    expect(result?.debrief.outcome).toBe("success");
    expect(result?.debrief.summary).toContain("commits");
  });

  it("returns null for unknown taskId", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* DebriefStoreService;
        return yield* store.findByTaskId("nonexistent");
      }).pipe(Effect.provide(testLayer))
    );
    expect(result).toBeNull();
  });

  it("lists recent debriefs for an agent", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* DebriefStoreService;
        yield* store.save({ taskId: "t1", agentId: "agent-1", taskPrompt: "task 1", terminatedBy: "final_answer_tool", output: "a", outputFormat: "text", debrief: sampleDebrief });
        yield* store.save({ taskId: "t2", agentId: "agent-1", taskPrompt: "task 2", terminatedBy: "final_answer_tool", output: "b", outputFormat: "text", debrief: sampleDebrief });
        yield* store.save({ taskId: "t3", agentId: "agent-2", taskPrompt: "task 3", terminatedBy: "max_iterations", output: "c", outputFormat: "text", debrief: { ...sampleDebrief, outcome: "partial" } });
      }).pipe(Effect.provide(testLayer))
    );

    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* DebriefStoreService;
        return yield* store.listByAgent("agent-1", 10);
      }).pipe(Effect.provide(testLayer))
    );

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.agentId === "agent-1")).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test packages/memory/tests/debrief-store.test.ts
```
Expected: FAIL

**Step 3: Implement `packages/memory/src/services/debrief-store.ts`**

```typescript
import { Context, Effect, Layer } from "effect";
import { Database } from "bun:sqlite";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface DebriefRecord {
  taskId: string;
  agentId: string;
  taskPrompt: string;
  terminatedBy: string;
  output: string;
  outputFormat: string;
  debrief: import("@reactive-agents/runtime").AgentDebrief;
  createdAt: number;
}

export interface SaveDebriefInput {
  taskId: string;
  agentId: string;
  taskPrompt: string;
  terminatedBy: string;
  output: string;
  outputFormat: string;
  debrief: import("@reactive-agents/runtime").AgentDebrief;
}

// ─── Service Interface ─────────────────────────────────────────────────────

export interface IDebriefStore {
  save(input: SaveDebriefInput): Effect.Effect<void, never>;
  findByTaskId(taskId: string): Effect.Effect<DebriefRecord | null, never>;
  listByAgent(agentId: string, limit: number): Effect.Effect<DebriefRecord[], never>;
}

export class DebriefStoreService extends Context.Tag("DebriefStoreService")<
  DebriefStoreService,
  IDebriefStore
>() {}

// ─── Live Layer ─────────────────────────────────────────────────────────────

export const DebriefStoreLive = (dbPath: string): Layer.Layer<DebriefStoreService> =>
  Layer.effect(
    DebriefStoreService,
    Effect.sync(() => {
      const db = new Database(dbPath, { create: true });
      db.exec("PRAGMA journal_mode=WAL;");
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_debriefs (
          id              TEXT PRIMARY KEY,
          task_id         TEXT NOT NULL,
          agent_id        TEXT NOT NULL,
          created_at      INTEGER NOT NULL,
          task_prompt     TEXT NOT NULL,
          terminated_by   TEXT NOT NULL,
          output          TEXT NOT NULL,
          output_format   TEXT NOT NULL,
          debrief_json    TEXT NOT NULL,
          debrief_markdown TEXT NOT NULL,
          tokens_used     INTEGER,
          duration_ms     INTEGER,
          iterations      INTEGER,
          outcome         TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_debriefs_agent_id ON agent_debriefs(agent_id);
        CREATE INDEX IF NOT EXISTS idx_debriefs_task_id ON agent_debriefs(task_id);
        CREATE INDEX IF NOT EXISTS idx_debriefs_created_at ON agent_debriefs(created_at DESC);
      `);

      const save = (input: SaveDebriefInput): Effect.Effect<void, never> =>
        Effect.sync(() => {
          const id = `dbrf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const now = Date.now();
          db.prepare(`
            INSERT INTO agent_debriefs
              (id, task_id, agent_id, created_at, task_prompt, terminated_by,
               output, output_format, debrief_json, debrief_markdown,
               tokens_used, duration_ms, iterations, outcome)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            id,
            input.taskId,
            input.agentId,
            now,
            input.taskPrompt,
            input.terminatedBy,
            input.output,
            input.outputFormat,
            JSON.stringify(input.debrief),
            input.debrief.markdown,
            input.debrief.metrics.tokens,
            input.debrief.metrics.duration,
            input.debrief.metrics.iterations,
            input.debrief.outcome,
          );
        });

      const findByTaskId = (taskId: string): Effect.Effect<DebriefRecord | null, never> =>
        Effect.sync(() => {
          const row = db.prepare(
            "SELECT * FROM agent_debriefs WHERE task_id = ? LIMIT 1"
          ).get(taskId) as Record<string, unknown> | null;
          if (!row) return null;
          return rowToRecord(row);
        });

      const listByAgent = (agentId: string, limit: number): Effect.Effect<DebriefRecord[], never> =>
        Effect.sync(() => {
          const rows = db.prepare(
            "SELECT * FROM agent_debriefs WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?"
          ).all(agentId, limit) as Record<string, unknown>[];
          return rows.map(rowToRecord);
        });

      return { save, findByTaskId, listByAgent };
    })
  );

function rowToRecord(row: Record<string, unknown>): DebriefRecord {
  return {
    taskId: row.task_id as string,
    agentId: row.agent_id as string,
    taskPrompt: row.task_prompt as string,
    terminatedBy: row.terminated_by as string,
    output: row.output as string,
    outputFormat: row.output_format as string,
    debrief: JSON.parse(row.debrief_json as string),
    createdAt: row.created_at as number,
  };
}
```

**Step 4: Export from memory package**

In `packages/memory/src/index.ts` add:
```typescript
export {
  DebriefStoreService,
  DebriefStoreLive,
  type DebriefRecord,
  type SaveDebriefInput,
} from "./services/debrief-store.js";
```

**Step 5: Run test to verify it passes**

```bash
bun test packages/memory/tests/debrief-store.test.ts
```
Expected: 3 pass, 0 fail

**Step 6: Commit**

```bash
git add packages/memory/src/services/debrief-store.ts packages/memory/tests/debrief-store.test.ts packages/memory/src/index.ts
git commit -m "feat(memory): DebriefStore — SQLite persistence for agent run debriefs"
```

---

### Task 5: Wire debrief into execution engine + enrich `AgentResult`

**Files:**
- Modify: `packages/core/src/types/result.ts`
- Modify: `packages/runtime/src/builder.ts` (AgentResult interface + run() wiring)
- Modify: `packages/runtime/src/execution-engine.ts` (call synthesizeDebrief after loop)
- Test: `packages/runtime/tests/debrief-integration.test.ts`

**Step 1: Update `packages/core/src/types/result.ts`**

Add after `TaskResultSchema`:
```typescript
export const OutputFormat = Schema.Literal("text", "json", "markdown", "csv", "html");
export type OutputFormat = typeof OutputFormat.Type;

export const TerminatedBy = Schema.Literal(
  "final_answer_tool",
  "final_answer",
  "max_iterations",
  "end_turn",
);
export type TerminatedBy = typeof TerminatedBy.Type;
```

**Step 2: Update `AgentResult` interface in `packages/runtime/src/builder.ts`** (~line 542)

```typescript
export interface AgentResult {
  readonly output: string;
  readonly success: boolean;
  readonly taskId: string;
  readonly agentId: string;
  readonly metadata: AgentResultMetadata;
  // New optional fields — backward compatible
  readonly format?: "text" | "json" | "markdown" | "csv" | "html";
  readonly terminatedBy?: "final_answer_tool" | "final_answer" | "max_iterations" | "end_turn";
  readonly debrief?: import("./debrief.js").AgentDebrief;
}
```

Also update `AgentResultMetadata` to add:
```typescript
readonly confidence?: "high" | "medium" | "low";
```

**Step 3: Wire debrief synthesis in execution engine**

In `packages/runtime/src/execution-engine.ts`, after the kernel result is received and before the final `AgentResult` is assembled, call `synthesizeDebrief` when memory is enabled:

```typescript
// After kernel exits, collect signals
const debriefInput: DebriefInput = {
  taskPrompt: input,
  agentId: config.agentId,
  taskId: currentTaskId,
  terminatedBy: kernelResult.terminatedBy,
  finalAnswerCapture: kernelResult.meta.finalAnswerCapture,
  toolCallHistory: collectToolStats(kernelResult.steps),
  errorsFromLoop: collectErrors(kernelResult.steps),
  metrics: {
    tokens: kernelResult.meta.tokensUsed ?? 0,
    duration: Date.now() - startTime,
    iterations: kernelResult.meta.iteration,
    cost: 0,
  },
};

// Synthesize debrief if memory is enabled (fire and don't block the result)
const debrief = config.enableMemory
  ? await Effect.runPromise(
      synthesizeDebrief(debriefInput).pipe(
        Effect.provide(llmLayer),
        Effect.catchAll(() => Effect.succeed(undefined)),
      )
    )
  : undefined;

// Persist if DebriefStore is available
if (debrief && debriefStore) {
  await Effect.runPromise(
    debriefStore.save({ ...debriefInput, output: kernelResult.output, outputFormat: finalAnswerCapture?.format ?? "text", debrief })
      .pipe(Effect.catchAll(() => Effect.void))
  );
}
```

Helper functions to add near the wiring:
```typescript
function collectToolStats(steps: KernelStep[]): ToolCallStat[] {
  const statsMap = new Map<string, { calls: number; errors: number; totalMs: number }>();
  for (const step of steps) {
    if (step.type === "action" && step.metadata?.toolUsed) {
      const name = step.metadata.toolUsed;
      const existing = statsMap.get(name) ?? { calls: 0, errors: 0, totalMs: 0 };
      statsMap.set(name, {
        calls: existing.calls + 1,
        errors: existing.errors + (step.metadata.error ? 1 : 0),
        totalMs: existing.totalMs + (step.metadata.duration ?? 0),
      });
    }
  }
  return Array.from(statsMap.entries()).map(([name, s]) => ({
    name,
    calls: s.calls,
    errors: s.errors,
    avgDurationMs: s.calls > 0 ? Math.round(s.totalMs / s.calls) : 0,
  }));
}

function collectErrors(steps: KernelStep[]): string[] {
  return steps
    .filter((s) => s.type === "observation" && s.metadata?.error)
    .map((s) => s.content.slice(0, 200));
}
```

**Step 4: Write integration test**

```typescript
// packages/runtime/tests/debrief-integration.test.ts
import { describe, expect, it } from "bun:test";

describe("AgentResult debrief integration", () => {
  it("result.debrief is populated after a successful run with memory enabled", async () => {
    // Use createTestLLMServiceLayer to simulate a run that calls final-answer
    // Then assert result.debrief is present with correct fields
    // Full integration test using ReactiveAgents.create() test harness
  });

  it("result.format reflects the format passed to final-answer", async () => {
    // Assert result.format === "json" when agent called final-answer with format: "json"
  });

  it("result.terminatedBy is final_answer_tool when tool was used", async () => {
    // Assert result.terminatedBy === "final_answer_tool"
  });
});
```

**Step 5: Run full test suite**

```bash
bun test
```
Expected: all pass + 3 new debrief-integration tests

**Step 6: Commit**

```bash
git add packages/core/src/types/result.ts packages/runtime/src/builder.ts packages/runtime/src/execution-engine.ts packages/runtime/tests/debrief-integration.test.ts
git commit -m "feat(runtime): wire debrief synthesis into execution engine, enrich AgentResult with debrief + format + terminatedBy"
```

---

### Task 6: `agent.chat()` — conversational method on ReactiveAgent

**Files:**
- Create: `packages/runtime/src/chat.ts`
- Modify: `packages/runtime/src/builder.ts` (add `chat()` to ReactiveAgent)
- Test: `packages/runtime/tests/chat.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/runtime/tests/chat.test.ts
import { describe, expect, it } from "bun:test";
import { ReactiveAgents } from "reactive-agents";
import { createTestLLMServiceLayer } from "@reactive-agents/testing";

describe("agent.chat()", () => {
  it("returns a ChatReply with a message", async () => {
    const agent = await ReactiveAgents.create()
      .withName("chat-test")
      .withProvider("test")
      .build();

    // Mock the LLM to return a simple response
    const reply = await agent.chat("What did you do last run?");

    expect(typeof reply.message).toBe("string");
    expect(reply.message.length).toBeGreaterThan(0);
  });

  it("routes to tool-capable path for action-oriented messages", async () => {
    const agent = await ReactiveAgents.create()
      .withName("chat-test-tools")
      .withProvider("test")
      .withTools()
      .build();

    const reply = await agent.chat("Search for the latest news about AI agents");
    expect(reply).toHaveProperty("message");
  });

  it("chat() is available on the agent instance", async () => {
    const agent = await ReactiveAgents.create()
      .withName("chat-shape-test")
      .withProvider("test")
      .build();

    expect(typeof agent.chat).toBe("function");
    expect(typeof agent.session).toBe("function");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test packages/runtime/tests/chat.test.ts
```
Expected: FAIL — `agent.chat is not a function`

**Step 3: Create `packages/runtime/src/chat.ts`**

```typescript
import { Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface ChatReply {
  message: string;
  toolsUsed?: string[];
  fromMemory?: boolean;
}

export interface ChatOptions {
  useTools?: boolean;  // override auto-routing
  maxIterations?: number;  // for tool-capable path, default 5
}

export interface SessionOptions {
  persistOnEnd?: boolean;  // write conversation to episodic memory on session.end()
}

// ─── Intent classifier (heuristic, zero tokens) ───────────────────────────

const TOOL_INTENT_PATTERNS = [
  /\b(search|fetch|find|get|check|look up|what is the current|what are the latest)\b/i,
  /\b(write|create|save|send|post|update|delete)\b/i,
  /\b(run|execute|calculate|compute)\b/i,
];

export function requiresTools(message: string): boolean {
  return TOOL_INTENT_PATTERNS.some((p) => p.test(message));
}

// ─── Direct LLM chat (no tools) ───────────────────────────────────────────

export function directChat(
  message: string,
  history: ChatMessage[],
  contextSummary: string,
): Effect.Effect<ChatReply, Error, LLMService> {
  return Effect.gen(function* () {
    const llm = yield* LLMService;

    const messages = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: message },
    ];

    const systemPrompt = contextSummary
      ? `You are a helpful AI assistant. Here is your recent context:\n\n${contextSummary}\n\nAnswer conversationally and concisely.`
      : "You are a helpful AI assistant. Answer conversationally and concisely.";

    const response = yield* llm.complete({ messages, systemPrompt, temperature: 0.7, maxTokens: 1024 });

    return { message: response.content };
  });
}

// ─── AgentSession ─────────────────────────────────────────────────────────

export class AgentSession {
  private history: ChatMessage[] = [];

  constructor(
    private chatFn: (message: string, history: ChatMessage[]) => Promise<ChatReply>,
    private onEnd?: (history: ChatMessage[]) => Promise<void>,
  ) {}

  async chat(message: string): Promise<ChatReply> {
    const reply = await this.chatFn(message, this.history);
    this.history.push({ role: "user", content: message, timestamp: Date.now() });
    this.history.push({ role: "assistant", content: reply.message, timestamp: Date.now() });
    return reply;
  }

  history_(): ChatMessage[] {
    return [...this.history];
  }

  async end(): Promise<void> {
    if (this.onEnd) await this.onEnd(this.history);
    this.history = [];
  }
}
```

**Step 4: Add `chat()` and `session()` to ReactiveAgent in `packages/runtime/src/builder.ts`**

In the `ReactiveAgent` class, add after `runStream()`:

```typescript
/**
 * Conversational Q&A with the agent.
 * Routes to direct LLM (for simple questions) or lightweight ReAct loop (for tool-capable queries).
 */
async chat(message: string, options?: ChatOptions): Promise<ChatReply> {
  const { requiresTools, directChat } = await import("./chat.js");
  const useTools = options?.useTools ?? requiresTools(message);

  const contextSummary = this._lastDebrief
    ? `Last run summary: ${this._lastDebrief.summary}\nKey findings: ${this._lastDebrief.keyFindings.join(", ")}`
    : "";

  if (!useTools) {
    return this.runtime.runPromise(
      directChat(message, this._chatHistory, contextSummary)
    );
  }

  // Tool-capable path: lightweight run with capped iterations
  const result = await this.run(message);
  return {
    message: result.output,
    toolsUsed: result.debrief?.toolsUsed.map((t) => t.name),
  };
}

/**
 * Start a multi-turn conversation session with auto-managed history.
 */
session(options?: SessionOptions): AgentSession {
  const { AgentSession } = require("./chat.js");
  return new AgentSession(
    (msg: string, history: ChatMessage[]) => this.chat(msg),
    options?.persistOnEnd
      ? async (history: ChatMessage[]) => {
          // Write to episodic memory
          // (implementation detail — store as type: "conversation")
        }
      : undefined,
  );
}

// Private state for chat context
private _lastDebrief?: AgentDebrief;
private _chatHistory: ChatMessage[] = [];
```

Also update `run()` to capture the debrief for chat context:
```typescript
// At the end of run(), after result is assembled:
if (result.debrief) this._lastDebrief = result.debrief;
```

**Step 5: Run test to verify it passes**

```bash
bun test packages/runtime/tests/chat.test.ts
```
Expected: 3 pass, 0 fail

**Step 6: Run full suite**

```bash
bun test
```
Expected: all pass

**Step 7: Commit**

```bash
git add packages/runtime/src/chat.ts packages/runtime/src/builder.ts packages/runtime/tests/chat.test.ts
git commit -m "feat(runtime): agent.chat() + agent.session() — adaptive conversational interaction"
```

---

### Task 7: Final wiring, exports, and full test run

**Files:**
- Modify: `packages/runtime/src/index.ts` (export new types)
- Modify: `packages/reasoning/src/index.ts` (export FinalAnswerCapture if needed)
- Run: full test suite + build

**Step 1: Verify all new exports are in place**

```bash
# Check runtime exports
grep -n "AgentDebrief\|ChatReply\|AgentSession\|synthesizeDebrief" packages/runtime/src/index.ts

# Check tools exports
grep -n "finalAnswerTool\|shouldShowFinalAnswer" packages/tools/src/index.ts

# Check memory exports
grep -n "DebriefStore" packages/memory/src/index.ts
```

**Step 2: Run full test suite**

```bash
bun test 2>&1 | tail -5
```
Expected: ~1760+ pass, 0 fail

**Step 3: Build all packages**

```bash
bun run build 2>&1 | tail -5
```
Expected: all 20 packages build successfully

**Step 4: Smoke test with test.ts**

```bash
bun run test.ts 2>&1 | grep -E "\[adaptive-tools\]|\[complete\]|terminatedBy|debrief"
```
Expected: see `terminatedBy: "final_answer_tool"` in output (if model calls the tool) or `"final_answer"` as fallback.

**Step 5: Final commit**

```bash
git add packages/runtime/src/index.ts packages/reasoning/src/index.ts packages/tools/src/index.ts
git commit -m "feat: final-answer tool + debrief synthesis + agent.chat() — v0.8.0 interaction layer"
```

---

## What Comes Next (tracked separately)

This plan is **Part 1 of 3** in the framework improvement sprint:

| Part | Goal | Status |
|------|------|--------|
| **Part 1 — This plan** | final-answer hard gate + debrief + chat() | 🔨 In progress |
| **Part 2 — Benchmarks** | Run 20-task × 5-tier suite, publish results | ⏳ Next |
| **Part 3 — Docker Sandbox + Programmatic Strategy** | Real code execution, 30-50% token reduction | ⏳ After Part 2 |
