# Layer 3: Reasoning Engine - AI Agent Implementation Spec

## Overview

Multi-strategy reasoning engine with 5 reasoning strategies, AI-driven adaptive selection, pluggable registry, and effectiveness learning. This is a UNIQUE competitive advantage — no other TS framework provides >1 strategy with adaptive selection.

**Package:** `@reactive-agents/reasoning`
**Dependencies:** `effect@^3.10`, `@reactive-agents/core`, `@reactive-agents/llm-provider`
**Phase:** 1B (Weeks 3-4) — Reactive only; Phase 2 for remaining strategies

---

## Package Structure

```
@reactive-agents/reasoning/
├── src/
│   ├── index.ts                       # Public API re-exports
│   ├── types/
│   │   ├── reasoning.ts               # Reasoning schemas & types
│   │   ├── step.ts                    # ReasoningStep schemas
│   │   ├── config.ts                  # ReasoningConfig schema
│   │   └── effectiveness.ts           # StrategyEffectiveness schema
│   ├── errors/
│   │   └── errors.ts                  # All Data.TaggedError definitions
│   ├── strategies/
│   │   ├── reactive.ts                # ReAct loop strategy function
│   │   ├── plan-execute.ts            # Plan-Execute-Reflect strategy function
│   │   ├── tree-of-thought.ts         # Tree-of-Thought strategy function
│   │   ├── reflexion.ts               # Reflexion strategy function
│   │   └── adaptive.ts                # AI-selects-strategy meta strategy
│   ├── services/
│   │   ├── strategy-registry.ts       # StrategyRegistry Context.Tag + Live Layer
│   │   ├── strategy-selector.ts       # StrategySelector Context.Tag + Live Layer
│   │   ├── effectiveness-tracker.ts   # EffectivenessTracker Context.Tag + Live Layer
│   │   └── reasoning-service.ts       # ReasoningService Context.Tag + Live Layer
│   └── runtime.ts                     # createReasoningLayer factory
├── tests/
│   ├── strategies/
│   │   ├── reactive.test.ts
│   │   ├── plan-execute.test.ts
│   │   └── tree-of-thought.test.ts
│   ├── strategy-selector.test.ts
│   ├── effectiveness-tracker.test.ts
│   └── reasoning-service.test.ts
├── package.json
└── tsconfig.json
```

---

## Build Order

1. `src/types/step.ts` — StepType, StepMetadata, ReasoningStep schemas
2. `src/types/reasoning.ts` — ReasoningStrategy, ReasoningMetadata, ReasoningResult, SelectionContext schemas
3. `src/types/effectiveness.ts` — StrategyEffectiveness schema
4. `src/types/config.ts` — ReasoningConfig schema with per-strategy settings
5. `src/errors/errors.ts` — All error types (ReasoningError, StrategyNotFoundError, SelectionError, ExecutionError)
6. `src/strategies/reactive.ts` — executeReactive strategy function
7. `src/strategies/plan-execute.ts` — executePlanExecuteReflect strategy function
8. `src/strategies/tree-of-thought.ts` — executeTreeOfThought strategy function
9. `src/strategies/reflexion.ts` — executeReflexion strategy function
10. `src/services/strategy-registry.ts` — StrategyRegistry + StrategyRegistryLive
11. `src/services/effectiveness-tracker.ts` — EffectivenessTracker + EffectivenessTrackerLive
12. `src/services/strategy-selector.ts` — StrategySelector + StrategySelectorLive
13. `src/strategies/adaptive.ts` — executeAdaptive strategy function (depends on selector + registry)
14. `src/services/reasoning-service.ts` — ReasoningService + ReasoningServiceLive
15. `src/runtime.ts` — createReasoningLayer factory
16. `src/index.ts` — Public re-exports
17. Tests for each module

---

## Core Types & Schemas

### File: `src/types/step.ts`

```typescript
// File: src/types/step.ts
import { Schema } from "effect";

// ─── Step ID (branded string) ───

export const StepId = Schema.String.pipe(Schema.brand("StepId"));
export type StepId = typeof StepId.Type;

// ─── Step Type ───

export const StepType = Schema.Literal(
  "thought", // Thinking/reasoning
  "action", // Tool call
  "observation", // Tool result
  "plan", // Planning step
  "reflection", // Self-reflection
  "critique", // Self-critique
);
export type StepType = typeof StepType.Type;

// ─── Step Metadata ───

export const StepMetadataSchema = Schema.Struct({
  confidence: Schema.optional(Schema.Number),
  toolUsed: Schema.optional(Schema.String),
  cost: Schema.optional(Schema.Number),
  duration: Schema.optional(Schema.Number),
});
export type StepMetadata = typeof StepMetadataSchema.Type;

// ─── Reasoning Step ───

export const ReasoningStepSchema = Schema.Struct({
  id: StepId,
  type: StepType,
  content: Schema.String,
  timestamp: Schema.DateFromSelf,
  metadata: Schema.optional(StepMetadataSchema),
});
export type ReasoningStep = typeof ReasoningStepSchema.Type;
```

### File: `src/types/reasoning.ts`

```typescript
// File: src/types/reasoning.ts
import { Schema } from "effect";
import { ReasoningStepSchema } from "./step.js";

// ─── Reasoning Strategy ───
// Canonical definition lives in @reactive-agents/core (layer-01-core-detailed-design.md).
// Re-export here so downstream reasoning code can import from either package.
import { ReasoningStrategy } from "@reactive-agents/core";
export { ReasoningStrategy };

// ─── Result Status ───

export const ReasoningStatus = Schema.Literal("completed", "failed", "partial");
export type ReasoningStatus = typeof ReasoningStatus.Type;

// ─── Reasoning Metadata ───

export const ReasoningMetadataSchema = Schema.Struct({
  duration: Schema.Number, // ms
  cost: Schema.Number, // USD
  tokensUsed: Schema.Number,
  stepsCount: Schema.Number,
  confidence: Schema.Number, // 0-1
  effectiveness: Schema.optional(Schema.Number), // 0-1 (learned)
  selectedStrategy: Schema.optional(ReasoningStrategy), // for adaptive
});
export type ReasoningMetadata = typeof ReasoningMetadataSchema.Type;

// ─── Reasoning Result ───

export const ReasoningResultSchema = Schema.Struct({
  strategy: ReasoningStrategy,
  steps: Schema.Array(ReasoningStepSchema),
  output: Schema.Unknown,
  metadata: ReasoningMetadataSchema,
  status: ReasoningStatus,
});
export type ReasoningResult = typeof ReasoningResultSchema.Type;

// ─── Selection Context ───

export const SelectionContextSchema = Schema.Struct({
  taskDescription: Schema.String,
  taskType: Schema.String,
  complexity: Schema.Number, // 0-1
  urgency: Schema.Number, // 0-1
  costBudget: Schema.optional(Schema.Number),
  timeConstraint: Schema.optional(Schema.Number), // ms
  preferredStrategy: Schema.optional(ReasoningStrategy),
});
export type SelectionContext = typeof SelectionContextSchema.Type;

// ─── Reasoning Controller (Vision Pillar: Control) ───
// Allows fine-grained step-level hooks inside the reasoning loop.
// Wired into strategy functions via optional dependency.

export interface ReasoningController {
  /** Called before reasoning begins, can modify the input. */
  readonly beforeReasoning?: (
    context: ReasoningInput,
  ) => Effect.Effect<ReasoningInput, ReasoningError>;
  /** Called during each reasoning step, can inspect/modify the step. */
  readonly duringStep?: (
    step: ReasoningStep,
  ) => Effect.Effect<ReasoningStep, ReasoningError>;
  /** Called after each reasoning step completes. */
  readonly afterStep?: (
    step: ReasoningStep,
  ) => Effect.Effect<ReasoningStep, ReasoningError>;
  /** Called when confidence drops below threshold. Return action to take. */
  readonly onUncertainty?: (
    signal: UncertaintySignal,
  ) => Effect.Effect<"continue" | "abort" | "escalate", never>;
  /** Called when adaptive strategy selection is needed. Return strategy override. */
  readonly onAdapt?: (
    context: ReasoningInput,
  ) => Effect.Effect<ReasoningStrategy, never>;
}

// Strategy functions should check for ReasoningController via:
//   const controllerOpt = yield* Effect.serviceOption(
//     Context.GenericTag<ReasoningController>("ReasoningController")
//   );
// and fire hooks at appropriate points within the loop.
```

