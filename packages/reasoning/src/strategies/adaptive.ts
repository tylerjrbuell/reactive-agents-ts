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
import type { ReasoningResult, ReasoningStep } from "../types/index.js";
import { ExecutionError, IterationLimitError } from "../errors/errors.js";
import type { ReasoningConfig } from "../types/config.js";
import { LLMService } from "@reactive-agents/llm-provider";
import { executeReactive } from "./reactive.js";
import { executeReflexion } from "./reflexion.js";
import { executePlanExecute } from "./plan-execute.js";
import { executeTreeOfThought } from "./tree-of-thought.js";
import { resolveStrategyServices, compilePromptOrFallback, publishReasoningStep } from "./shared/service-utils.js";
import { makeStep, buildStrategyResult } from "./shared/step-utils.js";
import { stripThinking } from "./shared/thinking-utils.js";
import type { ToolSchema } from "./shared/tool-utils.js";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import type { ContextProfile } from "../context/context-profile.js";
import type { KernelMetaToolsConfig } from "../types/kernel-meta-tools.js";

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
  /** Full tool schemas for pass-through to sub-strategies */
  readonly availableToolSchemas?: readonly ToolSchema[];
  /** Tool result compression config — forwarded to sub-strategies. */
  readonly resultCompression?: ResultCompressionConfig;
  /** Context profile — forwarded to sub-strategies (used by reactive for compaction). */
  readonly contextProfile?: Partial<ContextProfile>;
  /** Agent ID for tool execution attribution — forwarded to sub-strategies. */
  readonly agentId?: string;
  /** Session ID for tool execution attribution — forwarded to sub-strategies. */
  readonly sessionId?: string;
  /** Tools that MUST be called before the agent can declare success */
  readonly requiredTools?: readonly string[];
  /** Tools identified as relevant/supplementary (LLM-classified) — allowed through the required-tools gate */
  readonly relevantTools?: readonly string[];
  /** Per-tool call budget — gate blocks calls that exceed their limit */
  readonly maxCallsPerTool?: Readonly<Record<string, number>>;
  /** Max redirects when required tools are missing (default: 2) */
  readonly maxRequiredToolRetries?: number;
  /** Model identifier for routing/entropy scoring */
  readonly modelId?: string;
  /** LLM temperature override */
  readonly temperature?: number;
  readonly synthesisConfig?: import("../context/synthesis-types.js").SynthesisConfig;
  readonly metaTools?: KernelMetaToolsConfig;
  readonly briefResolvedSkills?: readonly { readonly name: string; readonly purpose: string }[];
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
    const { llm, promptService: promptServiceOpt, eventBus: ebOpt } =
      yield* resolveStrategyServices;
    const steps: ReasoningStep[] = [];
    const start = Date.now();

    // ── Heuristic pre-classifier ──
    // Avoid an LLM call for obvious cases. Only consult the LLM for ambiguous tasks.
    const heuristicResult = heuristicClassify(input);

    let selectedStrategy: SubStrategy;
    let analysisTokens = 0;
    let analysisCost = 0;

    if (heuristicResult) {
      selectedStrategy = heuristicResult;
      steps.push(makeStep(
        "thought",
        `[ADAPTIVE] Heuristic pre-classifier selected: ${selectedStrategy} (no LLM call needed)`,
      ));

      yield* publishReasoningStep(ebOpt, {
        _tag: "ReasoningStepCompleted",
        taskId: input.taskId ?? "adaptive",
        strategy: "adaptive",
        step: 1,
        totalSteps: 1,
        thought: `[ADAPTIVE] Heuristic: ${selectedStrategy}`,
        kernelPass: "adaptive:heuristic",
      });
    } else {
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
        maxTokens: 500,
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

    // Strip <think> blocks from classification to prevent thinking from
    // being parsed as a strategy name.
    selectedStrategy = parseStrategySelection(
      stripThinking(analysisResponse.content),
    );
    analysisTokens = analysisResponse.usage.totalTokens;
    analysisCost = analysisResponse.usage.estimatedCost;

    steps.push(makeStep(
      "thought",
      `[ADAPTIVE] Selected strategy: ${selectedStrategy} (analysis tokens: ${analysisTokens})`,
    ));

    yield* publishReasoningStep(ebOpt, {
      _tag: "ReasoningStepCompleted",
      taskId: input.taskId ?? "adaptive",
      strategy: "adaptive",
      step: steps.length,
      totalSteps: 1,
      thought: `[ADAPTIVE] Selected strategy: ${selectedStrategy}`,
      kernelPass: "adaptive:select",
    });
    } // end else (LLM classification path)

    // ── Dispatch to selected strategy ──
    const subResult = yield* dispatchStrategy(selectedStrategy, input);

    // ── Fallback: if sub-strategy returned partial and wasn't already reactive ──
    let finalSubResult = subResult;
    let fallbackOccurred = false;
    if (subResult.status === "partial" && selectedStrategy !== "reactive") {
      fallbackOccurred = true;
      steps.push(makeStep(
        "thought",
        `[ADAPTIVE] ${selectedStrategy} returned partial — falling back to reactive`,
      ));

      yield* publishReasoningStep(ebOpt, {
        _tag: "ReasoningStepCompleted",
        taskId: input.taskId ?? "adaptive",
        strategy: "adaptive",
        step: steps.length,
        totalSteps: 2,
        thought: `[ADAPTIVE] Falling back to reactive strategy`,
        kernelPass: "adaptive:fallback",
      });

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

    // strategy: "adaptive" preserved for API consumers.
    // selectedStrategy in metadata surfaces what actually ran (e.g. "reactive")
    // so strategyUsed in AgentResult shows the effective sub-strategy.
    const activeStrategy = fallbackOccurred ? "reactive" : selectedStrategy;

    return buildStrategyResult({
      strategy: "adaptive",
      steps: allSteps,
      output: finalSubResult.output,
      status: finalSubResult.status,
      start,
      totalTokens: finalSubResult.metadata.tokensUsed + analysisTokens,
      totalCost: finalSubResult.metadata.cost + analysisCost,
      extraMetadata: {
        selectedStrategy: activeStrategy,
        fallbackOccurred,
      },
    });
  });

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

