import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { CollaborationService, CollaborationServiceLive } from "../src/services/collaboration-service.js";
import { EventBusLive } from "@reactive-agents/core";

const TestLayer = CollaborationServiceLive.pipe(Layer.provide(EventBusLive));

const run = <A, E>(effect: Effect.Effect<A, E, CollaborationService>) =>
  effect.pipe(Effect.provide(TestLayer), Effect.runPromise);

describe("CollaborationService", () => {
  it("should start and end a session", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* CollaborationService;
        const session = yield* svc.startSession({
          agentId: "agent-1",
          taskId: "task-1",
        });
        expect(session.status).toBe("active");
        expect(session.thinkingVisible).toBe(true);

        yield* svc.endSession(session.id);
        const ended = yield* svc.getSession(session.id);
        expect(ended.status).toBe("ended");
        return ended;
      }),
    );
    expect(result.endedAt).toBeDefined();
  });

  it("should send and retrieve messages", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* CollaborationService;
        const session = yield* svc.startSession({
          agentId: "agent-1",
          taskId: "task-1",
        });

        yield* svc.sendMessage({
          sessionId: session.id,
          type: "thought",
          sender: "agent",
          content: "Analyzing the problem...",
        });
        yield* svc.sendMessage({
          sessionId: session.id,
          type: "question",
          sender: "agent",
          content: "Which approach do you prefer?",
        });
        yield* svc.sendMessage({
          sessionId: session.id,
          type: "answer",
          sender: "user",
          content: "Option A",
        });

        return yield* svc.getMessages(session.id);
      }),
    );
    expect(result).toHaveLength(3);
    expect(result[0]!.type).toBe("thought");
    expect(result[2]!.sender).toBe("user");
  });

  it("should fail on unknown session", async () => {
    const result = await Effect.gen(function* () {
      const svc = yield* CollaborationService;
      return yield* svc.getSession("nonexistent" as any).pipe(Effect.flip);
    }).pipe(Effect.provide(TestLayer), Effect.runPromise);

    expect(result._tag).toBe("SessionNotFoundError");
  });
});
