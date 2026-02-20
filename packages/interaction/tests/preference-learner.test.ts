import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { PreferenceLearner, PreferenceLearnerLive } from "../src/services/preference-learner.js";

const run = <A, E>(effect: Effect.Effect<A, E, PreferenceLearner>) =>
  effect.pipe(Effect.provide(PreferenceLearnerLive), Effect.runPromise);

describe("PreferenceLearner", () => {
  it("should return default preferences for new users", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* PreferenceLearner;
        return yield* svc.getPreference("user-1");
      }),
    );
    expect(result.userId).toBe("user-1");
    expect(result.learningEnabled).toBe(true);
    expect(result.interruptionTolerance).toBe("medium");
    expect(result.approvalPatterns).toHaveLength(0);
  });

  it("should record approvals and build patterns", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* PreferenceLearner;
        yield* svc.recordApproval({ userId: "user-1", taskType: "code-review", approved: true });
        yield* svc.recordApproval({ userId: "user-1", taskType: "code-review", approved: true });

        const pref = yield* svc.getPreference("user-1");
        expect(pref.approvalPatterns).toHaveLength(1);
        expect(pref.approvalPatterns[0]!.occurrences).toBe(2);
        expect(pref.approvalPatterns[0]!.action).toBe("auto-approve");
        return pref;
      }),
    );
    expect(result.approvalPatterns[0]!.confidence).toBeGreaterThan(0.3);
  });

  it("should not auto-approve with insufficient data", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* PreferenceLearner;
        yield* svc.recordApproval({ userId: "user-1", taskType: "deploy", approved: true });
        return yield* svc.shouldAutoApprove({ userId: "user-1", taskType: "deploy" });
      }),
    );
    expect(result).toBe(false); // Only 1 occurrence, needs 3+
  });

  it("should update interruption tolerance", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* PreferenceLearner;
        yield* svc.updateTolerance("user-1", "low");
        return yield* svc.getPreference("user-1");
      }),
    );
    expect(result.interruptionTolerance).toBe("low");
  });
});
