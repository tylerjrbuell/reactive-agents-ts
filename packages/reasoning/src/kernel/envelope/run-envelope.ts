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
import { resolveHarnessConfig, type HarnessConfig, type ResolvedHarness } from "../../harness-config.js";

export interface RunEnvelopePolicy {
  /** Declared TaskContract (.withContract) — judged contract-vs-ledger at the terminal. */
  readonly taskContract?: TaskContract;
  /** Fabrication-guard mode (.withFabricationGuard). Judged at the terminal; also read by kernel verify. */
  readonly fabricationGuard?: FabricationGuardMode;
  /** Numeric evidence-grounding config (.withGrounding). Judgment side; redirect half lives in rails-consuming loop. */
  readonly grounding?: GroundingConfig;
  /**
   * This kernel pass is a FRAGMENT of a run, not the run's terminal.
   *
   * Some passes cannot ground themselves BY CONSTRUCTION: the verification
   * THINK retry (`runtime/.../verification-think-retry.ts`) runs with
   * `availableTools: []` + `maxIterations: 1`, and the post-think continuation
   * passes (`runtime/.../reasoning-harness-hooks.ts`) refine prose against an
   * answer an EARLIER pass already grounded. Their grounding evidence lives in a
   * sibling pass, and the mint only ever sees `params.steps` of the pass in
   * front of it.
   *
   * Judged as a terminal, such a pass looks exactly like a fabrication: zero
   * successful required-tool calls. Under `fabricationGuard: "block"` that
   * flipped a correct, tool-grounded answer to `status:"failed"` with the
   * abstention sentinel — the run told the user "I could not ground an answer"
   * about a run that did (review finding C1, 2026-07-23).
   *
   * When true the mint still COMPUTES and RECORDS the full verdict (so the
   * observation is never hidden) but never enforces — see fence 4 in
   * `finalizeStrategyResult`. It is set by the two pass BUILDERS, which are the
   * only code that knows a pass is a fragment; a strategy cannot set it, and a
   * genuine terminal pass never carries it.
   */
  readonly auxiliaryPass?: boolean;
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
  /**
   * Harness mechanism configuration, resolved once (config > env > default).
   * A THIRD named sub-record on the SAME service — never a second service.
   * Spec §9's ruling stands: splitting the carrier reinvents the drop at the
   * join. `policy` is judgment, `rails` is repair, `harness` is mechanism.
   */
  readonly harness: ResolvedHarness;
}

export class RunEnvelope extends Context.Tag("RunEnvelope")<RunEnvelope, RunEnvelopeData>() {}

/** Flat construction options — what the runtime config actually holds. */
export interface BuildRunEnvelopeOptions {
  readonly taskContract?: TaskContract;
  readonly fabricationGuard?: FabricationGuardMode;
  readonly grounding?: GroundingConfig;
  /** See `RunEnvelopePolicy.auxiliaryPass` — set by pass builders, never by a strategy. */
  readonly auxiliaryPass?: boolean;
  readonly stallPolicy?: StallPolicy;
  readonly approvalPolicy?: KernelInput["approvalPolicy"];
  readonly approvalDecision?: KernelInput["approvalDecision"];
  readonly interactionResponse?: KernelInput["interactionResponse"];
  /** Optional per-agent harness config; absent ⇒ pure env/default resolution. */
  readonly harness?: HarnessConfig;
}

export function buildRunEnvelope(opts: BuildRunEnvelopeOptions = {}): RunEnvelopeData {
  return {
    policy: {
      ...(opts.taskContract !== undefined ? { taskContract: opts.taskContract } : {}),
      ...(opts.fabricationGuard !== undefined ? { fabricationGuard: opts.fabricationGuard } : {}),
      ...(opts.grounding !== undefined ? { grounding: opts.grounding } : {}),
      ...(opts.auxiliaryPass !== undefined ? { auxiliaryPass: opts.auxiliaryPass } : {}),
    },
    rails: {
      ...(opts.stallPolicy !== undefined ? { stallPolicy: opts.stallPolicy } : {}),
      ...(opts.approvalPolicy !== undefined ? { approvalPolicy: opts.approvalPolicy } : {}),
      ...(opts.approvalDecision !== undefined ? { approvalDecision: opts.approvalDecision } : {}),
      ...(opts.interactionResponse !== undefined
        ? { interactionResponse: opts.interactionResponse }
        : {}),
    },
    harness: resolveHarnessConfig(opts.harness ?? {}),
  };
}

/** The no-config envelope: every policy/rails field absent, harness fully
 *  resolved from env+defaults. Zero behavior change by construction. */
export const emptyRunEnvelope: RunEnvelopeData = {
  policy: {},
  rails: {},
  harness: resolveHarnessConfig(),
};

/**
 * Fold the run-wide envelope into a `KernelInput` — the cascade's REACH step
 * (Task 6). `runKernel` calls this once per kernel pass so a wither configured
 * on the agent applies on EVERY strategy, including the ones that never threaded
 * these fields to their sub-kernels (reflexion critique passes, ToT branch
 * kernels, plan-execute composite steps, direct).
 *
 * Precedence: an EXPLICIT `KernelInput` field always wins. Per-pass overrides
 * stay possible (e.g. a strategy that deliberately narrows `requiredTools` or a
 * sub-kernel handed a tighter policy), and the merge only ever FILLS holes.
 *
 * Absent-field discipline: a field the envelope does not carry is not written at
 * all (conditional spread, not `?? undefined`), so `"grounding" in input` and
 * `Object.keys(input)` are unchanged on a run with no envelope config — the
 * no-config path is byte-identical to pre-cascade behavior.
 */
export function mergeRunEnvelopeIntoKernelInput(
  input: KernelInput,
  envelope: RunEnvelopeData,
): KernelInput {
  const { policy, rails } = envelope;
  return {
    ...input,
    ...(input.taskContract === undefined && policy.taskContract !== undefined
      ? { taskContract: policy.taskContract }
      : {}),
    ...(input.fabricationGuard === undefined && policy.fabricationGuard !== undefined
      ? { fabricationGuard: policy.fabricationGuard }
      : {}),
    ...(input.grounding === undefined && policy.grounding !== undefined
      ? { grounding: policy.grounding }
      : {}),
    ...(input.stallPolicy === undefined && rails.stallPolicy !== undefined
      ? { stallPolicy: rails.stallPolicy }
      : {}),
    ...(input.approvalPolicy === undefined && rails.approvalPolicy !== undefined
      ? { approvalPolicy: rails.approvalPolicy }
      : {}),
    ...(input.approvalDecision === undefined && rails.approvalDecision !== undefined
      ? { approvalDecision: rails.approvalDecision }
      : {}),
    ...(input.interactionResponse === undefined && rails.interactionResponse !== undefined
      ? { interactionResponse: rails.interactionResponse }
      : {}),
    ...(input.harness === undefined ? { harness: envelope.harness } : {}),
  };
}

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
