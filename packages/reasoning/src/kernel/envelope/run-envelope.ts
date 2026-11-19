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
import type { RunPosture, TaskContract } from "@reactive-agents/core";
import type { KernelInput, GroundingConfig, StallPolicy } from "../state/kernel-state.js";
import type { FabricationGuardMode } from "../capabilities/verify/evidence-grounding.js";
import type { AdvisorySeedItem } from "../state/checklist-seed.js";
import type { AskUserRail } from "../capabilities/act/user-interaction.js";
import { postureInputOverrides } from "../policy/run-posture.js";
import type { PlanFindingSeed } from "../policy/plan-recon.js";
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
  /** Conversation-level todo: advisory items from a prior turn, seeded into the run's ledger at start. */
  readonly initialAdvisory?: readonly AdvisorySeedItem[];
  /** Fully rendered between-turn environment notice; rendered once in `Guidance:` on the pass's first think. */
  readonly environmentUpdate?: string;
  /** Findings recorded while planning (the plan's `findings`); an execute run renders them once as context. */
  readonly planFindings?: readonly PlanFindingSeed[];
  /**
   * Run posture. `"plan"` ⇒ plan-only: restricted tool surface, one `Guidance:`
   * line, required-tool pressure off (see `policy/run-posture.ts`). Absent ⇒
   * execute; the key is never written for `"execute"`, so the envelope is
   * byte-identical to a pre-posture run.
   */
  readonly posture?: RunPosture;
  /**
   * The producer-typed current turn's text (`TaskMetadata.currentTurn`, no
   * inlined history). Every contract compile and `deriveConditions` prefers it
   * over parsing history markers out of the task. Absent ⇒ marker parsing; the
   * key is never written when absent (byte-identical envelope).
   */
  readonly currentTurnText?: string;
  /**
   * Per-tool call caps (`.withTools({ maxCallsPerTool })`), e.g. `{ "web-search": 3 }`.
   * Merged onto every kernel pass (the think-phase tool gate refuses the extra
   * call) and read by the strategy substrate's direct-dispatch budget
   * (`StrategyRun.toolCallBudget`), so no strategy forwards it.
   */
  readonly maxCallsPerTool?: Readonly<Record<string, number>>;
  /**
   * Live ask-user rail. When present, a `request_user_input` call is answered
   * inline: the act phase calls this, puts the answer (or an honest "no
   * answer") in the call's tool result, and the run keeps going. Absent ⇒ the
   * durable path: the run pauses with `awaiting-interaction`. Read by
   * `capabilities/act/user-interaction.ts`; never folded into `KernelInput`.
   */
  readonly askUser?: AskUserRail;
  /**
   * The run's model facet: provider name, context profile and calibration
   * mode, as `ReasoningService.execute` received them. Merged onto every kernel
   * pass, so a strategy's sub-kernels (reflexion passes, ToT branches,
   * plan-execute steps) see the same provider, tier, window and calibration
   * choice as the run. Before this, each strategy copied them by hand and three
   * dropped them: their passes ran as provider "unknown" on the mid profile
   * (audit 2026-11-18, G1).
   */
  readonly providerName?: KernelInput["providerName"];
  /** See `providerName`. */
  readonly contextProfile?: KernelInput["contextProfile"];
  /** See `providerName`. `"skip"` applies no model calibration on any pass. */
  readonly calibrationMode?: KernelInput["calibrationMode"];
}

