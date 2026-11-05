/**
 * Single-analysis-step short-circuit for the plan-execute strategy.
 *
 * Extracted verbatim from `executePlanExecute`: when the planner produces exactly
 * ONE analysis step, the task did not decompose, so the per-step execution +
 * synthesis + reflect pipeline is collapsed into one structured generation
 * (plus the quality gate). It returns the run's `StrategyEnd`, so the
 * orchestrator simply `return yield* runSingleAnalysisShortCircuit(...)` and the
 * strategy substrate mints the result.
 */
import { Effect } from "effect";
import type { LLMService } from "@reactive-agents/llm-provider";
import type { LogEvent } from "@reactive-agents/observability";
import type { ExecutionError } from "../../errors/errors.js";
import { extractThinkingSafeContent } from "../../kernel/utils/stream-parser.js";
import { enforceQualityGate } from "../../kernel/loop/finalize.js";
import { withEnvContext } from "../../context/context-engine.js";
import { publishReasoningStep } from "../../kernel/utils/service-utils.js";
import type { StrategyServices } from "../../kernel/utils/service-utils.js";
import { makeStep } from "../../kernel/capabilities/sense/step-utils.js";
import type { RunContract } from "../../kernel/contract/run-contract.js";
import { budgetStopReason, isBudgetExhausted } from "../budget/remaining-budget.js";
import type { Plan } from "../../types/plan.js";
import type { StrategyEnd, StrategyRun } from "../substrate/strategy-run.js";

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
    readonly budgetLimits?: import("../../kernel/capabilities/decide/arbitrator.js").BudgetLimits;
  };
  readonly llm: LLMService["Type"];
  readonly eventBus: StrategyServices["eventBus"];
  readonly emitLog: (event: LogEvent) => Effect.Effect<void, never>;
  /** D9: the run contract finalize judges delivery against. */
  readonly runContract: RunContract;
  /** The strategy run: records the trace steps and accounts the generation + gate spend. */
  readonly run: StrategyRun;
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
): Effect.Effect<StrategyEnd, ExecutionError, LLMService> =>
  Effect.gen(function* () {
    const { plan, goal, input, llm, eventBus, emitLog, run } = deps;
    const only = plan.steps[0]!;
    run.record(makeStep("thought", `[PLAN 1] ${only.id}: ${only.title} (analysis)`));
    yield* publishReasoningStep(eventBus, {
      _tag: "ReasoningStepCompleted",
      taskId: input.taskId ?? "plan-execute",
      strategy: "plan-execute-reflect",
      step: run.steps().length,
      totalSteps: 1,
      thought: `[PLAN 1] ${only.id}: ${only.title} (analysis)`,
      kernelPass: `plan-execute:plan-1`,
    });

    const genResponse = yield* run.call({ purpose: "synthesize" }, {
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
      }, { message: "Single-analysis-step generation failed", step: 0 });

    only.status = "completed";
    only.result = extractThinkingSafeContent(genResponse).content;

    let scOutput = only.result;
    run.record(makeStep("thought", `[SYNTHESIS] ${scOutput}`));

    // Cumulative run budget: the quality gate is discretionary outer LLM
    // work; skip it once the declared limit is crossed (ship the raw
    // analysis output instead of overspending).
    const scSpend = yield* run.runSpend();
    const scBudgetExhausted = isBudgetExhausted(input.budgetLimits, scSpend);
    if (scOutput && !scBudgetExhausted) {
      const gated = yield* enforceQualityGate({
        llm,
        taskDescription: input.taskDescription,
        output: scOutput,
        ...(input.taskId ? { traceContext: { taskId: input.taskId } } : {}),
      });
      scOutput = gated.output;
      run.account({ tokens: gated.tokens, cost: gated.cost });
    } else if (scOutput) {
      run.record(
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
      totalTokens: run.spend().tokens,
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

    // #40 rule 5: NO sub-kernel runs on this short-circuit path (one direct
    // LLM call + quality gate), so no envelope joins the cap — the status
    // derives from this path's own deterministic evidence (output presence
    // through the gate). B2: the substrate claims `final_answer` for a
    // completed answer and `end_turn` otherwise; this path cannot abstain.
    return {
      _tag: "Result" as const,
      output: scOutput,
      status: scOutput ? ("completed" as const) : ("partial" as const),
      delivery: { runContract: deps.runContract },
    };
  });