### File: `src/types/effectiveness.ts`

```typescript
// File: src/types/effectiveness.ts
import { Schema } from "effect";
import { ReasoningStrategy } from "./reasoning.js";

// ─── Strategy Effectiveness Record ───

export const StrategyEffectivenessSchema = Schema.Struct({
  strategy: ReasoningStrategy,
  taskType: Schema.String,
  successRate: Schema.Number, // 0-1
  avgCost: Schema.Number,
  avgDuration: Schema.Number,
  avgConfidence: Schema.Number,
  executions: Schema.Number,
  lastUsed: Schema.DateFromSelf,
});
export type StrategyEffectiveness = typeof StrategyEffectivenessSchema.Type;
```

### File: `src/types/config.ts`

```typescript
// File: src/types/config.ts
import { Schema } from "effect";
import { ReasoningStrategy } from "./reasoning.js";

// ─── Per-Strategy Configuration ───

export const ReactiveConfigSchema = Schema.Struct({
  maxIterations: Schema.Number.pipe(Schema.int(), Schema.positive()),
  temperature: Schema.Number,
});
export type ReactiveConfig = typeof ReactiveConfigSchema.Type;

export const PlanExecuteConfigSchema = Schema.Struct({
  maxRefinements: Schema.Number.pipe(Schema.int(), Schema.positive()),
  reflectionDepth: Schema.Literal("shallow", "deep"),
});
export type PlanExecuteConfig = typeof PlanExecuteConfigSchema.Type;

export const TreeOfThoughtConfigSchema = Schema.Struct({
  breadth: Schema.Number.pipe(Schema.int(), Schema.positive()),
  depth: Schema.Number.pipe(Schema.int(), Schema.positive()),
  pruningThreshold: Schema.Number,
});
export type TreeOfThoughtConfig = typeof TreeOfThoughtConfigSchema.Type;

export const ReflexionConfigSchema = Schema.Struct({
  maxRetries: Schema.Number.pipe(Schema.int(), Schema.positive()),
  selfCritiqueDepth: Schema.Literal("shallow", "deep"),
});
export type ReflexionConfig = typeof ReflexionConfigSchema.Type;

// ─── Full Reasoning Config ───

export const ReasoningConfigSchema = Schema.Struct({
  defaultStrategy: ReasoningStrategy,
  adaptive: Schema.Struct({
    enabled: Schema.Boolean,
    learning: Schema.Boolean,
  }),
  strategies: Schema.Struct({
    reactive: ReactiveConfigSchema,
    planExecute: PlanExecuteConfigSchema,
    treeOfThought: TreeOfThoughtConfigSchema,
    reflexion: ReflexionConfigSchema,
  }),
});
export type ReasoningConfig = typeof ReasoningConfigSchema.Type;

// ─── Default Config ───

export const defaultReasoningConfig: ReasoningConfig = {
  defaultStrategy: "reactive",
  adaptive: { enabled: true, learning: true },
  strategies: {
    reactive: { maxIterations: 10, temperature: 0.7 },
    planExecute: { maxRefinements: 2, reflectionDepth: "deep" },
    treeOfThought: { breadth: 3, depth: 3, pruningThreshold: 0.5 },
    reflexion: { maxRetries: 3, selfCritiqueDepth: "deep" },
  },
};
```

---

## Error Types

### File: `src/errors/errors.ts`

```typescript
// File: src/errors/errors.ts
import { Data } from "effect";

// ─── Base reasoning error ───
export class ReasoningError extends Data.TaggedError("ReasoningError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ─── Strategy not found in registry ───
export class StrategyNotFoundError extends Data.TaggedError(
  "StrategyNotFoundError",
)<{
  readonly strategy: string;
}> {}

// ─── Strategy selection failed ───
export class SelectionError extends Data.TaggedError("SelectionError")<{
  readonly message: string;
  readonly context?: unknown;
}> {}

// ─── Strategy execution failed ───
export class ExecutionError extends Data.TaggedError("ExecutionError")<{
  readonly strategy: string;
  readonly message: string;
  readonly step?: number;
  readonly cause?: unknown;
}> {}

// ─── Max iterations / depth exceeded ───
export class IterationLimitError extends Data.TaggedError(
  "IterationLimitError",
)<{
  readonly strategy: string;
  readonly limit: number;
  readonly stepsCompleted: number;
}> {}

// ─── Union type for service signatures ───
export type ReasoningErrors =
  | ReasoningError
  | StrategyNotFoundError
  | SelectionError
  | ExecutionError
  | IterationLimitError;
```

---

## Strategy Functions

Each strategy is a **pure function** returning an Effect — NOT an OOP class. Strategies receive typed dependencies via Effect service context.

### Pattern for All Strategies

```typescript
// Every strategy function has this signature:
type StrategyFn = (input: {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string; // serialized relevant memory
  readonly availableTools: readonly string[];
  readonly config: ReasoningConfig;
}) => Effect.Effect<
  ReasoningResult,
  ExecutionError | IterationLimitError,
  LLMService // requires LLM provider from Layer 1.5
>;
```

### File: `src/strategies/reactive.ts`

