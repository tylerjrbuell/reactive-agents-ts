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
 */
import { Effect } from "effect";
import { normalizeFromStepRefs } from "../../assembly/ref-grammar.js";
import { emitGuardFired } from "../../kernel/utils/diagnostics.js";
import type { Plan, PlanStep } from "../../types/plan.js";

/** The guard-fired key for a keyed-ref rewrite. */
export const PLAN_REF_NORMALIZED_GUARD = "plan-ref-normalized";

/** The keyed refs rewritten in one step (instruction first, then tool args). */
export interface NormalizedStepRefs {
  readonly stepId: string;
  readonly refs: readonly string[];
}

/** The plan's steps with refs in the grammar, and every rewrite (empty: unchanged). */
export interface PlanRefNormalization {
  readonly steps: PlanStep[];
  readonly normalized: readonly NormalizedStepRefs[];
}

/** Rewrite keyed from_step refs in every step's instruction and string tool args. */
export function normalizePlanRefs(steps: readonly PlanStep[]): PlanRefNormalization {
  const normalized: NormalizedStepRefs[] = [];
  const out = steps.map((step) => {
    const refs: string[] = [];
    const fix = (text: string): string => {
      const r = normalizeFromStepRefs(text);
      refs.push(...r.rewritten);
      return r.text;
    };
    const instruction = fix(step.instruction);
    const toolArgs =
      step.toolArgs === undefined
        ? undefined
        : Object.fromEntries(Object.entries(step.toolArgs).map(([k, v]) => [k, typeof v === "string" ? fix(v) : v]));
    if (refs.length === 0) return step;
    normalized.push({ stepId: step.id, refs });
    return { ...step, instruction, ...(toolArgs !== undefined ? { toolArgs } : {}) };
  });
  return { steps: out, normalized };
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
        reason: `rewrote ${normalized.reduce((n, s) => n + s.refs.length, 0)} keyed from_step ref(s) to the bare ref in step(s) ${normalized.map((s) => s.stepId).join(", ")}`,
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
