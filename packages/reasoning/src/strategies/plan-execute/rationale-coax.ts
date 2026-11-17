/**
 * Rationale enforcement (coax) for the plan-execute strategy, moved verbatim
 * out of `executePlanExecute`. Every tool_call step must carry a non-empty
 * `rationale.why`. The base prompt marks it MANDATORY but small models
 * sometimes still omit it; one retry with a stronger reminder typically
 * recovers compliance. Opt-in audit gate: `rationale.why` is audit-only
 * (debrief), not execution, so the full re-plan retry is skipped unless
 * auditing is on (and never for a caller-supplied plan).
 */
import { Effect } from "effect";
import type { LLMService } from "@reactive-agents/llm-provider";
import type { LogEvent } from "@reactive-agents/observability";
import type { ExecutionError } from "../../errors/errors.js";
import { LLMPlanOutputSchema, hydratePlan } from "../../types/plan.js";
import type { Plan, PlanContext } from "../../types/plan.js";
import { extractStructuredOutput, structuredCallSpend } from "../../structured-output/pipeline.js";
import { PLANNER_PERSONA } from "../planning/shared-personas.js";
import type { StrategyRun } from "../substrate/strategy-run.js";
import { stepsMissingRationale } from "./plan-enforcement.js";

/** What the coax reads from the strategy input and run. */
export interface RationaleCoaxDeps {
  /** The plan as obtained (planner output or caller-supplied). */
  readonly plan: Plan;
  /** The prompt the plan was generated from (empty for a supplied plan). */
  readonly planPrompt: string;
  /** True when auditing is on (`auditRationale` input or harness env). */
  readonly auditOn: boolean;
  readonly systemPrompt?: string;
  readonly temperature?: number;
  readonly taskId?: string;
  readonly planContext: PlanContext;
  readonly emitLog: (event: LogEvent) => Effect.Effect<void, never>;
  readonly run: Pick<StrategyRun, "account">;
}

/** The plan after at most one rationale retry (the retry plan only when it is strictly better). */
export const coaxPlanRationale = (d: RationaleCoaxDeps): Effect.Effect<Plan, ExecutionError, LLMService> =>
  Effect.gen(function* () {
    let plan = d.plan;
    let missing = d.auditOn ? stepsMissingRationale(plan) : [];
    if (missing.length === 0) return plan;
    const reminderPrompt = `${d.planPrompt}\n\n[STRICT RETRY] Your previous plan omitted "rationale" on one or more tool_call steps. EVERY tool_call step MUST include a "rationale": { "why": "<≤280 chars, specific to this call>" } object. Plans without rationale on tool_call steps are rejected. Regenerate the entire plan now, including rationale on every tool_call step.`;
    const retryResult = yield* extractStructuredOutput({
      schema: LLMPlanOutputSchema,
      prompt: reminderPrompt,
      systemPrompt: `${d.systemPrompt ? `${d.systemPrompt}\n` : ""}${PLANNER_PERSONA} Rationale on tool_call steps is mandatory.`,
      strategy: "plan-execute-reflect",
      maxRetries: 1,
      // GH #246: commanded temperature wins; unset keeps the 0.3 default.
      temperature: d.temperature ?? 0.3,
      maxTokens: 4096,
      ...(d.taskId ? { traceContext: { taskId: d.taskId } } : {}),
    }).pipe(
      // Accounted like the planner call.
      Effect.tap((r) => Effect.sync(() => d.run.account(structuredCallSpend(r.usage, { prompt: reminderPrompt, raw: r.raw })))),
      Effect.map((r) => hydratePlan(r.data, d.planContext)),
      Effect.catchAll(() => Effect.succeed(plan)), // substrate-ok: planner retry is a direct structured call, no run.pass inside
    );
    const retryMissing = stepsMissingRationale(retryResult);
    if (retryMissing.length < missing.length) {
      plan = retryResult;
      missing = retryMissing;
    }
    if (missing.length > 0) {
      yield* d.emitLog({
        _tag: "metric",
        name: "plan_rationale_missing",
        value: missing.length,
        unit: "steps",
        timestamp: new Date(),
      });
    }
    return plan;
  });