/**
 * Heuristic pre-classifier — handles obvious cases without an LLM call.
 * Returns null for ambiguous tasks that require LLM classification.
 */
function heuristicClassify(input: AdaptiveInput): SubStrategy | null {
  const task = input.taskDescription.toLowerCase();
  const hasTools = input.availableTools.length > 0;
  const wordCount = task.split(/\s+/).length;

  // Short tasks with no tools → reactive (Q&A, simple lookup)
  if (wordCount <= 15 && !hasTools) return "reactive";

  // Plan patterns → plan-execute
  const planPatterns = /\b(step[- ]by[- ]step|plan|phases?|stages?|pipeline|workflow|sequenc|first .* then|implement .* with .* and)\b/i;
  if (planPatterns.test(task) && wordCount > 10) return "plan-execute-reflect";

  // Numbered lists (1. ... 2. ... or "steps: ") → plan-execute
  if (/\b\d+\.\s/.test(task) || /steps?:/i.test(task)) return "plan-execute-reflect";

  // Exploration/comparison patterns → tree-of-thought
  const totPatterns = /\b(compare|alternative|explore|brainstorm|creative|different (ways|approach|solution)|pros and cons|trade-?offs?)\b/i;
  if (totPatterns.test(task)) return "tree-of-thought";

  // Quality/iteration patterns → reflexion
  const reflexionPatterns = /\b(review|critique|improve|refine|iterate|polish|rewrite|fix (and )?check|self-assess)\b/i;
  if (reflexionPatterns.test(task) && wordCount > 8) return "reflexion";

  // Short task with tools → reactive (direct tool use)
  if (wordCount <= 20 && hasTools) return "reactive";

  // Ambiguous — defer to LLM classifier
  return null;
}
