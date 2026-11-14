// File: src/kernel/loop/enumeration-abstain-exit.ts
/**
 * The control plane's enumeration `abstain`, acted on.
 *
 * An enumeration requirement ("answer expects 6 items") that has stalled past
 * its patience (`enumerationStallPatience`, emitters.ts) wins the resolver as
 * `abstain`, but the seams only acted on an abstain when the grounding-based
 * `forced` decision was non-null, and `forced` is null for an enumeration. The
 * decision was emitted every iteration and ignored (campaign trace
 * 01M7BMXFY8350ZFQQQTF63DAEQ: iterations 12 to 47 resolved `abstain`, the run
 * burned to the cap).
 *
 * This is the one place that acts on it. Like every guard it PROPOSES and the
 * exit gate disposes: a `cap` proposal (a bound that ran out, never denied)
 * that names the incomplete requirement as outstanding. With material the run
 * hands off (the model's draft ships as a labelled partial with the
 * `Unfinished:` list, otherwise `failed` with the gathered evidence attached
 * raw); with none the honest failure stands. The harness never writes the
 * missing items.
 */
import { Effect } from "effect";
import type { ControlProposal } from "../control/control-plane.js";
import { proposeExit, type ExitDisposition } from "./exit-gate.js";
import { assembleDeliverable, deliverableTerminationReason } from "./runner-helpers/deliverable.js";
import type { KernelInput, KernelRunOptions, KernelState } from "../state/kernel-state.js";

/** The proposal source the enumeration emitter stamps (emitters.ts). */
export const ENUMERATION_PROPOSAL_SOURCE = "enumeration-incomplete";

/** Propose the honest end of a run whose enumeration requirement cannot make progress. */
export function proposeEnumerationAbstainExit(args: {
  readonly state: KernelState;
  readonly input: KernelInput;
  readonly options: KernelRunOptions;
  readonly winner: ControlProposal;
}): Effect.Effect<ExitDisposition, never, never> {
  const { state, input, options, winner } = args;
  const d = assembleDeliverable(state);
  const unfinished = `satisfy the requirement (${winner.remedy?.detail ?? winner.reason})`;
  return proposeExit({
    state,
    proposal: {
      proposedBy: "stall_deliverable",
      kind: "cap",
      reason: deliverableTerminationReason(d),
      deliverable: d,
      extraMeta: { terminalSite: "enumeration-abstain" },
      outstanding: [unfinished],
      failure: { error: `Enumeration requirement cannot make progress: ${winner.reason}` },
      guardEvent: {
        guard: "stall_deliverable",
        reason: "enumeration_incomplete",
        metadata: { resolution: winner.reason },
      },
    },
    input,
    maxIterations: options.maxIterations,
    taskId: options.taskId ?? state.taskId,
  });
}
