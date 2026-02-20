import { Context, Effect, Layer, Ref } from "effect";
import type { SessionId } from "../types/mode.js";
import type { CollaborationSession, CollaborationMessage } from "../types/collaboration.js";
import { SessionNotFoundError } from "../errors/errors.js";
import { EventBus } from "@reactive-agents/core";

export class CollaborationService extends Context.Tag("CollaborationService")<
  CollaborationService,
  {
    readonly startSession: (params: {
      agentId: string;
      taskId: string;
      thinkingVisible?: boolean;
      streamingEnabled?: boolean;
    }) => Effect.Effect<CollaborationSession>;

    readonly endSession: (
      sessionId: SessionId,
    ) => Effect.Effect<void, SessionNotFoundError>;

    readonly sendMessage: (params: {
      sessionId: SessionId;
      type: CollaborationMessage["type"];
      sender: "agent" | "user";
      content: string;
    }) => Effect.Effect<CollaborationMessage, SessionNotFoundError>;

    readonly getMessages: (
      sessionId: SessionId,
    ) => Effect.Effect<readonly CollaborationMessage[], SessionNotFoundError>;

    readonly getSession: (
      sessionId: SessionId,
    ) => Effect.Effect<CollaborationSession, SessionNotFoundError>;
  }
>() {}

export const CollaborationServiceLive = Layer.effect(
  CollaborationService,
  Effect.gen(function* () {
    const eventBus = yield* EventBus;
    const sessionsRef = yield* Ref.make<Map<string, CollaborationSession>>(new Map());
    const messagesRef = yield* Ref.make<Map<string, CollaborationMessage[]>>(new Map());

    return {
      startSession: (params) =>
        Effect.gen(function* () {
          const sessionId = crypto.randomUUID() as SessionId;
          const session: CollaborationSession = {
            id: sessionId,
            agentId: params.agentId,
            taskId: params.taskId,
            status: "active",
            thinkingVisible: params.thinkingVisible ?? true,
            streamingEnabled: params.streamingEnabled ?? false,
            questionStyle: "inline",
            rollbackEnabled: false,
            startedAt: new Date(),
          };

          yield* Ref.update(sessionsRef, (m) => {
            const next = new Map(m);
            next.set(sessionId, session);
            return next;
          });
          yield* Ref.update(messagesRef, (m) => {
            const next = new Map(m);
            next.set(sessionId, []);
            return next;
          });

          yield* eventBus.publish({
            _tag: "Custom",
            type: "interaction.collaboration-started",
            payload: session,
          });

          return session;
        }),

      endSession: (sessionId) =>
        Effect.gen(function* () {
          const sessions = yield* Ref.get(sessionsRef);
          const session = sessions.get(sessionId);
          if (!session) {
            return yield* Effect.fail(new SessionNotFoundError({ sessionId }));
          }

          yield* Ref.update(sessionsRef, (m) => {
            const next = new Map(m);
            next.set(sessionId, { ...session, status: "ended" as const, endedAt: new Date() });
            return next;
          });
        }),

      sendMessage: (params) =>
        Effect.gen(function* () {
          const sessions = yield* Ref.get(sessionsRef);
          if (!sessions.has(params.sessionId)) {
            return yield* Effect.fail(new SessionNotFoundError({ sessionId: params.sessionId }));
          }

          const message: CollaborationMessage = {
            id: crypto.randomUUID(),
            sessionId: params.sessionId,
            type: params.type,
            sender: params.sender,
            content: params.content,
            timestamp: new Date(),
          };

          yield* Ref.update(messagesRef, (m) => {
            const next = new Map(m);
            const existing = next.get(params.sessionId) ?? [];
            next.set(params.sessionId, [...existing, message]);
            return next;
          });

          return message;
        }),

      getMessages: (sessionId) =>
        Effect.gen(function* () {
          const sessions = yield* Ref.get(sessionsRef);
          if (!sessions.has(sessionId)) {
            return yield* Effect.fail(new SessionNotFoundError({ sessionId }));
          }
          const msgs = yield* Ref.get(messagesRef);
          return msgs.get(sessionId) ?? [];
        }),

      getSession: (sessionId) =>
        Effect.gen(function* () {
          const sessions = yield* Ref.get(sessionsRef);
          const session = sessions.get(sessionId);
          if (!session) {
            return yield* Effect.fail(new SessionNotFoundError({ sessionId }));
          }
          return session;
        }),
    };
  }),
);
