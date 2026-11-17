/**
 * What a plan step carries beside its title, status and tool: the step ids it waits for
 * (`dependsOn`) and the JSON arguments it passes its tool (`args`), the framework `PlanStep`'s own
 * fields (core 58133c467). `@reactive-agents/ui-core`'s list rules (add, move, reword) do not know
 * them, so they ride beside the steps as a map by step id and this module keeps that map in step
 * with the list. The rules for a sound graph (unknown id, self reference, cycle) are core's
 * `findPlanDependencyProblem`; nothing here re-implements them. Pure.
 */
import { findPlanDependencyProblem } from "@reactive-agents/core";
import type { PlanStepWire } from "@reactive-agents/ui-core";

/** The extras of one step. */
export interface StepExtras {
  readonly dependsOn?: readonly string[];
  readonly args?: Readonly<Record<string, unknown>>;
}

/** The extras of a plan, by step id. A step with none has no entry. */
export type ExtrasMap = Readonly<Record<string, StepExtras>>;

/** A plan step as the server sends it: the ui-core wire step plus its extras. */
export type WireStep = PlanStepWire & StepExtras;

/** No extras. */
export const NO_EXTRAS: ExtrasMap = {};

const isEmpty = (e: StepExtras): boolean => (e.dependsOn === undefined || e.dependsOn.length === 0) && (e.args === undefined || Object.keys(e.args).length === 0);

const entry = (e: StepExtras): StepExtras => ({
  ...(e.dependsOn !== undefined && e.dependsOn.length > 0 ? { dependsOn: e.dependsOn } : {}),
  ...(e.args !== undefined && Object.keys(e.args).length > 0 ? { args: e.args } : {}),
});

/** The extras the steps carry. */
export function extrasOfSteps(steps: readonly WireStep[]): ExtrasMap {
  const out: Record<string, StepExtras> = {};
  for (const s of steps) {
    const e = entry(s);
    if (!isEmpty(e)) out[s.id] = e;
  }
  return out;
}

/** True when any step carries extras. */
export const hasExtras = (extras: ExtrasMap): boolean => Object.keys(extras).length > 0;

/** True when two maps differ (a step's prerequisites or args). */
export const extrasEdited = (saved: ExtrasMap, draft: ExtrasMap): boolean => JSON.stringify(sorted(saved)) !== JSON.stringify(sorted(draft));

const sorted = (m: ExtrasMap): [string, StepExtras][] => Object.entries(m).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * The extras kept for the steps that remain: a removed step loses its entry and a prerequisite
 * naming it is dropped. The same map comes back when nothing changed.
 */
export function pruneExtras(extras: ExtrasMap, steps: readonly { readonly id: string }[]): ExtrasMap {
  const live = new Set(steps.map((s) => s.id));
  let changed = false;
  const out: Record<string, StepExtras> = {};
  for (const [id, e] of Object.entries(extras)) {
    if (!live.has(id)) {
      changed = true;
      continue;
    }
    const deps = e.dependsOn?.filter((d) => live.has(d));
    if (deps !== undefined && e.dependsOn !== undefined && deps.length !== e.dependsOn.length) changed = true;
    const next = entry({ ...e, ...(deps !== undefined ? { dependsOn: deps } : {}) });
    if (!isEmpty(next)) out[id] = next;
    else changed = true;
  }
  return changed ? out : extras;
}

const withEntry = (extras: ExtrasMap, id: string, patch: StepExtras): ExtrasMap => {
  const { [id]: current, ...rest } = extras;
  const next = entry({ ...current, ...patch });
  return isEmpty(next) ? rest : { ...rest, [id]: next };
};

/** Set (or, empty, clear) the step ids a step waits for. */
export const setDependsOn = (extras: ExtrasMap, id: string, dependsOn: readonly string[]): ExtrasMap => withEntry(extras, id, { dependsOn });

/** Set (or, `undefined` or empty, clear) a step's tool arguments. */
export const setArgs = (extras: ExtrasMap, id: string, args: Readonly<Record<string, unknown>> | undefined): ExtrasMap => withEntry(extras, id, { args: args ?? {} });

/** Add `dep` to a step's prerequisites, or remove it when it is there. */
export function toggleDependsOn(extras: ExtrasMap, id: string, dep: string): ExtrasMap {
  const held = extras[id]?.dependsOn ?? [];
  return setDependsOn(extras, id, held.includes(dep) ? held.filter((d) => d !== dep) : [...held, dep]);
}

/** What typed args text means: nothing (blank), a JSON object, or the reason it is not one. */
export type ArgsParse = { readonly ok: true; readonly args: Readonly<Record<string, unknown>> | undefined } | { readonly ok: false; readonly error: string };

/** Read the args field: blank clears, anything else must be a JSON object. */
export function parseArgsText(text: string): ArgsParse {
  if (text.trim() === "") return { ok: true, args: undefined };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: "Args must be valid JSON." };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, error: "Args must be a JSON object, like {\"query\": \"...\"}." };
  return { ok: true, args: Object.fromEntries(Object.entries(value)) };
}

/** A step's args as the text the field shows (empty when it has none). */
export const argsText = (args: Readonly<Record<string, unknown>> | undefined): string => (args === undefined || Object.keys(args).length === 0 ? "" : JSON.stringify(args, null, 2));

/**
 * Why the steps' dependencies cannot run (unknown id, self reference or a cycle), in the
 * framework's words (`findPlanDependencyProblem`); `undefined` when they are sound.
 */
export function planProblem(steps: readonly PlanStepWire[], extras: ExtrasMap): string | undefined {
  return findPlanDependencyProblem({
    steps: steps.map((s) => ({ id: s.id, title: s.title, status: s.status, ...(extras[s.id]?.dependsOn !== undefined ? { dependsOn: extras[s.id]?.dependsOn } : {}) })),
  });
}

/** A short label for a step's prerequisites, by 1-based position (`after 1, 3`); empty when none. */
export function dependsLabel(steps: readonly { readonly id: string }[], dependsOn: readonly string[] | undefined): string {
  if (dependsOn === undefined || dependsOn.length === 0) return "";
  const at = dependsOn.map((d) => steps.findIndex((s) => s.id === d)).map((i, n) => (i >= 0 ? String(i + 1) : (dependsOn[n] ?? "?")));
  return `after ${at.join(", ")}`;
}
