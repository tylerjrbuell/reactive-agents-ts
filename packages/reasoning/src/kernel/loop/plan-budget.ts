// File: src/kernel/loop/plan-budget.ts
//
// Plan-sized iteration budget. A run SEEDED with a plan checklist
// (`input.initialAdvisory`) can need more iterations than the configured
// `maxIterations`: Cortex trace 01M7JHP80MHNZ35EVPS42JBD7T had an 18-item list
// against maxIterations 10, and only the silent bookkeeping refund
// (iterate-bookkeeping-refund-seam.ts) kept it going. The harness sizes the
// budget from the plan instead, once, at run start, and says so.
//
//   effective = clamp(configured, unchecked + reserve, hardCap)   (the TARGET)
//   stage1    = configured + max(1, ceil((effective - configured) / 2))
//
// STAGED (2026-11-17; ablation 2026-11-16-plan-posture-ablations: the whole raise
// bought no accuracy and cost +15% to +36% tokens when it fired): the run starts
// with `stage1`. Near that bound the second stage (up to `effective`) is granted
// ONLY IF the run made progress since the raise: a checklist row completed or a
// tool step succeeded. A stalled run ends at stage 1 instead of burning the rest.
// Refunds ride on top (the carrier bound is stage + refunds); the total never
// passes `hardCap`.
//   reserve   = max(2, ceil(unchecked * 0.25))      (the answer turn and slack)
//   hardCap   = max(configured, min(60, configured * 3))
//
// Only UNCHECKED seeded steps count (a resumed plan's done steps do not). A plan
// that fits, an unseeded run, plan posture, or the mechanism not opted in
// (`planBudget: true` / `RA_PLAN_BUDGET=1`; default OFF since 2026-11-19):
// undefined, nothing changes (byte-identical). The raise is
// ONE bound: it lifts the iteration and LLM-call bounds the loop reads live from
// the carrier's options (the bound the refund also bumps), and nothing else.
// Cost, token, and time limits and kill switches are untouched and still end
// the run. The bookkeeping refund keeps its own cap from the ORIGINAL configured
// budget, and the raise plus refunds never pass `hardCap`.
//
// Recorded: a `harness_signal` step carrying a `plan-budget` intervention (the
// receipt shows it) plus a `plan_budget_raised` guard-fired event
// {configured, steps, effective, hardCap}. Pure decision, deterministic, NO LLM.

import { Effect } from "effect";
import { authorityOf } from "../capabilities/decide/authority.js";
import { startRound, viewItems } from "../capabilities/act/checklist-round.js";
import { makeStep } from "../capabilities/sense/step-utils.js";
import { isPlanPosture } from "../policy/run-posture.js";
import {
  transitionState,
  type KernelInput,
  type KernelRunOptions,
  type KernelState,
} from "../state/kernel-state.js";
import { emitGuardFired } from "../utils/diagnostics.js";

// Interface merging keeps kernel-state.ts (LOC-pinned) untouched; the fields
// live next to the code that reads them (precedent: checklist-seed.ts).
declare module "../state/kernel-state.js" {
  interface KernelRunOptions {
    /** The maxIterations the caller configured, set only when the plan raised the bound. */
    readonly configuredMaxIterations?: number;
    /** The most the bound may reach (raise plus refunds), set only when the plan raised it. */
    readonly planBudgetHardCap?: number;
    /** The plan-sized bound (before refunds) the run may reach on progress; set while a second stage is open. */
    readonly planBudgetTarget?: number;
    /** Progress baseline at the last raise: steps recorded and checklist rows completed then. */
    readonly planBudgetMark?: { readonly steps: number; readonly completed: number };
  }
}

/** Intervention actor of the raise step. */
export const PLAN_BUDGET_ACTOR = "plan-budget";
/** The guard name of the raise's trace event. */
export const PLAN_BUDGET_GUARD = "plan_budget_raised";
/** Never raise past this many iterations, whatever the plan size. */
export const PLAN_BUDGET_ABSOLUTE_CEILING = 60;
/** Never raise past this multiple of the configured budget. */
export const PLAN_BUDGET_MULTIPLIER = 3;

