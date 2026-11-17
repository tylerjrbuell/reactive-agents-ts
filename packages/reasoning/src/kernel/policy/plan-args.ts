/**
 * policy/plan-args.ts — plan-time validation of tool-call arguments.
 *
 * A planner writes whole tool calls up front, before any step runs, so its
 * arguments can be wrong in ways a direct dispatch only discovers by failing:
 *   - `unknown-tool`        : the step names a tool the catalog does not have;
 *   - `missing-required`    : a required parameter has no value (and no
 *                             `{{from_step}}` reference supplies it);
 *   - `tool-on-analysis`    : a step typed `analysis` (a tool-less model call) names a
 *                             catalog tool, so the tool would never run; it becomes a
 *                             `composite` step scoped to that tool;
 *   - `ungrounded-literal`  : a date or relative-time literal (`2024-11-21`,
 *                             `tomorrow`) in a date-like argument that the goal
 *                             does not give. Relative phrases the goal DID use
 *                             resolve against the env date; an ISO date counts as
 *                             grounded when the goal names it (verbatim, or as a
 *                             month and day within the current or next year).
 * A step with a missing or ungrounded argument is not dispatched as written: it
 * becomes a `composite` step scoped to its tool, so the model chooses the
 * argument when the step runs (execute time), from the goal and prior results.
 * Known arguments move into the instruction. Pure and deterministic: the date
 * is a parameter, no LLM, no clock, no fs. The one home for this repair
 * (plan-execute's older missing-argument routing is {@link routeUnderspecifiedToolSteps}).
 */
import { Effect } from "effect";
import type { PlanStep } from "../../types/plan.js";
import { emitGuardFired } from "../utils/diagnostics.js";
import type { ToolSchema } from "../capabilities/attend/tool-formatting.js";
import { fromStepRe } from "../../assembly/ref-grammar.js";

/** What one finding is about. */
export type PlanArgFindingKind = "unknown-tool" | "missing-required" | "ungrounded-literal" | "tool-on-analysis";

/** One plan-time argument problem. */
export interface PlanArgFinding {
  readonly stepId: string;
  readonly tool: string;
  readonly kind: PlanArgFindingKind;
  /** The argument concerned (absent for `unknown-tool`). */
  readonly arg?: string;
  readonly detail: string;
}

/** What date arguments are grounded against. */
interface PlanArgGrounding {
  /** The user's goal text. */
  readonly goal: string;
  /** The env date, `YYYY-MM-DD`. */
  readonly today: string;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const DATEISH_PARAM = /date|check-?in|check-?out|deadline|timestamp|\b(?:time|day|days|start|end|until|since|when)\b/i;

/** True when a tool parameter reads as a date or time (by its name or description). */
export const isDateishParam = (p: { readonly name: string; readonly description?: string }): boolean =>
  DATEISH_PARAM.test(`${p.name} ${p.description ?? ""}`);
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;

const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === "string" && value.trim().length === 0);

const refsOf = (value: unknown): readonly string[] =>
  typeof value === "string" ? [...value.matchAll(fromStepRe())].map((m) => m[1]!) : [];

const addDays = (iso: string, days: number): string => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/** The env date a relative-time phrase means, or undefined when it is not one this resolves. */
export function resolveRelativeDate(phrase: string, today: string): string | undefined {
  const p = phrase.trim().toLowerCase();
  if (p === "today" || p === "tonight" || p === "now") return today;
  if (p === "tomorrow") return addDays(today, 1);
  if (p === "yesterday") return addDays(today, -1);
  const inN = /^in (\d{1,3}) (day|week)s?$/.exec(p);
  if (inN) return addDays(today, Number(inN[1]) * (inN[2] === "week" ? 7 : 1));
  const agoN = /^(\d{1,3}) (day|week)s? ago$/.exec(p);
  if (agoN) return addDays(today, -Number(agoN[1]) * (agoN[2] === "week" ? 7 : 1));
  return undefined;
}

/** True when `iso` is a date the goal gives: verbatim, or a month and day in the current or next year. */
export function goalGroundsDate(goal: string, iso: string, today: string): boolean {
  const day = iso.slice(0, 10);
  if (goal.includes(day)) return true;
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const thisYear = Number(today.slice(0, 4));
  if (y !== thisYear && y !== thisYear + 1) return false;
  const mon = MONTHS[m - 1];
  if (mon === undefined) return false;
  const g = goal.toLowerCase();
  return new RegExp(`\\b${mon}[a-z]*\\.?\\s+${d}(?:st|nd|rd|th)?\\b`).test(g) || new RegExp(`\\b${d}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${mon}[a-z]*\\b`).test(g);
}

/** The arg's grounded value, `"ungrounded"`, or `undefined` when it is not a date/relative literal. */
function groundLiteral(param: ToolSchema["parameters"][number], value: unknown, g: PlanArgGrounding): string | "ungrounded" | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (ISO_DATE.test(v)) return goalGroundsDate(g.goal, v, g.today) ? undefined : "ungrounded";
  if (!isDateishParam(param)) return undefined;
  const resolved = resolveRelativeDate(v, g.today);
  if (resolved === undefined) return undefined;
  return g.goal.toLowerCase().includes(v.toLowerCase()) ? resolved : "ungrounded";
}

/** Render a known argument for a step instruction; `{{from_step:sN}}` becomes "the result of step sN". */
const describeKnownArg = (value: unknown): string => {
  const refs = refsOf(value);
  return refs.length > 0 ? `the result of step ${refs.join(", ")}` : JSON.stringify(value);
};

