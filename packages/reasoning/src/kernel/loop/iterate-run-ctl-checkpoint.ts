/**
 * iterate-run-ctl-checkpoint.ts — RunController pass-boundary seams,
 * decomposed VERBATIM from iterate-pass.ts (quality program Task 9 / GH #222;
 * formerly lines 416-473 and 863-921).
 *
 * Owns, for one pass: the pause/stop checkpoint (terminate on `ctl.stop`), the
 * durable-execution `onCheckpoint` observer, the live-inspection
 * `noteCheckpoint` seam (pre- and post-phase), and the post-gate paused-state
 * checkpoint for durable HITL resume. Bodies are byte-identical modulo the
 * spine `state` binding and destructured params; the only control-flow
 * adaptation is the stop-branch `return "break"` becoming a returned
 * `stopped: true` flag the driver honors (W4.0 single-writer shape preserved —
 * the carrier write-back in iterate-pass.ts is untouched).
 */
import { Effect } from "effect";
import type { RunControllerLike } from "@reactive-agents/core";
import { terminate } from "./terminate.js";
import { serializeKernelState } from "../state/kernel-codec.js";
import { passthroughOutputDeliverable } from "./runner-helpers/deliverable.js";
import { type KernelState } from "../../kernel/state/kernel-state.js";

/** Pause/stop checkpoint + durable/live-inspection observers (former lines 416-473). */
export function runPassBoundaryCheckpoint(args: {
  state: KernelState;
  readonly _runCtl: RunControllerLike;
}): Effect.Effect<{ state: KernelState; stopped: boolean }, never, never> {
  return Effect.gen(function* () {
    let state = args.state;
    const { _runCtl } = args;

        const ctl = yield* Effect.promise(() => _runCtl.checkpoint());
        if (ctl?.stop) {
          // Sprint-1 B2 / P1 mission 2B: typed DeliverableProvenance channel.
          // Stop-checkpoint is a user-initiated termination — route through the
          // single-owner terminate() (status/terminatedBy) which delegates the
          // output string to commitDeliverable. Preserve any prior committed
          // output as a passthrough; an empty output becomes a structured
          // sentinel (NOT a raw empty string).
          //
          // FM-5 (Phase 4 Task 4): a hard terminate() (RunHandle.terminate())
          // is distinguished from a graceful stop() via `ctl.terminate` — both
          // exit the loop here, before the next provider call, but the reason
          // differs so `state.meta.terminatedBy` doesn't mislabel an abort as
          // a graceful stop (see terminate-reason.ts).
          state = terminate(state, {
            reason: ctl.terminate ? "terminate_requested" : "stop_requested",
            deliverable: passthroughOutputDeliverable(state.output),
          });
          return { state, stopped: true };
        }
        // Durable-execution seam (v0.12.0 track 1): surface the iteration-boundary
        // state to an optional durable controller. Observer must NEVER kill the
        // loop — failures are warn-surfaced (R11 precedent), not propagated.
        //
        // `checkpointState`/`checkpointIteration` capture the CURRENT (immutable)
        // state value now — the outer `state` binding is reassigned later this
        // same pass (`state = yield* kernel(...)` below), so closing over `state`
        // directly in a deferred thunk would silently serialize a LATER state.
        // KernelState values themselves never mutate, so this ref is safe to
        // close over lazily.
        const checkpointState = state;
        const checkpointIteration = checkpointState.iteration;
        // Live-inspection seam (Arc 1 Task 5): always-on, independent of
        // `onCheckpoint`/durability. `serializeOnce` memoizes so a durable run
        // (onCheckpoint present) reuses the SAME already-computed string for
        // both observers instead of serializing twice; a non-durable run
        // (onCheckpoint absent) pays ZERO serialization cost unless a caller
        // later invokes `RunHandle.inspect()`, which invokes this thunk.
        let checkpointSerialized: string | undefined;
        const serializeOnce = (): string =>
          checkpointSerialized ?? (checkpointSerialized = serializeKernelState(checkpointState));

        if (_runCtl.onCheckpoint) {
          try {
            _runCtl.onCheckpoint(serializeOnce(), checkpointIteration);
          } catch (err) {
            const msg = `[durable-checkpoint] onCheckpoint observer threw at iteration ${checkpointIteration}: ${err instanceof Error ? err.message : String(err)}`;
            yield* Effect.logWarning(msg);
          }
        }
        if (_runCtl.noteCheckpoint) {
          try {
            _runCtl.noteCheckpoint(serializeOnce, checkpointIteration);
          } catch (err) {
            const msg = `[live-inspect] noteCheckpoint observer threw at iteration ${checkpointIteration}: ${err instanceof Error ? err.message : String(err)}`;
            yield* Effect.logWarning(msg);
          }
        }
    return { state, stopped: false };
  });
}

