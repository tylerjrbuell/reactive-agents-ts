/**
 * act/round-hooks.ts — the hooks that close an act round: `after act`, then
 * `before observe`, the round ledger, then `after observe`.
 *
 * Each hook sees the round's merged state ({@link roundHookState}): the
 * observation steps and tools this round just ran, the assembled
 * conversation and scratchpad, and (for `after observe`) the round ledger.
 * Earlier these hooks got the state from act entry, so an `after act` hook
 * could not see the tool it had just run. `iteration` stays the round's own
 * turn number, the same one `before act` reports.
 *
 * Why `observe` fires here: the tool's observation steps are appended and the
 * conversation context is assembled, so this IS the observe phase the
 * 12-phase lifecycle documents ("append tool results, curate context", a
 * loop-body phase). The kernel used to fire `observe` once per RUN, from the
 * outer engine's synthetic end-of-run pair, so a user hook on `observe` never
 * saw a tool result during the loop.
 *
 * Any hook abort ends the round through {@link finalizeKillswitchExit}, which
 * keeps the round's state.
 */
import { Effect } from "effect";
import type { HarnessPipeline, Phase } from "@reactive-agents/core";
import type { ToolCallSpec } from "@reactive-agents/tools";
import type { LedgerEntryInput, RunLedger } from "../../ledger/run-ledger.js";
import type { KernelState } from "../../state/kernel-state.js";
import { runPhaseHooks } from "../../loop/phase-hooks.js";
import { deriveRoundLedger, finalizeKillswitchExit, roundMeta, type RoundSnapshot } from "./round-exit.js";

/** What the round has assembled beyond the {@link RoundSnapshot}. */
export interface RoundAssembly {
  readonly messages: KernelState["messages"];
  readonly scratchpad: KernelState["scratchpad"];
}

/**
 * The state a round-close hook sees: act-entry state with the round's steps,
 * tools used, meta-tool counters, run contract, conversation and scratchpad
 * merged in. `status` and `iteration` are unchanged (the round has not
 * transitioned yet).
 */
export function roundHookState(snap: RoundSnapshot, assembly: RoundAssembly, ledger?: RunLedger): KernelState {
  return {
    ...snap.state,
    steps: snap.steps,
    toolsUsed: snap.toolsUsed,
    lastMetaToolCall: snap.lastMetaToolCall,
    consecutiveMetaToolCount: snap.consecutiveMetaToolCount,
    meta: roundMeta(snap),
    messages: assembly.messages,
    scratchpad: assembly.scratchpad,
    ...(ledger !== undefined ? { ledger } : {}),
  };
}

/** A round closed by its hooks: either a killswitch exit, or the round ledger. */
export type RoundClose =
  | { readonly _tag: "exit"; readonly state: KernelState }
  | { readonly _tag: "settled"; readonly ledger: RunLedger | undefined };

/**
 * Fire the round-close hooks over the merged round state and derive the round
 * ledger between `before observe` and `after observe`.
 *
 * @param pipeline - the run's harness pipeline (no pipeline: no hooks).
 * @param snap - the round's accumulated state.
 * @param assembly - the round's conversation and scratchpad.
 * @param calls - the calls this round dispatched (gather-dedup is judged over these).
 * @param dedupSignals - this round's gather-dedup ledger signals.
 */
export function closeRound(
  pipeline: HarnessPipeline | undefined,
  snap: RoundSnapshot,
  assembly: RoundAssembly,
  calls: readonly ToolCallSpec[],
  dedupSignals: readonly LedgerEntryInput[],
): Effect.Effect<RoundClose> {
  return Effect.gen(function* () {
    const fire = (kind: "before" | "after", phase: Phase, ledger?: RunLedger) =>
      Effect.promise(() =>
        runPhaseHooks(pipeline, kind, phase, snap.state.iteration, roundHookState(snap, assembly, ledger)),
      );
    const exit = (ctrl: NonNullable<Effect.Effect.Success<ReturnType<typeof fire>>>) =>
      Effect.map(finalizeKillswitchExit(snap, ctrl, calls), (state): RoundClose => ({ _tag: "exit", state }));

    const afterAct = yield* fire("after", "act");
    if (afterAct) return yield* exit(afterAct);
    const beforeObserve = yield* fire("before", "observe");
    if (beforeObserve) return yield* exit(beforeObserve);
    // ── Artifact truth (Wave C / C2, audit 01-F1) ────────────────────────────
    // Emit `artifact` ledger entries for files this round produced, recognized
    // by the tool's DECLARED `produces` field (resolveProduces) + the per-
    // builtin path-extraction contract — not the old 4-name/15-key heuristic.
    // Seeded via patch.ledger (the same seam the terminal-verdict/claim
    // emitters use); the C1 chokepoint then appends this round's step-derived
    // tool-invocation/tool-result entries on top. The chokepoint itself is
    // untouched (C1 owns it). Only the NEW steps of this round are scanned.
    const ledger = yield* deriveRoundLedger(snap, dedupSignals);
    // 'after observe' closes the pair once the round's ledger curation is done.
    const afterObserve = yield* fire("after", "observe", ledger);
    if (afterObserve) return yield* exit(afterObserve);
    return { _tag: "settled", ledger };
  });
}
