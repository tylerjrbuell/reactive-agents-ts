// File: src/strategies/planning/plan-refs.ts
/**
 * Bring a generated plan's from_step refs into the grammar.
 *
 * H3 planner thinking-off (2026-11-06): bonsai planners wrote keyed refs like
 * `{{from_step:s2:lowstock}}`. The grammar (assembly/ref-grammar.ts) accepts
 * only `:summary` / `:full`, so dependency extraction, the fan-out split and
 * the resolver all skipped the ref, and file-write wrote the literal token with
 * ok:true. Each keyed ref is rewritten to the bare ref here, before any other
 * plan repair reads the refs.
 *
 * Called right after a plan is generated (plan-execute via repairGeneratedPlan,
 * and blueprint), before the fan-out split, and on every replan (patch, augment:
 * planning/plan-mutation.ts). Pure; the Effect wrappers apply it and emit one
 * `guard-fired{guard:"plan-ref-normalized"}` when any ref was rewritten.
 *
 * Second rewrite, same pass: `{{from_step:sN:summary}}` as the WHOLE value of
 * a file-content arg becomes `{{from_step:sN:full}}`. :summary collapses
 * whitespace and caps at 500 chars (types/plan.ts distillStepResult), right for
 * a search query, wrong for a file body: H3 2026-11-06 bonsai run2 wrote
 * 'SKU-003 SKU-008' for 'SKU-003\nSKU-008' (2/16 passes with :summary content
 * vs 32/103 without). A file-content arg is the one the producer is told "your
 * entire reply becomes the content of X" for (step-consumers.ts): the call names
 * a literal file target and the ref is the whole arg. :full, not the bare ref:
 * the bare ref of a TOOL step is distilled too (380 chars).
 */
import { Effect } from "effect";
import { fromStepRe, normalizeFromStepRefs, renderFromStepRef } from "../../assembly/ref-grammar.js";
import { emitGuardFired } from "../../kernel/utils/diagnostics.js";
import type { Plan, PlanStep } from "../../types/plan.js";
import { literalTarget } from "./step-consumers.js";

/** The guard-fired key for a keyed-ref rewrite. */
export const PLAN_REF_NORMALIZED_GUARD = "plan-ref-normalized";

/** The refs rewritten in one step. */
export interface NormalizedStepRefs {
  readonly stepId: string;
  /** Keyed refs rewritten to the bare ref (instruction first, then tool args). */
  readonly refs: readonly string[];
  /** File-content args whose whole-value :summary ref became :full (absent: none). */
  readonly fullContent?: readonly string[];
}

/** `{{from_step:sN:full}}` when `value` is wholly `{{from_step:sN:summary}}`, else undefined. */
function summaryToFull(value: string): string | undefined {
  const match = [...value.matchAll(fromStepRe())];
  const only = match.length === 1 ? match[0]! : undefined;
  return only !== undefined && value.trim() === only[0] && only[0].endsWith(":summary}}")
    ? renderFromStepRef(only[1]!, "full")
    : undefined;
}

/** The plan's steps with refs in the grammar, and every rewrite (empty: unchanged). */
export interface PlanRefNormalization {
  readonly steps: PlanStep[];
  readonly normalized: readonly NormalizedStepRefs[];
}

/**
 * Rewrite keyed from_step refs in every step's instruction and string tool
 * args, and a whole-value :summary ref in a file-content arg to :full.
 */
export function normalizePlanRefs(steps: readonly PlanStep[]): PlanRefNormalization {
  const normalized: NormalizedStepRefs[] = [];
  const out = steps.map((step) => {
    const refs: string[] = [];
    const fullContent: string[] = [];
    const fix = (text: string): string => {
      const r = normalizeFromStepRefs(text);
      refs.push(...r.rewritten);
      return r.text;
    };
    const target =
      step.type === "tool_call" && step.toolArgs !== undefined ? literalTarget(step.toolArgs)?.argName : undefined;
    const toFull = (argName: string, text: string): string => {
      const full = target !== undefined && argName !== target ? summaryToFull(text) : undefined;
      if (full === undefined) return text;
      fullContent.push(argName);
      return full;
    };
    const instruction = fix(step.instruction);
    const toolArgs =
      step.toolArgs === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(step.toolArgs).map(([k, v]) => [k, typeof v === "string" ? toFull(k, fix(v)) : v]),
          );
    if (refs.length === 0 && fullContent.length === 0) return step;
    normalized.push({ stepId: step.id, refs, ...(fullContent.length > 0 ? { fullContent } : {}) });
    return { ...step, instruction, ...(toolArgs !== undefined ? { toolArgs } : {}) };
  });
  return { steps: out, normalized };
}

/** The guard reason: one clause per rewrite kind that happened, with its steps. */
function normalizedReason(normalized: readonly NormalizedStepRefs[]): string {
  const keyed = normalized.filter((s) => s.refs.length > 0);
  const full = normalized.filter((s) => (s.fullContent?.length ?? 0) > 0);
  const clauses = [
    ...(keyed.length > 0
      ? [`rewrote ${keyed.reduce((n, s) => n + s.refs.length, 0)} keyed from_step ref(s) to the bare ref in step(s) ${keyed.map((s) => s.stepId).join(", ")}`]
      : []),
    ...(full.length > 0
      ? [`rewrote :summary to :full in ${full.reduce((n, s) => n + (s.fullContent?.length ?? 0), 0)} file-content arg(s) in step(s) ${full.map((s) => s.stepId).join(", ")} (:summary flattens lines and caps at 500 chars)`]
      : []),
  ];
  return clauses.join("; ");
}

/** Emit one `guard-fired{guard:"plan-ref-normalized"}` listing every rewrite (none: no event). */
const emitPlanRefNormalized = (normalized: readonly NormalizedStepRefs[], taskId: string): Effect.Effect<void, never> =>
  normalized.length === 0
    ? Effect.void
    : emitGuardFired({
        taskId,
        iteration: 0,
        guard: PLAN_REF_NORMALIZED_GUARD,
        outcome: "redirect",
        reason: normalizedReason(normalized),
        metadata: { normalized },
      });

/**
 * Apply {@link normalizePlanRefs} to `plan` in place and emit one
 * `guard-fired{guard:"plan-ref-normalized"}` listing every rewrite.
 */
export const applyPlanRefNormalization = (plan: Plan, taskId: string): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const { steps, normalized } = normalizePlanRefs(plan.steps);
    if (normalized.length === 0) return;
    plan.steps = steps;
    yield* emitPlanRefNormalized(normalized, taskId);
  });

/**
 * Normalize the steps of a replan (patch or augment) and emit the same
 * `plan-ref-normalized` event a fresh plan emits when any ref was rewritten.
 */
export const normalizeReplanRefs = (steps: readonly PlanStep[], taskId: string): Effect.Effect<PlanStep[], never> =>
  Effect.gen(function* () {
    const { steps: out, normalized } = normalizePlanRefs(steps);
    yield* emitPlanRefNormalized(normalized, taskId);
    return out;
  });
