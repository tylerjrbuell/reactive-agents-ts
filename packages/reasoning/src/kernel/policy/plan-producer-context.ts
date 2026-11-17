/**
 * policy/plan-producer-context.ts — the ONE context every plan producer plans from.
 *
 * Producers: the blueprint and plan-execute planners (generate, patch, augment)
 * and the plan-posture run. Each used to assemble its own framing, so a planner
 * could run without knowing it was only planning, which tools read and which
 * write, or what day it is (a baked check-in date of 2024 on a 2026 run).
 * Built here, once per call from the tool schemas and the clock:
 *   - posture     : plan only; the steps run later, with the catalog tools;
 *   - tools       : names, signatures, parameters, description and the read/write
 *                   effect (`ToolSchema.effect`; absent reads as `unknown`);
 *   - today       : the env date (ISO) and timezone, the ground for date arguments;
 *   - interaction : whether the planner may ask the user or run read-only recon.
 * `renderPlanProducerContext` is the model-visible block (strategy planner
 * prompts); `catalogLine` is the compact tool line plan-posture guidance uses.
 * Pure: the clock is a parameter (golden rule 5), no LLM, no fs.
 */
import type { ToolParamSchema, ToolSchema } from "../capabilities/attend/tool-formatting.js";
import { planToolCatalogLine } from "./plan-steps.js";
import { isDateishParam } from "./plan-args.js";

/**
 * What a plan producer is told about its role. It replaces the planner prompt's
 * old role sentence ("You are a planning agent. Decompose the goal into a
 * structured plan.") at no extra length, so the trivial-task overhead ratchet holds.
 */
export const PLAN_PRODUCER_POSTURE = "Role: planning agent. Never execute.";

/** One tool as the planner sees it. `read` looks things up, `write` changes state outside the plan, `unknown` is treated as may-mutate. */
export interface PlanCatalogTool extends CatalogToolView {
  readonly effect: "read" | "write" | "unknown";
}

/** The planner's context. See the module header. */
export interface PlanProducerContext {
  readonly posture: string;
  readonly tools: readonly PlanCatalogTool[];
  /** The env date, `YYYY-MM-DD`, in {@link PlanProducerContext.timeZone}. */
  readonly today: string;
  readonly timeZone: string;
  /** Whether the planner may ask the user, and whether it may run read-only recon. */
  readonly interaction: { readonly ask: boolean; readonly recon: boolean };
  /** The compact `Execute-phase tools: …` line (plan-posture guidance); undefined with no domain tools. */
  readonly catalogLine: string | undefined;
  /** True when some tool takes a date or time argument (what the date rule is for). */
  readonly dateArgs: boolean;
}

/** What {@link buildPlanProducerContext} reads. */
export interface PlanProducerContextArgs {
  /** The tools the execute phase will have (the full dispatchable catalog). */
  readonly schemas: readonly ToolSchema[] | undefined;
  /** The clock reading the date is taken from. */
  readonly now: Date;
  /** IANA timezone; absent: the runtime's. */
  readonly timeZone?: string;
  /** The planner may ask the user. Default false. */
  readonly ask?: boolean;
  /** Read-only recon tools the planner may call now; their presence marks recon available. */
  readonly reconTools?: readonly Pick<ToolSchema, "name">[];
}

/** What the catalog renderer reads of a tool (a plan-prompt `ToolSummary` fits). */
export interface CatalogToolView {
  readonly name: string;
  readonly signature: string;
  readonly description?: string;
  readonly params?: readonly ToolParamSchema[];
  readonly effect?: "read" | "write" | "unknown";
}

/**
 * A tool's description, or `undefined` when its name already says it: a short
 * description (at most 6 words) that repeats a word of the name (`add` / "Add
 * two numbers") adds tokens and no information.
 */
function toolBlurb(name: string, description: string | undefined): string | undefined {
  const d = description?.trim();
  if (d === undefined || d.length === 0) return undefined;
  const nameWords = name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  const descWords = d.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 0);
  return descWords.length <= 6 && nameWords.some((w) => descWords.some((x) => x === w || x.startsWith(w))) ? undefined : d;
}

