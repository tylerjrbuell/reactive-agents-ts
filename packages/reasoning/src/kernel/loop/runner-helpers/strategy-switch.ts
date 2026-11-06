/**
 * runner-helpers/strategy-switch.ts — Shared strategy-switch application.
 *
 * Extracted from `iterate-pass.ts` in WS-6 CORRECTION 5 (2026-05-29). Both the
 * dispatcher-requested switch (`dispatcher-strategy-switch`) and the
 * loop-detector-triggered switch reinitialise the kernel for a new strategy
 * with IDENTICAL machinery:
 *
 *   1. fire `onStrategySwitched` hook
 *   2. build the handoff summary (9-line block)
 *   3. bump switchCount + push the new strategy onto triedStrategies
 *   4. re-seed `currentOptions` with the new strategy + `initialKernelState`
 *   5. inject synthetic "permanently unavailable" observation steps so the new
 *      strategy doesn't rediscover broken tools via wasted retries
 *   6. fold the handoff into `currentInput.priorContext`, drop failed tools
 *      from requiredTools, and rebuild `currentContext`
 *   7. reset the five per-loop counters (prevActionCount, requiredToolRedirects,
 *      consecutiveStalled, prevArtifactCount, failureRecoveryRedirects)
 *
 * Pre-CORRECTION-5 this block was duplicated near-verbatim at two call sites
 * (~80 LOC each). The ONLY differences were the `fromStrategy` fallback and the
 * failure-reason string; both are now explicit parameters.
 *
 * Invariants preserved:
 *   - transitionState() discipline — the synthetic-step append routes through
 *     `transitionState`, never a direct mutation.
 *   - No new state.status writer — `initialKernelState` seeds "thinking"; the
 *     terminate single-owner invariant is untouched (this helper never finalizes).
 */

import { Effect } from "effect";
import { makeStep } from "../../../kernel/capabilities/sense/step-utils.js";
import { authorityOf } from "../../../kernel/capabilities/decide/authority.js";
import { buildHandoff } from "../../../kernel/capabilities/reflect/strategy-evaluator.js";
import { trailingUnresolvedRun } from "../../../kernel/capabilities/reflect/unresolved-steps.js";
import { unresolvedStrikesOf } from "../../capabilities/reason/unresolved-tool-call.js";
import { buildHandoffSummary, CARRIED_OBSERVATION_PREFIX } from "../../../kernel/capabilities/verify/harness-internal-text.js";
import { recordHandoff } from "../../../kernel/ledger/emit.js";
import { emitGuardFired } from "../../utils/diagnostics.js";
import type { RunLedger } from "../../../kernel/ledger/run-ledger.js";
import {
  initialKernelState,
  transitionState,
  type KernelState,
  type KernelContext,
  type KernelInput,
  type KernelRunOptions,
  type KernelHooks,
} from "../../../kernel/state/kernel-state.js";

/**
 * Drop a later `tool-result` entry that duplicates an earlier one's `stepId`
 * (the ledger dual-emit chokepoint re-projects ANY `steps` growth, so carrying
 * an observation already recorded in `priorState.ledger` forward as a `steps`
 * patch would otherwise mint a SECOND fact for the same call), then
 * re-densify `seq` so it stays the ledger's dense, monotonic, append-assigned
 * index (DAG law, run-ledger.ts). Pure — returns a NEW ledger; not an
 * `appendEntry` call, so `check-ledger-writes.sh`'s single-writer boundary is
 * untouched.
 */
function dedupeCarriedToolResults(ledger: RunLedger): RunLedger {
  const seenStepIds = new Set<string>();
  const kept = ledger.filter((e) => {
    if (e.kind !== "tool-result" || e.stepId === undefined) return true;
    if (seenStepIds.has(e.stepId)) return false;
    seenStepIds.add(e.stepId);
    return true;
  });
  return kept.map((e, seq) => ({ ...e, seq }));
}

