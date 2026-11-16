/**
 * policy/run-posture.ts — the kernel half of the run POSTURE (plan-only mode).
 *
 * Plan: wiki/Planning/Implementation-Plans/2026-10-29-run-posture-plan-mode.md (P3).
 *
 * A posture is typed state the HARNESS owns (`RunEnvelope.rails.posture`), not
 * prompt wording. Under `"plan"` every harness-authored instruction derives from
 * it, so exactly one coherent story reaches the model:
 *   - tool surface  : EMPTY ({@link PLAN_POSTURE_TOOLS} has no members): plan is a
 *                     pure reasoning mode and the model is offered no tool at all.
 *                     Any call it names anyway is blocked at the tool-policy choke
 *                     point (`evaluateToolPolicy`) and recorded as a failed
 *                     observation, never executed. Provider thinking is untouched;
 *   - guidance      : the `Guidance:` block is ONE line ({@link PLAN_POSTURE_GUIDANCE});
 *                     act-reminder / checklist reminder / required-tools pressure /
 *                     every other pending nudge are suppressed at render;
 *   - completion    : required tools are cleared at the merge boundary so no
 *                     required-tool gate can fail or force a deliberately
 *                     stopped run — it completes when the model replies with its plan;
 *   - observability : a `posture-applied` signal rides the existing
 *                     `GuardFiredEmitted` trace event (no TraceEvent schema change).
 *   - nudges        : execute-oriented act guidance is not even produced under
 *                     plan (conversation-assembly), so it never sits in
 *                     `pendingGuidance` contradicting the posture line.
 * Absent / `"execute"` posture changes NOTHING (request-identity is pinned).
 */
import { Effect } from "effect";
import type { RunPosture } from "@reactive-agents/core";
import type { ReasoningStep } from "../../types/index.js";
import type { ResolvedToolSurface } from "../capabilities/reason/tool-surface.js";
import { emitGuardFired, emitSignalRendered } from "../utils/diagnostics.js";
import { injectSignal } from "../capabilities/reflect/signal-injection.js";
import { markRendered } from "../state/signal-ledger.js";
import { transitionState, type KernelState } from "../state/kernel-state.js";
import { guidanceBlockParts } from "../state/guidance-channel.js";
import type { TextPart } from "@reactive-agents/core";

// Interface merging keeps kernel-state.ts (LOC-pinned) untouched.
declare module "../state/kernel-state.js" {
  interface KernelInput {
    /** Run posture (from `RunEnvelope.rails.posture`). Only `"plan"` is ever carried; absent ⇒ execute. */
    readonly posture?: RunPosture;
  }
}

/** Trace `guard` name of the posture signal (reuses `GuardFiredEmitted`). */
export const POSTURE_APPLIED_GUARD = "posture-applied";

/**
 * The tools a plan-posture run may call: NONE. Plan is a pure reasoning mode
 * (owner direction 2026-11-15): the surface is empty and every call, meta and
 * exit tools included, is blocked at the tool-policy gate. The model's prose
 * reply is the plan; the user switches to execute to carry it out.
 */
export const PLAN_POSTURE_TOOLS: ReadonlySet<string> = new Set<string>();

/** The single `Guidance:` line rendered under plan posture. */
export const PLAN_POSTURE_GUIDANCE =
  "Plan mode: no tools are available. Reason it through and give the plan; the user will switch to execute mode to carry it out.";

/** Stable prefix of the block message; also how blocked calls are read back off the steps. */
export const PLAN_POSTURE_BLOCK_PREFIX = "[Tool \"";

const BLOCK_MARKER = "is not available in plan posture";

/** True when the carrier is in plan posture. */
export const isPlanPosture = (carrier: { readonly posture?: RunPosture } | undefined): boolean =>
  carrier?.posture === "plan";

/** Observation text for a call blocked by plan posture. */
export function planPostureBlockMessage(toolName: string): string {
  return `${PLAN_POSTURE_BLOCK_PREFIX}${toolName}" ${BLOCK_MARKER} — plan mode offers no tools; blocked, not executed. Reason it through and reply with the plan.]`;
}

/**
 * Narrow a resolved surface to the posture-allowed tools: `visible`/`callable`
 * (what the model is shown and offered) shrink; `universe` (what a model-named
 * call resolves against) stays whole so a withheld call reaches the act-time
 * gate and is blocked + recorded there.
 */
export function restrictSurfaceToPosture(surface: ResolvedToolSurface): ResolvedToolSurface {
  const allowed = (ts: { readonly name: string }): boolean => PLAN_POSTURE_TOOLS.has(ts.name);
  const reasons = new Map(surface.reasons);
  for (const ts of surface.universe) {
    if (!PLAN_POSTURE_TOOLS.has(ts.name)) reasons.set(ts.name, "hidden: withheld by plan posture");
  }
  return { ...surface, visible: surface.visible.filter(allowed), callable: surface.callable.filter(allowed), reasons };
}

