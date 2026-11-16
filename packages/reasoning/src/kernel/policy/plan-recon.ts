/**
 * policy/plan-recon.ts — plan posture's questions and bounded read-only recon.
 *
 * Spec: wiki/Architecture/Design-Specs/2026-11-16-plan-execute-posture-robustness.md
 * (Addendum 2026-11-16). A planner may
 *   - ASK the user (`request_user_input`) when user interaction is wired, and
 *   - with the opt-in `planRecon` flag, call tools whose kernel schema says
 *     `effect === "read"` to look facts up (an id, a current state), bounded by
 *     a harness budget: {@link PLAN_RECON_MAX_CALLS} calls per run in total,
 *     {@link PLAN_RECON_MAX_PER_TOOL} per tool. A `write`, `unknown` or absent
 *     effect is NEVER recon-eligible.
 *
 * Budget and findings are derived from the step record and the run ledger (no
 * prompt wording, no new state field): what ran is `observation` steps of a
 * non-planning tool; each successful one becomes a `plan-finding` ledger fact
 * ({@link planFindingFacts}, committed by act/round-exit.ts). Exhaustion, or
 * the last iteration, withholds every tool but `todo` / `final-answer` so the
 * model must reply with its plan ({@link planTurnTools}).
 *
 * Gate: `evaluateToolPolicy` reads {@link PlanTurnTools.recon}; a recon call
 * over budget is blocked and recorded like any other posture block.
 * Execute side: recorded findings seed a one-time context line
 * ({@link planFindingsLine}). Flag off ⇒ none of this runs (byte-identical).
 * Deterministic, NO LLM, NO fs.
 */
import { REQUEST_USER_INPUT_TOOL_NAME } from "@reactive-agents/tools";
import type { ReasoningStep } from "../../types/index.js";
import type { ToolSchema } from "../capabilities/attend/tool-formatting.js";
import type { ResolvedToolSurface } from "../capabilities/reason/tool-surface.js";
import type { KernelInput } from "../state/kernel-state.js";
import { META_TOOLS } from "../state/kernel-constants.js";
import { PLAN_POSTURE_GUIDANCE, PLAN_POSTURE_TOOLS, isPlanPosture, isPostureBlockedObservation, restrictSurfaceToPosture } from "./run-posture.js";

/** One recorded recon result, as carried to the execute run (`RunEnvelopeRails.planFindings`). */
export interface PlanFindingSeed {
  readonly id: string;
  readonly tool: string;
  readonly summary: string;
}

// Interface merging keeps kernel-state.ts (LOC-pinned) untouched.
declare module "../state/kernel-state.js" {
  interface KernelInput {
    /** Findings recorded while planning (from `RunEnvelope.rails.planFindings`); rendered once in an execute run. */
    readonly planFindings?: readonly PlanFindingSeed[];
  }
}

/** Most recon calls one plan run may make. */
export const PLAN_RECON_MAX_CALLS = 6;
/** Most recon calls one plan run may make to the same tool. */
export const PLAN_RECON_MAX_PER_TOOL = 2;
/** Longest recorded finding summary (characters). */
export const PLAN_FINDING_SUMMARY_CHARS = 200;

/** When the model should ask the user (rendered under plan posture when interaction is wired). */
export const PLAN_ASK_GUIDANCE =
  "Ask the user with request_user_input only when the answer would change the plan; batch your questions into one call; never ask what recon or the conversation can answer.";
/** What recon is for and how much of it there is. */
export const PLAN_RECON_GUIDANCE =
  `Recon: you may call the read-only tools offered (at most ${PLAN_RECON_MAX_CALLS} calls, ${PLAN_RECON_MAX_PER_TOOL} per tool) to look up facts the plan needs, such as ids or current state. Each result is recorded as a finding. Never use recon to do the task itself.`;
/** Rendered once recon is spent: the plan reply is due. */
export const PLAN_FORCED_REPLY_GUIDANCE =
  "Recon is finished: reply now with the plan. Record the steps with todo, then present them.";
/** The posture line when recon tools are offered (the base line says no tool but todo). */
export const PLAN_RECON_POSTURE_GUIDANCE = PLAN_POSTURE_GUIDANCE.replace(
  "You cannot run tools other than todo",
  "You cannot run tools other than todo and the read-only recon tools offered",
);
/** Tools still offered once the plan reply is forced. */
const FORCED_REPLY_TOOLS: ReadonlySet<string> = new Set(["todo", "final-answer"]);