/**
 * Copy the run-scoped seeds from the pre-switch state onto the reinitialized
 * one. These are the fields the runner seeds ONCE before the loop and that
 * describe the RUN, not the strategy pass: the compiled goal (`runContract`),
 * the delivery conditions both terminal gates read (`postConditions`), the run
 * budget (`budgetLimits`, the live `runBudgetMeter`, `runBudgetLimits`), the
 * run's `nominatedTools`, and the environment
 * and skills context. `harnessPlan` / `horizonProfile` are left out: the plan
 * names a strategy, so it does not survive a strategy change unchanged.
 *
 * `initialKernelState` starts an empty meta bag and the runner never re-seeds
 * mid-loop, so without this a switched kernel ran CONTRACTLESS: no delivery
 * conditions, no assessment, and the exit gate and terminal accepted a "done"
 * with named deliverables unproduced (Plan 9 H3 defect 1, cogito
 * h3-todo-heavy). Absent fields stay absent.
 *
 * The run's accumulated spend (`tokens`, `inputTokens`, `outputTokens`,
 * `cost`, `llmCalls`) is carried too. Each think turn ADDS its usage to the
 * current state's totals, so a zeroed post-switch state reported only the
 * post-switch segment: the pre-switch spend vanished from `state.tokens` /
 * `state.cost` and every result that reads them (ablation 2026-11-05: cogito
 * rw-7 reported 11,195 tokens against 20,144 billed). Carried, not summed:
 * `next` is fresh from `initialKernelState` (all zero), so there is no double
 * count. The run budget meter is a separate reference carried above, not
 * derived from these fields.
 */
export function carryRunScopedSeeds(prior: KernelState, next: KernelState): KernelState {
  const m = prior.meta;
  return transitionState(next, {
    tokens: prior.tokens,
    inputTokens: prior.inputTokens,
    outputTokens: prior.outputTokens,
    cost: prior.cost,
    llmCalls: prior.llmCalls,
    meta: {
      ...next.meta,
      ...(m.runContract !== undefined ? { runContract: m.runContract } : {}),
      ...(m.postConditions !== undefined ? { postConditions: m.postConditions } : {}),
      ...(m.budgetLimits !== undefined ? { budgetLimits: m.budgetLimits } : {}),
      ...(m.runBudgetMeter !== undefined ? { runBudgetMeter: m.runBudgetMeter } : {}),
      ...(m.runBudgetLimits !== undefined ? { runBudgetLimits: m.runBudgetLimits } : {}),
      ...(m.nominatedTools !== undefined ? { nominatedTools: m.nominatedTools } : {}),
    },
    ...(prior.environmentContext !== undefined ? { environmentContext: prior.environmentContext } : {}),
    ...(prior.skillsContext !== undefined ? { skillsContext: prior.skillsContext } : {}),
  });
}

/** Per-loop counters that a strategy switch resets to zero. */
export interface SwitchResetCounters {
  readonly prevActionCount: number;
  readonly requiredToolRedirects: number;
  readonly consecutiveStalled: number;
  readonly prevArtifactCount: number;
  readonly failureRecoveryRedirects: number;
}

/** All zero — the fixed reset every switch applies to the five per-loop counters. */
export const SWITCH_RESET_COUNTERS: SwitchResetCounters = {
  prevActionCount: 0,
  requiredToolRedirects: 0,
  consecutiveStalled: 0,
  prevArtifactCount: 0,
  failureRecoveryRedirects: 0,
};

export interface ApplyStrategySwitchArgs {
  /** State at the point the switch fires (pre-reinit). */
  readonly state: KernelState;
  /** Input carrying the current task + priorContext + requiredTools. */
  readonly currentInput: KernelInput;
  /** Original context built pre-loop — base for the rebuilt context. */
  readonly context: KernelContext;
  /** Original options — base for the re-seeded currentOptions. */
  readonly options: KernelRunOptions;
  /** Hooks bundle — `onStrategySwitched` fires inside. */
  readonly hooks: KernelHooks;
  /** Strategy names tried so far (mutated in place: the new one is pushed). */
  readonly triedStrategies: string[];
  /** Switch count BEFORE this switch (handoff uses switchCount + 1). */
  readonly switchCount: number;
  /** The strategy we're leaving (each site resolves its own fallback). */
  readonly fromStrategy: string;
  /** The strategy we're switching to. */
  readonly toStrategy: string;
  /** Human-readable reason — `pending.reason` (dispatcher) or `loopMsg` (loop). */
  readonly failureReason: string;
}

export interface ApplyStrategySwitchResult {
  readonly state: KernelState;
  readonly currentInput: KernelInput;
  readonly currentContext: KernelContext;
  readonly currentOptions: KernelRunOptions;
  /** New switch count (= input switchCount + 1). */
  readonly switchCount: number;
  /** The five per-loop counters, all reset to zero. */
  readonly resetCounters: SwitchResetCounters;
}

