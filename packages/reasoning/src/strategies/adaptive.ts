// File: src/strategies/adaptive.ts
/**
 * Adaptive Meta-Strategy
 *
 * Analyzes task complexity and dispatches to the best sub-strategy:
 * - Simple tasks → reactive (fast, single-pass)
 * - Tasks needing self-improvement → reflexion
 * - Complex multi-step tasks → plan-execute-reflect
 * - Exploratory/creative tasks → tree-of-thought
 */
import { Effect } from "effect";
import { ulid } from "ulid";
import type { ReasoningResult, ReasoningStep } from "../types/index.js";
import type { StepId } from "../types/step.js";
import { ExecutionError, IterationLimitError } from "../errors/errors.js";
import type { ReasoningConfig } from "../types/config.js";
import { LLMService } from "@reactive-agents/llm-provider";
import { PromptService } from "@reactive-agents/prompts";
import { executeReactive } from "./reactive.js";
import { executeReflexion } from "./reflexion.js";
import { executePlanExecute } from "./plan-execute.js";
import { executeTreeOfThought } from "./tree-of-thought.js";

interface AdaptiveInput {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  readonly availableTools: readonly string[];
  readonly config: ReasoningConfig;
}

type SubStrategy =
  | "reactive"
  | "reflexion"
  | "plan-execute-reflect"
  | "tree-of-thought";

export const executeAdaptive = (
  input: AdaptiveInput,
): Effect.Effect<
  ReasoningResult,
  ExecutionError | IterationLimitError,
  LLMService
> =>
  Effect.gen(function* () {
    const llm = yield* LLMService;
    const promptServiceOptRaw = yield* Effect.serviceOption(PromptService).pipe(
      Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
    );
    const promptServiceOpt = promptServiceOptRaw as PromptServiceOpt;
    const steps: ReasoningStep[] = [];
    const start = Date.now();

    // ── Analyze task to select strategy ──
    const classifySystemPrompt = yield* compilePromptOrFallback(
      promptServiceOpt,
      "reasoning.adaptive-classify",
      {},
      "You are a task analyzer. Classify the task and recommend the best reasoning strategy. Respond with ONLY one of: REACTIVE, REFLEXION, PLAN_EXECUTE, TREE_OF_THOUGHT",
    );
    const analysisResponse = yield* llm
      .complete({
        messages: [
          {
            role: "user",
            content: buildAnalysisPrompt(input),
          },
        ],
        systemPrompt: classifySystemPrompt,
        maxTokens: 50,
        temperature: 0.2,
      })
      .pipe(
        Effect.mapError(
          (err) =>
            new ExecutionError({
              strategy: "adaptive",
              message: "Task analysis failed",
              step: 0,
              cause: err,
            }),
        ),
      );

    const selectedStrategy = parseStrategySelection(
      analysisResponse.content,
    );

    steps.push({
      id: ulid() as StepId,
      type: "thought",
      content: `[ADAPTIVE] Selected strategy: ${selectedStrategy} (analysis tokens: ${analysisResponse.usage.totalTokens})`,
      timestamp: new Date(),
    });

    // ── Dispatch to selected strategy ──
    const subResult = yield* dispatchStrategy(selectedStrategy, input);

    // ── Combine results ──
    const allSteps = [...steps, ...subResult.steps];

    return {
      strategy: "adaptive" as const,
      steps: allSteps,
      output: subResult.output,
      metadata: {
        duration: Date.now() - start,
        cost:
          subResult.metadata.cost +
          analysisResponse.usage.estimatedCost,
        tokensUsed:
          subResult.metadata.tokensUsed +
          analysisResponse.usage.totalTokens,
        stepsCount: allSteps.length,
        confidence: subResult.metadata.confidence,
        selectedStrategy: selectedStrategy,
      },
      status: subResult.status,
    };
  });

// ─── Prompt compilation helper ───

type PromptServiceOpt =
  | { _tag: "Some"; value: { compile: (id: string, vars: Record<string, unknown>) => Effect.Effect<{ content: string }, unknown> } }
  | { _tag: "None" };

function compilePromptOrFallback(
  promptServiceOpt: PromptServiceOpt,
  templateId: string,
  variables: Record<string, unknown>,
  fallback: string,
): Effect.Effect<string, never> {
  if (promptServiceOpt._tag === "None") {
    return Effect.succeed(fallback);
  }
  return promptServiceOpt.value
    .compile(templateId, variables)
    .pipe(
      Effect.map((compiled: { content: string }) => compiled.content),
      Effect.catchAll(() => Effect.succeed(fallback)),
    );
}

// ─── Private Helpers ───

function buildAnalysisPrompt(input: AdaptiveInput): string {
  return `Analyze this task and classify it:

Task: ${input.taskDescription}
Task Type: ${input.taskType}
Available Tools: ${input.availableTools.length > 0 ? input.availableTools.join(", ") : "none"}

Strategy options:
- REACTIVE: Best for simple Q&A, quick tool use, straightforward tasks
- REFLEXION: Best for tasks requiring accuracy, self-correction, quality improvement
- PLAN_EXECUTE: Best for multi-step tasks, procedural work, tasks needing a plan
- TREE_OF_THOUGHT: Best for creative/exploratory tasks, problems with multiple valid approaches

Respond with ONLY the strategy name (REACTIVE, REFLEXION, PLAN_EXECUTE, or TREE_OF_THOUGHT).`;
}

function parseStrategySelection(text: string): SubStrategy {
  const normalized = text.trim().toUpperCase();

  if (normalized.includes("PLAN_EXECUTE") || normalized.includes("PLAN-EXECUTE")) {
    return "plan-execute-reflect";
  }
  if (normalized.includes("TREE_OF_THOUGHT") || normalized.includes("TREE-OF-THOUGHT")) {
    return "tree-of-thought";
  }
  if (normalized.includes("REFLEXION")) {
    return "reflexion";
  }
  // Default to reactive for anything else
  return "reactive";
}

function dispatchStrategy(
  strategy: SubStrategy,
  input: AdaptiveInput,
): Effect.Effect<
  ReasoningResult,
  ExecutionError | IterationLimitError,
  LLMService
> {
  switch (strategy) {
    case "reflexion":
      return executeReflexion(input);
    case "plan-execute-reflect":
      return executePlanExecute(input);
    case "tree-of-thought":
      return executeTreeOfThought(input);
    case "reactive":
    default:
      return executeReactive(input);
  }
}
