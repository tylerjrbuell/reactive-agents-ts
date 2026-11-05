// File: src/strategies/adaptive.ts
/**
 * Adaptive Meta-Strategy
 *
 * Analyzes task complexity and dispatches to the best sub-strategy:
 * - Simple tasks → reactive (fast, single-pass)
 * - Tasks needing self-improvement → reflexion
 * - Complex multi-step tasks → plan-execute-reflect
 * - Exploratory/creative tasks → tree-of-thought
 *
 * Runs on the strategy run substrate and ends `Delegated`: the dispatched
 * sub-strategy's minted result is the terminal (its status, verdict, terminal
 * decision and honesty fields untouched), with adaptive's own steps and its own
 * spend (the classifier call, a fallen-back sub-strategy) folded in.
 */
import { Effect, Option, Either } from "effect";
import { ExecutionError, IterationLimitError } from "../errors/errors.js";
import type { ReasoningConfig } from "../types/config.js";
import { LLMService } from "@reactive-agents/llm-provider";
import { emitPhaseEnd } from "../kernel/utils/service-utils.js";
import type { SkillsContext } from "../kernel/state/kernel-state.js";
import { executeReactive } from "./reactive.js";
import { executeReflexion } from "./reflexion.js";
import { executePlanExecute } from "./plan-execute.js";
import { executeTreeOfThought } from "./tree-of-thought.js";
import { executeBlueprint } from "./blueprint.js";
import { resolveStrategyServices, compilePromptOrFallback, publishReasoningStep } from "../kernel/utils/service-utils.js";
import { makeStep } from "../kernel/capabilities/sense/step-utils.js";
import type { JudgedReasoningResult } from "../kernel/capabilities/sense/finalize-result.js";
import { RunEnvelope } from "../kernel/envelope/run-envelope.js";
import { runStrategy } from "./substrate/strategy-run.js";
import { extractThinkingSafeContent } from "../kernel/utils/stream-parser.js";
import { shouldSkipClassifierEvaluation } from "../kernel/capabilities/reflect/strategy-evaluator.js";
import type { ToolSchema } from "../kernel/capabilities/attend/tool-formatting.js";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import type { ContextProfile } from "../context/context-profile.js";
import type { KernelMetaToolsConfig } from "../types/kernel-meta-tools.js";
import { classifyTask } from "../kernel/capabilities/comprehend/task-classification.js";
import type { TaskClassification } from "../kernel/capabilities/comprehend/task-classification.js";
import { JudgmentService } from "@reactive-agents/judgment";
import type { EventBusInstance } from "../kernel/state/kernel-state.js";
import { buildAdaptiveJudgmentQuestions, buildAdaptiveJudgmentState, answerToStrategy } from "./adaptive-judgment-questions.js";

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
  readonly skillsContext?: SkillsContext;
  /**
   * Pre-computed task classification from the upstream `comprehend` pass.
   * When provided, adaptive reads complexity/intent here and threads it to
   * the dispatched sub-strategy (HS-cleanup-2). When absent, classifies
   * once at entry and threads that snapshot.
   */
  readonly taskClassification?: TaskClassification;
  // FM-I (#195): cross-cutting fields forwarded verbatim to the dispatched
  // sub-strategy (via `{ ...input }` spread). Declared here so the forward is
  // type-visible — at runtime the spread already carried them, but the type
  // previously hid them, making the dispatch look lossy.
  readonly harnessPipeline?: import("@reactive-agents/core").HarnessPipeline;
  readonly budgetLimits?: import("../kernel/capabilities/decide/arbitrator.js").BudgetLimits;
  readonly calibration?: import("@reactive-agents/llm-provider").ModelCalibration;
  readonly auditRationale?: boolean;
  readonly verifier?: import("../kernel/capabilities/verify/verifier.js").Verifier;
}

type SubStrategy =
  | "reactive"
  | "reflexion"
  | "plan-execute-reflect"
  | "tree-of-thought"
  | "blueprint";

/**
 * Select a sub-strategy (heuristic, local-tier default, or one classifier
 * call), dispatch to it, fall back to reactive on a partial, and end
 * `Delegated` with the result that shipped.
 *
 * The dispatched strategy's own mint already declares its repair capability
 * (review I1: plan-execute-reflect and blueprint report `per-iteration` as a
 * repair gap), and the Delegated end relays that verdict untouched, so adaptive
 * no longer re-declares it.
 */
