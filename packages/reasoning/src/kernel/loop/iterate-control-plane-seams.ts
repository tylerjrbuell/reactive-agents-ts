/**
 * iterate-control-plane-seams.ts — the three in-loop control-plane proposal
 * seams (F3 repeated-identical-failure, stall guard, F1 strategy-switch),
 * decomposed VERBATIM from iterate-pass.ts (quality program Task 9 / GH #222;
 * formerly lines 1242-1287, 1397-1438, 1673-1716).
 *
 * Each seam builds its typed ControlProposals, resolves them through the
 * single-decider resolver (kernel/control/control-plane.ts), and emits the
 * resolution. None of these helpers FORCES a control action — the resolver is
 * the decider; the helpers only surface whether `abstain` won so the DRIVER
 * performs the single-owner terminate() break (the `return "break"` at each
 * winning-abstain branch adapts to a returned `abstained: true` flag — the
 * only control-flow deviation from the verbatim bodies).
 */
import { Effect } from "effect";
import { sentinelDeliverable } from "@reactive-agents/core";
import type { KernelInput, KernelRunOptions } from "../state/kernel-state.js";
import { resolveControlPlane, type ControlProposal } from "../control/control-plane.js";
import {
  proposeFromErrorRecovery,
  proposeFromLoopDetector,
  proposeFromStallGuard,
} from "../control/emitters.js";
import { enumerationIncompleteProposal, inLoopAbstentionProposal } from "../control/abstention-proposal.js";
import { emitControlResolution } from "../utils/diagnostics.js";
import { terminate } from "./terminate.js";
import type { LaneDecision } from "../utils/lane-controller.js";
import { transitionState, type KernelState } from "../../kernel/state/kernel-state.js";
import type { HorizonProfile } from "./runner-helpers/horizon-profile.js";
import type {
  detectRepeatedIdenticalToolFailure,
  getToolFailureRecovery,
} from "./runner-helpers/recovery-steering.js";

/** F3 seam — repeated-identical-failure proposals vs abstain (former lines 1242-1287). */
export function resolveF3ControlPlane(args: {
  state: KernelState;
  readonly currentInput: KernelInput;
  readonly requiredTools: readonly string[];
  readonly currentOptions: KernelRunOptions;
  readonly horizon: HorizonProfile;
  readonly repeated: NonNullable<ReturnType<typeof detectRepeatedIdenticalToolFailure>>;
  readonly repeatedRecovery: ReturnType<typeof getToolFailureRecovery>;
  readonly guidance: string;
}): Effect.Effect<{ state: KernelState; abstained: boolean }, never, never> {
  return Effect.gen(function* () {
    let state = args.state;
    const { currentInput, requiredTools, currentOptions, horizon, repeated, repeatedRecovery, guidance } = args;
            // ── Control plane (F3 seam) — resolve redirect vs abstain ──────────
            // This seam used to FORCE its redirect and `return "continue"`, so the
            // in-loop abstain signal (built only at the strategy-switch seam, which
            // needs the loop detector to trip) never got to compete. The resolver's
            // documented total order ranks abstain(1) STRICTLY above redirect(4):
            // a run whose grounding is structurally impossible must decline
            // honestly, not be re-steered until the redirect budget runs out. Same
            // precedence inversion as P5, at a different seam.
            //
            // `proposeFromErrorRecovery` had zero production callers before this —
            // it was unit-tested in emitters.test.ts and never invoked. OFF the
            // long-horizon profile the block is skipped entirely, so the default
            // path is byte-identical (the redirect fires exactly as today).


              const recoveryProposal = proposeFromErrorRecovery({
                repeatedFailureTool: repeated.toolName,
                errorClass: repeated.errorClass,
                failedTools: repeatedRecovery.failedUnresolved,
                guidance,
                horizonActive: true,
                assessment: state.meta.assessment,
              });
              const { proposal: abstainProposal, forced } = inLoopAbstentionProposal(
                state,
                currentInput,
                requiredTools,
                currentOptions.maxIterations,
              );
              const enumProposal = enumerationIncompleteProposal(
                state.meta.runContract, state.meta.assessment, horizon !== undefined,
              );
              const proposals: ControlProposal[] = [];
              if (recoveryProposal) proposals.push(recoveryProposal);
              if (abstainProposal) proposals.push(abstainProposal);
              if (enumProposal) proposals.push(enumProposal);
              if (proposals.length > 0) {
                const resolution = resolveControlPlane(proposals);
                yield* emitControlResolution({
                  taskId: currentOptions.taskId ?? state.taskId,
                  iteration: state.iteration,
                  action: resolution.action,
                  reason: resolution.reason,
                  proposals: proposals.map((p) => ({ source: p.source, action: p.action })),
                });
                if (resolution.action === "abstain" && forced !== null) {
                  // Abstain won — stand down the redirect (its counter was never
                  // committed) and force the honest decline through the
                  // single-owner terminate() abstain path, exactly as the
                  // strategy-switch seam does.
                  state = transitionState(state, { error: null });
                  state = terminate(state, {
                    reason: "abstained",
                    deliverable: sentinelDeliverable("no_substantive_output", forced.reason),
                    extraMeta: {
                      abstention: { reason: forced.reason, missing: forced.missing },
                    },
                  });
                  return { state, abstained: true };
                }
              }
    return { state, abstained: false };
  });
}