/**
 * Validate and repair the tool-call steps of `plan` in place (`plan.steps` is
 * replaced). Returns every finding. A step with a missing or ungrounded
 * argument becomes a `composite` step scoped to its tool (see module header);
 * grounded relative phrases are rewritten to the env date and a step with only
 * those stays a `tool_call`. Steps for tools with no schema are reported
 * (`unknown-tool`) and left alone. Without `grounding`, only missing
 * required arguments are checked.
 */
export function groundPlanArgs(plan: { steps: PlanStep[] }, schemas: readonly ToolSchema[], grounding?: PlanArgGrounding): readonly PlanArgFinding[] {
  const byName = new Map(schemas.map((s) => [s.name, s]));
  const findings: PlanArgFinding[] = [];
  plan.steps = plan.steps.map((step): PlanStep => {
    if (step.type === "analysis" && step.toolName !== undefined && byName.has(step.toolName)) {
      findings.push({ stepId: step.id, tool: step.toolName, kind: "tool-on-analysis", detail: `analysis step names tool "${step.toolName}"` });
      return { ...step, type: "composite", toolHints: [...new Set([...(step.toolHints ?? []), step.toolName])] };
    }
    if (step.type !== "tool_call" || step.toolName === undefined) return step;
    const tool = step.toolName;
    const schema = byName.get(tool);
    if (schema === undefined) {
      if (schemas.length > 0) findings.push({ stepId: step.id, tool, kind: "unknown-tool", detail: `no tool "${tool}" in the catalog` });
      return step;
    }
    const args = step.toolArgs ?? {};
    const missing = schema.parameters.filter((p) => p.required === true && isBlank(args[p.name])).map((p) => p.name);
    const ungrounded: string[] = [];
    const resolved: Record<string, unknown> = { ...args };
    if (grounding !== undefined) {
      for (const p of schema.parameters) {
        const grounded = groundLiteral(p, args[p.name], grounding);
        if (grounded === undefined) continue;
        if (grounded === "ungrounded") ungrounded.push(p.name);
        else resolved[p.name] = grounded;
      }
    }
    for (const arg of missing) findings.push({ stepId: step.id, tool, kind: "missing-required", arg, detail: `required "${arg}" has no value` });
    for (const arg of ungrounded) findings.push({ stepId: step.id, tool, kind: "ungrounded-literal", arg, detail: `"${arg}" = ${JSON.stringify(args[arg])} is a date the goal does not give` });
    const deferred = [...missing, ...ungrounded];
    if (deferred.length === 0) return Object.keys(resolved).some((k) => resolved[k] !== args[k]) ? { ...step, toolArgs: resolved } : step;
    const known = Object.entries(resolved).filter(([k, v]) => !isBlank(v) && !deferred.includes(k));
    const refIds = known.flatMap(([, v]) => refsOf(v));
    const knownText = known.length > 0 ? ` Known arguments: ${known.map(([k, v]) => `${k} = ${describeKnownArg(v)}`).join("; ")}.` : "";
    const { toolArgs: _dropped, ...rest } = step;
    return {
      ...rest,
      type: "composite",
      toolHints: [tool],
      instruction: `${step.instruction} Call ${tool}; supply ${deferred.join(", ")} from the goal${grounding !== undefined ? ` and today's date (${grounding.today})` : ""}.${knownText}`,
      dependsOn: [...new Set([...(step.dependsOn ?? []), ...refIds])],
    };
  });
  return findings;
}

/**
 * True when the step plans a call to its named tool: a `tool_call` step, or the
 * `composite` step a `tool_call` became when its arguments were deferred to
 * execute time (it keeps `toolName`). Required-tool and quantity checks count these.
 */
export const plansToolCall = (s: Pick<PlanStep, "type" | "toolName">): boolean =>
  s.toolName !== undefined && (s.type === "tool_call" || s.type === "composite");

/**
 * Turn each `tool_call` step that lacks a required argument into a `composite`
 * step scoped to its tool. {@link groundPlanArgs} without date grounding.
 */
export const routeUnderspecifiedToolSteps = (plan: { steps: PlanStep[] }, schemas: readonly ToolSchema[]): void => {
  groundPlanArgs(plan, schemas);
};

/** Trace `guard` name of the plan-args report. */
const PLAN_ARGS_VALIDATED_GUARD = "plan-args-validated";

/**
 * {@link groundPlanArgs} on `plan` in place, plus ONE `guard-fired{guard:
 * "plan-args-validated"}` listing every finding (the way planning/plan-refs.ts
 * reports its rewrites); no finding, no event. Dates are checked against
 * `today` (the producer context's); `today` undefined skips them (a
 * caller-supplied plan's literals are the caller's choice) while missing
 * required arguments are still deferred. Used for every plan a strategy
 * produces: generated, supplied, patched, augmented.
 */
export const applyPlanArgGrounding = (
  plan: { steps: PlanStep[] },
  schemas: readonly ToolSchema[],
  today: string | undefined,
  goal: string,
  taskId: string,
): Effect.Effect<readonly PlanArgFinding[], never> =>
  Effect.gen(function* () {
    const findings = groundPlanArgs(plan, schemas, today === undefined ? undefined : { goal, today });
    if (findings.length === 0) return findings;
    yield* emitGuardFired({
      taskId,
      iteration: 0,
      guard: PLAN_ARGS_VALIDATED_GUARD,
      outcome: "redirect",
      reason: `${findings.length} plan argument problem(s): ${findings.map((f) => `${f.stepId} ${f.tool}${f.arg !== undefined ? `.${f.arg}` : ""}: ${f.kind}`).join("; ")}`,
      metadata: { findings },
    });
    return findings;
  });