/** Post-phase live-inspection seam + durable HITL paused-state checkpoint (former lines 863-921). Read-only over `state`. */
export function runPostPhaseCheckpointSeams(args: {
  readonly state: KernelState;
  readonly _runCtl: RunControllerLike | null;
}): Effect.Effect<void, never, never> {
  return Effect.gen(function* () {
    const { state, _runCtl } = args;

      // Live-inspection seam, post-phase (Arc 1 Task 5): surface the state the
      // kernel phase just produced — steps appended, iteration incremented,
      // meta.lastThought / meta.pendingNativeToolCalls populated. The
      // pass-boundary seam above only captures the PRE-phase state, which for
      // runs that resolve within few passes (streamed single-exchange answers,
      // single-tool tasks) leaves `RunHandle.inspect()` permanently showing the
      // pristine iteration-0 snapshot. The thunk is LAZY (serialization only
      // happens if `inspect()` is called), so firing at both points costs a
      // closure allocation and nothing more. `onCheckpoint` (durable writes)
      // deliberately does NOT fire here — the durable rail stays
      // boundary-only; resume semantics are unchanged.
      if (_runCtl?.noteCheckpoint) {
        // Capture-now: `state` is reassigned later this pass (hooks, guards,
        // arbitrator) — the deferred thunk must close over THIS value.
        const postPhaseState = state;
        try {
          _runCtl.noteCheckpoint(
            () => serializeKernelState(postPhaseState),
            postPhaseState.iteration,
          );
        } catch (err) {
          yield* Effect.logWarning(
            `[live-inspect] post-phase noteCheckpoint threw at iteration ${postPhaseState.iteration}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // Durable HITL (Phase D): when the act gate paused the run, checkpoint the
      // PAUSED state NOW — the per-iteration onCheckpoint above fires at the pass
      // BOUNDARY (before think/act), so it never captures the post-gate state that
      // carries `meta.awaitingApprovalFor` + the pending call. Without this, resume
      // restores a pre-gate checkpoint, the runner re-entry finds no
      // `awaitingApprovalFor`, and the gate re-fires instead of executing the
      // approved call. Fire-and-forget through the same observer contract (never
      // kills the loop). The loop exits immediately after (status:"done").
      // Durable pause (Task 9): a `request_user_input` interaction pause needs
      // the identical post-gate checkpoint — same rationale, mirrors
      // `meta.awaitingInteractionFor` instead of `awaitingApprovalFor`.
      if (
        (state.meta.terminatedBy === "awaiting-approval" ||
          state.meta.terminatedBy === "awaiting-interaction") &&
        _runCtl?.onCheckpoint
      ) {
        try {
          // Write at iteration+1 so this is a DISTINCT row that always wins
          // `latestCheckpoint` (ORDER BY iteration DESC) — the pass-boundary
          // checkpoint above writes the pre-gate state at this same iteration, and
          // both go through fire-and-forget `Effect.runFork`, so a same-iteration
          // write would race. The stateJson keeps its real iteration; the column
          // is only an ordering key. Resume reads the stateJson, not the column.
          // (The live-inspection seam needs no mirror call here — the post-phase
          // noteCheckpoint above already captured this same post-gate state.)
          _runCtl.onCheckpoint(serializeKernelState(state), state.iteration + 1);
        } catch (err) {
          yield* Effect.logWarning(
            `[durable-checkpoint] paused-state onCheckpoint threw at iteration ${state.iteration}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
  });
}
