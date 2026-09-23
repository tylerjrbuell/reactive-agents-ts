import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import { JudgmentService } from "@reactive-agents/judgment";
import type { JudgmentAnswers, JudgmentError } from "@reactive-agents/judgment";
import { PreferenceLearner, PreferenceLearnerLive } from "../src/services/preference-learner.js";
import { CheckpointService, CheckpointServiceLive } from "../src/services/checkpoint-service.js";

/**
 * Task 11b (shadow-only, highest blast radius — see the plan's dedicated
 * exit-gate note). Pins: the judgment shadow never alters the existing
 * confidence/occurrences/action/cost-threshold auto-approve gate, a failing
 * judgment backend leaves that gate fully in control, and
 * `CheckpointService`'s human-escalation path stays untouched.
 */

const makeFakeJudgmentLayer = (safeToAutoApprove: number) =>
  Layer.succeed(JudgmentService, {
    ask: (input) =>
      Effect.succeed({
        preferenceMatch: { kind: "score", value: 2, probabilities: {}, confidence: 0.9, calibrated: true },
        safeToAutoApprove: { kind: "noul", probability: safeToAutoApprove },
      } as unknown as JudgmentAnswers<typeof input.questions>),
  });

const FailingJudgmentLayer = Layer.succeed(JudgmentService, {
  ask: () => Effect.fail({ _tag: "JudgmentTimeout", message: "too slow", timeoutMs: 3000 } as unknown as JudgmentError),
});

/**
 * Builds an established, auto-approving pattern (occurrences ≥ 3, confidence
 * ≥ 0.7). Confidence starts at 0.3 and gains +0.1 per repeat occurrence, so
 * 5 approvals (0.3 → 0.7) are needed to clear the gate.
 */
const withEstablishedPattern = (userId: string, taskType: string) =>
  Effect.gen(function* () {
    const svc = yield* PreferenceLearner;
    for (let i = 0; i < 5; i++) {
      yield* svc.recordApproval({ userId, taskType, approved: true });
    }
  });

describe("Task 11b: autonomy-confidence shadow", () => {
  it("shadow never alters the auto-approve decision, even when the judgment disagrees", async () => {
    const layer = Layer.mergeAll(PreferenceLearnerLive, makeFakeJudgmentLayer(0.02));

    const decision = await Effect.runPromise(
      Effect.gen(function* () {
        yield* withEstablishedPattern("user-1", "code-review");
        const svc = yield* PreferenceLearner;
        return yield* svc.shouldAutoApprove({ userId: "user-1", taskType: "code-review" });
      }).pipe(Effect.provide(layer)),
    );

    // Heuristic gate says approve; fake judgment says unsafe (0.02) — decision is unaffected.
    expect(decision).toBe(true);
  });

  it("a failing judgment backend leaves the static gate fully in control", async () => {
    const layer = Layer.mergeAll(PreferenceLearnerLive, FailingJudgmentLayer);

    const decision = await Effect.runPromise(
      Effect.gen(function* () {
        yield* withEstablishedPattern("user-1", "code-review");
        const svc = yield* PreferenceLearner;
        return yield* svc.shouldAutoApprove({ userId: "user-1", taskType: "code-review" });
      }).pipe(Effect.provide(layer)),
    );

    expect(decision).toBe(true);
  });

  it("fires JudgmentShadow tagged site: autonomy-confidence with an agreement verdict", async () => {
    const layer = Layer.mergeAll(PreferenceLearnerLive, EventBusLive, makeFakeJudgmentLayer(0.95));

    const captured: Array<{ readonly site: string; readonly judged: string | null; readonly current: string; readonly agreement: boolean | null }> = [];
    const decision = await Effect.runPromise(
      Effect.gen(function* () {
        const eventBus = yield* EventBus;
        yield* eventBus.on("JudgmentShadow", (event) => Effect.sync(() => captured.push(event)));
        yield* withEstablishedPattern("user-1", "deploy");
        const svc = yield* PreferenceLearner;
        return yield* svc.shouldAutoApprove({ userId: "user-1", taskType: "deploy" });
      }).pipe(Effect.provide(layer)),
    );

    expect(decision).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.site).toBe("autonomy-confidence");
    expect(captured[0]!.current).toBe("true");
    expect(captured[0]!.judged).toBe("true");
    expect(captured[0]!.agreement).toBe(true);
  });

  it("does not fire a shadow when no pattern exists yet (nothing to judge)", async () => {
    const layer = Layer.mergeAll(PreferenceLearnerLive, EventBusLive, makeFakeJudgmentLayer(0.95));

    const captured: unknown[] = [];
    const decision = await Effect.runPromise(
      Effect.gen(function* () {
        const eventBus = yield* EventBus;
        yield* eventBus.on("JudgmentShadow", (event) => Effect.sync(() => captured.push(event)));
        const svc = yield* PreferenceLearner;
        return yield* svc.shouldAutoApprove({ userId: "new-user", taskType: "code-review" });
      }).pipe(Effect.provide(layer)),
    );

    expect(decision).toBe(false);
    expect(captured).toHaveLength(0);
  });

  it("CheckpointService's human-escalation path (resolveCheckpoint) is untouched in shadow mode", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const checkpoints = yield* CheckpointService;
        const cp = yield* checkpoints.createCheckpoint({
          agentId: "agent-1",
          taskId: "task-1",
          milestoneName: "review",
          description: "human review required",
        });
        return yield* checkpoints.resolveCheckpoint(cp.id, "approved", "looks good");
      }).pipe(Effect.provide(CheckpointServiceLive.pipe(Layer.provide(EventBusLive)))),
    );

    expect(result.status).toBe("approved");
  });
});