/**
 * The universe the tool-INDEX mechanism (opt-in) may disclose/promote from.
 * Under plan it is the visible set, so the index can never re-expose a
 * posture-withheld tool (promotion would otherwise make it FC-callable).
 */
export const toolIndexUniverse = (
  surface: Pick<ResolvedToolSurface, "universe" | "visible">,
  carrier: { readonly posture?: RunPosture },
): ResolvedToolSurface["universe"] => (isPlanPosture(carrier) ? surface.visible : surface.universe);

/** Names of calls plan posture blocked so far, read off the observation steps (deterministic). */
export function blockedPostureCalls(steps: readonly ReasoningStep[]): readonly string[] {
  const names: string[] = [];
  for (const s of steps) {
    if (s.type !== "observation" || !s.content.includes(BLOCK_MARKER)) continue;
    const toolName = s.metadata?.observationResult?.toolName;
    if (typeof toolName === "string") names.push(toolName);
  }
  return names;
}

/**
 * Posture-derived overrides folded into the KernelInput at the merge boundary.
 * `requiredTools` is cleared (posture beats the classifier): no required-tool
 * gate, pressure nudge or terminal check may fail/force a plan-only run.
 */
export function postureInputOverrides(posture: RunPosture | undefined): {
  readonly posture?: RunPosture;
  readonly requiredTools?: readonly string[];
  readonly requiredToolQuantities?: Readonly<Record<string, number>>;
} {
  return posture === "plan" ? { posture: "plan", requiredTools: [], requiredToolQuantities: {} } : {};
}

/** The one-line `Guidance:` block rendered under plan posture (the channel's block format, as parts). */
export const planPostureGuidanceParts = (): readonly TextPart[] => guidanceBlockParts([PLAN_POSTURE_GUIDANCE]);

/** Ledger `origin` of the once-per-run posture signal. */
export const POSTURE_SIGNAL_ORIGIN = "policy/run-posture:posture-applied";

/**
 * Open the posture signal in the signal ledger ONCE per run (first plan think)
 * and emit its `harness-signal-injected`, so the guidance line the posture
 * renders is a tracked signal like every other (injected → rendered → effect).
 * Returns the stable ledger id; `undefined` outside plan posture.
 */
export function registerPostureSignal(
  state: KernelState,
  posture: RunPosture | undefined,
): Effect.Effect<{ readonly state: KernelState; readonly signalId: string } | undefined> {
  if (posture !== "plan") return Effect.succeed(undefined);
  const existing = (state.signalLedger ?? []).find((e) => e.origin === POSTURE_SIGNAL_ORIGIN);
  if (existing) return Effect.succeed({ state, signalId: existing.signalId });
  return injectSignal(state, {
    signalKind: "other",
    origin: POSTURE_SIGNAL_ORIGIN,
    content: PLAN_POSTURE_GUIDANCE,
    target: { policy: "other" },
    metadata: { posture: "plan", allowedTools: [...PLAN_POSTURE_TOOLS] },
  }).pipe(Effect.map((r) => ({ state: r.state, signalId: r.signalId })));
}

/**
 * Stamp the posture signal rendered the first time its guidance line actually
 * reaches the prompt (`renderedText` non-empty after any `prompt.guidance`
 * hook). Idempotent: later thinks are identity.
 */
export function stampPostureRendered(
  state: KernelState,
  signalId: string | undefined,
  renderedText: string | null | undefined,
): Effect.Effect<KernelState> {
  const entry = signalId === undefined ? undefined : (state.signalLedger ?? []).find((e) => e.signalId === signalId);
  if (!entry || entry.state !== "open" || !renderedText || renderedText.trim().length === 0) return Effect.succeed(state);
  return emitSignalRendered({
    taskId: state.taskId,
    iteration: state.iteration,
    signalId: entry.signalId,
    renderedInIter: state.iteration,
    renderedSection: "guidance",
  }).pipe(
    Effect.as(
      transitionState(state, {
        signalLedger: markRendered(state.signalLedger ?? [], entry.signalId, state.iteration, state.steps.length),
      }),
    ),
  );
}

/** Emit the `posture-applied` signal for one think pass (no-op outside plan posture). */
export function emitPostureApplied(args: {
  readonly posture: RunPosture | undefined;
  /** Stable ledger id of the posture signal (see {@link registerPostureSignal}). */
  readonly signalId?: string;
  readonly taskId: string;
  readonly iteration: number;
  readonly steps: readonly ReasoningStep[];
}): Effect.Effect<void> {
  if (args.posture !== "plan") return Effect.void;
  const blocked = blockedPostureCalls(args.steps);
  return emitGuardFired({
    taskId: args.taskId,
    iteration: args.iteration,
    guard: POSTURE_APPLIED_GUARD,
    outcome: blocked.length > 0 ? "block" : "pass",
    reason: "plan posture: tool surface restricted, execute-oriented guidance suppressed",
    metadata: {
      posture: "plan",
      allowedTools: [...PLAN_POSTURE_TOOLS],
      blockedCalls: [...blocked],
      ...(args.signalId !== undefined ? { signalId: args.signalId } : {}),
    },
  });
}
