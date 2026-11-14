// File: src/kernel/loop/broken-tool-exit.ts
/**
 * The "broken-tool-exit" turn operation: a REQUIRED tool that keeps failing ends
 * the run honestly instead of burning iterations to the cap.
 *
 * The requirement is unsatisfiable once the tool has failed
 * {@link GIVE_UP_STREAK} times in a row with no success (`tool-health.ts`, the
 * one predicate the guidance text reads too). The guidance window is the gap
 * between BROKEN_TOOL_STREAK (guidance names the tool as unavailable and never
 * says "retry") and the give-up streak.
 *
 * Like every guard, this PROPOSES; the exit gate disposes. It is a `cap`
 * proposal (a bound that ran out, never denied): with material the run hands off
 * (a model draft ships as a labelled partial, otherwise `failed` with the
 * gathered evidence attached raw); with none the guard's own failure stands.
 * The gate itself names the unavailable tool in the outstanding list of EVERY
 * exit (`exit-gate.ts`, from the same predicate), so the result says "tool X
 * unavailable" rather than a bare stall. Proposer `required_tool_quota` (the
 * existing proposer for an unmeetable required-tool quota), guard event reason
 * `required_tool_unavailable`, `terminatedBy` `required_tool_quota`.
 */
import { Effect } from "effect";
import { proposeExit, type ExitDisposition } from "./exit-gate.js";
import { assembleDeliverable, deliverableTerminationReason } from "./runner-helpers/deliverable.js";
import { GIVE_UP_STREAK, unavailableRequiredTools } from "./runner-helpers/tool-health.js";
import { guardEvidence } from "../utils/guard-evidence.js";
import type { KernelInput, KernelRunOptions, KernelState } from "../state/kernel-state.js";

/**
 * Propose the unsatisfiable-requirement exit, or return `null` when no required
 * tool has been given up on (or the run already ended).
 */
export function proposeBrokenToolExit(args: {
  readonly state: KernelState;
  readonly input: KernelInput;
  readonly options: KernelRunOptions;
}): Effect.Effect<ExitDisposition | null, never, never> {
  return Effect.gen(function* () {
    const { state, input, options } = args;
    if (state.status === "done" || state.status === "failed") return null;
    const unavailable = unavailableRequiredTools(state, input);
    const worst = unavailable[0];
    if (worst === undefined) return null;
    const d = assembleDeliverable(state);
    const names = unavailable.map((b) => b.toolName).join(", ");
    return yield* proposeExit({
      state,
      proposal: {
        proposedBy: "required_tool_quota",
        kind: "cap",
        reason: deliverableTerminationReason(d),
        deliverable: d,
        extraMeta: { terminalSite: "broken-tool-exit" },
        failure: { error: `Required tool unavailable: ${names} (failed ${worst.failureStreak} consecutive attempts); the requirement cannot be satisfied.` },
        guardEvent: {
          guard: "required_tool_quota",
          reason: "required_tool_unavailable",
          metadata: {
            tools: unavailable.map((b) => b.toolName),
            routedVia: unavailable.flatMap((b) => (b.routedVia === undefined ? [] : [b.routedVia])),
            ...guardEvidence("failureStreak", worst.failureStreak, GIVE_UP_STREAK),
          },
        },
      },
      input,
      maxIterations: options.maxIterations,
      taskId: options.taskId ?? state.taskId,
    });
  });
}
