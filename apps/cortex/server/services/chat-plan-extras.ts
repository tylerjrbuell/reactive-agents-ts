/**
 * What a chat plan's steps carry that the conversation's to-do list cannot: the step ids each one
 * waits for (`dependsOn`) and the arguments it passes its tool (`args`). The framework `PlanStep`
 * holds both (core 58133c467) and `agent.execute(plan)` runs them; the to-do rows stay the one
 * store of ids, titles, statuses and tool hints, and these ride beside them in the plan meta, like
 * the older tool-hint map did. Validation is core's (`findPlanDependencyProblem`); Cortex only
 * bounds sizes and keeps the maps in step with the rows. Pure.
 */
import { findPlanDependencyProblem, type Plan, type PlanStep } from "@reactive-agents/core";

/** The extras one step may carry (the framework `PlanStep` fields, by the same names). */
export interface PlanStepExtras {
  /** Ids of steps that must finish first. */
  readonly dependsOn?: readonly string[];
  /** Arguments the step passes its tool (a JSON object). */
  readonly args?: Readonly<Record<string, unknown>>;
}

/** The extras of a whole plan, by step id: the shape `PlanFromChecklistMeta` takes in core. */
export interface PlanExtras {
  readonly dependsOn: Readonly<Record<string, readonly string[]>>;
  readonly args: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/** No extras. */
export const NO_EXTRAS: PlanExtras = { dependsOn: {}, args: {} };

/** Most prerequisites one step may name. */
export const DEPENDS_ON_MAX = 50;
/** Longest id a prerequisite may be (the step id bound the editor uses). */
const ID_MAX = 100;
/** Longest serialized `args` one step may carry, in characters. */
export const ARGS_MAX_CHARS = 8_000;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** True when `extras` hold nothing. */
export const extrasEmpty = (e: PlanExtras): boolean => Object.keys(e.dependsOn).length === 0 && Object.keys(e.args).length === 0;

/** Trim and bound one step's extras. `ok: false` carries the reason for a 400. */
export function cleanStepExtras(raw: PlanStepExtras): { readonly ok: true; readonly extras: PlanStepExtras } | { readonly ok: false; readonly error: string } {
  const out: { dependsOn?: readonly string[]; args?: Readonly<Record<string, unknown>> } = {};
  if (raw.dependsOn !== undefined) {
    const ids = [...new Set(raw.dependsOn.map((d) => d.trim()).filter((d) => d !== ""))];
    if (ids.length > DEPENDS_ON_MAX) return { ok: false, error: `Invalid plan: a step waits for at most ${DEPENDS_ON_MAX} steps` };
    if (ids.some((d) => d.length > ID_MAX)) return { ok: false, error: `Invalid plan: a step id is at most ${ID_MAX} characters` };
    if (ids.length > 0) out.dependsOn = ids;
  }
  if (raw.args !== undefined) {
    if (!isRecord(raw.args)) return { ok: false, error: "Invalid plan: step args must be a JSON object" };
    if (Object.keys(raw.args).length > 0) {
      let text: string | undefined;
      try {
        text = JSON.stringify(raw.args);
      } catch {
        text = undefined;
      }
      if (text === undefined) return { ok: false, error: "Invalid plan: step args must be JSON" };
      if (text.length > ARGS_MAX_CHARS) return { ok: false, error: `Invalid plan: a step's args are at most ${ARGS_MAX_CHARS} characters` };
      out.args = raw.args;
    }
  }
  return { ok: true, extras: out };
}

/** The extras of editor steps (ids as given, else the 1-based `step-N` the framework assigns). */
export function extrasOfSteps<S extends { readonly id?: string } & PlanStepExtras>(steps: readonly S[]): PlanExtras {
  const dependsOn: Record<string, readonly string[]> = {};
  const args: Record<string, Readonly<Record<string, unknown>>> = {};
  steps.forEach((s, i) => {
    const id = s.id ?? `step-${i + 1}`;
    if (s.dependsOn !== undefined && s.dependsOn.length > 0) dependsOn[id] = s.dependsOn;
    if (s.args !== undefined && Object.keys(s.args).length > 0) args[id] = s.args;
  });
  return { dependsOn, args };
}

/**
 * The reason a step list's dependencies cannot run (unknown id, self reference or cycle), by the
 * framework's own check; `undefined` when they are sound.
 */
export function dependencyProblemOf<S extends { readonly id?: string } & PlanStepExtras>(steps: readonly S[]): string | undefined {
  const plan: Pick<Plan, "steps"> = {
    steps: steps.map((s, i): PlanStep => ({ id: s.id ?? `step-${i + 1}`, title: "", status: "pending", ...(s.dependsOn !== undefined ? { dependsOn: s.dependsOn } : {}) })),
  };
  return findPlanDependencyProblem(plan);
}

/**
 * The stored extras kept for the steps a plan still has: a step that is gone loses its entries, and
 * a prerequisite naming a gone step is dropped, so a plan a turn reshaped never fails the
 * framework's dependency check over an id nobody can see.
 */
export function pruneExtras(extras: PlanExtras, stepIds: readonly string[]): PlanExtras {
  const live = new Set(stepIds);
  const dependsOn: Record<string, readonly string[]> = {};
  const args: Record<string, Readonly<Record<string, unknown>>> = {};
  for (const id of stepIds) {
    const deps = (extras.dependsOn[id] ?? []).filter((d) => live.has(d) && d !== id);
    if (deps.length > 0) dependsOn[id] = deps;
    const a = extras.args[id];
    if (a !== undefined) args[id] = a;
  }
  return { dependsOn, args };
}

/** The plan with its steps' extras (pruned to the steps it has). Pure. */
export function withExtras(plan: Plan, extras: PlanExtras): Plan {
  if (extrasEmpty(extras)) return plan;
  const kept = pruneExtras(extras, plan.steps.map((s) => s.id));
  return {
    ...plan,
    steps: plan.steps.map((s): PlanStep => {
      const deps = kept.dependsOn[s.id];
      const a = kept.args[s.id];
      return { ...s, ...(deps !== undefined ? { dependsOn: deps } : {}), ...(a !== undefined ? { args: a } : {}) };
    }),
  };
}

/** Read stored extras (corrupt or absent values read as none). */
export function extrasOfStored(rawDependsOn: unknown, rawArgs: unknown): PlanExtras {
  const dependsOn: Record<string, readonly string[]> = {};
  const args: Record<string, Readonly<Record<string, unknown>>> = {};
  if (isRecord(rawDependsOn)) {
    for (const [id, v] of Object.entries(rawDependsOn)) {
      if (Array.isArray(v)) {
        const ids = v.filter((x): x is string => typeof x === "string" && x !== "");
        if (ids.length > 0) dependsOn[id] = ids;
      }
    }
  }
  if (isRecord(rawArgs)) {
    for (const [id, v] of Object.entries(rawArgs)) if (isRecord(v) && Object.keys(v).length > 0) args[id] = v;
  }
  return { dependsOn, args };
}
