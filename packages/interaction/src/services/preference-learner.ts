import { Context, Effect, Either, Layer, Option, Ref } from "effect";
import { EventBus } from "@reactive-agents/core";
import { JudgmentService } from "@reactive-agents/judgment";
import type { UserPreference, ApprovalPattern } from "../types/preference.js";
import {
  buildAutonomyConfidenceQuestions,
  buildAutonomyConfidenceState,
  answerToSafeToAutoApprove,
  answerToPreferenceMatchLabel,
  confidenceToPreferenceMatchLabel,
} from "./autonomy-confidence-questions.js";

/**
 * Task 11b (shadow-only — see plan's "highest blast radius" note; no
 * inversion step is written in this task). Fires the batched
 * `preferenceMatch`/`safeToAutoApprove` judgment questions via
 * `Effect.forkDaemon` — never awaited, never altering `current` (the boolean
 * `shouldAutoApprove` actually returns, decided by the existing
 * confidence/occurrences/action/cost-threshold gate above). Emits
 * `JudgmentShadow` tagged `site: "autonomy-confidence"` — distinct from
 * every other shadow site, so its agreement data is never averaged into a
 * less-sensitive site's ablation numbers. `Effect.serviceOption` resolution
 * of `JudgmentService`/`EventBus` means an unconfigured judgment layer is a
 * clean, zero-cost no-op — this function's (and `shouldAutoApprove`'s)
 * requirements stay unwidened.
 */
function autonomyConfidenceShadow(
  pattern: ApprovalPattern,
  cost: number | undefined,
  current: boolean,
): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const maybeJudgment = yield* Effect.serviceOption(JudgmentService);
    if (Option.isNone(maybeJudgment)) return;
    const maybeEventBus = yield* Effect.serviceOption(EventBus);
    if (Option.isNone(maybeEventBus)) return;
    const judgment = maybeJudgment.value;
    const eventBus = maybeEventBus.value;

    yield* Effect.forkDaemon(
      Effect.gen(function* () {
        const result = yield* judgment
          .ask({
            state: buildAutonomyConfidenceState({
              taskType: pattern.taskType,
              occurrences: pattern.occurrences,
              heuristicConfidence: pattern.confidence,
              recordedAction: pattern.action,
              costThreshold: pattern.costThreshold,
              cost,
            }),
            questions: buildAutonomyConfidenceQuestions(),
          })
          .pipe(Effect.either);

        const safe = Either.isRight(result) ? answerToSafeToAutoApprove(result.right.safeToAutoApprove) : null;
        const judged = safe === null ? null : String(safe);
        const currentStr = String(current);

        yield* eventBus.publish({
          _tag: "JudgmentShadow",
          site: "autonomy-confidence",
          judged,
          current: currentStr,
          agreement: judged === null ? null : judged === currentStr,
        });

        // `preferenceMatch` is otherwise computed and discarded — surface it
        // too (a distinct site, so it never mixes into the boolean-agreement
        // stats above) rather than paying for an unread judgment answer.
        const matchLabel = Either.isRight(result) ? answerToPreferenceMatchLabel(result.right.preferenceMatch) : null;
        const currentMatchLabel = confidenceToPreferenceMatchLabel(pattern.confidence);
        yield* eventBus.publish({
          _tag: "JudgmentShadow",
          site: "autonomy-confidence-match",
          judged: matchLabel,
          current: currentMatchLabel,
          agreement: matchLabel === null ? null : matchLabel === currentMatchLabel,
        });
      }),
    );
  });
}

export class PreferenceLearner extends Context.Tag("PreferenceLearner")<
  PreferenceLearner,
  {
    readonly getPreference: (userId: string) => Effect.Effect<UserPreference>;

    readonly recordApproval: (params: {
      userId: string;
      taskType: string;
      approved: boolean;
      cost?: number;
    }) => Effect.Effect<void>;

    readonly shouldAutoApprove: (params: {
      userId: string;
      taskType: string;
      cost?: number;
    }) => Effect.Effect<boolean>;

    readonly updateTolerance: (
      userId: string,
      tolerance: "low" | "medium" | "high",
    ) => Effect.Effect<void>;
  }
>() {}

export const PreferenceLearnerLive = Layer.effect(
  PreferenceLearner,
  Effect.gen(function* () {
    const prefsRef = yield* Ref.make<Map<string, UserPreference>>(new Map());

    const getOrCreatePref = (userId: string): Effect.Effect<UserPreference> =>
      Ref.get(prefsRef).pipe(
        Effect.map((m) =>
          m.get(userId) ?? {
            userId,
            learningEnabled: true,
            interruptionTolerance: "medium" as const,
            approvalPatterns: [],
            lastUpdated: new Date(),
          },
        ),
      );

    return {
      getPreference: (userId) => getOrCreatePref(userId),

      recordApproval: (params) =>
        Effect.gen(function* () {
          const pref = yield* getOrCreatePref(params.userId);
          const existing = pref.approvalPatterns.find(
            (p) => p.taskType === params.taskType,
          );

          let updatedPatterns: ApprovalPattern[];

          if (existing) {
            updatedPatterns = pref.approvalPatterns.map((p) =>
              p.taskType === params.taskType
                ? {
                    ...p,
                    occurrences: p.occurrences + 1,
                    confidence: Math.min(1.0, p.confidence + 0.1),
                    action: params.approved ? ("auto-approve" as const) : p.action,
                    lastSeen: new Date(),
                  }
                : p,
            );
          } else {
            updatedPatterns = [
              ...pref.approvalPatterns,
              {
                id: crypto.randomUUID(),
                taskType: params.taskType,
                costThreshold: params.cost,
                action: params.approved ? ("auto-approve" as const) : ("ask" as const),
                confidence: 0.3,
                occurrences: 1,
                lastSeen: new Date(),
              },
            ];
          }

          yield* Ref.update(prefsRef, (m) => {
            const next = new Map(m);
            next.set(params.userId, {
              ...pref,
              approvalPatterns: updatedPatterns,
              lastUpdated: new Date(),
            });
            return next;
          });
        }),

      shouldAutoApprove: (params) =>
        Effect.gen(function* () {
          const pref = yield* getOrCreatePref(params.userId);
          if (!pref.learningEnabled) return false;

          const pattern = pref.approvalPatterns.find(
            (p) => p.taskType === params.taskType,
          );
          if (!pattern) return false;

          // Existing heuristic gate — needs enough confidence and occurrences,
          // an "auto-approve" action, and no cost-threshold breach. Unchanged
          // by Task 11b: the judgment shadow below never feeds back into this.
          const decision =
            pattern.confidence >= 0.7 &&
            pattern.occurrences >= 3 &&
            pattern.action === "auto-approve" &&
            // Preserves the original truthy check's semantics: a falsy
            // `costThreshold` (including 0, "no limit set") skips the check.
            !(params.cost && pattern.costThreshold && params.cost > pattern.costThreshold);

          yield* autonomyConfidenceShadow(pattern, params.cost, decision);

          return decision;
        }),

      updateTolerance: (userId, tolerance) =>
        Effect.gen(function* () {
          const pref = yield* getOrCreatePref(userId);
          yield* Ref.update(prefsRef, (m) => {
            const next = new Map(m);
            next.set(userId, {
              ...pref,
              interruptionTolerance: tolerance,
              lastUpdated: new Date(),
            });
            return next;
          });
        }),
    };
  }),
);