/**
 * Apply a strategy switch: fire the hook, reinit kernel state for the new
 * strategy, carry forward handoff context, and reset per-loop counters.
 *
 * `triedStrategies` is mutated in place (the new strategy is pushed) — matching
 * the pre-extraction behaviour where it was a reference-stable array.
 */
export function applyStrategySwitch(
  args: ApplyStrategySwitchArgs,
): Effect.Effect<ApplyStrategySwitchResult, never, never> {
  return Effect.gen(function* () {
    const {
      state: priorState,
      currentInput: priorInput,
      context,
      options,
      hooks,
      triedStrategies,
      switchCount,
      fromStrategy,
      toStrategy,
      failureReason,
    } = args;

    yield* hooks.onStrategySwitched(priorState, fromStrategy, toStrategy, failureReason);

    // The reinit below discards `meta.pendingNativeToolCalls`. Loop detection
    // runs only at turn boundaries (iterate-pass), so a loop switch never sees
    // pending calls; a non-zero count here is a regression (H3
    // tool-call-dropped) or a dispatcher-requested switch mid-turn. Record it
    // so `rax-diagnose attribute` can see the drop instead of inferring it.
    const pendingCalls = priorState.meta.pendingNativeToolCalls ?? [];
    if (pendingCalls.length > 0) {
      yield* emitGuardFired({
        taskId: priorState.taskId,
        iteration: priorState.iteration,
        guard: "strategy_switch",
        outcome: "warn",
        reason: "switch_dropped_pending_tool_calls",
        metadata: {
          pendingToolCalls: pendingCalls.length,
          pendingToolNames: pendingCalls.map((c) => c.name),
          from: fromStrategy,
          to: toStrategy,
        },
      });
    }

    const handoff = buildHandoff(
      priorState,
      priorInput.task ?? "",
      fromStrategy,
      failureReason,
      switchCount + 1,
      priorInput.requiredTools ?? [],
    );

    const handoffSummary = buildHandoffSummary(handoff);

    const nextSwitchCount = switchCount + 1;
    triedStrategies.push(toStrategy);

    const currentOptions: KernelRunOptions = { ...options, strategy: toStrategy };

    // Reset state, but CARRY the run's iteration count across the switch (Move 5,
    // per-run iteration cap). `initialKernelState` zeroes `iteration`; leaving it
    // at 0 gave each strategy pass its OWN `maxIterations` budget, so a run that
    // switched could execute up to (switches+1)×maxIterations — the declared cap
    // was a lie (2026-07-29 audit: 16-28 iterations against a declared 12). The
    // run-total now bounds the loop; a run that switches late gets what remains,
    // which is the honest reading of a per-RUN cap. Trims the pathological tail
    // (only runs that loop-detect AND switch are affected — healthy runs never
    // reach here), so it cannot regress a run that was not already thrashing.
    let state = initialKernelState(currentOptions);
    state = transitionState(state, { iteration: priorState.iteration });
    // The run's contract, delivery conditions and budget are facts of the RUN:
    // they survive the reinit (see carryRunScopedSeeds).
    state = carryRunScopedSeeds(priorState, state);

    // Carry the run's ledger across the switch (Step 1 characterization test:
    // `initialKernelState`'s `ledger: []` DROPS the prior ledger — tool
    // invocations, artifacts, requirement facts would silently vanish and
    // `assess()` would re-list satisfied requirements as outstanding after
    // every switch). Then record the handoff as a typed fact instead of
    // string-folding it into `priorContext` (audit 03-F5 — the typed carrier
    // existed, was rendered by the standing frame, and had zero writers).
    state = transitionState(state, {
      ledger: recordHandoff(
        priorState.ledger,
        {
          from: fromStrategy,
          to: toStrategy,
          summary: handoffSummary,
          // Plan 8 K3 / R6: protocol strikes survive the steps reset.
          protocolStrikes: unresolvedStrikesOf(priorState),
        },
        priorState.iteration,
      ),
    });

    // P4 (2026-07-07, A2 #3): carry successful tool observations AND the
    // toolsUsed ledger across the switch. Without them the new strategy both
    // lacks the data (only 5 compressed keyObservations lines survive in
    // priorContext) and gets redirected by the required-tools gate to re-call
    // tools that already succeeded — observed ~2× run cost from re-executing
    // completed tool calls after an escalation switch.
    const carriedObservations = priorState.steps
      .filter((s) => {
        if (s.type !== "observation") return false;
        const obs = s.metadata?.observationResult as { success?: boolean } | undefined;
        return obs?.success === true;
      })
      .slice(-8);
    if (carriedObservations.length > 0 || priorState.toolsUsed.size > 0) {
      state = transitionState(state, {
        steps: [...state.steps, ...carriedObservations],
        toolsUsed: new Set(priorState.toolsUsed),
      });
      // The ledger dual-emit chokepoint (`transitionState`) re-projects ANY
      // `steps` growth, including a fresh `tool-result` per carried
      // observation — but `priorState.ledger` (carried above) already holds
      // the ORIGINAL `tool-result` for these same steps. Left alone, carrying
      // observations across a switch would double the fact for every call.
      // De-dupe by `stepId` (keep the earlier entry) and re-densify `seq`.
      state = transitionState(state, { ledger: dedupeCarriedToolResults(state.ledger ?? []) });
    }

    // Carry the trailing shaped-reply (unresolved-tool-call) thoughts: the strike
    // count is DERIVED from these steps, and the reinit above drops them — which
    // restarted the count at 1 and meant tools were never withheld.
    const carriedShaped = trailingUnresolvedRun(priorState.steps);
    if (carriedShaped.length > 0) {
      state = transitionState(state, { steps: [...state.steps, ...carriedShaped] });
    }

    // Inject synthetic failure observations so the new strategy immediately
    // knows which required tools are permanently unavailable, without having
    // to rediscover this through wasted retry iterations.
    if (handoff.permanentlyFailedTools.length > 0) {
      const failedSteps = handoff.permanentlyFailedTools.map((toolName) =>
        makeStep(
          "observation",
          `${CARRIED_OBSERVATION_PREFIX} Tool "${toolName}" is permanently unavailable — every call failed. Do not retry it; synthesize your answer without this data.`,
          {
            observationResult: {
              toolName,
              success: false,
              displayText: `Tool "${toolName}" permanently unavailable (carried from prior strategy)`,
              category: "error" as const,
              resultKind: "error" as const,
              preserveOnCompaction: false,
              // S2.3 — error observations carry framework-generated text only,
              // safe to render inline. Mark as trusted with grandfather note.
              trustLevel: "trusted" as const,
              trustJustification: "grandfather-phase-1",
            },
          },
        ),
      );
      state = transitionState(state, { steps: [...state.steps, ...failedSteps] });
    }

    // Spec §5b (W-Q / task #54) — the strategy switch is a receipt-visible
    // intervention: an arbitration decision (model-grade) reinitialized the
    // kernel for a different strategy. Stamped on the NEW state (the prior
    // state's steps are discarded by the reinit, except carriedObservations),
    // so `deriveInterventionsFromSteps` picks it up from the run's final steps.
    state = transitionState(state, {
      steps: [
        ...state.steps,
        makeStep(
          "harness_signal",
          `⚠️ Strategy switched: ${fromStrategy} → ${toStrategy} (${failureReason})`,
          {
            intervention: {
              actor: "strategy-switch",
              authorityClass: authorityOf("strategy-switch"),
              evidence: `${fromStrategy}→${toStrategy}: ${failureReason.slice(0, 180)}`,
              whatChanged: `strategy-switch: reinitialized kernel as "${toStrategy}"`,
              iter: priorState.iteration,
            },
          },
        ),
      ],
    });

    // Build updated input. The handoff is now a typed ledger fact (recorded
    // above) that the standing frame renders directly — `priorContext` is left
    // untouched instead of string-folding the handoff into it (two carriers for
    // one concept; the typed one wins). Also drop permanently-failed tools from
    // requiredTools — the lane controller uses this list to decide whether to
    // nudge, and nudging for a known-broken tool only causes retry loops.
    const failedSet = new Set(handoff.permanentlyFailedTools);
    const currentInput: KernelInput = {
      ...priorInput,
      requiredTools: failedSet.size > 0
        ? (priorInput.requiredTools ?? []).filter((t) => !failedSet.has(t))
        : priorInput.requiredTools,
    };

    const currentContext: KernelContext = { ...context, input: currentInput };

    return {
      state,
      currentInput,
      currentContext,
      currentOptions,
      switchCount: nextSwitchCount,
      resetCounters: SWITCH_RESET_COUNTERS,
    };
  });
}