```typescript
// File: src/strategies/reactive.ts
import { Effect } from "effect";
import { ulid } from "ulid";
import type { ReasoningResult, ReasoningStep, StepId } from "../types/index.js";
import { ExecutionError, IterationLimitError } from "../errors/errors.js";
import type { ReasoningConfig } from "../types/config.js";
import { LLMService } from "@reactive-agents/llm-provider";

interface ReactiveInput {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  readonly availableTools: readonly string[];
  readonly config: ReasoningConfig;
}

/**
 * ReAct loop: Thought → Action → Observation, iterating until done.
 * Each iteration calls the LLM once for reasoning.
 */
export const executeReactive = (
  input: ReactiveInput,
): Effect.Effect<
  ReasoningResult,
  ExecutionError | IterationLimitError,
  LLMService
> =>
  Effect.gen(function* () {
    const llm = yield* LLMService;
    const maxIter = input.config.strategies.reactive.maxIterations;
    const temp = input.config.strategies.reactive.temperature;
    const steps: ReasoningStep[] = [];
    const start = Date.now();

    let context = buildInitialContext(input);
    let iteration = 0;
    let totalTokens = 0;
    let totalCost = 0;

    while (iteration < maxIter) {
      // ── THOUGHT ──
      const thoughtResponse = yield* llm
        .complete({
          messages: [
            { role: "user", content: buildThoughtPrompt(context, steps) },
          ],
          systemPrompt: `You are a reasoning agent. Task: ${input.taskDescription}`,
          maxTokens: 300,
          temperature: temp,
        })
        .pipe(
          Effect.mapError(
            (err) =>
              new ExecutionError({
                strategy: "reactive",
                message: `LLM thought failed at iteration ${iteration}`,
                step: iteration,
                cause: err,
              }),
          ),
        );

      const thought = thoughtResponse.content;
      totalTokens += thoughtResponse.usage.totalTokens;
      totalCost += thoughtResponse.usage.estimatedCost;

      steps.push({
        id: ulid() as StepId,
        type: "thought",
        content: thought,
        timestamp: new Date(),
      });

      // ── CHECK: does the thought indicate a final answer? ──
      if (hasFinalAnswer(thought)) {
        return buildResult(
          steps,
          thought,
          "completed",
          start,
          totalTokens,
          totalCost,
        );
      }

      // ── ACTION: does the thought request a tool call? ──
      const toolRequest = parseToolRequest(thought);
      if (toolRequest) {
        steps.push({
          id: ulid() as StepId,
          type: "action",
          content: JSON.stringify(toolRequest),
          timestamp: new Date(),
          metadata: { toolUsed: toolRequest.tool },
        });

        // Tool execution is deferred to the caller (ReasoningService) via a
        // placeholder observation. The service orchestrates tool calls through
        // the ToolService from Layer 8. Here, we note the request and continue.
        steps.push({
          id: ulid() as StepId,
          type: "observation",
          content: `[Tool call requested: ${toolRequest.tool}(${JSON.stringify(toolRequest.input)})]`,
          timestamp: new Date(),
        });

        // Update context with tool request for next iteration
        context = appendToContext(context, thought);
      }

      iteration++;
    }

    // Max iterations reached — return partial result
    return buildResult(steps, null, "partial", start, totalTokens, totalCost);
  });

// ─── Helpers (private to module) ───

function buildInitialContext(input: ReactiveInput): string {
  return [
    `Task: ${input.taskDescription}`,
    `Task Type: ${input.taskType}`,
    `Relevant Memory:\n${input.memoryContext}`,
    `Available Tools: ${input.availableTools.join(", ")}`,
  ].join("\n\n");
}

function buildThoughtPrompt(
  context: string,
  history: readonly ReasoningStep[],
): string {
  const historyStr = history.map((s) => `[${s.type}] ${s.content}`).join("\n");
  return `${context}\n\nPrevious steps:\n${historyStr}\n\nThink step-by-step. If you need a tool, respond with "ACTION: tool_name(input)". If you have a final answer, respond with "FINAL ANSWER: ...".`;
}

function hasFinalAnswer(thought: string): boolean {
  return /final answer:/i.test(thought);
}

function parseToolRequest(
  thought: string,
): { tool: string; input: string } | null {
  const match = thought.match(/ACTION:\s*(\w+)\((.+?)\)/i);
  return match ? { tool: match[1], input: match[2] } : null;
}

function appendToContext(context: string, addition: string): string {
  return `${context}\n\n${addition}`;
}

function buildResult(
  steps: readonly ReasoningStep[],
  output: unknown,
  status: "completed" | "partial",
  startMs: number,
  tokensUsed: number,
  cost: number,
): ReasoningResult {
  return {
    strategy: "reactive",
    steps,
    output,
    metadata: {
      duration: Date.now() - startMs,
      cost,
      tokensUsed,
      stepsCount: steps.length,
      confidence: status === "completed" ? 0.8 : 0.4,
    },
    status,
  };
}
```

### File: `src/strategies/plan-execute.ts`

```typescript
// File: src/strategies/plan-execute.ts
import { Effect } from "effect";
import { ulid } from "ulid";
import type { ReasoningResult, ReasoningStep, StepId } from "../types/index.js";
import { ExecutionError } from "../errors/errors.js";
import type { ReasoningConfig } from "../types/config.js";
import { LLMService } from "@reactive-agents/llm-provider";

interface PlanExecuteInput {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  readonly availableTools: readonly string[];
  readonly config: ReasoningConfig;
}

/**
 * Plan-Execute-Reflect: 4-phase structured reasoning.
 * Phase 1: Create plan → Phase 2: Execute steps → Phase 3: Reflect → Phase 4: Refine if needed
 */
export const executePlanExecuteReflect = (
  input: PlanExecuteInput,
): Effect.Effect<ReasoningResult, ExecutionError, LLMService> =>
  Effect.gen(function* () {
    const llm = yield* LLMService;
    const maxRefinements = input.config.strategies.planExecute.maxRefinements;
    const steps: ReasoningStep[] = [];
    const start = Date.now();
    let totalTokens = 0;
    let totalCost = 0;
    let refinement = 0;

    // ── PHASE 1: PLAN ──
    const planResponse = yield* llm
      .complete({
        messages: [
          {
            role: "user",
            content: `Create a detailed step-by-step plan to accomplish this task. Number each step.\n\nAvailable tools: ${input.availableTools.join(", ")}\n\nPlan:`,
          },
        ],
        systemPrompt: `Task: ${input.taskDescription}`,
        maxTokens: 500,
        temperature: 0.5,
      })
      .pipe(
        Effect.mapError(
          (err) =>
            new ExecutionError({
              strategy: "plan-execute-reflect",
              message: "Planning failed",
              cause: err,
            }),
        ),
      );

    totalTokens += planResponse.usage.totalTokens;
    totalCost += planResponse.usage.estimatedCost;
    let plan = planResponse.content;

    steps.push({
      id: ulid() as StepId,
      type: "plan",
      content: plan,
      timestamp: new Date(),
    });

    // ── PHASE 2: EXECUTE each plan step ──
    const planSteps = parsePlanSteps(plan);
    const execResults: string[] = [];

    for (const [i, planStep] of planSteps.entries()) {
      const execResponse = yield* llm
        .complete({
          messages: [
            {
              role: "user",
              content: `Plan step ${i + 1}: ${planStep}\nPrevious results: ${JSON.stringify(execResults)}\n\nExecute this step. If a tool is needed, indicate with ACTION: tool_name(input). Otherwise provide the result.`,
            },
          ],
          systemPrompt: `Task: ${input.taskDescription}`,
          maxTokens: 300,
          temperature: 0.3,
        })
        .pipe(
          Effect.mapError(
            (err) =>
              new ExecutionError({
                strategy: "plan-execute-reflect",
                message: `Execution failed at plan step ${i + 1}`,
                step: i,
                cause: err,
              }),
          ),
        );

      totalTokens += execResponse.usage.totalTokens;
      totalCost += execResponse.usage.estimatedCost;
      execResults.push(execResponse.content);

      steps.push({
        id: ulid() as StepId,
        type: "action",
        content: execResponse.text,
        timestamp: new Date(),
        metadata: { confidence: 0.7 },
      });
    }

    // ── PHASE 3: REFLECT ──
    let reflectionConfidence = 0;
    let needsRefinement = false;

    while (refinement <= maxRefinements) {
      const reflectResponse = yield* llm
        .complete({
          messages: [
            {
              role: "user",
              content: `Plan: ${plan}\nResults: ${JSON.stringify(execResults)}\n\nReflect:\n1. Was the task accomplished? (YES/NO)\n2. Confidence (0.0 - 1.0)?\n3. Should the plan be refined? (YES/NO)\n4. What could be improved?\n\nRespond in JSON: { "accomplished": bool, "confidence": number, "refine": bool, "improvements": string }`,
            },
          ],
          systemPrompt: `Task: ${input.taskDescription}`,
          maxTokens: 200,
          temperature: 0.3,
        })
        .pipe(
          Effect.mapError(
            (err) =>
              new ExecutionError({
                strategy: "plan-execute-reflect",
                message: "Reflection failed",
                cause: err,
              }),
          ),
        );

      totalTokens += reflectResponse.usage.totalTokens;
      totalCost += reflectResponse.usage.estimatedCost;

      const reflection = parseReflection(reflectResponse.content);
      reflectionConfidence = reflection.confidence;
      needsRefinement = reflection.refine;

      steps.push({
        id: ulid() as StepId,
        type: "reflection",
        content: reflectResponse.text,
        timestamp: new Date(),
        metadata: { confidence: reflectionConfidence },
      });

      if (!needsRefinement || refinement >= maxRefinements) break;

      // ── PHASE 4: REFINE (loop back to Phase 2) ──
      refinement++;
    }

    return {
      strategy: "plan-execute-reflect" as const,
      steps,
      output: execResults[execResults.length - 1] ?? null,
      metadata: {
        duration: Date.now() - start,
        cost: totalCost,
        tokensUsed: totalTokens,
        stepsCount: steps.length,
        confidence: reflectionConfidence,
      },
      status: "completed" as const,
    };
  });

// ─── Helpers ───

function parsePlanSteps(plan: string): string[] {
  return plan
    .split("\n")
    .filter((line) => /^\d+[\.\)]\s/.test(line.trim()))
    .map((line) => line.replace(/^\d+[\.\)]\s*/, "").trim());
}

function parseReflection(text: string): {
  accomplished: boolean;
  confidence: number;
  refine: boolean;
  improvements: string;
} {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch {
    // fallback
  }
  return {
    accomplished: true,
    confidence: 0.6,
    refine: false,
    improvements: "",
  };
}
```