/** A computed raise. */
export interface PlanBudget {
  readonly configured: number;
  readonly steps: number;
  readonly reserve: number;
  readonly effective: number;
  readonly hardCap: number;
  /** The first-stage bound the run starts with (<= effective). */
  readonly stage1: number;
}

/** The budget a plan of `steps` unchecked steps needs, or undefined when `configured` already covers it. Pure. */
export function planBudget(configured: number, steps: number): PlanBudget | undefined {
  if (steps <= 0) return undefined;
  const reserve = Math.max(2, Math.ceil(steps * 0.25));
  const hardCap = Math.max(configured, Math.min(PLAN_BUDGET_ABSOLUTE_CEILING, configured * PLAN_BUDGET_MULTIPLIER));
  const effective = Math.min(steps + reserve, hardCap);
  if (effective <= configured) return undefined;
  const stage1 = Math.min(effective, configured + Math.max(1, Math.ceil((effective - configured) / 2)));
  return { configured, steps, reserve, effective, hardCap, stage1 };
}

/** Checklist rows completed right now. */
const completedPlanSteps = (state: KernelState): number =>
  viewItems(startRound(), state.ledger).filter((i) => i.status === "completed").length;

/** Progress since `mark`: a row completed, or a tool step that succeeded. */
export const planBudgetProgressed = (state: KernelState, mark: { readonly steps: number; readonly completed: number }): boolean =>
  completedPlanSteps(state) > mark.completed ||
  state.steps.slice(mark.steps).some((s) => s.type === "observation" && s.metadata?.observationResult?.success === true);

/** Unchecked seeded steps right now (own-run checklist facts not completed). */
export const uncheckedPlanSteps = (state: KernelState): number =>
  viewItems(startRound(), state.ledger).filter((i) => i.status !== "completed").length;

/**
 * The raise for a run about to start, or undefined when it does not apply.
 * Returns the state carrying the record and the options with the bound raised.
 */
export function proposePlanBudget(args: {
  readonly state: KernelState;
  readonly input: KernelInput;
  readonly options: KernelRunOptions;
}): { readonly state: KernelState; readonly options: KernelRunOptions; readonly budget: PlanBudget } | undefined {
  const { state, input, options } = args;
  if (input.harness?.planBudget !== true) return undefined;
  if (isPlanPosture(input) || (input.initialAdvisory?.length ?? 0) === 0) return undefined;
  if (state.status === "done" || state.status === "failed") return undefined;
  if (options.configuredMaxIterations !== undefined) return undefined; // already raised
  const budget = planBudget(options.maxIterations, uncheckedPlanSteps(state));
  if (budget === undefined) return undefined;
  const step = makeStep(
    "harness_signal",
    `iteration budget raised to ${budget.stage1} for the plan (${budget.steps} unchecked steps; configured ${budget.configured}${budget.stage1 < budget.effective ? `; extends to ${budget.effective} on progress` : ""})`,
    {
      intervention: {
        actor: PLAN_BUDGET_ACTOR,
        authorityClass: authorityOf(PLAN_BUDGET_ACTOR),
        evidence: `${budget.steps} unchecked plan steps + ${budget.reserve} reserve vs maxIterations ${budget.configured}; hard cap ${budget.hardCap}`,
        whatChanged: `plan-budget: maxIterations ${budget.configured} -> ${budget.stage1}`,
        iter: state.iteration,
      },
    },
  );
  return {
    // `meta.maxIterations` is what ReasoningIterationProgress reports: keep it the effective bound.
    state: transitionState(state, { steps: [...state.steps, step], meta: { ...state.meta, maxIterations: budget.stage1 } }),
    options: {
      ...options,
      maxIterations: budget.stage1,
      configuredMaxIterations: budget.configured,
      planBudgetHardCap: budget.hardCap,
      ...(budget.stage1 < budget.effective
        ? { planBudgetTarget: budget.effective, planBudgetMark: { steps: state.steps.length + 1, completed: completedPlanSteps(state) } }
        : {}),
    },
    budget,
  };
}