/** A parameter note is kept only when it shows how to call (an example, a quoted or code value). */
const SHOWS_HOW = /e\.g\.|example|`|"|'/i;

/**
 * One catalog line per tool, the one format every planner prompt uses:
 * `- name(req:type, req, opt?) [r|w]: description`. Required parameters come
 * first (a type only when it is not string), optional ones follow as `name?`;
 * `[r]` / `[w]` is the effect (nothing when unknown); the description only when
 * the name does not already say it (`toolBlurb`); a parameter's own note only
 * when it carries an example. Without `params`, the supplied signature stands.
 */
export function renderCatalog(tools: readonly CatalogToolView[]): string {
  return tools
    .map((t) => {
      const params = t.params;
      const signature =
        params === undefined
          ? t.signature
          : `(${[
              ...params.filter((p) => p.required === true).map((p) => p.name),
              ...params.filter((p) => p.required !== true).map((p) => `${p.name}?`),
            ].join(", ")})`;
      const blurb = toolBlurb(t.name, t.description);
      const notes = (params ?? []).filter((p) => p.description !== undefined && SHOWS_HOW.test(p.description)).map((p) => `\n    ${p.name}: ${p.description}`);
      return `- ${t.name}${signature}${t.effect === "read" ? " [r]" : t.effect === "write" ? " [w]" : ""}${blurb !== undefined ? `: ${blurb}` : ""}${notes.join("")}`;
    })
    .join("\n");
}

/** `YYYY-MM-DD` of `now` in `timeZone`. */
function isoDateIn(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The catalog tool for one schema. */
const toCatalogTool =(t: ToolSchema): PlanCatalogTool => ({
  name: t.name,
  signature: `(${t.parameters.map((p) => (p.required ? p.name : `${p.name}?`)).join(", ")})`,
  ...(t.description ? { description: t.description } : {}),
  ...(t.parameters.length > 0 ? { params: t.parameters } : {}),
  effect: t.effect ?? "unknown",
});

/** Build the context every plan producer plans from. */
export function buildPlanProducerContext(args: PlanProducerContextArgs): PlanProducerContext {
  const timeZone = args.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const reconTools = args.reconTools ?? [];
  return {
    posture: PLAN_PRODUCER_POSTURE,
    tools: (args.schemas ?? []).map(toCatalogTool),
    today: isoDateIn(args.now, timeZone),
    timeZone,
    interaction: { ask: args.ask === true, recon: reconTools.length > 0 },
    catalogLine: planToolCatalogLine(args.schemas, reconTools),
    dateArgs: (args.schemas ?? []).some((t) => t.parameters.some(isDateishParam)),
  };
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/**
 * The model-visible context lines beyond the posture, each only when it applies:
 * today's date and the argument rule (a tool takes a date), what the `[r]` /
 * `[w]` marks mean (a tool has one), and what the planner may ask or look up
 * (interaction or recon is on). Empty when none applies.
 */
export function renderPlanProducerContext(ctx: PlanProducerContext): string {
  const [y, m, d] = ctx.today.split("-").map(Number) as [number, number, number];
  const weekday = WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const lines: string[] = [];
  if (ctx.dateArgs) {
    lines.push(
      `Today is ${ctx.today} (${weekday}), timezone ${ctx.timeZone}. A date argument must come from the goal or be worked out from today's date, never invented; leave out an argument you cannot ground, it is chosen when the step runs.`,
    );
  }
  if (ctx.tools.some((t) => t.effect !== "unknown")) lines.push("[r] tools look something up; [w] tools change state outside the plan.");
  if (ctx.interaction.ask || ctx.interaction.recon) {
    lines.push(
      ctx.interaction.ask && ctx.interaction.recon
        ? "You may ask the user a question or call the read-only tools to look a fact up."
        : ctx.interaction.ask
          ? "You may ask the user a question when the answer would change the plan."
          : "You may call the read-only tools to look a fact up.",
    );
  }
  return lines.join("\n");
}
