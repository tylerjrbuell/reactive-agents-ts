/**
 * Think phase — the tool-result pairing invariant, kernel side.
 *
 * Every assistant tool_use in the projected thread must be answered by a
 * tool_result of the same id: the model cannot use a result it never sees, and
 * native-FC providers reject an orphan tool_use id. The assembly records any
 * break (`AssemblyTrace.pairing`, project-results.ts); this module makes it
 * loud and keeps the guidance honest about it.
 *
 * Owner report 2026-11-10 (Cortex traces 01M745M4CSCS…, 01M745S366TC…): a
 * compressed `find` result was dropped from the thread while the guidance
 * still said "You have tool results above". The drop is fixed at its source
 * (act/scratchpad-sync.ts); this is the boundary check that keeps a future one
 * from being silent.
 */
import { Effect } from "effect";
import type { AssemblyTrace } from "../../../assembly/trace.js";
import type { ProviderRequest } from "../../../assembly/types.js";
import type { PendingGuidance } from "../../state/guidance-channel.js";
import { emitGuardFired } from "../../utils/diagnostics.js";

/** Guard name of the pairing signal on the `guard-fired` trace event. */
export const TOOL_RESULT_PAIRING_GUARD = "tool-result-pairing";

/**
 * Publish a `tool-result-pairing` guard event when the projection had to
 * recover a result from its message (its stored ref was missing) or left a
 * tool_use unanswered. No event for a whole thread.
 */
export function emitToolResultPairing(
  trace: AssemblyTrace,
  taskId: string,
  iteration: number,
): Effect.Effect<void, never> {
  const pairing = trace.pairing;
  if (pairing === undefined) return Effect.void;
  const unpaired = pairing.unpairedCallIds.length > 0;
  return emitGuardFired({
    taskId,
    iteration,
    guard: TOOL_RESULT_PAIRING_GUARD,
    outcome: "warn",
    reason: unpaired
      ? "tool_use without a tool result in the projected thread"
      : "tool result projected from its message: stored ref missing from the scratchpad",
    metadata: { unpairedCallIds: pairing.unpairedCallIds, recoveredRefs: pairing.recoveredRefs },
  });
}

/**
 * The act reminder ("You have tool results above …") claims results the model
 * can read. It renders only when the projected thread carries a tool result;
 * otherwise it is dropped and the rest of the guidance is unchanged.
 */
export function guidanceForProjectedThread(
  guidance: PendingGuidance,
  messages: ProviderRequest["messages"],
): PendingGuidance {
  if (guidance.actReminder === undefined) return guidance;
  if (messages.some((m) => m.role === "tool_result")) return guidance;
  const { actReminder: _dropped, ...rest } = guidance;
  return rest;
}