export const executeAdaptive = (
  input: AdaptiveInput,
): Effect.Effect<
  JudgedReasoningResult,
  ExecutionError | IterationLimitError,
  LLMService | RunEnvelope
> =>
  Effect.gen(function* () {
    const { promptService: promptServiceOpt, eventBus: ebOpt } =
      yield* resolveStrategyServices;

    return yield* runStrategy(
      {
        strategy: "adaptive",
        taskId: input.taskId ?? "adaptive",
        requiredTools: input.requiredTools ?? [],
        logSite: "reasoning/src/strategies/adaptive.ts:emitLog",
      },
      (run) => Effect.gen(function* () {
    const emitLog = run.emitLog;
    const start = run.start;

    yield* emitLog({ _tag: "phase_started", phase: "adaptive:select", timestamp: new Date() });

    // HS-cleanup-2: one canonical pre-execution classification per agent run.
    // Reuse the upstream snapshot when threaded; classify locally only as
    // backward-compat fallback for direct adaptive callers. The same snapshot
    // is forwarded to the dispatched sub-strategy so it doesn't re-classify.
    const taskClassification =
      input.taskClassification ?? classifyTask(input.taskDescription);

    // ── Strategy honesty (v0.12) — local-tier default ──
    // Heavy strategies (reflexion / tree-of-thought / plan-execute) show no
    // quality lift over the reactive kernel on local models (internal parity
    // data) at 3–15× cost. On the local tier, default adaptive to reactive —
    // this also skips the analysis LLM call. Non-local tiers keep the full
    // heuristic + LLM selection path.
    const localTierDefault: SubStrategy | undefined =
      input.contextProfile?.tier === "local" ? "reactive" : undefined;

    // ── Heuristic pre-classifier ──
    // Avoid an LLM call for obvious cases. Only consult the LLM for ambiguous tasks.
    const heuristicResult = localTierDefault ?? heuristicClassify(input, taskClassification);

    let selectedStrategy: SubStrategy;

    if (heuristicResult) {
      selectedStrategy = heuristicResult;
      run.record(makeStep(
        "thought",
        localTierDefault
          ? `[ADAPTIVE] Local tier → reactive (heavy-strategy parity; honest default, no LLM analysis)`
          : `[ADAPTIVE] Heuristic pre-classifier selected: ${selectedStrategy} (no LLM call needed)`,
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
    } else if (shouldSkipClassifierEvaluation(input.calibration?.classifierReliability)) {
      // W2d 2.6 — classifier-skip: reliability "low"/"skip" means skip the LLM
      // classify round-trip entirely and default to the honest reactive strategy.
      selectedStrategy = "reactive";
      run.record(
        makeStep(
          "thought",
          `[ADAPTIVE] Classifier skipped (classifierReliability=${input.calibration?.classifierReliability}); defaulting to reactive (no LLM classify call)`,
        ),
      );
      yield* publishReasoningStep(ebOpt, {
        _tag: "ReasoningStepCompleted",
        taskId: input.taskId ?? "adaptive",
        strategy: "adaptive",
        step: 1,
        totalSteps: 1,
        thought: `[ADAPTIVE] Classifier skipped; defaulting to reactive`,
        kernelPass: "adaptive:classifier-skip",
      });
    } else {
    // ── Analyze task to select strategy ──
    const strategyMenu =
      "You are a task analyzer. Classify the task and recommend the best reasoning strategy. Respond with ONLY one of:\n" +
      "- REACTIVE: most tasks; direct tool use; Q&A; short/simple.\n" +
      "- BLUEPRINT: decomposable, tool-heavy tasks whose full plan is knowable UP FRONT and does NOT depend on observing intermediate results — independent/parallel subtasks, multi-file/artifact generation, static pipelines (cheapest for these).\n" +
      "- PLAN_EXECUTE: multi-step tasks that DO need to adapt mid-course — react to tool failures, branch on results, debug-until-passing, investigate (pick over BLUEPRINT whenever observation drives the plan).\n" +
      "- TREE_OF_THOUGHT: explore/compare alternatives, brainstorm, pros-and-cons.\n" +
      "- REFLEXION: iterative critique/refine to a quality bar.";
    const classifyDefaultFallback = input.systemPrompt
      ? `${input.systemPrompt}\n\n${strategyMenu}`
      : strategyMenu;

    const classifySystemPrompt = yield* compilePromptOrFallback(
      promptServiceOpt,
      "reasoning.adaptive-classify",
      {},
      classifyDefaultFallback,
    );
    // `run.call` accounts the classifier call into adaptive's own spend, which
    // the Delegated end folds into the shipped result.
    const analysisResponse = yield* run.call({ purpose: "classify" }, {
        messages: [
          {
            role: "user",
            content: buildAnalysisPrompt(input),
          },
        ],
        systemPrompt: classifySystemPrompt,
        // GH #246: commanded temperature wins; unset keeps the 0.2 default.
        temperature: input.temperature ?? 0.2,
      }, { message: "Task analysis failed", step: 0 });

    // Thinking-safe extraction prevents thinking blocks from being parsed
    // as strategy names AND rescues classifications trapped inside <think>
    // (strict upgrade vs bare stripThinking).
    selectedStrategy = parseStrategySelection(
      extractThinkingSafeContent(analysisResponse).content,
    );

    run.record(makeStep(
      "thought",
      `[ADAPTIVE] Selected strategy: ${selectedStrategy} (analysis tokens: ${analysisResponse.usage.totalTokens})`,
    ));

    yield* publishReasoningStep(ebOpt, {
      _tag: "ReasoningStepCompleted",
      taskId: input.taskId ?? "adaptive",
      strategy: "adaptive",
      step: run.steps().length,
      totalSteps: 1,
      thought: `[ADAPTIVE] Selected strategy: ${selectedStrategy}`,
      kernelPass: "adaptive:select",
    });
    } // end else (LLM classification path)

    yield* emitPhaseEnd({ emitLog, phase: "adaptive:select", startedAt: start });

    // ── Task 9 (shadow-only): judgment strategy-selection classifier ──
    // Fires the batched Choice+Nouls speculatively via Effect.forkDaemon (same
    // fire-and-forget pattern as iterate-pass.ts:1722's checkpoint write and
    // execute-stream.ts:791's debrief finalization) so it never blocks or
    // alters `selectedStrategy`. Absent JudgmentService (no `.withJudgment()`
    // on the builder) is a clean no-op — Effect.serviceOption resolves `None`
    // without widening this function's R (Effect<..., never, T> per Effect's
    // own signature, not a project convention).
    yield* judgmentClassifyShadow(input, selectedStrategy, ebOpt);

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
        run.record(
          makeStep(
            "thought",
            `[ADAPTIVE] Cost-aware downgrade: ${adjustment.reason}`,
          ),
        );
        yield* publishReasoningStep(ebOpt, {
          _tag: "ReasoningStepCompleted",
          taskId: input.taskId ?? "adaptive",
          strategy: "adaptive",
          step: run.steps().length,
          totalSteps: run.steps().length,
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
      run.record(makeStep(
        "thought",
        `[ADAPTIVE] ${selectedStrategy} returned partial — falling back to reactive`,
      ));

      yield* publishReasoningStep(ebOpt, {
        _tag: "ReasoningStepCompleted",
        taskId: input.taskId ?? "adaptive",
        strategy: "adaptive",
        step: run.steps().length,
        totalSteps: 2,
        thought: `[ADAPTIVE] Falling back to reactive strategy`,
        kernelPass: "adaptive:fallback",
      });

      finalSubResult = yield* executeReactive({ ...input, taskClassification }).pipe(
        // If reactive also fails, use original partial result rather than throwing.
        Effect.catchAll(() => Effect.succeed(subResult)), // substrate-ok: a sub-strategy run is a minted result, not a run.pass of this run
      );
      if (finalSubResult !== subResult) {
        // §5.1 (B2): the FAILED sub-strategy's real steps must NOT be discarded —
        // a partial plan-execute may have written 2 of 3 files before returning,
        // and those tool-write steps are the deliverable receipt's only evidence.
        // They join adaptive's own steps (ahead of the fallback reactive's), and
        // its real spend joins adaptive's (honest accounting: it was spent). When
        // reactive itself failed, catchAll handed back the SAME subResult, which
        // then ships as the delegated result, so nothing is recorded twice.
        run.record(...subResult.steps);
        const subMeta: Readonly<Record<string, unknown>> = subResult.metadata;
        run.account({
          tokens: subResult.metadata.tokensUsed,
          cost: subResult.metadata.cost,
          llmCalls: typeof subMeta["llmCalls"] === "number" ? subMeta["llmCalls"] : 0,
        });
      }
    }

    yield* emitPhaseEnd({ emitLog, phase: "adaptive:dispatch", startedAt: start });

    // strategy: "adaptive" preserved for API consumers.
    // selectedStrategy in metadata surfaces what actually ran (e.g. "reactive")
    // so strategyUsed in AgentResult shows the effective sub-strategy.
    //
    // Derived from the result that actually SHIPPED, not from `fallbackOccurred`
    // (review I5, 2026-07-23). `fallbackOccurred` only records that a fallback
    // was ATTEMPTED. On a double failure the reactive attempt is caught by
    // the catchAll above (it hands back `subResult` itself), so the ORIGINAL
    // plan-execute / blueprint result is what ships — and hard-coding
    // "reactive" here would report a `selectedStrategy` that never produced
    // this output (review I1/I5).
    // `finalSubResult === subResult` is the only reliable discriminator: the
    // catchAll hands back the SAME object, and a successful fallback cannot.
    //
    // NOT PINNED BY A TEST, deliberately (verified 2026-07-23): the catchAll
    // branch is defensive-only and unreachable from the test seam. There is no
    // `Effect.fail` anywhere in the reactive path — driving the fallback's LLM
    // to throw produces a reactive RESULT with `status:"failed"` (a distinct
    // object, so the "reactive" label is then correct), never an Effect
    // failure. Reaching the branch would require injecting the dispatcher,
    // i.e. a refactor of this function rather than a test. Contriving one was
    // rejected over pinning nothing.
    const activeStrategy: SubStrategy =
      finalSubResult === subResult ? selectedStrategy : "reactive";

    yield* emitLog({
      _tag: "log",
      level: "debug",
      source: "framework",
      message: `Adaptive selected ${activeStrategy}${fallbackOccurred ? " (fallback)" : ""}`,
      timestamp: new Date(),
    });

    // §5.1 (B2): the shipped sub-strategy result is the terminal. Its
    // terminatedBy / rawTerminatedBy / abstention, pause rails, verdict
    // (including its own repair gaps), terminal decision and runLedger are
    // relayed untouched. KNOWN LIMITATION: on a fallback the ledger is ONLY the
    // fallback reactive's — the failed sub-strategy's ledger was minted by an
    // independent run (colliding `seq` numbering); its tool evidence still
    // rides the recorded steps above.
    return {
      _tag: "Delegated" as const,
      result: finalSubResult,
      extraMetadata: {
        selectedStrategy: activeStrategy,
        fallbackOccurred,
        ...(costAwareDowngradeReason
          ? { costAwareDowngrade: costAwareDowngradeReason }
          : {}),
      },
    };
      }),
    );
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

export function parseStrategySelection(text: string): SubStrategy {
  const normalized = text.trim().toUpperCase();

  // BLUEPRINT before PLAN_EXECUTE — both are decomposition strategies; blueprint
  // is the static/observation-free variant, so match it first when named.
  if (normalized.includes("BLUEPRINT")) {
    return "blueprint";
  }
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
  JudgedReasoningResult,
  ExecutionError | IterationLimitError,
  LLMService | RunEnvelope
> {
  switch (strategy) {
    case "reflexion":
      return executeReflexion(input);
    case "plan-execute-reflect":
      return executePlanExecute(input);
    case "tree-of-thought":
      return executeTreeOfThought(input);
    case "blueprint":
      return executeBlueprint(input);
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
  // Aggregate per-strategy metrics from history (past runs, not this run's spend).
  type Agg = { count: number; successes: number; historyTokens: number };
  const byStrategy = new Map<string, Agg>();
  for (const o of history) {
    const a = byStrategy.get(o.strategy) ?? { count: 0, successes: 0, historyTokens: 0 };
    a.count += 1;
    a.successes += o.success ? 1 : 0;
    a.historyTokens += o.tokensUsed;
    byStrategy.set(o.strategy, a);
  }

  const pickedAgg = byStrategy.get(picked);
  if (!pickedAgg || pickedAgg.count < MIN_SAMPLES) {
    return { strategy: picked, downgraded: false, reason: "insufficient-history" };
  }
  const pickedMeanTokens = pickedAgg.historyTokens / pickedAgg.count;
  const pickedSuccessRate = pickedAgg.successes / pickedAgg.count;

  // Look for a cheaper alternative meeting the constraints.
  let best: { strategy: SubStrategy; mean: number; success: number } | null = null;
  for (const candidate of ["reactive", "plan-execute-reflect"] as SubStrategy[]) {
    if (candidate === picked) continue;
    const a = byStrategy.get(candidate);
    if (!a || a.count < MIN_SAMPLES) continue;
    const mean = a.historyTokens / a.count;
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
export function heuristicClassify(
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

  // Blueprint domain → static, decomposable, LOCAL artifact generation whose
  // full plan is knowable up front and does NOT need mid-course observation.
  // Cheapest for these (plan once → execute tools with no LLM → solve).
  // GUARDS (route AWAY from blueprint, toward plan-execute/reactive):
  //   - observationDriven: needs to react to results (debug/investigate/branch).
  //   - networkIO: fetch/api/http is failure-prone → needs adaptation/retry,
  //     which blueprint (observation-free) can't do. Proof-gate evidence
  //     (2026-06-28): rw-9 flaky-fetch routed to blueprint → acc=0; plan-execute
  //     handled it. So network tasks stay on plan-execute/reactive.
  const observationDriven =
    /\b(debug|until|retry|investigat|diagnos|based on|depend(s|ing) on|if .* then|explore|find (the )?(cause|bug|root)|troubleshoot|recover|fix (and |then )?(verify|test|check))\b/i.test(task);
  const networkIO = /\b(fetch|https?:|api\b|download|scrape|crawl|web[- ]?search|url)\b/i.test(task);
  const staticGen =
    /\b(generate|create|write|build|scaffold|implement|produce|refactor)\b/i.test(task) &&
    /\b(files?|components?|modules?|classes?|functions?|tests?|endpoints?|schemas?|types?|pipeline|each|multiple|several)\b/i.test(task);
  if (hasTools && staticGen && !observationDriven && !networkIO && wordCount > 8) {
    return "blueprint";
  }

  // Plan patterns → plan-execute (the adaptive/observation-driven decomposition
  // sibling; static-local decomposition was already routed to blueprint above).
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

/**
 * Task 9 (shadow-only). Fires the batched judgment strategy-classification
 * question via `Effect.forkDaemon` — never awaited by the caller, never
 * altering `current` (the strategy actually selected by the existing
 * heuristic/LLM path). Emits `JudgmentShadow` on the event bus with an
 * agreement verdict for later analysis (Task 9 Step 4's exit gate).
 * Backend-agnostic — works against whichever `JudgmentBackend` the resolved
 * `JudgmentService` was constructed with.
 *
 * Absent `JudgmentService` (no `.withJudgment()` on the builder) is a clean,
 * zero-cost no-op — `Effect.serviceOption` resolves `None` without adding
 * `JudgmentService` to this function's (or `executeAdaptive`'s) requirements.
 */
function judgmentClassifyShadow(
  input: AdaptiveInput,
  current: SubStrategy,
  eventBus: Option.Option<EventBusInstance>,
): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const maybeJudgment = yield* Effect.serviceOption(JudgmentService);
    if (Option.isNone(maybeJudgment)) return;
    const judgment = maybeJudgment.value;

    yield* Effect.forkDaemon(
      Effect.gen(function* () {
        const result = yield* judgment
          .ask({
            state: buildAdaptiveJudgmentState({
              taskDescription: input.taskDescription,
              taskType: input.taskType,
              availableTools: input.availableTools,
            }),
            questions: buildAdaptiveJudgmentQuestions(),
          })
          .pipe(Effect.either); // substrate-ok: shadow judgment daemon, no run.pass inside

        const judged = Either.isRight(result)
          ? answerToStrategy(result.right.strategy)
          : null;
        const confidence = Either.isRight(result)
          ? (result.right.strategy.kind === "noul" ? null : result.right.strategy.confidence)
          : null;

        yield* publishReasoningStep(eventBus, {
          _tag: "JudgmentShadow",
          site: "strategy-selection",
          judged,
          current,
          agreement: judged === null ? null : judged === current,
          confidence: judged === null ? null : confidence,
        });
      }),
    );
  });
}