### File: `src/strategies/tree-of-thought.ts`

```typescript
// File: src/strategies/tree-of-thought.ts
import { Effect } from "effect";
import { ulid } from "ulid";
import type { ReasoningResult, ReasoningStep, StepId } from "../types/index.js";
import { ExecutionError } from "../errors/errors.js";
import type { ReasoningConfig } from "../types/config.js";
import { LLMService } from "@reactive-agents/llm-provider";

interface TreeOfThoughtInput {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  readonly availableTools: readonly string[];
  readonly config: ReasoningConfig;
}

/**
 * Tree-of-Thought: generate N candidate solutions at each depth level,
 * evaluate each, prune below threshold, and expand the best.
 */
export const executeTreeOfThought = (
  input: TreeOfThoughtInput,
): Effect.Effect<ReasoningResult, ExecutionError, LLMService> =>
  Effect.gen(function* () {
    const llm = yield* LLMService;
    const { breadth, depth, pruningThreshold } =
      input.config.strategies.treeOfThought;
    const steps: ReasoningStep[] = [];
    const start = Date.now();
    let totalTokens = 0;
    let totalCost = 0;

    // Represent each node as { content, score, depth }
    type ThoughtNode = { content: string; score: number; depth: number };
    let frontier: ThoughtNode[] = [];

    // ── Generate initial thought branches ──
    const initResponse = yield* llm
      .complete({
        messages: [
          {
            role: "user",
            content: `Generate ${breadth} distinctly different approaches to solve this task. Number each approach.\n\nApproaches:`,
          },
        ],
        systemPrompt: `Task: ${input.taskDescription}`,
        maxTokens: 600,
        temperature: 0.9,
      })
      .pipe(
        Effect.mapError(
          (err) =>
            new ExecutionError({
              strategy: "tree-of-thought",
              message: "Initial generation failed",
              cause: err,
            }),
        ),
      );

    totalTokens += initResponse.usage.totalTokens;
    totalCost += initResponse.usage.estimatedCost;

    const initialThoughts = parseNumberedList(initResponse.content);
    for (const thought of initialThoughts) {
      steps.push({
        id: ulid() as StepId,
        type: "thought",
        content: `[depth=0] ${thought}`,
        timestamp: new Date(),
      });
    }

    // ── Evaluate initial thoughts ──
    for (const thought of initialThoughts) {
      const evalResponse = yield* llm
        .complete({
          messages: [
            {
              role: "user",
              content: `Approach: ${thought}\n\nRate this approach 0-10 on relevance, feasibility, and likely effectiveness. Respond with just a number.`,
            },
          ],
          systemPrompt: `Task: ${input.taskDescription}`,
          maxTokens: 10,
          temperature: 0.3,
        })
        .pipe(
          Effect.mapError(
            (err) =>
              new ExecutionError({
                strategy: "tree-of-thought",
                message: "Evaluation failed",
                cause: err,
              }),
          ),
        );

      totalTokens += evalResponse.usage.totalTokens;
      totalCost += evalResponse.usage.estimatedCost;

      const score = parseFloat(evalResponse.content.trim()) / 10;
      frontier.push({
        content: thought,
        score: isNaN(score) ? 0.5 : score,
        depth: 0,
      });
    }

    // ── Expand best thoughts at each depth level ──
    for (let d = 1; d < depth; d++) {
      // Prune below threshold
      frontier = frontier.filter((n) => n.score >= pruningThreshold);
      if (frontier.length === 0) break;

      // Sort and keep top `breadth`
      frontier.sort((a, b) => b.score - a.score);
      frontier = frontier.slice(0, breadth);

      const nextFrontier: ThoughtNode[] = [];

      for (const node of frontier) {
        const expandResponse = yield* llm
          .complete({
            messages: [
              {
                role: "user",
                content: `Current approach: ${node.content}\n\nExpand this approach with more detail. Provide a refined, concrete next step.`,
              },
            ],
            systemPrompt: `Task: ${input.taskDescription}`,
            maxTokens: 300,
            temperature: 0.7,
          })
          .pipe(
            Effect.mapError(
              (err) =>
                new ExecutionError({
                  strategy: "tree-of-thought",
                  message: `Expansion at depth ${d} failed`,
                  cause: err,
                }),
            ),
          );

        totalTokens += expandResponse.usage.totalTokens;
        totalCost += expandResponse.usage.estimatedCost;

        steps.push({
          id: ulid() as StepId,
          type: "thought",
          content: `[depth=${d}] ${expandResponse.content}`,
          timestamp: new Date(),
          metadata: { confidence: node.score },
        });

        nextFrontier.push({
          content: expandResponse.content,
          score: node.score,
          depth: d,
        });
      }

      frontier = nextFrontier;
    }

    // ── Select best solution ──
    frontier.sort((a, b) => b.score - a.score);
    const best = frontier[0] ?? { content: "No solution found", score: 0 };

    return {
      strategy: "tree-of-thought" as const,
      steps,
      output: best.content,
      metadata: {
        duration: Date.now() - start,
        cost: totalCost,
        tokensUsed: totalTokens,
        stepsCount: steps.length,
        confidence: best.score,
      },
      status: "completed" as const,
    };
  });

// ─── Helpers ───

function parseNumberedList(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => /^\d+[\.\)]\s/.test(line.trim()))
    .map((line) => line.replace(/^\d+[\.\)]\s*/, "").trim())
    .filter((s) => s.length > 0);
}
```

### File: `src/strategies/reflexion.ts`