/** Stall-guard seam — steer/deliver proposals vs abstain (former lines 1397-1438). */
export function resolveStallControlPlane(args: {
  state: KernelState;
  readonly currentInput: KernelInput;
  readonly requiredTools: readonly string[];
  readonly currentOptions: KernelRunOptions;
  readonly horizon: HorizonProfile;
  readonly laneDecision: LaneDecision;
}): Effect.Effect<{ state: KernelState; abstained: boolean }, never, never> {
  return Effect.gen(function* () {
    let state = args.state;
    const { currentInput, requiredTools, currentOptions, horizon, laneDecision } = args;
      // ── Control plane (stall seam) — resolve steer vs abstain ───────────────
      // Same precedence inversion as the F3 seam. `runStallDeliverableStep`
      // forces its own action: a `steer` (required-tool nudge / recovery
      // steering) or a harness-deliverable `terminate`. Both rank BELOW `abstain`
      // in the resolver's total order (abstain(1) < terminate(2) < steer(5)), yet
      // a run with no deliverable and exhausted ungrounded-synthesis retries — one
      // that provably cannot ground its answer — was nudged instead of declining.
      //
      // `proposeFromStallGuard` exists for exactly this seam and had zero
      // production callers (every reference lived in emitters.test.ts). OFF the
      // long-horizon profile the block is skipped, so the default path is
      // byte-identical.


        const stallProposal = proposeFromStallGuard({
          stallTriggered: true,
          missingRequiredTools: laneDecision.missingRequiredTools,
          horizonActive: true,
          assessment: state.meta.assessment,
        });
        const { proposal: abstainProposal, forced } = inLoopAbstentionProposal(
          state,
          currentInput,
          requiredTools,
          currentOptions.maxIterations,
        );
        const enumProposal = enumerationIncompleteProposal(
          state.meta.runContract, state.meta.assessment, horizon !== undefined,
        );
        const proposals: ControlProposal[] = [];
        if (stallProposal) proposals.push(stallProposal);
        if (abstainProposal) proposals.push(abstainProposal);
        if (enumProposal) proposals.push(enumProposal);
        if (proposals.length > 0) {
          const resolution = resolveControlPlane(proposals);
          yield* emitControlResolution({
            taskId: currentOptions.taskId ?? state.taskId,
            iteration: state.iteration,
            action: resolution.action,
            reason: resolution.reason,
            proposals: proposals.map((p) => ({ source: p.source, action: p.action })),
          });
          if (resolution.action === "abstain" && forced !== null) {
            // Abstain won — stand down the stall guard and decline honestly via
            // the single-owner terminate() abstain path.
            state = transitionState(state, { error: null });
            state = terminate(state, {
              reason: "abstained",
              deliverable: sentinelDeliverable("no_substantive_output", forced.reason),
              extraMeta: {
                abstention: { reason: forced.reason, missing: forced.missing },
              },
            });
            return { state, abstained: true };
          }
        }
    return { state, abstained: false };
  });
}

/** F1 strategy-switch seam — switch proposal vs abstain (the P5 fix) (former lines 1673-1716). */
export function resolveSwitchControlPlane(args: {
  state: KernelState;
  readonly currentInput: KernelInput;
  readonly requiredTools: readonly string[];
  readonly currentOptions: KernelRunOptions;
  readonly horizon: HorizonProfile;
}): Effect.Effect<{ state: KernelState; abstained: boolean }, never, never> {
  return Effect.gen(function* () {
    let state = args.state;
    const { currentInput, requiredTools, currentOptions, horizon } = args;
              // ── Control plane (F1) — resolve switch vs abstain (the P5 fix) ──
              // Before F1 the strategy switch fired here unconditionally while
              // forced abstention only ran POST-loop (§7.5), so a run that
              // qualified for BOTH switched first and burned a strategy's budget
              // only to abstain later (the P5 race). Now the switch is ONE
              // proposal; under the long-horizon profile the in-loop abstain
              // signal is another; the resolver's documented total order ranks
              // abstain STRICTLY above strategy-switch, so an honest decline
              // pre-empts the wasted switch. OFF the profile → the block is
              // skipped entirely → byte-identical (switch proceeds as today).


                const switchProposal = proposeFromLoopDetector({
                  loopDetected: true,
                  switchingViable: true,
                  horizonActive: true,
                  assessment: state.meta.assessment,
                });
                const { proposal: abstainProposal, forced } = inLoopAbstentionProposal(
                  state,
                  currentInput,
                  requiredTools,
                  currentOptions.maxIterations,
                );
                const enumProposal = enumerationIncompleteProposal(
                  state.meta.runContract, state.meta.assessment, horizon !== undefined,
                );
                const proposals: ControlProposal[] = [];
                if (switchProposal) proposals.push(switchProposal);
                if (abstainProposal) proposals.push(abstainProposal);
                if (enumProposal) proposals.push(enumProposal);
                if (proposals.length > 0) {
                  const resolution = resolveControlPlane(proposals);
                  yield* emitControlResolution({
                    taskId: currentOptions.taskId ?? state.taskId,
                    iteration: state.iteration,
                    action: resolution.action,
                    reason: resolution.reason,
                    proposals: proposals.map((p) => ({ source: p.source, action: p.action })),
                  });
                  if (resolution.action === "abstain" && forced !== null) {
                    // Abstain won — stand down the switch and force the honest
                    // decline via the single-owner terminate() abstain path
                    // (identical mechanics to runner §7.5; the post-loop block
                    // then skips because terminatedBy === "abstained").
                    state = transitionState(state, { error: null });
                    state = terminate(state, {
                      reason: "abstained",
                      deliverable: sentinelDeliverable("no_substantive_output", forced.reason),
                      extraMeta: {
                        abstention: { reason: forced.reason, missing: forced.missing },
                      },
                    });
                    return { state, abstained: true };
                  }
                }
    return { state, abstained: false };
  });
}