/** The model facet `withModelFacet` folds onto an envelope's rails. */
export type RunModelFacet = Pick<RunEnvelopeRails, "providerName" | "contextProfile" | "calibrationMode">;

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
  /** See `RunEnvelopeRails.initialAdvisory`. */
  readonly initialAdvisory?: readonly AdvisorySeedItem[];
  /** See `RunEnvelopeRails.environmentUpdate`. */
  readonly environmentUpdate?: string;
  /** See `RunEnvelopeRails.planFindings`. */
  readonly planFindings?: readonly PlanFindingSeed[];
  /** See `RunEnvelopeRails.posture`. */
  readonly posture?: RunPosture;
  /** See `RunEnvelopeRails.currentTurnText`. */
  readonly currentTurnText?: string;
  /** See `RunEnvelopeRails.maxCallsPerTool`. */
  readonly maxCallsPerTool?: Readonly<Record<string, number>>;
  /** See `RunEnvelopeRails.askUser`. */
  readonly askUser?: AskUserRail;
  /** See `RunEnvelopeRails.providerName` (the model facet). */
  readonly providerName?: KernelInput["providerName"];
  /** See `RunEnvelopeRails.providerName` (the model facet). */
  readonly contextProfile?: KernelInput["contextProfile"];
  /** See `RunEnvelopeRails.providerName` (the model facet). */
  readonly calibrationMode?: KernelInput["calibrationMode"];
  /** Optional per-agent harness config; absent ⇒ pure env/default resolution. */
  readonly harness?: HarnessConfig;
  /**
   * Lowest-priority harness layer, beneath env — a `ContextProfile` tier's
   * disclosure-mode shorthand (`fromDisclosureMode()`). Only fills a hole an
   * unset env var leaves; `harness` and any explicit `RA_*` var both still
   * win. See `resolveHarnessConfig`'s `profileDefault` parameter.
   */
  readonly harnessProfileDefault?: HarnessConfig;
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
      ...(opts.initialAdvisory !== undefined ? { initialAdvisory: opts.initialAdvisory } : {}),
      ...(opts.environmentUpdate !== undefined ? { environmentUpdate: opts.environmentUpdate } : {}),
      ...(opts.planFindings !== undefined && opts.planFindings.length > 0 ? { planFindings: opts.planFindings } : {}),
      ...(opts.posture === "plan" ? { posture: opts.posture } : {}),
      ...(opts.currentTurnText !== undefined ? { currentTurnText: opts.currentTurnText } : {}),
      ...(opts.maxCallsPerTool !== undefined ? { maxCallsPerTool: opts.maxCallsPerTool } : {}),
      ...(opts.askUser !== undefined ? { askUser: opts.askUser } : {}),
      ...modelFacet(opts),
    },
    harness: resolveHarnessConfig(opts.harness ?? {}, opts.harnessProfileDefault ?? {}),
  };
}

/** The no-config envelope: every policy/rails field absent, harness fully
 *  resolved from env+defaults. Zero behavior change by construction.
 *
 *  NOT used as the production default (Finding 4, harness-control-surface
 *  final fix wave): `harness` resolves ONCE at module-import time, so a
 *  `RA_*` env var set after import is silently ignored by any caller that
 *  reuses this frozen constant. `reasoning-service.ts` (the sole production
 *  provision site) falls back to a fresh `buildRunEnvelope()` call instead.
 *  Kept exported for tests and any other caller that genuinely wants the
 *  shared, already-resolved constant. */
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
    ...(input.initialAdvisory === undefined && rails.initialAdvisory !== undefined
      ? { initialAdvisory: rails.initialAdvisory }
      : {}),
    ...(input.environmentUpdate === undefined && rails.environmentUpdate !== undefined
      ? { environmentUpdate: rails.environmentUpdate }
      : {}),
    ...(input.planFindings === undefined && rails.planFindings !== undefined
      ? { planFindings: rails.planFindings }
      : {}),
    // Only a pass whose task CARRIES the current turn: a sub-kernel with its own
    // task (plan-execute step, critique) must not scan the parent's typed turn.
    ...(input.currentTurnText === undefined && rails.currentTurnText !== undefined
      && input.task.includes(rails.currentTurnText)
      ? { currentTurnText: rails.currentTurnText }
      : {}),
    ...(input.maxCallsPerTool === undefined && rails.maxCallsPerTool !== undefined
      ? { maxCallsPerTool: rails.maxCallsPerTool }
      : {}),
    ...(input.harness === undefined ? { harness: envelope.harness } : {}),
    // The model facet: every pass runs on the run's provider, profile and calibration choice.
    ...modelFacet(rails, input),
    // Posture is run-level fiat: applied LAST so it beats the classifier's required tools.
    ...postureInputOverrides(rails.posture),
  };
}

