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
import { ObservableLogger, type LogEvent } from "@reactive-agents/observability";
import { executeReactive } from "./reactive.js";
import { executeReflexion } from "./reflexion.js";
import { executePlanExecute } from "./plan-execute.js";
import { executeTreeOfThought } from "./tree-of-thought.js";
import { resolveStrategyServices, compilePromptOrFallback, publishReasoningStep } from "../kernel/utils/service-utils.js";
import { makeStep, buildStrategyResult } from "../kernel/capabilities/sense/step-utils.js";
import { stripThinking } from "../kernel/capabilities/reason/stream-parser.js";
import type { ToolSchema } from "../kernel/capabilities/attend/tool-formatting.js";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import type { ContextProfile } from "../context/context-profile.js";
import type { KernelMetaToolsConfig } from "../types/kernel-meta-tools.js";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { classifyTaskComplexity } from "../kernel/capabilities/comprehend/task-complexity.js";
import type { TaskClassification } from "../kernel/capabilities/comprehend/task-classification.js";

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
  /**
   * Pre-computed task classification from the upstream `comprehend` pass.
   * When provided, adaptive reads complexity/intent here and threads it to
   * the dispatched sub-strategy (HS-cleanup-2). When absent, classifies
   * once at entry and threads that snapshot.
   */
  readonly taskClassification?: TaskClassification;
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

    const emitLog = (event: LogEvent): Effect.Effect<void, never> =>
      Effect.serviceOption(ObservableLogger).pipe(
        Effect.flatMap((opt) =>
          opt._tag === "Some"
            ? opt.value.emit(event).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/strategies/adaptive.ts:98", tag: errorTag(err) })))
            : Effect.void
        )
      );

    const steps: ReasoningStep[] = [];
    const start = Date.now();

    yield* emitLog({ _tag: "phase_started", phase: "adaptive:select", timestamp: new Date() });

    // HS-cleanup-2: one canonical pre-execution classification per agent run.
    // Reuse the upstream snapshot when threaded; classify locally only as
    // backward-compat fallback for direct adaptive callers. The same snapshot
    // is forwarded to the dispatched sub-strategy so it doesn't re-classify.
    const taskClassification =
      input.taskClassification ?? {
        complexity: classifyTaskComplexity(input.taskDescription),
        intent: { format: null, cues: [], expectedContent: [], expectedEntities: [] },
      };

    // ── Heuristic pre-classifier ──
    // Avoid an LLM call for obvious cases. Only consult the LLM for ambiguous tasks.
    const heuristicResult = heuristicClassify(input, taskClassification);

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

    yield* emitLog({
      _tag: "phase_complete",
      phase: "adaptive:select",
      duration: Date.now() - start,
      status: "success",
    });

    // ── HS-111 / M5 cost-aware downgrade ──
    //
    // After strategy is selected (by heuristic or LLM), consult pastExperience
    // for cost telemetry. If the picked strategy has historically been ≥2×
    // more expensive than a cheaper alternative with comparable success rate,
    // downgrade. Probe evidence (sweep-2026-05-23) showed adaptive routing
    // never considered cost — expensive strategies kept being selected on
    // trivial tasks even when cheap ones had higher success on the same
    // history. Only fires with ≥3 samples of each strategy in pastExperience.
    let costAwareDowngradeReason: string | null = null;
    if (input.pastExperience && input.pastExperience.length > 0) {
      const adjustment = costAwareAdjustment(selectedStrategy, input.pastExperience);
      if (adjustment.downgraded) {
        steps.push(
          makeStep(
            "thought",
            `[ADAPTIVE] Cost-aware downgrade: ${adjustment.reason}`,
          ),
        );
        yield* publishReasoningStep(ebOpt, {
          _tag: "ReasoningStepCompleted",
          taskId: input.taskId ?? "adaptive",
          strategy: "adaptive",
          step: steps.length,
          totalSteps: steps.length,
          thought: `[ADAPTIVE] cost-downgrade ${selectedStrategy}→${adjustment.strategy}`,
          kernelPass: "adaptive:cost-downgrade",
        });
        selectedStrategy = adjustment.strategy;
        costAwareDowngradeReason = adjustment.reason;
      }
    }

    yield* emitLog({ _tag: "phase_started", phase: "adaptive:dispatch", timestamp: new Date() });

    // ── Dispatch to selected strategy ──
    // HS-cleanup-2: forward the canonical classification snapshot so the
    // sub-strategy doesn't re-classify the same task string.
    const subResult = yield* dispatchStrategy(selectedStrategy, {
      ...input,
      taskClassification,
    });

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
      finalSubResult = yield* executeReactive({ ...input, taskClassification }).pipe(
        // If reactive also fails, use original partial result rather than throwing
        Effect.catchAll(() => Effect.succeed(subResult)),
      );
    }

    // ── Combine results ──
    const allSteps = [...steps, ...finalSubResult.steps];

    yield* emitLog({
      _tag: "phase_complete",
      phase: "adaptive:dispatch",
      duration: Date.now() - start,
      status: "success",
    });

    // strategy: "adaptive" preserved for API consumers.
    // selectedStrategy in metadata surfaces what actually ran (e.g. "reactive")
    // so strategyUsed in AgentResult shows the effective sub-strategy.
    const activeStrategy = fallbackOccurred ? "reactive" : selectedStrategy;

    yield* emitLog({
      _tag: "completion",
      success: finalSubResult.status === "completed",
      summary: `Adaptive selected ${activeStrategy}${fallbackOccurred ? " (fallback)" : ""}`,
      timestamp: new Date(),
    });

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
        ...(costAwareDowngradeReason
          ? { costAwareDowngrade: costAwareDowngradeReason }
          : {}),
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
 * HS-111 / M5 cost-aware downgrade.
 *
 * Given a heuristic-picked strategy and the agent's past execution history,
 * downgrade to a cheaper strategy when the picked one is ≥COST_RATIO_THRESHOLD
 * times more expensive on average than a cheaper alternative AND the cheaper
 * alternative has a comparable success rate (within tolerance).
 *
 * Only considers strategies with ≥MIN_SAMPLES historical runs each — single
 * outliers don't trigger a downgrade. Returns the input strategy unchanged
 * when there's not enough data or when the picked strategy is already cheapest.
 */
