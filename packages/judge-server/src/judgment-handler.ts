import { Effect } from "effect";
import { JudgmentService, type JudgmentEntry } from "@reactive-agents/judgment";
import type { JudgeLayerResult, JudgeRequest, JudgeResponse, ReproducibilityMetadata } from "./contract.js";

/**
 * Task 5: the `jev` judge engine. Builds `JudgeResponse` from ONE batched
 * `passed` (Noul) + `overallScore` (Score) + `recommendation` (Choice)
 * request — no text prompt, no `indexOf("{")`, no `JSON.parse`, no
 * degraded-0.5 verdict. Compare `handler.ts`'s `parseJudgmentText`, which
 * this path has no equivalent of: a malformed answer here is a typed
 * `JudgmentError`, caught by the caller and mapped to `judge_engine_error`
 * (never fabricated).
 *
 * Scoping note: the original text-prompt path (`handler.ts`) decomposes
 * `taskCriteria` into per-requirement `layerResults` entries by asking the
 * judge LLM to enumerate them in free text. `taskCriteria` is an unstructured
 * string (`JudgeRequest.taskCriteria: Schema.optional(Schema.String)`) — there
 * is no structured requirement list to decompose at the type level, so this
 * path asks ONE partial-credit Score over the whole criteria instead of N
 * per-requirement questions. Restructuring `JudgeRequest` to carry structured
 * requirements (enabling true per-requirement `layerResults` here) is a
 * larger contract change, tracked in the plan's out-of-scope list rather than
 * done speculatively inside this task.
 */
const OVERALL_SCORE_LEVELS = [
  "Fails the criteria: most or all requirements are unmet, or the response is wrong in a way the criteria explicitly treat as a failure.",
  "Meets few requirements: roughly a quarter of what the criteria ask for is satisfied.",
  "Partially meets the criteria: roughly half of what's asked for is satisfied.",
  "Mostly meets the criteria: most requirements are satisfied, with minor gaps.",
  "Fully meets the criteria: all or nearly all requirements are satisfied.",
] as const;

export const handleJudgeRequestViaJudgment = (
  req: JudgeRequest,
  reproducibility: ReproducibilityMetadata,
): Effect.Effect<JudgeResponse, unknown, JudgmentService> =>
  Effect.gen(function* () {
    const judgment = yield* JudgmentService;

    const answers = yield* judgment.ask({
      state: {
        sutModel: req.sutModel,
        // `JudgeRequest.taskInput` is `Schema.Unknown` because the contract
        // accepts any already-decoded JSON value; it arrived via
        // `Schema.decodeUnknownEither(JudgeRequest)` over a parsed JSON
        // body (index.ts), so it is JSON-shaped by construction — a single
        // named-type cast, not a widening `as unknown as` escape.
        taskInput: req.taskInput as JudgmentEntry,
        sutResponse: req.sutResponse,
        ...(req.taskCriteria !== undefined ? { taskCriteria: req.taskCriteria } : {}),
      },
      questions: {
        passed: {
          type: "noul",
          instructions:
            "Does `sutResponse` satisfy `taskCriteria` well enough to accept as-is, with no human review needed?",
        },
        overallScore: {
          type: "score",
          instructions:
            "How well does `sutResponse` satisfy `taskCriteria`? Apply partial credit — this is the fraction of requirements satisfied, not an all-or-nothing check.",
          criteria: OVERALL_SCORE_LEVELS,
        },
        recommendation: {
          type: "choice",
          instructions: "Given `sutResponse` against `taskCriteria`, what should happen next?",
          criteria: {
            accept: "The response is good enough to accept without human review.",
            review: "The response is borderline, or the criteria are ambiguous — a human should look at it.",
            reject: "The response clearly fails the criteria.",
          },
        },
      },
    });

    const { passed: passedAnswer, overallScore: overallScoreAnswer, recommendation: recommendationAnswer } = answers;
    if (
      passedAnswer.kind !== "noul" ||
      overallScoreAnswer.kind !== "score" ||
      recommendationAnswer.kind !== "choice" ||
      !(recommendationAnswer.value === "accept" || recommendationAnswer.value === "review" || recommendationAnswer.value === "reject")
    ) {
      return yield* Effect.fail(
        new Error(
          `jev judge returned an unexpected answer shape: ${JSON.stringify({ passedAnswer, overallScoreAnswer, recommendationAnswer })}`,
        ),
      );
    }

    const maxIndex = OVERALL_SCORE_LEVELS.length - 1;
    const overallScore = Math.max(0, Math.min(1, overallScoreAnswer.value / maxIndex));
    const passed = passedAnswer.probability >= 0.5;

    const layerResults: JudgeLayerResult[] = [
      {
        layerName: "jev",
        score: overallScore,
        passed,
        details: `jev verdict: passed_p=${passedAnswer.probability.toFixed(2)} score_confidence=${overallScoreAnswer.confidence.toFixed(2)} recommendation_confidence=${recommendationAnswer.confidence.toFixed(2)}`,
      },
    ];

    return {
      taskId: req.taskId,
      passed,
      overallScore,
      recommendation: recommendationAnswer.value,
      layerResults,
      reproducibility,
    };
  });