```typescript
// File: src/strategies/reflexion.ts
import { Effect } from "effect";
import { ulid } from "ulid";
import type { ReasoningResult, ReasoningStep, StepId } from "../types/index.js";
import { ExecutionError } from "../errors/errors.js";
import type { ReasoningConfig } from "../types/config.js";
import { LLMService } from "@reactive-agents/llm-provider";

interface ReflexionInput {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  readonly availableTools: readonly string[];
  readonly config: ReasoningConfig;
}

/**
 * Reflexion: attempt → self-critique → retry with critique incorporated.
 * Iterates up to maxRetries, incorporating self-generated feedback each round.
 */
export const executeReflexion = (
  input: ReflexionInput,
): Effect.Effect<ReasoningResult, ExecutionError, LLMService> =>
  Effect.gen(function* () {
    const llm = yield* LLMService;
    const { maxRetries, selfCritiqueDepth } = input.config.strategies.reflexion;
    const steps: ReasoningStep[] = [];
    const start = Date.now();
    let totalTokens = 0;
    let totalCost = 0;
    let bestAnswer = "";
    let bestConfidence = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const previousCritiques = steps
        .filter((s) => s.type === "critique")
        .map((s) => s.content)
        .join("\n");

      // ── ATTEMPT ──
      const attemptResponse = yield* llm
        .complete({
          messages: [
            {
              role: "user",
              content: `${previousCritiques ? `\nPrevious critiques to address:\n${previousCritiques}\n` : ""}\nProvide your best answer:`,
            },
          ],
          systemPrompt: `Task: ${input.taskDescription}`,
          maxTokens: 500,
          temperature: 0.5,
        })
        .pipe(
          Effect.mapError(
            (err) =>
              new ExecutionError({
                strategy: "reflexion",
                message: `Attempt ${attempt + 1} failed`,
                step: attempt,
                cause: err,
              }),
          ),
        );

      totalTokens += attemptResponse.usage.totalTokens;
      totalCost += attemptResponse.usage.estimatedCost;

      steps.push({
        id: ulid() as StepId,
        type: "thought",
        content: `[attempt ${attempt + 1}] ${attemptResponse.content}`,
        timestamp: new Date(),
      });

      // ── SELF-CRITIQUE ──
      const critiquePrompt =
        selfCritiqueDepth === "deep"
          ? `Answer: ${attemptResponse.content}\n\nCritique this answer thoroughly:\n1. Is it correct?\n2. Is it complete?\n3. What assumptions were made?\n4. What could be improved?\n5. Rate confidence 0.0-1.0\n\nRespond in JSON: { "issues": string[], "confidence": number, "satisfactory": boolean }`
          : `Answer: ${attemptResponse.content}\n\nBriefly critique. Respond in JSON: { "issues": string[], "confidence": number, "satisfactory": boolean }`;

      const critiqueResponse = yield* llm
        .complete({
          messages: [{ role: "user", content: critiquePrompt }],
          systemPrompt: `Task: ${input.taskDescription}`,
          maxTokens: 300,
          temperature: 0.3,
        })
        .pipe(
          Effect.mapError(
            (err) =>
              new ExecutionError({
                strategy: "reflexion",
                message: "Critique failed",
                cause: err,
              }),
          ),
        );

      totalTokens += critiqueResponse.usage.totalTokens;
      totalCost += critiqueResponse.usage.estimatedCost;

      const critique = parseCritique(critiqueResponse.content);

      steps.push({
        id: ulid() as StepId,
        type: "critique",
        content: critiqueResponse.text,
        timestamp: new Date(),
        metadata: { confidence: critique.confidence },
      });

      if (critique.confidence > bestConfidence) {
        bestAnswer = attemptResponse.content;
        bestConfidence = critique.confidence;
      }

      // If satisfactory, stop early
      if (critique.satisfactory) break;
    }

    return {
      strategy: "reflexion" as const,
      steps,
      output: bestAnswer,
      metadata: {
        duration: Date.now() - start,
        cost: totalCost,
        tokensUsed: totalTokens,
        stepsCount: steps.length,
        confidence: bestConfidence,
      },
      status: "completed" as const,
    };
  });

// ─── Helpers ───

function parseCritique(text: string): {
  issues: string[];
  confidence: number;
  satisfactory: boolean;
} {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch {
    // fallback
  }
  return { issues: [], confidence: 0.5, satisfactory: false };
}
```

### File: `src/strategies/adaptive.ts`

```typescript
// File: src/strategies/adaptive.ts
import { Effect } from "effect";
import type { ReasoningResult } from "../types/index.js";
import type { ExecutionError } from "../errors/errors.js";
import type { ReasoningConfig } from "../types/config.js";
import { StrategySelector } from "../services/strategy-selector.js";
import { StrategyRegistry } from "../services/strategy-registry.js";
import { EffectivenessTracker } from "../services/effectiveness-tracker.js";
import { LLMService } from "@reactive-agents/llm-provider";

interface AdaptiveInput {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  readonly availableTools: readonly string[];
  readonly config: ReasoningConfig;
}

/**
 * Adaptive meta-strategy: uses StrategySelector to pick the best strategy,
 * delegates to it, and records effectiveness for future learning.
 */
export const executeAdaptive = (
  input: AdaptiveInput,
): Effect.Effect<
  ReasoningResult,
  ExecutionError,
  LLMService | StrategySelector | StrategyRegistry | EffectivenessTracker
> =>
  Effect.gen(function* () {
    const selector = yield* StrategySelector;
    const registry = yield* StrategyRegistry;
    const tracker = yield* EffectivenessTracker;

    // ── Analyze complexity and select strategy ──
    const complexity = yield* selector.analyzeComplexity(
      input.taskDescription,
      input.taskType,
    );

    const selectedStrategy = yield* selector.select({
      taskDescription: input.taskDescription,
      taskType: input.taskType,
      complexity,
      urgency: 0.5,
      costBudget: undefined,
      timeConstraint: undefined,
      preferredStrategy: undefined,
    });

    // ── Get the strategy execution function and run it ──
    const strategyFn = yield* registry.get(selectedStrategy);
    const result = yield* strategyFn(input);

    // ── Record effectiveness for learning ──
    yield* tracker.record(
      selectedStrategy,
      input.taskType,
      result,
      result.status === "completed",
    );

    // ── Return result with adaptive metadata ──
    return {
      ...result,
      strategy: "adaptive" as const,
      metadata: {
        ...result.metadata,
        selectedStrategy,
      },
    };
  });
```

---

## Services

### File: `src/services/strategy-registry.ts`

