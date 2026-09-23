// File: src/kernel/capabilities/verify/grounding-fabrication-judgment-shadow.ts
/**
 * Task 3 (Phase D leverage plan, shadow-only): fires a single Noul judgment
 * question — "is this claim fully supported by the provided evidence, with
 * nothing invented or embellished (fabrication)?" — alongside the existing
 * deterministic content-containment check that decides whether a model's
 * terminal thought is trusted over the harness-assembled deliverable
 * fallback (`evaluateUnconsumedEvidenceGrounding` /
 * `assembleDeliverable`, `runner-helpers/deliverable.ts`; 2026-08-16
 * t0-deterministic fix). Fired via `Effect.forkDaemon` — the judgment answer
 * is computed and reported but NEVER consumes or alters the deliverable-
 * assembly decision (`assembleDeliverable` calls
 * `evaluateUnconsumedEvidenceGrounding` directly and is untouched by this
 * file). This file adds an OBSERVATION, not a second grounding decision
 * point.
 *
 * Wired from `runner.ts`'s §8.8 output-ownership-invariant fallback (the
 * general, terminatedBy-drift-immune `assembleDeliverable` call site) — the
 * single most universal reach of the containment check across done-run
 * terminations. Only fires when the containment comparison itself actually
 * ran (`evaluateUnconsumedEvidenceGrounding(state).evidence !== undefined`):
 * unconsumed stored evidence exists AND a qualifying model thought exists AND
 * something resolved from the scratchpad to compare against.
 *
 * Emits ONE `JudgmentShadow` event, `site: "grounding-fabrication"`, reusing
 * the EXACT event shape Phase C's four existing shadow sites and Task 2's
 * `completion-satisfied` site use — see `@reactive-agents/core`'s
 * `JudgmentShadow` type. Later agreement analysis (Task 3 Step 4's exit
 * gate, out of scope for this dispatch) reads these events. Adversarial
 * framing per the plan: a judge calling a real fabrication "grounded" (a
 * false negative against the heuristic's own reject direction) is the
 * failure mode Step 4's sampling must weight toward — not something this
 * file needs to special-case; it just needs to report `judged` honestly.
 *
 * Pattern mirrors `judgmentCompletionShadow` (Task 2,
 * `completion-judgment-shadow.ts`): `Effect.serviceOption(JudgmentService)`
 * resolution (does not widen this function's `R`), fire-and-forget via
 * `Effect.forkDaemon`, degrade to a clean no-op absent `.withJudgment()` —
 * and, distinctly here, absent `EventBus` too (mirrors
 * `emitVerifierVerdict`'s own ambient `Effect.serviceOption(EventBus)`
 * resolution, since this function is wired directly inside the kernel loop,
 * which already resolves EventBus the same way).
 */
import { Effect, Either, Option } from "effect";
import { EventBus } from "@reactive-agents/core";
import { JudgmentService } from "@reactive-agents/judgment";
import type { JudgmentAnswer, JudgmentEntry, NoulSpec, QuestionSpecs } from "@reactive-agents/judgment";
import type { KernelState } from "../../state/kernel-state.js";
import { evaluateUnconsumedEvidenceGrounding } from "../../loop/runner-helpers/deliverable.js";

/** The single Noul question id this shadow asks — also the emitted event's `site` discriminator context. */
const GROUNDING_FABRICATION_QUESTION_ID = "grounding-fabrication";

/** Inputs for the shadow Noul — the exact claim/evidence pair the heuristic containment check compared. */
export interface GroundingFabricationJudgmentShadowInput {
  /** The model's terminal thought — the claim being checked for fabrication. */
  readonly claim: string;
  /** The resolved unconsumed-evidence text (already scratchpad-resolved) the claim is checked against. */
  readonly evidence: string;
  /**
   * The heuristic's own containment verdict for this SAME claim/evidence pair
   * (`evaluateUnconsumedEvidenceGrounding(...).grounded`). This shadow never
   * influences it; it is only the baseline for the `agreement` field recorded
   * on the emitted event.
   */
  readonly heuristicGrounded: boolean;
}

const buildState = (input: GroundingFabricationJudgmentShadowInput): JudgmentEntry => ({
  claim: input.claim,
  evidence: input.evidence,
});

const buildQuestions = (): QuestionSpecs => ({
  [GROUNDING_FABRICATION_QUESTION_ID]: {
    type: "noul",
    instructions:
      "Is `claim` fully supported by `evidence` — i.e. is every factual assertion in `claim` verifiably present in `evidence`, with nothing invented, embellished, or unsupported (fabrication)?",
  } satisfies NoulSpec,
});

/** Maps a Noul answer to a boolean verdict (probability ≥ 0.5) — `null` if the answer isn't Noul-shaped. */
const answerToBoolean = (answer: JudgmentAnswer): boolean | null =>
  answer.kind === "noul" ? answer.probability >= 0.5 : null;

/**
 * Task 3 (shadow-only). Fires the grounding-fabrication Noul via
 * `Effect.forkDaemon` — never awaited by the caller, never altering
 * `evaluateUnconsumedEvidenceGrounding`'s own `grounded` verdict (already
 * computed by the time this is called). Absent `JudgmentService` (no
 * `.withJudgment()` on the builder) is a clean, zero-cost no-op.
 */
export function judgmentGroundingFabricationShadow(
  input: GroundingFabricationJudgmentShadowInput,
): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const maybeJudgment = yield* Effect.serviceOption(JudgmentService);
    if (Option.isNone(maybeJudgment)) return;
    const judgment = maybeJudgment.value;

    yield* Effect.forkDaemon(
      Effect.gen(function* () {
        const result = yield* judgment
          .ask({ state: buildState(input), questions: buildQuestions() })
          .pipe(Effect.either);

        const judged = Either.isRight(result)
          ? answerToBoolean(result.right[GROUNDING_FABRICATION_QUESTION_ID])
          : null;
        const judgedStr = judged === null ? null : String(judged);
        const current = String(input.heuristicGrounded);

        const busOpt = yield* Effect.serviceOption(EventBus);
        if (Option.isNone(busOpt)) return;
        yield* busOpt.value
          .publish({
            _tag: "JudgmentShadow",
            site: "grounding-fabrication",
            judged: judgedStr,
            current,
            agreement: judgedStr === null ? null : judgedStr === current,
          })
          .pipe(Effect.catchAll(() => Effect.void));
      }),
    );
  });
}

/**
 * Convenience wrapper: derives the shadow input from a {@link KernelState} via
 * {@link evaluateUnconsumedEvidenceGrounding} (reusing the SAME extraction the
 * heuristic itself runs — no re-fetch, no re-derivation) and fires the shadow
 * only when the containment comparison actually ran (`evidence !== undefined`).
 * A clean no-op (returns `Effect.void` immediately, no `JudgmentService`
 * resolution at all) when there is nothing to compare — mirrors Task 2's
 * `terminal !== true` early-return.
 */
export function judgmentGroundingFabricationShadowFromState(
  state: KernelState,
): Effect.Effect<void, never> {
  const check = evaluateUnconsumedEvidenceGrounding(state);
  if (check.evidence === undefined || check.lastThoughtContent === undefined) {
    return Effect.void;
  }
  return judgmentGroundingFabricationShadow({
    claim: check.lastThoughtContent,
    evidence: check.evidence,
    heuristicGrounded: check.grounded,
  });
}