/**
 * The model-facet fields of `from` that `into` does not set yet (absent keys
 * are not written). One reader for the three fields, used by the envelope
 * build, the kernel-input merge and `withModelFacet`.
 */
function modelFacet(from: RunModelFacet, into: RunModelFacet = {}): RunModelFacet {
  return {
    ...(into.providerName === undefined && from.providerName !== undefined ? { providerName: from.providerName } : {}),
    ...(into.contextProfile === undefined && from.contextProfile !== undefined ? { contextProfile: from.contextProfile } : {}),
    ...(into.calibrationMode === undefined && from.calibrationMode !== undefined ? { calibrationMode: from.calibrationMode } : {}),
  };
}

/**
 * Fold the run's model facet (provider name, context profile, calibration
 * mode) onto an envelope's rails. `ReasoningService.execute` takes them as
 * params; this puts them on the one carrier so every kernel pass of every
 * strategy runs on them without a strategy forwarding them. Fields already on
 * the envelope win; nothing to add returns the same object.
 */
export function withModelFacet(envelope: RunEnvelopeData, facet: RunModelFacet): RunEnvelopeData {
  const added = modelFacet(facet, envelope.rails);
  if (Object.keys(added).length === 0) return envelope;
  return { ...envelope, rails: { ...envelope.rails, ...added } };
}

/**
 * Fold per-tool call caps onto an envelope's rails. `ReasoningService.execute`
 * takes `maxCallsPerTool` as a param; this puts it on the one carrier so every
 * strategy and every kernel pass sees the same caps. Caps already on the
 * envelope win; absent caps leave the envelope unchanged (same object).
 */
export function withMaxCallsPerTool(
  envelope: RunEnvelopeData,
  maxCallsPerTool: Readonly<Record<string, number>> | undefined,
): RunEnvelopeData {
  if (maxCallsPerTool === undefined || envelope.rails.maxCallsPerTool !== undefined) return envelope;
  return { ...envelope, rails: { ...envelope.rails, maxCallsPerTool } };
}

/**
 * Fold the producer-typed current turn onto an envelope's rails.
 * `ReasoningService.execute` takes `currentTurnText` as a param; this puts it on
 * the one carrier so every strategy's contract compile and every kernel pass
 * sees it. Text already on the envelope wins; absent text returns the same object.
 */
export function withCurrentTurnText(
  envelope: RunEnvelopeData,
  currentTurnText: string | undefined,
): RunEnvelopeData {
  if (currentTurnText === undefined || envelope.rails.currentTurnText !== undefined) return envelope;
  return { ...envelope, rails: { ...envelope.rails, currentTurnText } };
}

/**
 * Test helper — the ONLY sanctioned provision site outside
 * `reasoning-service.ts` (enforced by scripts/check-cross-cutting.sh).
 *
 * `data` defaults to a FRESH `buildRunEnvelope()` resolved at CALL time, not
 * to the frozen `emptyRunEnvelope` module constant (that constant is snapshot
 * once at import time — a test's `beforeAll`/`beforeEach` mutating `RA_*` env
 * vars runs strictly after module import, so it would silently miss a
 * pre-resolved snapshot). Explicit `data` still wins when a caller wants the
 * exact shared constant or a hand-built envelope.
 */
export function provideTestEnvelope<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  data?: RunEnvelopeData,
): Effect.Effect<A, E, Exclude<R, RunEnvelope>> {
  return Effect.provideService(effect, RunEnvelope, data ?? buildRunEnvelope());
}