```typescript
// File: src/services/strategy-registry.ts
import { Context, Effect, Layer, Ref } from "effect";
import type { ReasoningResult, ReasoningStrategy } from "../types/index.js";
import type { ReasoningConfig } from "../types/config.js";
import {
  StrategyNotFoundError,
  type ExecutionError,
  type IterationLimitError,
} from "../errors/errors.js";
import { LLMService } from "@reactive-agents/llm-provider";
import { executeReactive } from "../strategies/reactive.js";
import { executePlanExecuteReflect } from "../strategies/plan-execute.js";
import { executeTreeOfThought } from "../strategies/tree-of-thought.js";
import { executeReflexion } from "../strategies/reflexion.js";

// ─── Strategy function type ───

export type StrategyFn = (input: {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  readonly availableTools: readonly string[];
  readonly config: ReasoningConfig;
}) => Effect.Effect<
  ReasoningResult,
  ExecutionError | IterationLimitError,
  LLMService
>;

// ─── Service Tag ───

export class StrategyRegistry extends Context.Tag("StrategyRegistry")<
  StrategyRegistry,
  {
    readonly get: (
      name: ReasoningStrategy,
    ) => Effect.Effect<StrategyFn, StrategyNotFoundError>;

    readonly register: (
      name: ReasoningStrategy,
      fn: StrategyFn,
    ) => Effect.Effect<void>;

    readonly list: () => Effect.Effect<readonly ReasoningStrategy[]>;
  }
>() {}

// ─── Live Layer ───

export const StrategyRegistryLive = Layer.effect(
  StrategyRegistry,
  Effect.gen(function* () {
    // Ref-based mutable map of strategies
    const registryRef = yield* Ref.make<Map<string, StrategyFn>>(
      new Map<string, StrategyFn>([
        ["reactive", executeReactive],
        ["plan-execute-reflect", executePlanExecuteReflect],
        ["tree-of-thought", executeTreeOfThought],
        ["reflexion", executeReflexion],
      ]),
    );

    return {
      get: (name) =>
        Effect.gen(function* () {
          const registry = yield* Ref.get(registryRef);
          const fn = registry.get(name);
          if (!fn) {
            return yield* Effect.fail(
              new StrategyNotFoundError({ strategy: name }),
            );
          }
          return fn;
        }),

      register: (name, fn) =>
        Ref.update(registryRef, (m) => {
          const next = new Map(m);
          next.set(name, fn);
          return next;
        }),

      list: () =>
        Ref.get(registryRef).pipe(
          Effect.map((m) => Array.from(m.keys()) as ReasoningStrategy[]),
        ),
    };
  }),
);
```

### File: `src/services/effectiveness-tracker.ts`

```typescript
// File: src/services/effectiveness-tracker.ts
import { Context, Effect, Layer, Ref } from "effect";
import type { ReasoningStrategy, ReasoningResult } from "../types/index.js";
import type { StrategyEffectiveness } from "../types/effectiveness.js";

// ─── Service Tag ───

export class EffectivenessTracker extends Context.Tag("EffectivenessTracker")<
  EffectivenessTracker,
  {
    /** Record a strategy execution for learning. */
    readonly record: (
      strategy: ReasoningStrategy,
      taskType: string,
      result: ReasoningResult,
      success: boolean,
    ) => Effect.Effect<void>;

    /** Get effectiveness data for a strategy + task type combo. */
    readonly getEffectiveness: (
      strategy: ReasoningStrategy,
      taskType: string,
    ) => Effect.Effect<StrategyEffectiveness | null>;

    /** Get the historically best strategy for a task type. */
    readonly getBestStrategy: (
      taskType: string,
    ) => Effect.Effect<ReasoningStrategy | null>;
  }
>() {}

// ─── Live Layer ───

export const EffectivenessTrackerLive = Layer.effect(
  EffectivenessTracker,
  Effect.gen(function* () {
    // Ref-based mutable map keyed by "strategy:taskType"
    const dataRef = yield* Ref.make<Map<string, StrategyEffectiveness>>(
      new Map(),
    );

    return {
      record: (strategy, taskType, result, success) =>
        Ref.update(dataRef, (data) => {
          const key = `${strategy}:${taskType}`;
          const current = data.get(key);
          const next = new Map(data);

          if (!current) {
            next.set(key, {
              strategy,
              taskType,
              successRate: success ? 1.0 : 0.0,
              avgCost: result.metadata.cost,
              avgDuration: result.metadata.duration,
              avgConfidence: result.metadata.confidence,
              executions: 1,
              lastUsed: new Date(),
            });
          } else {
            const n = current.executions;
            next.set(key, {
              ...current,
              successRate:
                (current.successRate * n + (success ? 1 : 0)) / (n + 1),
              avgCost: (current.avgCost * n + result.metadata.cost) / (n + 1),
              avgDuration:
                (current.avgDuration * n + result.metadata.duration) / (n + 1),
              avgConfidence:
                (current.avgConfidence * n + result.metadata.confidence) /
                (n + 1),
              executions: n + 1,
              lastUsed: new Date(),
            });
          }

          return next;
        }),

      getEffectiveness: (strategy, taskType) =>
        Ref.get(dataRef).pipe(
          Effect.map((data) => data.get(`${strategy}:${taskType}`) ?? null),
        ),

      getBestStrategy: (taskType) =>
        Ref.get(dataRef).pipe(
          Effect.map((data) => {
            let best: StrategyEffectiveness | null = null;
            for (const entry of data.values()) {
              if (entry.taskType === taskType) {
                if (!best || entry.successRate > best.successRate) {
                  best = entry;
                }
              }
            }
            return best?.strategy ?? null;
          }),
        ),
    };
  }),
);
```

### File: `src/services/strategy-selector.ts`

```typescript
// File: src/services/strategy-selector.ts
import { Context, Effect, Layer } from "effect";
import type { ReasoningStrategy, SelectionContext } from "../types/index.js";
import { SelectionError } from "../errors/errors.js";
import { EffectivenessTracker } from "./effectiveness-tracker.js";
import { LLMService } from "@reactive-agents/llm-provider";

// ─── Service Tag ───

export class StrategySelector extends Context.Tag("StrategySelector")<
  StrategySelector,
  {
    /** AI-driven strategy selection based on task context. */
    readonly select: (
      context: SelectionContext,
    ) => Effect.Effect<ReasoningStrategy, SelectionError>;

    /** Analyze task complexity (returns 0-1 score). */
    readonly analyzeComplexity: (
      taskDescription: string,
      taskType: string,
    ) => Effect.Effect<number, SelectionError>;
  }
>() {}

// ─── Live Layer ───
// Requires: LLMService, EffectivenessTracker

export const StrategySelectorLive = Layer.effect(
  StrategySelector,
  Effect.gen(function* () {
    const llm = yield* LLMService;
    const tracker = yield* EffectivenessTracker;

    return {
      select: (context) =>
        Effect.gen(function* () {
          // Check historical data first
          const historicalBest = yield* tracker.getBestStrategy(
            context.taskType,
          );

          // Use LLM to make final selection
          const prompt = [
            `Task type: ${context.taskType}`,
            `Task: ${context.taskDescription}`,
            `Complexity: ${context.complexity}`,
            `Urgency: ${context.urgency}`,
            context.costBudget != null
              ? `Budget: $${context.costBudget}`
              : null,
            context.timeConstraint != null
              ? `Time limit: ${context.timeConstraint}ms`
              : null,
            "",
            "Available strategies:",
            "1. reactive — Fast iterative ReAct loop (best for simple, tool-heavy tasks)",
            "2. plan-execute-reflect — Structured planning (best for complex multi-step tasks)",
            "3. tree-of-thought — Creative exploration (best for open-ended tasks)",
            "4. reflexion — Self-correcting with critique (best for precision-critical tasks)",
            "",
            historicalBest
              ? `Historical data suggests "${historicalBest}" works best for "${context.taskType}" tasks.`
              : "",
            context.preferredStrategy
              ? `User preference: ${context.preferredStrategy}`
              : "",
            "",
            "Select the single best strategy. Respond with ONLY the strategy name.",
          ]
            .filter(Boolean)
            .join("\n");

          const response = yield* Effect.tryPromise({
            try: () =>
              llm.complete({ prompt, maxTokens: 20, temperature: 0.3 }),
            catch: (err) =>
              new SelectionError({
                message: "LLM selection call failed",
                context: err,
              }),
          });

          const raw = response.text.trim().toLowerCase();
          const validStrategies: ReasoningStrategy[] = [
            "reactive",
            "plan-execute-reflect",
            "tree-of-thought",
            "reflexion",
          ];

          const strategy = validStrategies.find((s) => raw.includes(s));
          return strategy ?? context.preferredStrategy ?? "reactive";
        }),

      analyzeComplexity: (taskDescription, taskType) =>
        Effect.sync(() => {
          let score = 0;

          // Input length complexity
          if (taskDescription.length > 1000) score += 0.2;
          if (taskDescription.length > 5000) score += 0.2;

          // Task type complexity
          const complexTypes = [
            "research",
            "analysis",
            "creative",
            "multi-step",
          ];
          if (complexTypes.includes(taskType)) score += 0.3;

          // Keyword signals
          if (/compare|analyze|evaluate|synthesize/i.test(taskDescription))
            score += 0.2;
          if (/step.by.step|multi.?step|plan/i.test(taskDescription))
            score += 0.1;

          return Math.min(score, 1.0);
        }),
    };
  }),
);
```

