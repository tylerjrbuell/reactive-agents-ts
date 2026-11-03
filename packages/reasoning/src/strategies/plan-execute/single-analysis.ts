/**
 * Single-analysis-step short-circuit for the plan-execute strategy.
 *
 * Extracted verbatim from `executePlanExecute`: when the planner produces exactly
 * ONE analysis step, the task did not decompose, so the per-step execution +
 * synthesis + reflect pipeline is collapsed into one structured generation
 * (plus the quality gate). Self-contained: it returns the finished strategy
 * result, so the orchestrator simply `return yield* runSingleAnalysisShortCircuit(...)`.
 */
import { Effect, Ref } from "effect";
import type { LLMService } from "@reactive-agents/llm-provider";
import type { LogEvent } from "@reactive-agents/observability";
import { ExecutionError } from "../../errors/errors.js";
import { gatewayComplete } from "../../kernel/llm-gateway.js";
import { extractThinkingSafeContent } from "../../kernel/utils/stream-parser.js";
import { enforceQualityGate } from "../../kernel/loop/finalize.js";
import { withEnvContext } from "../../context/context-engine.js";
import { publishReasoningStep } from "../../kernel/utils/service-utils.js";
import type { StrategyServices } from "../../kernel/utils/service-utils.js";
import { makeStep } from "../../kernel/capabilities/sense/step-utils.js";
import {
  finalizeStrategyResult,
  type JudgedReasoningResult,
} from "../../kernel/capabilities/sense/finalize-result.js";
import type { RunEnvelope } from "../../kernel/envelope/run-envelope.js";
import type { RunLedger } from "../../kernel/ledger/run-ledger.js";
import { budgetStopReason, isBudgetExhausted } from "../budget/remaining-budget.js";
import { resolveRunSpend } from "../budget/run-budget-spend.js";
import type { Plan } from "../../types/plan.js";
import type { ReasoningStep } from "../../types/index.js";

/** Everything the short-circuit reads from the orchestrator's scope. */
export interface SingleAnalysisDeps {
  /** The one-step plan (`plan.steps.length === 1 && type === "analysis"`). */
  readonly plan: Plan;
  readonly goal: string;
  readonly input: {
    readonly taskId?: string;
    readonly taskDescription: string;
    readonly systemPrompt?: string;
    readonly temperature?: number;
    readonly requiredTools?: readonly string[];
    readonly budgetLimits?: import("../../kernel/capabilities/decide/arbitrator.js").BudgetLimits;
  };
  readonly llm: LLMService["Type"];
  readonly eventBus: StrategyServices["eventBus"];
  readonly emitLog: (event: LogEvent) => Effect.Effect<void, never>;
  readonly ledgerRef: Ref.Ref<RunLedger>;
  /** Reasoning-step trace the orchestrator is building (appended in place). */
  readonly steps: ReasoningStep[];
  readonly start: number;
  /** Spend so far (plan generation); the short-circuit adds its own. */
  readonly totalTokens: number;
  readonly totalCost: number;
  readonly llmCallsTotal: number;
}

