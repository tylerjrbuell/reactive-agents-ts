/**
 * Behavioral-contract resolution + KillSwitch acquisition + maxToolCalls bridge.
 *
 * Owns: the up-front behavioral-contract resolve (and the merged config it
 * produces), the optional `KillSwitchService` acquisition (widened so a
 * declared `maxToolCalls` cap gets the service even without an explicit
 * `.withKillSwitch()`), and the unconditional `startMaxToolCallsGuard` start
 * (before bootstrap, so it observes every tool call for the FULL run).
 *
 * Moved verbatim from execution-engine.ts (GH #221 W26 decomposition,
 * "behavioral-contract resolve + KillSwitchService acquisition +
 * maxToolCalls->killswitch bridge" banner, former lines 475-515). The
 * `activeBehavioralContract` local is an internal detail: the engine only
 * consumes the merged config and the resolved `ks`.
 */
import { Context, Effect } from "effect";
import type { Task } from "@reactive-agents/core";
import { BehavioralContractService, KillSwitchService } from "@reactive-agents/guardrails";
import type { ReactiveAgentsConfig } from "../types.js";
import {
  mergeBehavioralContractIntoConfig,
  startMaxToolCallsGuard,
} from "./phases/agent-loop/behavioral-contract-bridge.js";
import type { EbLike } from "./runtime-context.js";

/** Resolved value type of the guardrails KillSwitchService tag. */
export type KillSwitchValue = Context.Tag.Service<typeof KillSwitchService>;

export interface ContractKillSwitchDeps {
  readonly eb: EbLike | null;
  readonly task: Task;
  readonly config: ReactiveAgentsConfig;
}

export interface ContractKillSwitchResult {
  /** Behavioral-contract-merged config (identical to `config` when no contract is active). */
  readonly configForBehavioralContract: ReactiveAgentsConfig;
  /** Resolved kill-switch service (null when not wired / not needed). */
  readonly ks: KillSwitchValue | null;
}

export const resolveContractAndKillSwitch = (
  deps: ContractKillSwitchDeps,
): Effect.Effect<ContractKillSwitchResult, never> => {
  const { eb, task, config } = deps;
  return Effect.gen(function* () {
    // ── Behavioral contract: resolve once, up front ──
    // (Runtime fix, 2026-08-23 — see behavioral-contract-bridge.ts doc
    // block for the full root-cause + mechanism writeup.) Resolved here,
    // BEFORE the KillSwitchService acquisition below, because a declared
    // `maxToolCalls` cap needs the kill switch even when the caller never
    // called `.withKillSwitch()` explicitly — runtime.ts's
    // `killSwitchOptLayer` auto-provides the service in that case (see
    // its own comment), and this is the corresponding consumer-side
    // widen so the service is actually ACQUIRED, not just provided.
    let activeBehavioralContract: import("@reactive-agents/guardrails").BehavioralContract | undefined;
    if (config.enableBehavioralContracts) {
      const bcOpt = yield* Effect.serviceOption(BehavioralContractService).pipe(
        Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
      );
      if (bcOpt._tag === "Some") {
        activeBehavioralContract = yield* bcOpt.value.getContract();
      }
    }
    const configForBehavioralContract = activeBehavioralContract
      ? mergeBehavioralContractIntoConfig(config, activeBehavioralContract)
      : config;

    // ── Acquire KillSwitchService optionally ──
    const ksOpt = config.enableKillSwitch || activeBehavioralContract?.maxToolCalls != null
      ? yield* Effect.serviceOption(KillSwitchService).pipe(
          Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
        )
      : { _tag: "None" as const };
    const ks = ksOpt._tag === "Some" ? ksOpt.value : null;

    // ── maxToolCalls → kill-switch bridge ──
    // Started unconditionally here (before bootstrap) so it observes
    // every tool call for the FULL run, not just the reasoning-arm
    // portion. No-ops when the contract declares no maxToolCalls cap.
    yield* startMaxToolCallsGuard({
      eb,
      ks,
      taskId: task.id,
      agentId: config.agentId,
      maxToolCalls: activeBehavioralContract?.maxToolCalls,
    });

    return { configForBehavioralContract, ks };
  });
};
