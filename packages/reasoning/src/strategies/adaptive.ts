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
import { EventBus } from "@reactive-agents/core";
import { executeReactive } from "./reactive.js";
import { executeReflexion } from "./reflexion.js";
import { executePlanExecute } from "./plan-execute.js";
import { executeTreeOfThought } from "./tree-of-thought.js";

/** Record of a past strategy execution outcome for self-improvement. */
export interface StrategyOutcome {
  readonly strategy: string;
  readonly success: boolean;
  readonly durationMs: number;
  readonly tokensUsed: number;
  readonly taskDescription: string;
}

interface AdaptiveInput {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  readonly availableTools: readonly string[];
  readonly config: ReasoningConfig;
  /** Custom system prompt for steering agent behavior */
  readonly systemPrompt?: string;
  /** Past strategy outcomes from episodic memory (for self-improvement). */
  readonly pastExperience?: readonly StrategyOutcome[];
  /** Task ID for event correlation */
  readonly taskId?: string;
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
    const ebOptRaw = yield* Effect.serviceOption(EventBus).pipe(
      Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
    );
    const ebOpt = ebOptRaw as typeof ebOptRaw;
    const steps: ReasoningStep[] = [];
    const start = Date.now();

    // ── Analyze task to select strategy ──
    const classifyDefaultFallback = input.systemPrompt
      ? `${input.systemPrompt}\n\nYou are a task analyzer. Classify the task and recommend the best reasoning strategy. Respond with ONLY one of: REACTIVE, REFLEXION, PLAN_EXECUTE, TREE_OF_THOUGHT`
      : "You are a task analyzer. Classify the task and recommend the best reasoning strategy. Respond with ONLY one of: REACTIVE, REFLEXION, PLAN_EXECUTE, TREE_OF_THOUGHT";

    const classifySystemPrompt = yield* compilePromptOrFallback(
      promptServiceOpt,
      "reasoning.adaptive-classify",
      {},
      classifyDefaultFallback,
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

    if (ebOpt._tag === "Some") {
      yield* ebOpt.value.publish({
        _tag: "ReasoningStepCompleted",
        taskId: input.taskId ?? "adaptive",
        strategy: "adaptive",
        step: steps.length,
        totalSteps: 1,
        thought: `[ADAPTIVE] Selected strategy: ${selectedStrategy}`,
      }).pipe(Effect.catchAll(() => Effect.void));
    }

    // ── Dispatch to selected strategy ──
    const subResult = yield* dispatchStrategy(selectedStrategy, input);

    // ── Fallback: if sub-strategy returned partial and wasn't already reactive ──
    let finalSubResult = subResult;
    let fallbackOccurred = false;
    if (subResult.status === "partial" && selectedStrategy !== "reactive") {
      fallbackOccurred = true;
      steps.push({
        id: ulid() as StepId,
        type: "thought",
        content: `[ADAPTIVE] ${selectedStrategy} returned partial — falling back to reactive`,
        timestamp: new Date(),
      });

      if (ebOpt._tag === "Some") {
        yield* ebOpt.value.publish({
          _tag: "ReasoningStepCompleted",
          taskId: input.taskId ?? "adaptive",
          strategy: "adaptive",
          step: steps.length,
          totalSteps: 2,
          thought: `[ADAPTIVE] Falling back to reactive strategy`,
        }).pipe(Effect.catchAll(() => Effect.void));
      }

      // NOTE: The failed sub-strategy's tokens are not added to metadata —
      // only the reactive result's tokens are reported. This is acceptable
      // since this is a best-effort fallback and the partial tokens are
      // from an unsuccessful run.
      finalSubResult = yield* executeReactive(input).pipe(
        // If reactive also fails, use original partial result rather than throwing
        Effect.catchAll(() => Effect.succeed(subResult)),
      );
    }

    // ── Combine results ──
    const allSteps = [...steps, ...finalSubResult.steps];

    return {
      strategy: "adaptive" as const,
      steps: allSteps,
      output: finalSubResult.output,
      metadata: {
        duration: Date.now() - start,
        cost:
          finalSubResult.metadata.cost +
          analysisResponse.usage.estimatedCost,
        tokensUsed:
          finalSubResult.metadata.tokensUsed +
          analysisResponse.usage.totalTokens,
        stepsCount: allSteps.length,
        confidence: finalSubResult.metadata.confidence,
        // selectedStrategy = what the classifier chose; fallbackOccurred = true means
        // reactive actually produced the output (not selectedStrategy)
        selectedStrategy: selectedStrategy,
        fallbackOccurred,
      },
      status: finalSubResult.status,
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
  let prompt = `Analyze this task and classify it:

Task: ${input.taskDescription}
Task Type: ${input.taskType}
Available Tools: ${input.availableTools.length > 0 ? input.availableTools.join(", ") : "none"}

Strategy options:
- REACTIVE: Best for simple Q&A, quick tool use, straightforward tasks
- REFLEXION: Best for tasks requiring accuracy, self-correction, quality improvement
- PLAN_EXECUTE: Best for multi-step tasks, procedural work, tasks needing a plan
- TREE_OF_THOUGHT: Best for creative/exploratory tasks, problems with multiple valid approaches`;

  // Include past experience for self-improvement bias
  if (input.pastExperience && input.pastExperience.length > 0) {
    const experienceSummary = input.pastExperience
      .map((e) => `  - ${e.strategy}: ${e.success ? "succeeded" : "failed"} (${e.tokensUsed} tokens, ${(e.durationMs / 1000).toFixed(1)}s) for "${e.taskDescription.slice(0, 80)}"`)
      .join("\n");
    prompt += `\n\nPast experience on similar tasks:\n${experienceSummary}\nFavor strategies that succeeded on similar tasks.`;
  }

  prompt += `\n\nExamples:
- "What is the capital of France?" → REACTIVE (simple Q&A)
- "Summarize this article" → REACTIVE (single-pass task, no iteration needed)
- "Write a persuasive essay about climate change" → REFLEXION (quality-driven, iterative self-improvement)
- "Review and fix this code for correctness" → REFLEXION (iterative accuracy, self-critique)
- "Set up a CI/CD pipeline with these 5 steps" → PLAN_EXECUTE (procedural, sequential phases)
- "Build a REST API with auth, tests, and docs" → PLAN_EXECUTE (clear decomposable stages)
- "Design 3 different system architectures for this use case" → TREE_OF_THOUGHT (multiple valid approaches to explore)
- "Find the most creative solution to this puzzle" → TREE_OF_THOUGHT (exploratory, branching possibilities)`;

  prompt += `\n\nRespond with ONLY the strategy name (REACTIVE, REFLEXION, PLAN_EXECUTE, or TREE_OF_THOUGHT).`;
  return prompt;
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