// ── Single-analysis-step short-circuit (streamline) ──────────────────────
// When the planner produces exactly ONE analysis step (and no tool_call
// steps), the task did not decompose — plan-execute degenerates to "reactive
// + overhead". Trace evidence (pe-diag 2026-06-05, qwen3.5 long-form): the
// per-step execution generates the full prose answer (~2422 out) AND the
// final synthesis pass RE-generates it restructured (~1542 out) — the same
// answer produced twice, plus a reflect pass that the niche probe showed adds
// no quality on non-decomposable tasks. Collapse all of that into ONE
// structured generation so a non-decomposable task degrades gracefully to
// ~reactive cost. Tool/multi-step plans skip this branch entirely and keep
// the full plan→execute→reflect→synthesize pipeline (where synthesis
// legitimately COMBINES distinct step results rather than duplicating one).
// 
// SCOPE DECISION: this drops reflect+refine for single-analysis plans. The
// evidence (niche probe t4/t5 — expository "explain/compare" generation, no
// verifiable right answer) shows reflection adds no quality there. It is NOT
// validated for single-step tasks with a VERIFIABLE correctness property (a
// derivation/calculation/proof) where a first pass can be wrong and a critique
// would catch it — but routing such a task to a one-pass generation is exactly
// what reactive would do, so this is not a regression vs the cheap default.
// CONSERVATIVE FALLBACK if a regression ever surfaces: keep ONE reflect+refine
// pass here (generate → reflect → refine-once) — preserves the safety net while
// still killing the duplicate generation.
export const runSingleAnalysisShortCircuit = (
  deps: SingleAnalysisDeps,
): Effect.Effect<JudgedReasoningResult, ExecutionError, RunEnvelope> =>
  Effect.gen(function* () {
    const { plan, goal, input, llm, eventBus, emitLog, ledgerRef, steps, start } = deps;
    let { totalTokens, totalCost } = deps;
    const only = plan.steps[0]!;
    steps.push(makeStep("thought", `[PLAN 1] ${only.id}: ${only.title} (analysis)`));
    yield* publishReasoningStep(eventBus, {
      _tag: "ReasoningStepCompleted",
      taskId: input.taskId ?? "plan-execute",
      strategy: "plan-execute-reflect",
      step: steps.length,
      totalSteps: 1,
      thought: `[PLAN 1] ${only.id}: ${only.title} (analysis)`,
      kernelPass: `plan-execute:plan-1`,
    });

    const genResponse = yield* gatewayComplete(llm, { purpose: "synthesize" }, {
        messages: [
          {
            role: "user",
            content: `Task: ${goal}\n\n${only.instruction}\n\nWrite the complete, well-structured final answer to the task now. Use clear sections/headings where the task calls for them. Output only the answer — no preamble, no offers, no internal metadata.\n\nEVIDENCE RULE: only state facts your tool results actually contain. If a requested attribute (a name, number, license, date, spec) is not in the results, say \"not found in sources\" for that item instead of guessing — invented specifics are worse than acknowledged gaps. Prefer fewer, verified items over a complete-looking but fabricated list.\n\nCOMPLETION CHECK: before finishing, re-read the Task and confirm every explicit requirement is addressed — each requested field, format, count, and any required meta-commentary (e.g. identifying conflicts, caveats, or unresolved items). If a requirement cannot be met from the results, state that explicitly instead of omitting it.`,
          },
        ],
        systemPrompt: withEnvContext(
          input.systemPrompt ??
            "You are a precise task executor. Produce the complete, well-structured final answer directly. Never ask questions or offer to do something — just output the finished result.",
        ),
        // GH #246: commanded temperature wins; unset keeps the 0.5 default.
        temperature: input.temperature ?? 0.5,
        ...(input.taskId ? { traceContext: { taskId: input.taskId } } : {}),
      })
      .pipe(
        Effect.mapError(
          (err) =>
            new ExecutionError({
              strategy: "plan-execute-reflect",
              message: `Single-analysis-step generation failed: ${err instanceof Error ? err.message : String(err)}`,
              step: 0,
              cause: err,
            }),
        ),
      );

    totalTokens += genResponse.usage.totalTokens;
    totalCost += genResponse.usage.estimatedCost;
    only.status = "completed";
    only.result = extractThinkingSafeContent(genResponse).content;

    let scOutput = only.result;
    steps.push(makeStep("thought", `[SYNTHESIS] ${scOutput}`));

    // Cumulative run budget: the quality gate is discretionary outer LLM
    // work; skip it once the declared limit is crossed (ship the raw
    // analysis output instead of overspending).
    const scSpend = yield* resolveRunSpend({
      tokens: totalTokens,
      cost: totalCost,
    });
    const scBudgetExhausted = isBudgetExhausted(input.budgetLimits, scSpend);
    if (scOutput && !scBudgetExhausted) {
      const gated = yield* enforceQualityGate({
        llm,
        taskDescription: input.taskDescription,
        output: scOutput,
        ...(input.taskId ? { traceContext: { taskId: input.taskId } } : {}),
      });
      scOutput = gated.output;
      totalTokens += gated.tokens;
      totalCost += gated.cost;
    } else if (scOutput) {
      steps.push(
        makeStep(
          "thought",
          `[BUDGET] ${budgetStopReason(input.budgetLimits, scSpend) ?? "budget exhausted"}: skipped quality gate`,
        ),
      );
    }

    yield* publishReasoningStep(eventBus, {
      _tag: "FinalAnswerProduced",
      taskId: input.taskId ?? "plan-execute",
      strategy: "plan-execute-reflect",
      answer: scOutput ?? "",
      iteration: 0,
      totalTokens,
      kernelPass: `plan-execute:synthesize`,
    });

    yield* emitLog({
      _tag: "log",
      level: "debug",
      source: "framework",
      message: scOutput
        ? "Plan execution completed (single-analysis-step short-circuit)"
        : "Plan execution failed to produce output",
      timestamp: new Date(),
    });

    // ONE ledger value, read twice (verdict + forwarded metadata).
    const shortCircuitLedger = yield* Ref.get(ledgerRef);

    return yield* finalizeStrategyResult({
      strategy: "plan-execute-reflect",
        taskId: input.taskId ?? "plan-execute",
      steps,
      output: scOutput,
      // Cascade terminal boundary — judgment inputs (Task 4). plan-execute
      // has only coarse phase loops, no per-iteration repair hook (spec §3.4).
      requiredTools: input.requiredTools ?? [],
      runLedger: shortCircuitLedger,
      repairCapabilities: { perIteration: false },
      // #40 rule 5: NO sub-kernel runs on this short-circuit path (one direct
      // LLM call + quality gate), so there is no envelope to join — the
      // status derives from this path's own deterministic evidence (output
      // presence through the gate) and no kernel markers are fabricated.
      status: scOutput ? "completed" : "partial",
      start,
      totalTokens,
      totalCost,
      extraMetadata: {
        // B2: a produced single-analysis answer IS a delivered final answer
        // (`final_answer`); no output maps to `end_turn` (defers to the
        // deliverable scan). This path cannot abstain. Fixes goalAchieved —
        // previously every plan-execute run reported `end_turn`.
        terminatedBy: scOutput ? "final_answer" : "end_turn",
        llmCalls: deps.llmCallsTotal,
        // C8 — the run's canonical tool ledger (empty on this no-dispatch
        // short-circuit, but present for shape consistency).
        runLedger: shortCircuitLedger,
      },
    });
  });
