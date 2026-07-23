// RunEnvelope — the ONE run-wide carrier for cross-cutting harness concerns.
//
// Design: wiki/Architecture/Design-Specs/2026-07-22-cross-cutting-cascade-design.md
// Defect class this closes: a run-wide field threaded by hand through 8 strategy
// input interfaces is silently dropped wherever an interface omits it (HITL
// bypass fe5dc93b; grounding/fabricationGuard/stallPolicy discarded on 5 of 8
// strategies, measured 2026-07-22). Strategies never carry these fields again —
// they cannot drop what they never carry.
//
// ONE service, TWO named sub-records (spec §9 ruling — a split into two
// services reinvents the drop at the join):
//   policy — judgment inputs, read at the terminal mint (finalizeStrategyResult)
//   rails  — repair inputs, soft-read at the seams (runKernel, tool-observe)
import { Context, Effect } from "effect";
import type { TaskContract } from "@reactive-agents/core";
import type { KernelInput, GroundingConfig, StallPolicy } from "../state/kernel-state.js";
import type { FabricationGuardMode } from "../capabilities/verify/evidence-grounding.js";

export interface RunEnvelopePolicy {
  /** Declared TaskContract (.withContract) — judged contract-vs-ledger at the terminal. */
  readonly taskContract?: TaskContract;
  /** Fabrication-guard mode (.withFabricationGuard). Judged at the terminal; also read by kernel verify. */
  readonly fabricationGuard?: FabricationGuardMode;
  /** Numeric evidence-grounding config (.withGrounding). Judgment side; redirect half lives in rails-consuming loop. */
  readonly grounding?: GroundingConfig;
}

export interface RunEnvelopeRails {
  /** Stall/no-progress policy (.withStallPolicy) — mid-run steering, loop-scoped. */
  readonly stallPolicy?: StallPolicy;
  /** Durable HITL (Phase D): approval-gate policy. Repair: must pause BEFORE the tool runs. */
  readonly approvalPolicy?: KernelInput["approvalPolicy"];
  /** Durable HITL (Phase D): human's approve/deny decision on a resumed run. */
  readonly approvalDecision?: KernelInput["approvalDecision"];
  /** Agentic-UI interaction rail: human's response to a paused request_user_input. */
  readonly interactionResponse?: KernelInput["interactionResponse"];
}

export interface RunEnvelopeData {
  readonly policy: RunEnvelopePolicy;
  readonly rails: RunEnvelopeRails;
}

export class RunEnvelope extends Context.Tag("RunEnvelope")<RunEnvelope, RunEnvelopeData>() {}

/** Flat construction options — what the runtime config actually holds. */
export interface BuildRunEnvelopeOptions {
  readonly taskContract?: TaskContract;
  readonly fabricationGuard?: FabricationGuardMode;
  readonly grounding?: GroundingConfig;
  readonly stallPolicy?: StallPolicy;
  readonly approvalPolicy?: KernelInput["approvalPolicy"];
  readonly approvalDecision?: KernelInput["approvalDecision"];
  readonly interactionResponse?: KernelInput["interactionResponse"];
}

export function buildRunEnvelope(opts: BuildRunEnvelopeOptions = {}): RunEnvelopeData {
  return {
    policy: {
      ...(opts.taskContract !== undefined ? { taskContract: opts.taskContract } : {}),
      ...(opts.fabricationGuard !== undefined ? { fabricationGuard: opts.fabricationGuard } : {}),
      ...(opts.grounding !== undefined ? { grounding: opts.grounding } : {}),
    },
    rails: {
      ...(opts.stallPolicy !== undefined ? { stallPolicy: opts.stallPolicy } : {}),
      ...(opts.approvalPolicy !== undefined ? { approvalPolicy: opts.approvalPolicy } : {}),
      ...(opts.approvalDecision !== undefined ? { approvalDecision: opts.approvalDecision } : {}),
      ...(opts.interactionResponse !== undefined
        ? { interactionResponse: opts.interactionResponse }
        : {}),
    },
  };
}

/** The no-config envelope: every field absent. Zero behavior change by construction. */
export const emptyRunEnvelope: RunEnvelopeData = { policy: {}, rails: {} };

/**
 * Test helper — the ONLY sanctioned provision site outside
 * `reasoning-service.ts` (enforced by scripts/check-cross-cutting.sh).
 */
export function provideTestEnvelope<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  data: RunEnvelopeData = emptyRunEnvelope,
): Effect.Effect<A, E, Exclude<R, RunEnvelope>> {
  return Effect.provideService(effect, RunEnvelope, data);
}