### File: `src/services/reasoning-service.ts`

```typescript
// File: src/services/reasoning-service.ts
import { Context, Effect, Layer } from "effect";
import type {
  ReasoningResult,
  ReasoningStrategy,
  SelectionContext,
} from "../types/index.js";
import type { ReasoningConfig } from "../types/config.js";
import { defaultReasoningConfig } from "../types/config.js";
import { StrategyRegistry, type StrategyFn } from "./strategy-registry.js";
import { StrategySelector } from "./strategy-selector.js";
import { EffectivenessTracker } from "./effectiveness-tracker.js";
import {
  ExecutionError,
  SelectionError,
  type ReasoningErrors,
} from "../errors/errors.js";
import { LLMService } from "@reactive-agents/llm-provider";

// ─── Service Tag ───

export class ReasoningService extends Context.Tag("ReasoningService")<
  ReasoningService,
  {
    /**
     * Execute reasoning on a task.
     * If `strategy` is provided, uses that strategy directly.
     * If omitted and adaptive is enabled, uses adaptive selection.
     * Otherwise uses the configured default strategy.
     */
    readonly execute: (params: {
      readonly taskDescription: string;
      readonly taskType: string;
      readonly memoryContext: string;
      readonly availableTools: readonly string[];
      readonly strategy?: ReasoningStrategy;
    }) => Effect.Effect<ReasoningResult, ReasoningErrors>;

    /** Select best strategy for a given context (delegates to StrategySelector). */
    readonly selectStrategy: (
      context: SelectionContext,
    ) => Effect.Effect<ReasoningStrategy, SelectionError>;

    /** Register a custom strategy function. */
    readonly registerStrategy: (
      name: ReasoningStrategy,
      fn: StrategyFn,
    ) => Effect.Effect<void>;
  }
>() {}

// ─── Live Layer ───
// Requires: StrategyRegistry, StrategySelector, EffectivenessTracker, LLMService

export const ReasoningServiceLive = (
  config: ReasoningConfig = defaultReasoningConfig,
) =>
  Layer.effect(
    ReasoningService,
    Effect.gen(function* () {
      const registry = yield* StrategyRegistry;
      const selector = yield* StrategySelector;
      const tracker = yield* EffectivenessTracker;

      return {
        execute: (params) =>
          Effect.gen(function* () {
            // ── Determine which strategy to use ──
            let strategyName: ReasoningStrategy;

            if (params.strategy) {
              strategyName = params.strategy;
            } else if (config.adaptive.enabled) {
              const complexity = yield* selector.analyzeComplexity(
                params.taskDescription,
                params.taskType,
              );
              strategyName = yield* selector.select({
                taskDescription: params.taskDescription,
                taskType: params.taskType,
                complexity,
                urgency: 0.5,
              });
            } else {
              strategyName = config.defaultStrategy;
            }

            // ── Get strategy function from registry ──
            const strategyFn = yield* registry.get(strategyName);

            // ── Execute strategy ──
            const result = yield* strategyFn({
              ...params,
              config,
            });

            // ── Record effectiveness if learning is enabled ──
            if (config.adaptive.learning) {
              yield* tracker.record(
                strategyName,
                params.taskType,
                result,
                result.status === "completed",
              );
            }

            return result;
          }),

        selectStrategy: (context) => selector.select(context),

        registerStrategy: (name, fn) => registry.register(name, fn),
      };
    }),
  );
```

---

## Runtime Layer

### File: `src/runtime.ts`

```typescript
// File: src/runtime.ts
import { Layer } from "effect";
import type { ReasoningConfig } from "./types/config.js";
import { defaultReasoningConfig } from "./types/config.js";
import { StrategyRegistryLive } from "./services/strategy-registry.js";
import { EffectivenessTrackerLive } from "./services/effectiveness-tracker.js";
import { StrategySelectorLive } from "./services/strategy-selector.js";
import { ReasoningServiceLive } from "./services/reasoning-service.js";

/**
 * Create the full Reasoning layer.
 *
 * Provides: ReasoningService, StrategyRegistry, EffectivenessTracker, StrategySelector
 * Requires: LLMService (from Layer 1.5)
 *
 * Usage:
 *   const ReasoningLive = createReasoningLayer();
 *   const program = myEffect.pipe(Effect.provide(ReasoningLive));
 */
export const createReasoningLayer = (
  config: ReasoningConfig = defaultReasoningConfig,
) => {
  // EffectivenessTracker has no deps beyond Effect
  const TrackerLayer = EffectivenessTrackerLive;

  // StrategySelector needs LLMService + EffectivenessTracker
  const SelectorLayer = StrategySelectorLive.pipe(Layer.provide(TrackerLayer));

  // StrategyRegistry has no deps (strategies are registered at construction)
  const RegistryLayer = StrategyRegistryLive;

  // ReasoningService needs all three + LLMService
  const ServiceLayer = ReasoningServiceLive(config).pipe(
    Layer.provide(Layer.mergeAll(RegistryLayer, SelectorLayer, TrackerLayer)),
  );

  // Merge all services into one layer
  return Layer.mergeAll(
    ServiceLayer,
    RegistryLayer,
    SelectorLayer,
    TrackerLayer,
  );
};
```

---

## Public API

### File: `src/index.ts`

