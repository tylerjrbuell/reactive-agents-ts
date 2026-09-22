import { describe, expect, it } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { JudgmentService, makeJudgmentServiceLive, withEvents } from "../src/services/judgment-service.js";
import { JudgmentTimeout, type JudgmentAnswers, type JudgmentBackend, type QuestionSpecs } from "../src/types.js";

const QUESTIONS: QuestionSpecs = {
  onTopic: { type: "noul", instructions: "on topic?" },
};

const fakeBackend = (
  result: () => Effect.Effect<JudgmentAnswers, JudgmentTimeout>,
): JudgmentBackend => ({
  name: "fake",
  evaluate: () => result(),
});

describe("JudgmentService", () => {
  it("ask() delegates to the wired JudgmentBackend", async () => {
    const backend = fakeBackend(() =>
      Effect.succeed({ onTopic: { kind: "noul", probability: 0.9 } }),
    );
    const layer = makeJudgmentServiceLive(backend);

    const answers = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* JudgmentService;
        return yield* svc.ask({ state: "x", questions: QUESTIONS });
      }).pipe(Effect.provide(layer)),
    );

    expect(answers.onTopic).toEqual({ kind: "noul", probability: 0.9 });
  });

  it("withEvents emits judgment:evaluated on success, never carrying the API key", async () => {
    const backend = fakeBackend(() =>
      Effect.succeed({ onTopic: { kind: "noul", probability: 0.42 } }),
    );
    const baseLayer = makeJudgmentServiceLive(backend);
    const layer = withEvents("test-site", "jev").pipe(
      Layer.provide(baseLayer),
      Layer.provideMerge(EventBusLive),
    );

    const captured = await Effect.runPromise(
      Effect.gen(function* () {
        const events = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.subscribe((event) => Ref.update(events, (es) => [...es, event]));

        const svc = yield* JudgmentService;
        yield* svc.ask({ state: "x", questions: QUESTIONS });

        return yield* Ref.get(events);
      }).pipe(Effect.provide(layer)),
    );

    expect(captured).toHaveLength(1);
    const event = captured[0];
    expect(event?._tag).toBe("JudgmentEvaluated");
    if (event?._tag === "JudgmentEvaluated") {
      expect(event.site).toBe("test-site");
      expect(event.backend).toBe("jev");
      expect(event.answers).toEqual([{ id: "onTopic", kind: "noul", value: 0.42 }]);
    }
    expect(JSON.stringify(captured)).not.toContain("api-key");
  });

  it("withEvents emits judgment:failed on backend error, and ask() still fails (degrade happens at the CONSUMER boundary)", async () => {
    const backend = fakeBackend(() =>
      Effect.fail(new JudgmentTimeout({ message: "too slow", timeoutMs: 3000 })),
    );
    const baseLayer = makeJudgmentServiceLive(backend);
    const layer = withEvents("test-site", "jev").pipe(
      Layer.provide(baseLayer),
      Layer.provideMerge(EventBusLive),
    );

    const [error, captured] = await Effect.runPromise(
      Effect.gen(function* () {
        const events = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.subscribe((event) => Ref.update(events, (es) => [...es, event]));

        const svc = yield* JudgmentService;
        const err = yield* svc.ask({ state: "x", questions: QUESTIONS }).pipe(Effect.flip);

        return [err, yield* Ref.get(events)] as const;
      }).pipe(Effect.provide(layer)),
    );

    expect(error).toBeInstanceOf(JudgmentTimeout);
    expect(captured).toHaveLength(1);
    expect(captured[0]?._tag).toBe("JudgmentFailed");
    if (captured[0]?._tag === "JudgmentFailed") {
      expect(captured[0].errorTag).toBe("JudgmentTimeout");
    }
  });
});
