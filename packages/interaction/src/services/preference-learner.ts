import { Context, Effect, Layer, Ref } from "effect";
import type { UserPreference, ApprovalPattern } from "../types/preference.js";

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

          // Need enough confidence and occurrences
          if (pattern.confidence < 0.7 || pattern.occurrences < 3) return false;
          if (pattern.action !== "auto-approve") return false;

          // Check cost threshold
          if (params.cost && pattern.costThreshold && params.cost > pattern.costThreshold) {
            return false;
          }

          return true;
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