```typescript
// File: src/index.ts

// ─── Types ───
export type {
  StepId,
  StepType,
  StepMetadata,
  ReasoningStep,
} from "./types/step.js";

export type {
  ReasoningStrategy,
  ReasoningStatus,
  ReasoningMetadata,
  ReasoningResult,
  SelectionContext,
} from "./types/reasoning.js";

export type { StrategyEffectiveness } from "./types/effectiveness.js";

export type {
  ReasoningConfig,
  ReactiveConfig,
  PlanExecuteConfig,
  TreeOfThoughtConfig,
  ReflexionConfig,
} from "./types/config.js";

// ─── Schemas (for runtime validation) ───
export {
  StepId,
  StepType,
  StepMetadataSchema,
  ReasoningStepSchema,
} from "./types/step.js";

export {
  ReasoningStrategy,
  ReasoningStatus,
  ReasoningMetadataSchema,
  ReasoningResultSchema,
  SelectionContextSchema,
} from "./types/reasoning.js";

export { StrategyEffectivenessSchema } from "./types/effectiveness.js";

export {
  ReasoningConfigSchema,
  ReactiveConfigSchema,
  PlanExecuteConfigSchema,
  TreeOfThoughtConfigSchema,
  ReflexionConfigSchema,
  defaultReasoningConfig,
} from "./types/config.js";

// ─── Errors ───
export {
  ReasoningError,
  StrategyNotFoundError,
  SelectionError,
  ExecutionError,
  IterationLimitError,
  type ReasoningErrors,
} from "./errors/errors.js";

// ─── Services ───
export {
  ReasoningService,
  ReasoningServiceLive,
} from "./services/reasoning-service.js";
export {
  StrategyRegistry,
  StrategyRegistryLive,
  type StrategyFn,
} from "./services/strategy-registry.js";
export {
  StrategySelector,
  StrategySelectorLive,
} from "./services/strategy-selector.js";
export {
  EffectivenessTracker,
  EffectivenessTrackerLive,
} from "./services/effectiveness-tracker.js";

// ─── Strategy Functions (for direct use or custom composition) ───
export { executeReactive } from "./strategies/reactive.js";
export { executePlanExecuteReflect } from "./strategies/plan-execute.js";
export { executeTreeOfThought } from "./strategies/tree-of-thought.js";
export { executeReflexion } from "./strategies/reflexion.js";
export { executeAdaptive } from "./strategies/adaptive.js";

// ─── Runtime ───
export { createReasoningLayer } from "./runtime.js";
```

---

## Testing

### File: `tests/strategies/reactive.test.ts`

```typescript
// File: tests/strategies/reactive.test.ts
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { executeReactive } from "../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { LLMService } from "@reactive-agents/llm-provider";

// ─── Mock LLM Provider ───
const MockLLMService = Layer.succeed(LLMService, {
  complete: async ({ prompt }) => ({
    text: prompt.includes("FINAL ANSWER")
      ? "FINAL ANSWER: The capital of France is Paris."
      : "I need to think about this. FINAL ANSWER: Paris",
    usage: { totalTokens: 50, cost: 0.001, confidence: 0.9 },
  }),
  // ... other methods as needed
} as any);

describe("ReactiveStrategy", () => {
  it("should execute ReAct loop and return completed result", async () => {
    const program = executeReactive({
      taskDescription: "What is the capital of France?",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(MockLLMService)),
    );

    expect(result.strategy).toBe("reactive");
    expect(result.status).toBe("completed");
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.metadata.stepsCount).toBeGreaterThan(0);
  });

  it("should return partial result when max iterations reached", async () => {
    const NeverFinishLLM = Layer.succeed(LLMService, {
      complete: async () => ({
        text: "I need to think more about this...",
        usage: { totalTokens: 20, cost: 0.0005, confidence: 0.3 },
      }),
    } as any);

    const program = executeReactive({
      taskDescription: "An impossible task",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: {
        ...defaultReasoningConfig,
        strategies: {
          ...defaultReasoningConfig.strategies,
          reactive: { maxIterations: 3, temperature: 0.7 },
        },
      },
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(NeverFinishLLM)),
    );

    expect(result.status).toBe("partial");
    expect(result.steps.length).toBe(3); // 3 iterations × 1 thought each
  });
});
```

### File: `tests/effectiveness-tracker.test.ts`

```typescript
// File: tests/effectiveness-tracker.test.ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  EffectivenessTrackerLive,
  EffectivenessTracker,
} from "../src/services/effectiveness-tracker.js";
import type { ReasoningResult } from "../src/types/reasoning.js";

const mockResult = (cost: number, confidence: number): ReasoningResult => ({
  strategy: "reactive",
  steps: [],
  output: "test",
  metadata: {
    duration: 100,
    cost,
    tokensUsed: 50,
    stepsCount: 1,
    confidence,
  },
  status: "completed",
});

describe("EffectivenessTracker", () => {
  it("should record and retrieve effectiveness data", async () => {
    const program = Effect.gen(function* () {
      const tracker = yield* EffectivenessTracker;

      yield* tracker.record("reactive", "query", mockResult(0.01, 0.9), true);
      yield* tracker.record("reactive", "query", mockResult(0.02, 0.8), true);
      yield* tracker.record(
        "plan-execute-reflect",
        "query",
        mockResult(0.05, 0.7),
        false,
      );

      const effectiveness = yield* tracker.getEffectiveness(
        "reactive",
        "query",
      );
      expect(effectiveness).not.toBeNull();
      expect(effectiveness!.executions).toBe(2);
      expect(effectiveness!.successRate).toBe(1.0);

      const best = yield* tracker.getBestStrategy("query");
      expect(best).toBe("reactive");
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(EffectivenessTrackerLive)),
    );
  });
});
```

---

## Package Configuration

### File: `package.json`

```json
{
  "name": "@reactive-agents/reasoning",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": {
    "effect": "^3.10.0",
    "@reactive-agents/core": "workspace:*",
    "@reactive-agents/llm-provider": "workspace:*",
    "ulid": "^2.3.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@types/bun": "latest"
  },
  "scripts": {
    "test": "bun test",
    "build": "bun build src/index.ts --outdir dist",
    "typecheck": "tsc --noEmit"
  }
}
```

---

## Performance Targets

| Operation                       | Target | Notes                        |
| ------------------------------- | ------ | ---------------------------- |
| Strategy selection (AI)         | <200ms | LLM round-trip               |
| Complexity analysis (heuristic) | <5ms   | No LLM call                  |
| Reactive execution (simple)     | <5s    | 3-5 steps                    |
| Plan-Execute-Reflect (complex)  | <30s   | Multi-step + reflection      |
| Tree-of-Thought (creative)      | <60s   | Multiple branches            |
| Reflexion (precision)           | <45s   | Multiple attempts + critique |
| Effectiveness lookup            | <1ms   | In-memory Ref                |
| Strategy registration           | <1ms   | Ref.update                   |

---

## Success Criteria

- [ ] All 5 strategies implemented as pure Effect functions (not classes)
- [ ] StrategyRegistry, EffectivenessTracker, StrategySelector, ReasoningService as Context.Tag + Layer.effect
- [ ] Adaptive selector chooses correctly (>80% accuracy on test suite)
- [ ] Effectiveness learning tracks and improves strategy selection over time
- [ ] Registry supports custom strategy registration at runtime
- [ ] Reactive strategy completes simple tasks within 10 iterations
- [ ] Plan-Execute handles complex tasks with reflection + refinement
- [ ] Tree-of-Thought generates diverse solutions with scoring and pruning
- [ ] Reflexion improves answers through self-critique across retries
- [ ] All types defined with Schema (not plain interfaces)
- [ ] All errors defined with Data.TaggedError
- [ ] All tests pass with >80% coverage

---

## Dependencies

**Requires:**

- Layer 1 (Core): Task, AgentId types
- Layer 1.5 (LLM Provider): LLMService service for all LLM calls
- Layer 2 (Memory): MemorySnapshot for context (passed as serialized string)

**Provides to:**

- Layer 4 (Verification): ReasoningResult for hallucination checking
- Layer 7 (Orchestration): Reasoning for sub-agents
- Layer 10 (Interaction): Strategy metadata for UI display

---

**Status: Implementation-Ready**
**Phase 1:** Reactive strategy + ReasoningService (Weeks 3-4)
**Phase 2:** Plan-Execute, Tree-of-Thought, Reflexion, Adaptive (Weeks 5-6)