/** The input fields plan-turn resolution reads. */
export type PlanReconInput = Pick<KernelInput, "posture" | "harness" | "metaTools" | "allowedTools" | "allToolSchemas" | "availableToolSchemas">;

/** The run position plan-turn resolution reads. */
export interface PlanTurnContext {
  readonly iteration: number;
  readonly maxIterations: number;
  readonly steps: readonly ReasoningStep[];
  /** Tool names dispatched earlier in the same round but not yet recorded as steps. */
  readonly pending?: readonly string[];
}

/** True when recon is on for this run (plan posture and the `planRecon` flag). */
export const planReconOn = (input: Pick<KernelInput, "posture" | "harness">): boolean =>
  isPlanPosture(input) && input.harness?.planRecon === true;

/** True when the model may ask the user under this plan run (user interaction is wired). */
export const planAskOn = (input: Pick<KernelInput, "posture" | "metaTools">): boolean =>
  isPlanPosture(input) && input.metaTools?.userInteraction === true;

/** The tools recon may ever call: schemas whose `effect` is `read`, minus harness/meta tools. */
export function reconEligibleSchemas(input: PlanReconInput): readonly ToolSchema[] {
  if (!planReconOn(input)) return [];
  const allowed = input.allowedTools ?? [];
  return (input.allToolSchemas ?? input.availableToolSchemas ?? []).filter(
    (t) =>
      t.effect === "read" &&
      !META_TOOLS.has(t.name) &&
      !PLAN_POSTURE_TOOLS.has(t.name) &&
      t.name !== REQUEST_USER_INPUT_TOOL_NAME &&
      (allowed.length === 0 || allowed.includes(t.name)),
  );
}

/** True for an observation of a tool plan posture let run (a recon call), blocked calls excluded. */
const isReconObservation = (s: ReasoningStep): boolean => {
  if (s.type !== "observation" || isPostureBlockedObservation(s.content)) return false;
  const name = s.metadata?.observationResult?.toolName;
  return typeof name === "string" && !PLAN_POSTURE_TOOLS.has(name) && !META_TOOLS.has(name) && name !== REQUEST_USER_INPUT_TOOL_NAME;
};

/** Recon calls made so far (total and per tool), plus calls dispatched earlier this round. */
export function reconUsage(steps: readonly ReasoningStep[], pending: readonly string[] = []): { readonly total: number; readonly perTool: ReadonlyMap<string, number> } {
  const perTool = new Map<string, number>();
  const bump = (name: string): void => void perTool.set(name, (perTool.get(name) ?? 0) + 1);
  for (const s of steps) if (isReconObservation(s)) bump(String(s.metadata?.observationResult?.toolName));
  for (const name of pending) bump(name);
  return { total: [...perTool.values()].reduce((a, b) => a + b, 0), perTool };
}

/** What a plan think/act turn may offer, derived from the input and the run position. */
export interface PlanTurnTools {
  /** Recon tools still callable (flag on, budget left, not the last iteration). */
  readonly recon: ReadonlySet<string>;
  /** Their schemas (to add to the surface when disclosure hid them). */
  readonly reconSchemas: readonly ToolSchema[];
  /** `request_user_input` is offered (interaction wired, plan reply not yet forced). */
  readonly ask: boolean;
  /** Recon is spent (or the last iteration): only `todo` / `final-answer` remain, the plan reply is due. */
  readonly forced: boolean;
}

/** Resolve the plan turn's extra tools. No flag and no interaction ⇒ `{ recon: ∅, ask: false, forced: false }`. */
export function planTurnTools(input: PlanReconInput, ctx: PlanTurnContext): PlanTurnTools {
  const eligible = reconEligibleSchemas(input);
  const lastIteration = ctx.iteration >= ctx.maxIterations - 1;
  const usage = reconUsage(ctx.steps, ctx.pending);
  const callable =
    lastIteration || usage.total >= PLAN_RECON_MAX_CALLS
      ? []
      : eligible.filter((t) => (usage.perTool.get(t.name) ?? 0) < PLAN_RECON_MAX_PER_TOOL);
  // Forced once recon was used and nothing is left, or on the last iteration of a recon-enabled run.
  const forced = planReconOn(input) && (lastIteration || (usage.total > 0 && callable.length === 0));
  return {
    recon: new Set(callable.map((t) => t.name)),
    reconSchemas: callable,
    ask: planAskOn(input) && !forced,
    forced,
  };
}

