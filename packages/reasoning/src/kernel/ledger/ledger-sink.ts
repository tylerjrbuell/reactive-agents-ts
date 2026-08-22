/**
 * The announced ledger seam (Wave C.2 slice 3b-ii).
 *
 * 09 §3 C1 rules that the RunLedger is the substrate and every other view — the
 * trace JSONL, the EventBus stream, `run_events`, steps[] — is a projection of
 * it, with "no second store, ever". The ratified reading
 * ([[wiki/Decisions/2026-07-22-c1-equivalence-invariant]]) makes that a
 * containment invariant whose two halves are READER convergence and **a single
 * write path**.
 *
 * The write-path half had a hole. `check-ledger-writes.sh` fences the append API
 * (`appendEntry`/`appendEntries`) to this directory, but `projectStepsToLedger`
 * — which calls that API from inside the fence — was itself callable from
 * anywhere. So four ledger factories existed where the invariant assumes one:
 * the sanctioned `transitionState` chokepoint plus `inline-act`, `code-action`
 * and `reflexion`, each growing a run ledger that nothing announced.
 *
 * The three unannounced factories produced exactly the divergence C1 exists to
 * kill (GH #188), measured on the real engine before this seam landed:
 *
 *   code-action  object=[tool-invocation, tool-result×2]   stream=[]
 *   reflexion    object=[tool-result×2]                    stream=[requirement, verdict]×2
 *
 * reflexion's two views were DISJOINT — the kernel passes announced their
 * `requirement`/`verdict` entries while the strategy's own step projection went
 * only to result metadata. Neither view contained the other; a reader could not
 * pick a "more complete" one because there wasn't one.
 *
 * `growRunLedger` closes it by making growth and announcement the same act: a
 * caller cannot obtain the grown ledger without the delta having been published.
 * Announcement happens at CONSTRUCTION, not at finalize, so the stream stays
 * live — a terminal reconciler would have made trace consumers wait for run end
 * and would have re-introduced a second, lagging store.
 *
 * Enforcement: `check-ledger-writes.sh` now confines `projectStepsToLedger(` to
 * this directory too. Outside it, this function is the only way to grow a run
 * ledger — one owner module + one grep-able script, per 09 §6.
 */
import { Effect, Option } from "effect";
import type { LedgerEntryAppendedEvent } from "@reactive-agents/core";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { ReasoningStep } from "../../types/index.js";
import type { EventBusInstance } from "../state/kernel-state.js";
import {
  appendEntries,
  ledgerEntriesForEvent,
  type LedgerEntryInput,
  type RunLedger,
} from "./run-ledger.js";
import { projectStepsToLedger } from "./step-projection.js";

/** Matches `kernel-hooks.ts` so an un-named caller attributes identically. */
const DEFAULT_LEDGER_TAP_AGENT_ID = "reasoning-agent";

/** Where a grown ledger's new entries are announced. */
export interface LedgerSinkTarget {
  readonly taskId: string;
  readonly agentId?: string;
  /**
   * The run's event publisher. Optional because a run may legitimately have no
   * bus wired (unit tests, `createLightRuntime`); the ledger still grows, it is
   * simply unobserved. Never throws — publish failures are the caller's to
   * swallow, matching every other tap in the kernel.
   */
  readonly publish?: (event: LedgerEntryAppendedEvent) => Effect.Effect<void, never>;
}

/**
 * Grow a run-scoped ledger from new steps AND announce the delta, as one act.
 *
 * Returns the grown ledger. When the steps project to nothing (thought/plan/
 * reflection steps map to no entries by design — see `step-projection.ts`) the
 * prior ledger is returned unchanged and nothing is published, so a run that
 * records no facts stays byte-identical to what Wave C.1 shipped.
 *
 * `extraEntries` carries facts that are NOT step-derived — today the `artifact`
 * entries `deriveArtifactEntries` mints from a tool's declared `produces:"file"`
 * (artifact-projection.ts). They exist because the step→entry mapping is
 * deliberately generic and cannot know a tool's artifact contract. Routing them
 * through this same seam (rather than letting a caller append them itself) is
 * what keeps the announcement invariant intact: the published delta is the WHOLE
 * growth, so the stream never carries a subset of the object view. They land
 * AFTER the step entries so the recorded order reads as it happened —
 * invocation, result, then the artifact that resulted.
 */
export function growRunLedger(
  prior: RunLedger | undefined,
  newSteps: readonly ReasoningStep[],
  iteration: number,
  target: LedgerSinkTarget,
  extraEntries: readonly LedgerEntryInput[] = [],
): Effect.Effect<RunLedger, never> {
  return Effect.gen(function* () {
    const fromSteps = projectStepsToLedger(prior, newSteps, iteration);
    const grown =
      extraEntries.length > 0 ? appendEntries(fromSteps, extraEntries) : fromSteps;
    const priorLen = prior?.length ?? 0;
    if (grown.length <= priorLen) return grown;

    if (target.publish) {
      yield* target.publish({
        _tag: "LedgerEntryAppended",
        agentId: target.agentId ?? DEFAULT_LEDGER_TAP_AGENT_ID,
        taskId: target.taskId,
        entries: ledgerEntriesForEvent(grown.slice(priorLen)),
        timestamp: Date.now(),
      });
    }
    return grown;
  });
}

/**
 * Build a sink target from an optional EventBus — the shape strategies already
 * hold via `resolveStrategyServices`. Keeps each call site a one-liner, so the
 * announce wiring cannot drift between the paths that use it.
 *
 * A `None` bus yields a target with no publisher: the ledger still grows, it is
 * simply unobserved (unit tests, `createLightRuntime`).
 */
export function ledgerSinkTarget(
  eventBus: Option.Option<EventBusInstance>,
  taskId: string,
  agentId: string | undefined,
  site: string,
): LedgerSinkTarget {
  return Option.match(eventBus, {
    onNone: () => ({ taskId, ...(agentId ? { agentId } : {}) }),
    onSome: (bus) => ({
      taskId,
      ...(agentId ? { agentId } : {}),
      publish: (event: LedgerEntryAppendedEvent) =>
        bus
          .publish(event)
          .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site, tag: errorTag(err) }))),
    }),
  });
}