export interface CostAwareDowngradeAdjustment {
  readonly strategy: SubStrategy;
  readonly downgraded: boolean;
  readonly reason: string;
}

const COST_RATIO_THRESHOLD = 2.0; // 2× more expensive triggers downgrade
const MIN_SAMPLES = 3;             // need ≥3 runs of each strategy to compare
const SUCCESS_TOLERANCE = 0.15;    // cheaper strategy must be within 15pp success rate

export function costAwareAdjustment(
  picked: SubStrategy,
  history: readonly StrategyOutcome[],
): CostAwareDowngradeAdjustment {
  // Aggregate per-strategy metrics from history.
  type Agg = { count: number; successes: number; totalTokens: number };
  const byStrategy = new Map<string, Agg>();
  for (const o of history) {
    const a = byStrategy.get(o.strategy) ?? { count: 0, successes: 0, totalTokens: 0 };
    a.count += 1;
    a.successes += o.success ? 1 : 0;
    a.totalTokens += o.tokensUsed;
    byStrategy.set(o.strategy, a);
  }

  const pickedAgg = byStrategy.get(picked);
  if (!pickedAgg || pickedAgg.count < MIN_SAMPLES) {
    return { strategy: picked, downgraded: false, reason: "insufficient-history" };
  }
  const pickedMeanTokens = pickedAgg.totalTokens / pickedAgg.count;
  const pickedSuccessRate = pickedAgg.successes / pickedAgg.count;

  // Look for a cheaper alternative meeting the constraints.
  let best: { strategy: SubStrategy; mean: number; success: number } | null = null;
  for (const candidate of ["reactive", "plan-execute-reflect"] as SubStrategy[]) {
    if (candidate === picked) continue;
    const a = byStrategy.get(candidate);
    if (!a || a.count < MIN_SAMPLES) continue;
    const mean = a.totalTokens / a.count;
    const success = a.successes / a.count;
    const ratio = mean > 0 ? pickedMeanTokens / mean : 0;
    if (ratio < COST_RATIO_THRESHOLD) continue;
    if (success < pickedSuccessRate - SUCCESS_TOLERANCE) continue;
    if (best === null || mean < best.mean) {
      best = { strategy: candidate, mean, success };
    }
  }

  if (best === null) {
    return { strategy: picked, downgraded: false, reason: "no-cheaper-alternative" };
  }

  return {
    strategy: best.strategy,
    downgraded: true,
    reason: `cost-downgrade:${picked}(${Math.round(pickedMeanTokens)}tok)→${best.strategy}(${Math.round(best.mean)}tok)`,
  };
}

/**
 * Heuristic pre-classifier — handles obvious cases without an LLM call.
 * Returns null for ambiguous tasks that require LLM classification.
 *
 * HS-111 / M5: consults the pre-execution complexity classification.
 * Trivial-classified tasks force reactive — the cost-cheapest strategy —
 * before any pattern matching can route them to expensive ToT/plan-execute.
 *
 * HS-cleanup-2: classification is supplied by the caller (computed once
 * upstream per agent run) rather than re-derived here.
 */
function heuristicClassify(
  input: AdaptiveInput,
  classification: TaskClassification,
): SubStrategy | null {
  // HS-111 cost-class gate: trivial tasks always route to reactive,
  // regardless of other pattern matches. Probe evidence (sweep-2026-05-23)
  // showed adaptive routing trivial tasks to ToT cost 3.3-23× reactive.
  if (classification.complexity.complexity === "trivial" && classification.complexity.confidence >= 0.7) {
    return "reactive";
  }

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

  // Knowledge/explanation tasks with "trade-off" language stay reactive —
  // "explain X with trade-offs" is recall, not exploration.
  const knowledgePrefix = /^(explain|describe|what (is|are|was|were)|define|how does|tell me about)\b/i;
  const isKnowledgeTask = knowledgePrefix.test(task.trim()) && !hasTools;

  // Exploration/comparison patterns → tree-of-thought (skip for knowledge tasks)
  const totPatterns = /\b(compare|alternative|explore|brainstorm|creative|different (ways|approach|solution)|pros and cons|trade-?offs?)\b/i;
  if (totPatterns.test(task) && !isKnowledgeTask) return "tree-of-thought";

  // Quality/iteration patterns → reflexion
  const reflexionPatterns = /\b(review|critique|improve|refine|iterate|polish|rewrite|fix (and )?check|self-assess)\b/i;
  if (reflexionPatterns.test(task) && wordCount > 8) return "reflexion";

  // Short task with tools → reactive (direct tool use)
  if (wordCount <= 20 && hasTools) return "reactive";

  // Ambiguous — defer to LLM classifier
  return null;
}
