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
 *
 * `iteration` is the kernel iteration of the turn: the event's own `iteration`
 * when the emitter stamps one, else `fallbackIteration`. Never `event.step`:
 * that is a step index (thought + action + observation steps), so reading it
 * split one turn across several iterations in chat UIs (2026-11-10).
 */
export function toThoughtStreamEvent(event: BusEvent, fallbackIteration = 0): AgentStreamEvent | undefined {
  if (event.producedBy !== "kernel") return undefined;
  const thought = typeof event.thought === "string" ? event.thought.trim() : "";
  if (thought.length === 0) return undefined;
  return {
    _tag: "ThoughtEmitted",
    content: thought,
    iteration: typeof event.iteration === "number" ? event.iteration : fallbackIteration,
  };
}

/**
 * Stateful thought projection for one stream. The bus `ReasoningStepCompleted`
 * carries no iteration today, but the turn's LLM call (`LLMRequestCompleted`,
 * stamped with the kernel iteration) completes before its thought is
 * published. `observeLlmCall` records that iteration per task (root and
 * sub-agent runs share the bus); `project` stamps it on the next thought of
 * the same task.
 */
export function makeThoughtProjection(): {
  readonly observeLlmCall: (event: BusEvent) => void;
  readonly project: (event: BusEvent) => AgentStreamEvent | undefined;
} {
  const lastIteration = new Map<string, number>();
  return {
    observeLlmCall: (event) => {
      if (typeof event.iteration === "number") lastIteration.set(String(event.taskId ?? ""), event.iteration);
    },
    project: (event) => toThoughtStreamEvent(event, lastIteration.get(String(event.taskId ?? "")) ?? 0),
  };
}

/**
 * Project a bus `GuardFiredEmitted` from either exit gate onto `ExitGateDecision`.
 * `deny-once` and `deny` (a repeated model denial) map to `repair`; `handoff` stays `handoff`; `accept` with items
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
    meta.gateDecision === "deny-once" || meta.gateDecision === "deny"
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
