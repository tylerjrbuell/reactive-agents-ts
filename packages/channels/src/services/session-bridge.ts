import { Effect } from "effect";
import { SessionResolutionError } from "../errors.js";
import type {
  AgentSessionFactory,
  ExternalIdentity,
  SessionBridgeResolveParams,
  TriggerAgentConfig,
} from "../types.js";

export interface SessionBridgeDeps {
  readonly agentFactory: AgentSessionFactory;
}

/**
 * Maps external identities to agent chat sessions (bot DM keys, webhook sender ids, etc.).
 * One chat handle per composite key; sequential turns share the same session.
 */
export class SessionBridge {
  private readonly agentFactory: AgentSessionFactory;
  private readonly chatByKey = new Map<
    string,
    { sessionId: string; chat: (message: string) => Promise<{ message: string; tokens?: number }> }
  >();
  private readonly chainByKey = new Map<string, Promise<unknown>>();

  constructor(deps: SessionBridgeDeps) {
    this.agentFactory = deps.agentFactory;
  }

  private compositeKey(identity: ExternalIdentity, channelId: string): string {
    return `${identity.platform}:${identity.userId}:${channelId}`;
  }

  private makeSessionId(key: string): string {
    return `ch-sess-${key.replace(/[^a-zA-Z0-9:_-]+/g, "_")}`;
  }

  /**
   * Returns an existing session id + chat handle or creates one via {@link AgentSessionFactory}.
   */
  ensureSession(params: SessionBridgeResolveParams): Effect.Effect<
    { readonly sessionId: string; readonly chat: (message: string) => Promise<{ message: string; tokens?: number }> },
    SessionResolutionError
  > {
    const key = this.compositeKey(params.identity, params.channelId);
    const existing = this.chatByKey.get(key);
    if (existing) {
      return Effect.succeed({ sessionId: existing.sessionId, chat: existing.chat });
    }
    const sessionId = this.makeSessionId(key);
    return Effect.tryPromise({
      try: async () => {
        const session = await this.agentFactory(params.agentConfig, sessionId);
        this.chatByKey.set(key, { sessionId, chat: session.chat });
        return { sessionId, chat: session.chat };
      },
      catch: (cause) =>
        new SessionResolutionError({
          externalId: params.identity,
          reason: "agent_factory_failed",
          cause,
        }),
    });
  }

  /**
   * Runs `chat(content)` for the session, serialized per composite key so concurrent
   * inbound events for the same user/channel are processed FIFO.
   */
  runChatTurn(
    params: SessionBridgeResolveParams,
    content: string,
  ): Effect.Effect<{ readonly sessionId: string; readonly reply: string }, SessionResolutionError> {
    const key = this.compositeKey(params.identity, params.channelId);
    const self = this;
    return Effect.gen(function* () {
      const { sessionId, chat } = yield* self.ensureSession(params);
      const prev = self.chainByKey.get(key) ?? Promise.resolve();
      const run = prev.then(() => chat(content));
      self.chainByKey.set(key, run);
      const out = yield* Effect.tryPromise({
        try: () => run,
        catch: (cause) =>
          new SessionResolutionError({
            externalId: params.identity,
            reason: "chat_failed",
            cause,
          }),
      });
      return { sessionId, reply: out.message };
    });
  }

  release(identity: ExternalIdentity, channelId: string): Effect.Effect<void, never> {
    const key = this.compositeKey(identity, channelId);
    this.chatByKey.delete(key);
    this.chainByKey.delete(key);
    return Effect.void;
  }

  /** @internal — merge static agent config with optional per-message derive (caller resolves derive). */
  static mergeAgentConfig(base: TriggerAgentConfig | undefined, patch: Partial<TriggerAgentConfig> | undefined): TriggerAgentConfig | undefined {
    if (!base && !patch) return undefined;
    return { ...(base ?? {}), ...(patch ?? {}) };
  }
}