/**
 * The plan surface: the posture-restricted surface plus this turn's ask / recon
 * tools; when the plan reply is forced, only `todo` / `final-answer`. With no
 * flag and no interaction this IS {@link restrictSurfaceToPosture}.
 */
export function planPostureSurface(resolved: ResolvedToolSurface, input: PlanReconInput, ctx: PlanTurnContext, askSchema: ToolSchema): ResolvedToolSurface {
  const turn = planTurnTools(input, ctx);
  const base = restrictSurfaceToPosture(resolved);
  if (!turn.forced && !turn.ask && turn.recon.size === 0) return base;
  const extraSchemas = [...turn.reconSchemas, ...(turn.ask ? [askSchema] : [])];
  const extraNames = new Set(extraSchemas.map((t) => t.name));
  const keep = (t: { readonly name: string }): boolean => (turn.forced ? FORCED_REPLY_TOOLS.has(t.name) : extraNames.has(t.name) || PLAN_POSTURE_TOOLS.has(t.name));
  const withExtras = (list: readonly ToolSchema[]): readonly ToolSchema[] => {
    const kept = list.filter((t) => !extraNames.has(t.name) && (!turn.forced || keep(t)));
    return turn.forced ? kept : [...kept, ...extraSchemas];
  };
  const reasons = new Map(base.reasons);
  for (const t of extraSchemas) reasons.set(t.name, turn.ask && t.name === askSchema.name ? "visible: plan posture may ask the user" : "visible: plan recon (read-only)");
  if (turn.forced) for (const t of resolved.universe) if (!FORCED_REPLY_TOOLS.has(t.name)) reasons.set(t.name, "hidden: plan reply is due");
  const universe = [...resolved.universe, ...extraSchemas.filter((t) => !resolved.universe.some((u) => u.name === t.name))];
  return { universe, visible: withExtras(base.visible), callable: withExtras(base.callable), reasons };
}

/** Summary of one tool result: whitespace collapsed, clipped. */
const summarize = (content: string): string => {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length <= PLAN_FINDING_SUMMARY_CHARS ? flat : `${flat.slice(0, PLAN_FINDING_SUMMARY_CHARS - 1).trimEnd()}…`;
};

/** One recon result to record (the ledger emitter assigns the id). */
export interface PlanFindingFact {
  readonly tool: string;
  readonly summary: string;
}

/** The recon results among a round's new steps: successful observations of tools plan posture let run. */
export function planFindingFacts(roundSteps: readonly ReasoningStep[]): readonly PlanFindingFact[] {
  return roundSteps
    .filter((s) => isReconObservation(s) && s.metadata?.observationResult?.success === true)
    .map((s) => ({ tool: String(s.metadata?.observationResult?.toolName), summary: summarize(s.content) }));
}

/** Guidance for one plan turn: the base line (recon variant when recon tools are offered) and the extra lines. */
export function planTurnGuidance(turn: PlanTurnTools): { readonly base?: string; readonly lines: readonly string[] } {
  return {
    ...(turn.recon.size > 0 ? { base: PLAN_RECON_POSTURE_GUIDANCE } : {}),
    lines: [
      ...(turn.recon.size > 0 ? [PLAN_RECON_GUIDANCE] : []),
      ...(turn.ask ? [PLAN_ASK_GUIDANCE] : []),
      ...(turn.forced ? [PLAN_FORCED_REPLY_GUIDANCE] : []),
    ],
  };
}

/**
 * The execute-side context line for findings recorded while planning; undefined
 * when none. It rides the environment-notice channel (think.ts), which renders
 * a notice ONCE per run.
 */
export function planFindingsLine(input: Pick<KernelInput, "posture" | "planFindings">): string | undefined {
  const findings = input.planFindings ?? [];
  if (isPlanPosture(input) || findings.length === 0) return undefined;
  return `Findings from planning: ${findings.map((f) => `${f.tool}: ${f.summary}`).join("; ")}.`;
}
