/**
 * act/round-exit.ts — the ONE place an act round's accumulated state is
 * folded into the state a round returns.
 *
 * `handleActing` has several exits that end a round early (the before/after
 * `act` and `observe` killswitch hooks). Each used to hand-build
 * `{ ...state, ledger: <checklist only>, status, meta }`, silently dropping
 * the round's observation steps, tools used, artifact facts, gather-dedup
 * signals and meta-tool dedup counters. Every such exit now routes through
 * {@link finalizeKillswitchExit}; the normal exit shares
 * {@link deriveRoundLedger} so both seed the ledger identically.
 *
 * Debt: D-2026-10-28-ACT-EXIT.
 */
import { Effect } from "effect";
import type { Option } from "effect";
import { resolveProduces, type ProducesKind } from "@reactive-agents/tools";
import { deriveArtifactEntries } from "../../ledger/artifact-projection.js";
import type { LedgerEntryInput, RunLedger } from "../../ledger/run-ledger.js";
import { recordRequirementsDeclared, seedRoundFacts } from "../../ledger/emit.js";
import { declarePlanOutputs } from "../../contract/plan-declared.js";
import type { RunPosture } from "@reactive-agents/core";
import { detectDuplicateGathers, dedupSignalEntries } from "../../../assembly/gather-dedup.js";
import { commitRound, type ChecklistRound } from "./checklist-round.js";
import { killswitchTerminatedBy, type HookAbort } from "../../loop/phase-hooks.js";
import type { KernelState, ToolServiceInstance } from "../../state/kernel-state.js";
import type { ToolCallSpec } from "@reactive-agents/tools";
import type { ReasoningStep } from "../../../types/index.js";

/** Everything a round has accumulated so far, read at exit time. */
export interface RoundSnapshot {
  readonly state: KernelState;
  readonly round: ChecklistRound;
  readonly steps: readonly ReasoningStep[];
  readonly toolsUsed: ReadonlySet<string>;
  readonly lastMetaToolCall: string | undefined;
  readonly consecutiveMetaToolCount: number;
  readonly toolService: Option.Option<ToolServiceInstance>;
  /** The run's posture (`plan` declares no output files — see contract/plan-declared.ts). */
  readonly posture?: RunPosture;
}

/**
 * The run contract after this round: widened with the output files named by
 * the `todo` items this round ADDED (source `plan-declared`). Only round-staged
 * changes count, so seeded prior-turn items and merged sub-agent facts never
 * declare. Same reference when nothing new is declared.
 */
function roundContract(snap: RoundSnapshot): KernelState["meta"]["runContract"] {
  return declarePlanOutputs(
    snap.state.meta.runContract,
    snap.round.staged.map((s) => s.change),
    snap.posture,
  );
}

/**
 * The meta a round returns: `state.meta` with the run contract widened by
 * {@link roundContract}. Returns `state.meta` itself when nothing is declared.
 */
export function roundMeta(snap: RoundSnapshot): KernelState["meta"] {
  const runContract = roundContract(snap);
  return runContract === snap.state.meta.runContract ? snap.state.meta : { ...snap.state.meta, runContract };
}

/** Gather-dedup `harness-signal` entries for the calls a round dispatched. */
export function roundDedupSignals(
  state: KernelState,
  calls: readonly ToolCallSpec[],
): readonly LedgerEntryInput[] {
  return dedupSignalEntries(
    detectDuplicateGathers(
      state.ledger,
      calls.map((tc) => ({
        toolName: tc.name,
        args: tc.arguments as Record<string, unknown> | undefined,
        toolCallId: tc.id,
      })),
    ),
    state.iteration + 1,
  );
}

/**
 * The round's ledger: prior ledger + artifact facts (declared `produces`,
 * live registry first) + gather-dedup signals + the committed checklist.
 * Returns `state.ledger` unchanged when the round added nothing.
 */
export function deriveRoundLedger(
  snap: RoundSnapshot,
  dedupSignals: readonly LedgerEntryInput[],
): Effect.Effect<RunLedger | undefined> {
  return Effect.gen(function* () {
    const { state, round, steps, toolService } = snap;
    const roundNewSteps = steps.slice(state.steps.length);
    // FM-15: prefer the LIVE registry's `produces` declaration; fall back to
    // the static builtin map. Absent/unknown yields "data" (safe false-UNMET).
    const declaredProduces = new Map<string, ProducesKind>();
    if (toolService._tag === "Some") {
      const roundToolNames = new Set<string>();
      for (const step of roundNewSteps) {
        const tc = step.metadata?.toolCall as { name?: unknown } | undefined;
        if (typeof tc?.name === "string" && tc.name.length > 0) roundToolNames.add(tc.name);
      }
      for (const toolName of roundToolNames) {
        const declared = yield* toolService.value.getTool(toolName).pipe(
          Effect.map((d) => d.produces),
          Effect.catchAll(() => Effect.succeed(undefined)),
        );
        if (declared !== undefined) declaredProduces.set(toolName, declared);
      }
    }
    const producesResolver = (toolName: string): ProducesKind =>
      declaredProduces.get(toolName) ?? resolveProduces(toolName);

    const artifactInputs = deriveArtifactEntries(roundNewSteps, producesResolver, state.iteration + 1);
    const seeded = seedRoundFacts(seedRoundFacts(state.ledger, artifactInputs), dedupSignals);
    const committed = commitRound(round, seeded, state.iteration + 1);
    // Plan-declared files get the same DECLARED lifecycle fact the runner mints
    // for compile-time requirements (idempotent by id).
    const contract = roundContract(snap);
    if (contract === undefined || contract === state.meta.runContract) return committed;
    const declared = contract.requirements.filter((r) => r.spec.source === "plan-declared");
    return recordRequirementsDeclared(
      committed,
      declared.map((r) => ({ id: r.id, description: r.spec.description, kind: r.kind })),
      state.iteration + 1,
    );
  });
}

/**
 * Finalize a killswitch exit: the abort status + `terminatedBy`, PLUS the
 * round's observation steps, tools used, meta-tool dedup counters and the full
 * round ledger. `calls` are the tool calls this round actually dispatched
 * (gather-dedup is judged only over those).
 */
export function finalizeKillswitchExit(
  snap: RoundSnapshot,
  ctrl: HookAbort,
  calls: readonly ToolCallSpec[],
): Effect.Effect<KernelState> {
  return Effect.map(
    deriveRoundLedger(snap, roundDedupSignals(snap.state, calls)),
    (ledger) => ({
      ...snap.state,
      steps: snap.steps,
      toolsUsed: snap.toolsUsed,
      lastMetaToolCall: snap.lastMetaToolCall,
      consecutiveMetaToolCount: snap.consecutiveMetaToolCount,
      ledger,
      status: ctrl.abort === "terminate" ? ("failed" as const) : ("done" as const),
      meta: {
        ...roundMeta(snap),
        terminatedBy: killswitchTerminatedBy(ctrl),
      },
    }),
  );
}
