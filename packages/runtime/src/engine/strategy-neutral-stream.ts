/**
 * Projections that keep the public stream uniform across strategies (Plan 8:
 * strategies are policies over shared primitives, so a consumer must not be
 * able to tell which strategy ran from the event shapes it sees).
 *
 * - `ThoughtEmitted` = the model's own reasoning for a kernel turn ONLY. A
 *   strategy's step records (`[PLAN 2] ...`, `[REFLECT 1] ...`, raw plan JSON)
 *   are control narration, not thinking; plans reach UIs as `ChecklistUpdated`
 *   plan rows and goal checks as `ExitGateDecision`.
 * - `ExitGateDecision` = either exit gate's non-accept disposition (the kernel
 *   `exit_gate`, reasoning kernel/loop/exit-gate.ts, and the strategy
 *   `strategy_delivery_gate`, kernel/loop/strategy-exit-gate.ts), one shape.
 *
 * Both read the loosely-typed bus event (runtime does not import reasoning);
 * run scoping is the caller's `routeScoped`.
 */
import type { AgentStreamEvent } from "../stream-types.js";

type BusEvent = Readonly<Record<string, unknown>>;
type ExitGateDecisionEvent = Extract<AgentStreamEvent, { _tag: "ExitGateDecision" }>;

/** Guards whose `GuardFiredEmitted` carries an exit-gate disposition. */
const EXIT_GATE_GUARDS: ReadonlySet<string> = new Set(["exit_gate", "strategy_delivery_gate"]);

/**
 * Project a bus `ReasoningStepCompleted` onto `ThoughtEmitted`. Only steps the
 * kernel produced (`producedBy === "kernel"`) with a non-empty thought qualify.
 */
export function toThoughtStreamEvent(event: BusEvent): AgentStreamEvent | undefined {
  if (event.producedBy !== "kernel") return undefined;
  const thought = typeof event.thought === "string" ? event.thought.trim() : "";
  if (thought.length === 0) return undefined;
  return {
    _tag: "ThoughtEmitted",
    content: thought,
    iteration: typeof event.step === "number" ? event.step : 0,
  };
}

/**
 * Project a bus `GuardFiredEmitted` from either exit gate onto `ExitGateDecision`.
 * `deny-once` maps to `repair`; `handoff` stays `handoff`; `accept` with items
 * still outstanding (the honest failure stands) maps to `accept-unfinished`.
 * A clean accept (nothing outstanding) and every other guard yield nothing.
 */
export function toExitGateStreamEvent(event: BusEvent): AgentStreamEvent | undefined {
  if (typeof event.guard !== "string" || !EXIT_GATE_GUARDS.has(event.guard)) return undefined;
  const meta = (event.metadata ?? {}) as BusEvent;
  const outstanding = Array.isArray(meta.outstanding)
    ? meta.outstanding.filter((o): o is string => typeof o === "string")
    : [];
  const decision: ExitGateDecisionEvent["decision"] | undefined =
    meta.gateDecision === "deny-once"
      ? "repair"
      : meta.gateDecision === "handoff"
        ? "handoff"
        : meta.gateDecision === "accept" && outstanding.length > 0
          ? "accept-unfinished"
          : undefined;
  if (decision === undefined) return undefined;
  return {
    _tag: "ExitGateDecision",
    decision,
    outstanding,
    iteration: typeof event.iteration === "number" ? event.iteration : 0,
  };
}