/** Trace the raise (the step record already carries it). */
export const emitPlanBudgetRaised = (
  state: KernelState,
  options: KernelRunOptions,
  budget: PlanBudget,
): Effect.Effect<void, never> =>
  emitGuardFired({
    taskId: options.taskId ?? state.taskId,
    iteration: state.iteration,
    guard: PLAN_BUDGET_GUARD,
    outcome: "pass",
    reason: `iteration budget raised to ${budget.stage1} for a ${budget.steps}-step plan`,
    metadata: {
      stage: 1,
      configured: budget.configured,
      steps: budget.steps,
      effective: budget.effective,
      stage1: budget.stage1,
      hardCap: budget.hardCap,
    },
  });

/** Iterations left at which the second-stage check runs. */
const STAGE_CHECK_REMAINING = 2;

/**
 * Stage two: near the first-stage bound, grant the rest of the plan-sized budget
 * only when the run progressed since the raise. Undefined when no second stage is
 * open, the bound is not near, or the run stalled (it then ends at stage 1).
 * `refunds` is the bookkeeping refunds already folded into `options.maxIterations`.
 */
export function proposePlanBudgetExtension(args: {
  readonly state: KernelState;
  readonly options: KernelRunOptions;
  readonly refunds: number;
}): { readonly state: KernelState; readonly options: KernelRunOptions; readonly from: number; readonly to: number } | undefined {
  const { state, options, refunds } = args;
  const { planBudgetTarget: target, planBudgetMark: mark, planBudgetHardCap: hardCap } = options;
  if (target === undefined || mark === undefined) return undefined;
  if (state.status === "done" || state.status === "failed") return undefined;
  if (state.iteration < options.maxIterations - STAGE_CHECK_REMAINING) return undefined;
  if (!planBudgetProgressed(state, mark)) return undefined;
  const from = options.maxIterations;
  const to = Math.max(from, Math.min(target + refunds, hardCap ?? target + refunds));
  const step = makeStep("harness_signal", `iteration budget extended to ${to} (the plan progressed since the raise)`, {
    intervention: {
      actor: PLAN_BUDGET_ACTOR,
      authorityClass: authorityOf(PLAN_BUDGET_ACTOR),
      evidence: `a step completed or a tool succeeded since the raise; target ${target}`,
      whatChanged: `plan-budget: maxIterations ${from} -> ${to}`,
      iter: state.iteration,
    },
  });
  return {
    state: transitionState(state, { steps: [...state.steps, step], meta: { ...state.meta, maxIterations: to } }),
    options: {
      ...options,
      maxIterations: to,
      planBudgetTarget: undefined,
      planBudgetMark: undefined,
    },
    from,
    to,
  };
}

/** Trace the second-stage grant. */
export const emitPlanBudgetExtended = (
  state: KernelState,
  options: KernelRunOptions,
  from: number,
  to: number,
): Effect.Effect<void, never> =>
  emitGuardFired({
    taskId: options.taskId ?? state.taskId,
    iteration: state.iteration,
    guard: PLAN_BUDGET_GUARD,
    outcome: "pass",
    reason: `iteration budget extended to ${to} after progress`,
    metadata: { stage: 2, from, to, configured: options.configuredMaxIterations },
  });

/**
 * Run-start entry: apply the raise and trace it. Returns the inputs by identity
 * when it does not apply.
 */
export const applyPlanBudgetAtStart = (args: {
  readonly state: KernelState;
  readonly input: KernelInput;
  readonly options: KernelRunOptions;
}): Effect.Effect<{ readonly state: KernelState; readonly options: KernelRunOptions }, never> =>
  Effect.gen(function* () {
    const raised = proposePlanBudget(args);
    if (raised === undefined) return { state: args.state, options: args.options };
    yield* emitPlanBudgetRaised(raised.state, raised.options, raised.budget);
    return { state: raised.state, options: raised.options };
  });
