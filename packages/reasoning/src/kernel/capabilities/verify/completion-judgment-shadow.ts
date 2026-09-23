// File: src/kernel/capabilities/verify/completion-judgment-shadow.ts
/**
 * Task 2 (Phase D leverage plan, shadow-only): fires a single Noul judgment
 * question — "is this response a complete, satisfying answer to the user's
 * request?" — alongside the Verifier's existing terminal-only completion
 * heuristics (`isSatisfied` / `detectContinuationIntent` in quality-utils.ts,
 * `GIVE_UP_PATTERNS` in verifier.ts's `defaultVerifier`), via
 * `Effect.forkDaemon`. The judgment answer is computed and reported but NEVER
 * consumes or alters `VerificationResult.verified` — the Verifier's own
 * terminal checks remain the sole heuristic authority feeding
 * `terminate.ts`'s single-owner termination gateway and the Arbitrator's
 * verdict resolution (`arbitrator.ts`). This file adds an OBSERVATION, not a
 * second termination decision point.
 *
 * Wired from `verifyAndEmit` (verifier.ts) — the existing capability-boundary
 * emit wrapper every terminal verification call site (`runner.ts` x2,
 * `stall-deliverable.ts`) already funnels through. No new call sites; no new
 * phase.
 *
 * Emits ONE `JudgmentShadow` event, `site: "completion-satisfied"`, reusing
 * the EXACT event shape Phase C's four existing shadow sites use
 * (`strategy-selection` in adaptive.ts, `complexity-router` in
 * `@reactive-agents/cost`, `task-comprehension` in judgment-classification.ts,
 * plus the guardrail-battery site) — see `@reactive-agents/core`'s
 * `JudgmentShadow` type. Later agreement analysis (Task 2 Step 4's exit gate,
 * out of scope for this dispatch) reads these events.
 *
 * Pattern mirrors `judgmentClassifyShadow` (adaptive.ts, Task 9) and
 * `judgmentComprehendShadow` (judgment-classification.ts, Task 10):
 * `Effect.serviceOption(JudgmentService)` resolution (does not widen this
 * function's `R`), fire-and-forget via `Effect.forkDaemon`, degrade to a
 * clean no-op absent `.withJudgment()` — and, distinctly here, absent
 * `EventBus` too (mirrors `emitVerifierVerdict`'s own ambient
 * `Effect.serviceOption(EventBus)` resolution in diagnostics.ts, since this
 * function is wired directly inside `verifyAndEmit`, which already resolves
 * EventBus the same way).
 */
import { Effect, Either, Option } from "effect";
import { EventBus } from "@reactive-agents/core";
import { JudgmentService } from "@reactive-agents/judgment";
import type { JudgmentAnswer, JudgmentEntry, NoulSpec, QuestionSpecs } from "@reactive-agents/judgment";

/** The single Noul question id this shadow asks — also the emitted event's `site` discriminator context. */
const COMPLETION_QUESTION_ID = "completion-satisfied";

export interface CompletionJudgmentShadowInput {
  /** The original task/goal text. */
  readonly task: string;
  /** The candidate final response text being verified. */
  readonly candidateOutput: string;
  /**
   * Recent tool-observation content (most-recent-last), so the judgment sees
   * the same evidence the Verifier's own grounding/give-up checks consult.
   * Callers pass a small bounded slice — this function does not truncate.
   */
  readonly recentObservations: readonly string[];
  /**
   * The Verifier's own `VerificationResult.verified` for this SAME candidate
   * — the existing heuristic decision (Step 2 of the plan). This shadow never
   * influences it; it is only the baseline for the `agreement` field recorded
   * on the emitted event.
   */
  readonly heuristicVerified: boolean;
}

const buildState = (input: CompletionJudgmentShadowInput): JudgmentEntry => ({
  task: input.task,
  candidateOutput: input.candidateOutput,
  recentObservations: [...input.recentObservations],
});

const buildQuestions = (): QuestionSpecs => ({
  [COMPLETION_QUESTION_ID]: {
    type: "noul",
    instructions:
      "Is `candidateOutput` a complete, satisfying final answer to `task`, grounded in `recentObservations` where relevant — as opposed to a partial, evasive, give-up, or mid-reasoning/continuation-intent response?",
  } satisfies NoulSpec,
});

/** Maps a Noul answer to a boolean verdict (probability ≥ 0.5) — `null` if the answer isn't Noul-shaped. */
const answerToBoolean = (answer: JudgmentAnswer): boolean | null =>
  answer.kind === "noul" ? answer.probability >= 0.5 : null;

/**
 * Task 2 (shadow-only). Fires the completion-judgment Noul via
 * `Effect.forkDaemon` — never awaited by the caller, never altering the
 * Verifier's own `verified` result (already computed by the time this is
 * called; see `verifyAndEmit`). Absent `JudgmentService` (no
 * `.withJudgment()` on the builder) is a clean, zero-cost no-op.
 */
export function judgmentCompletionShadow(
  input: CompletionJudgmentShadowInput,
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
          ? answerToBoolean(result.right[COMPLETION_QUESTION_ID])
          : null;
        const judgedStr = judged === null ? null : String(judged);
        const current = String(input.heuristicVerified);

        const busOpt = yield* Effect.serviceOption(EventBus);
        if (Option.isNone(busOpt)) return;
        yield* busOpt.value
          .publish({
            _tag: "JudgmentShadow",
            site: "completion-satisfied",
            judged: judgedStr,
            current,
            agreement: judgedStr === null ? null : judgedStr === current,
          })
          .pipe(Effect.catchAll(() => Effect.void));
      }),
    );
  });
}
