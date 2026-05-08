/**
 * Pre-loop dispatchers — the orchestration block that runs immediately after
 * BOOTSTRAP and before the AGENT_LOOP branch selector. Fires Phase 2
 * (GUARDRAIL), Phase 3 (COST_ROUTE + budget pre-flight), and Phase 4
 * (STRATEGY_SELECT), then fetches the tool registry, classifies tools, and
 * derives the per-tool call budget.
 *
 * The semantic cache check is intentionally excluded: its result feeds the
 * `cacheHit` branch selector that immediately follows in the engine, so it
 * must remain inline.
 *
 * Lifted from execution-engine.ts post-W23-6a-8 (2358-LOC checkpoint).
 */
import { Effect } from "effect";
import { CostService } from "@reactive-agents/cost";
import { BudgetExceededError, type RuntimeErrors } from "../../../../errors.js";
import type { ExecutionContext, ReactiveAgentsConfig } from "../../../../types.js";
import type { Task } from "@reactive-agents/core";
import type { ModelCalibration } from "@reactive-agents/llm-provider";
import type { LLMService } from "@reactive-agents/llm-provider";
import type { PhaseDeps, ObsLike } from "../../../runtime-context.js";
import { runGuardedPhase } from "../../../pipeline.js";
import type { Phase } from "../../../phase.js";
import { fetchToolsRegistry } from "./tools-registry.js";
import { classifyTools } from "./classifier.js";
import { buildAutoMaxCallsPerTool } from "../../../util.js";

export interface PreLoopDispatchDeps {
  /** Resolved execution context after BOOTSTRAP + skill post-processing. */
  readonly ctx: ExecutionContext;
  /** The task being executed. */
  readonly task: Task;
  /** Immutable run-scoped config. */
  readonly config: ReactiveAgentsConfig;
  /** Full PhaseDeps bundle threaded through all phase runners. */
  readonly deps: PhaseDeps;
  /** Resolved calibration for this model — caller resolves once and passes in. */
  readonly resolvedCalibration: ModelCalibration | undefined;
  /** Observability service (null when absent). */
  readonly obs: ObsLike | null;
  /** Whether observability is at normal verbosity. */
  readonly isNormal: boolean;
  /** GUARDRAIL phase object (W23 decomposition). */
  readonly guardrail: Phase;
  /** COST_ROUTE phase object (W23 decomposition). */
  readonly costRoute: Phase;
  /** STRATEGY_SELECT phase object (W23 decomposition). */
  readonly strategySelect: Phase;
}

export interface PreLoopDispatchResult {
  /** Updated execution context after Phases 2–4. */
  readonly ctx: ExecutionContext;
  /** Effective allowed-tools list (from config.allowedTools ?? []). */
  readonly effectiveAllowedTools: readonly string[];
  /** Required tools the agent MUST call (gate-enforced); undefined = none. */
  readonly effectiveRequiredTools: readonly string[] | undefined;
  /** Per-tool minCalls quantities; undefined = none. */
  readonly effectiveRequiredToolQuantities: Readonly<Record<string, number>> | undefined;
  /** Tools visible/usable but not gate-enforced; undefined = none. */
  readonly classifiedRelevantTools: readonly string[] | undefined;
  /** Per-tool call budgets derived from required quantities. */
  readonly autoMaxCallsPerTool: Readonly<Record<string, number>>;
  /** Tool definitions fetched once from ToolService for the whole run. */
  readonly cachedToolDefs: readonly unknown[];
}

/**
 * Run Phases 2–4 plus tool setup and return the pre-loop result tuple.
 * The returned `ctx` has been updated by GUARDRAIL, COST_ROUTE, and
 * STRATEGY_SELECT. All downstream reasoning paths consume the result fields.
 */
export const runPreLoopDispatch = (
  params: PreLoopDispatchDeps,
): Effect.Effect<PreLoopDispatchResult, RuntimeErrors, LLMService> =>
  Effect.gen(function* () {
    const { task, config, deps, resolvedCalibration, obs, isNormal, guardrail, costRoute, strategySelect } = params;
    let ctx = params.ctx;

    // ── Phase 2: GUARDRAIL (optional) ── H2
    // Extracted to engine/phases/guardrail.ts (W23).
    ctx = yield* runGuardedPhase(guardrail, ctx, deps);

    // ── Phase 3: COST_ROUTE (optional) ── H2
    // Extracted to engine/phases/cost-route.ts (W23).
    ctx = yield* runGuardedPhase(costRoute, ctx, deps);

    if (config.enableCostTracking) {
      // ── Budget pre-flight check: verify budget has room before reasoning ──
      const budgetCostOpt = yield* Effect.serviceOption(CostService).pipe(
        Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
      );
      if (budgetCostOpt._tag === "Some") {
        yield* budgetCostOpt.value
          .checkBudget(0, ctx.agentId, ctx.sessionId)
          .pipe(
            Effect.catchAll((budgetErr) => {
              const msg = "message" in budgetErr ? String(budgetErr.message) : "Budget exceeded";
              const budgetType = "budgetType" in budgetErr ? String(budgetErr.budgetType) : "unknown";
              const limit = "limit" in budgetErr ? Number(budgetErr.limit) : 0;
              const current = "current" in budgetErr ? Number(budgetErr.current) : 0;
              return Effect.fail(
                new BudgetExceededError({
                  message: msg,
                  taskId: ctx.taskId,
                  budgetType,
                  limit,
                  current,
                }),
              );
            }),
          );
      }
    }

    // ── Phase 4: STRATEGY_SELECT ──
    // Extracted to engine/phases/strategy-select.ts (W23).
    ctx = yield* runGuardedPhase(strategySelect, ctx, deps);

    // ── Tool registry fetch + allowedTools warn + strategy summary ──
    // Extracted to engine/phases/agent-loop/setup/tools-registry.ts (W23 step 4).
    const cachedToolDefs = yield* fetchToolsRegistry(config, ctx, obs, isNormal);
    // Used downstream by built-ins opt-in logic.
    const effectiveAllowedTools = config.allowedTools ?? [];

    // ── LLM-based tool classification (required + relevant) ──
    // Extracted to engine/phases/agent-loop/setup/classifier.ts (W23 step 4b).
    // Decision tree: no classification / low-reliability literal-mention
    // fallback / LLM classify with hallucination demotion + sequential
    // clamp + relevant set merge.
    const { effectiveRequiredTools, effectiveRequiredToolQuantities, classifiedRelevantTools } =
      yield* classifyTools({
        config,
        task,
        cachedToolDefs,
        resolvedCalibration,
        obs,
        isNormal,
      });

    // ── Auto per-tool budget derived from required quantities ──
    // Parallel mode: use required minCalls as the budget floor so quotas
    // are satisfiable. Sequential mode: disable auto per-tool budgets.
    const autoMaxCallsPerTool = buildAutoMaxCallsPerTool({
      parallelToolCallsEnabled: config.reasoningOptions?.parallelToolCalls !== false,
      requiredTools: effectiveRequiredTools,
      requiredToolQuantities: effectiveRequiredToolQuantities,
    });

    return {
      ctx,
      effectiveAllowedTools,
      effectiveRequiredTools,
      effectiveRequiredToolQuantities,
      classifiedRelevantTools,
      autoMaxCallsPerTool,
      cachedToolDefs,
    };
  });
