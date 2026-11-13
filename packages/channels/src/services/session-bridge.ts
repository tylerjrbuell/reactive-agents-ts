import { Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { SessionResolutionError } from "../errors.js";
import type {
  AgentLifecycle,
  AgentSessionFactory,
  ExternalIdentity,
  SessionBridgeResolveParams,
  TriggerAgentConfig,
} from "../types.js";

export interface SessionBridgeDeps {
  readonly agentFactory: AgentSessionFactory;
  /** Maximum live sessions; the least recently used is evicted beyond it. Default 500. */
  readonly maxSessions?: number;
  /** Idle time before a `conversation` session is torn down when the lifecycle sets none. Default 30 minutes. */
  readonly idleTimeoutMs?: number;
  /** Clock in epoch ms. Defaults to `Date.now`; tests inject one. */
  readonly now?: () => number;
}

/** Default bound on live per-sender sessions (each holds an agent). */
export const DEFAULT_MAX_SESSIONS = 500;
/** Default idle time before a `conversation` session is torn down (spec 7.10). */
export const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 30 * 60_000;

type Chat = (message: string) => Promise<{ message: string; tokens?: number }>;

interface Entry {
  readonly sessionId: string;
  readonly chat: Chat;
  readonly close: (() => Promise<void>) | undefined;
  readonly createdAt: number;
  lastActiveAt: number;
  /** Turns started and not finished. A session with turns in flight is never torn down. */
  inFlight: number;
  lifecycle: AgentLifecycle | undefined;
}

/**
 * Maps external identities to agent chat sessions (bot DM keys, webhook sender ids, etc.).
 * One chat handle per composite key; sequential turns share the same session.
 *
 * Lifecycle (on-demand spin-up, spec 7.10). The agent is built on the first turn and torn down by
 * the trigger's {@link AgentLifecycle}:
 * - `single_response`: fresh session id per build, torn down when the turn ends (no memory).
 * - `conversation`: torn down after `idleTimeoutMs` without a turn.
 * - `ttl`: torn down `durationMs` after it was built.
 * - `persistent` or none: held until evicted (LRU) or released.
 *
 * Teardown closes the agent but keeps the session id stable for `conversation`, `ttl` and
 * `persistent`, so a rebuilt agent resumes persisted history. Expiry is checked lazily on the next
 * turn and by {@link SessionBridge.sweep}; there are no timers to leak.
 */
export class SessionBridge {
  private readonly agentFactory: AgentSessionFactory;
  private readonly chatByKey = new Map<string, Entry>();
  private readonly chainByKey = new Map<string, Effect.Semaphore>();
  private readonly maxSessions: number;
  private readonly idleTimeoutMs: number;
  private readonly now: () => number;
  private oneShots = 0;

  constructor(deps: SessionBridgeDeps) {
    this.agentFactory = deps.agentFactory;
    this.maxSessions = Math.max(1, deps.maxSessions ?? DEFAULT_MAX_SESSIONS);
    this.idleTimeoutMs = deps.idleTimeoutMs ?? DEFAULT_SESSION_IDLE_TIMEOUT_MS;
    this.now = deps.now ?? Date.now;
  }

  /** Insert as most-recent; returns the least-recently-used entries evicted beyond the bound. */
  private remember(key: string, value: Entry): Entry[] {
    this.chatByKey.delete(key);
    this.chatByKey.set(key, value);
    const evicted: Entry[] = [];
    while (this.chatByKey.size > this.maxSessions) {
      const oldest = this.chatByKey.keys().next().value;
      if (oldest === undefined) break;
      const entry = this.chatByKey.get(oldest);
      this.chatByKey.delete(oldest);
      this.chainByKey.delete(oldest);
      if (entry) evicted.push(entry);
    }
    return evicted;
  }

  private gateFor(key: string): Effect.Semaphore {
    let gate = this.chainByKey.get(key);
    if (!gate) {
      gate = Effect.unsafeMakeSemaphore(1);
      this.chainByKey.set(key, gate);
    }
    return gate;
  }

  private compositeKey(identity: ExternalIdentity, channelId: string): string {
    return `${identity.platform}:${identity.userId}:${channelId}`;
  }

  private makeSessionId(key: string, lifecycle: AgentLifecycle | undefined): string {
    const base = `ch-sess-${key.replace(/[^a-zA-Z0-9:_-]+/g, "_")}`;
    return lifecycle?.type === "single_response" ? `${base}-once${++this.oneShots}` : base;
  }

  private isExpired(entry: Entry, lifecycle: AgentLifecycle | undefined): boolean {
    if (entry.inFlight > 0 || !lifecycle) return false;
    const now = this.now();
    switch (lifecycle.type) {
      case "conversation":
        return now - entry.lastActiveAt >= (lifecycle.idleTimeoutMs ?? this.idleTimeoutMs);
      case "ttl":
        return now - entry.createdAt >= lifecycle.durationMs;
      case "single_response":
      case "persistent":
        return false;
    }
  }

  /** Close a torn-down agent. A failing close ends as an `ErrorSwallowed` event, never a crash. */
  private closeEntry(entry: Entry): Effect.Effect<void> {
    const close = entry.close;
    if (!close) return Effect.void;
    return Effect.tryPromise({ try: close, catch: (cause) => cause }).pipe(
      Effect.catchAll((cause) =>
        emitErrorSwallowed({ site: "channels/src/services/session-bridge.ts:close", tag: errorTag(cause) }),
      ),
    );
  }

  private drop(key: string, entry: Entry): Effect.Effect<void> {
    if (this.chatByKey.get(key) === entry) {
      this.chatByKey.delete(key);
      this.chainByKey.delete(key);
    }
    return this.closeEntry(entry);
  }

  /**
   * Returns an existing session id + chat handle or creates one via {@link AgentSessionFactory}.
   * An expired session is torn down first, so the caller gets a freshly built agent on the same
   * session id (history resumes when the factory persists by id).
   */
  ensureSession(params: SessionBridgeResolveParams): Effect.Effect<
    { readonly sessionId: string; readonly chat: Chat },
    SessionResolutionError
  > {
    const key = this.compositeKey(params.identity, params.channelId);
    const self = this;
    return Effect.gen(function* () {
      const existing = self.chatByKey.get(key);
      if (existing) {
        const lifecycle = params.lifecycle ?? existing.lifecycle;
        if (!self.isExpired(existing, lifecycle)) {
          existing.lifecycle = lifecycle;
          existing.lastActiveAt = self.now();
          self.remember(key, existing); // touch: most recently used
          return { sessionId: existing.sessionId, chat: existing.chat };
        }
        yield* self.drop(key, existing);
      }
      const sessionId = self.makeSessionId(key, params.lifecycle);
      const created = yield* Effect.tryPromise({
        try: () => self.agentFactory(params.agentConfig, sessionId),
        catch: (cause) =>
          new SessionResolutionError({
            externalId: params.identity,
            reason: "agent_factory_failed",
            cause,
          }),
      });
      const now = self.now();
      const entry: Entry = {
        sessionId,
        chat: created.chat,
        close: created.close,
        createdAt: now,
        lastActiveAt: now,
        inFlight: 0,
        lifecycle: params.lifecycle,
      };
      for (const evicted of self.remember(key, entry)) yield* self.closeEntry(evicted);
      return { sessionId, chat: created.chat };
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
      const entry = self.chatByKey.get(key);
      if (entry) entry.inFlight += 1;
      const finish = Effect.suspend(() => {
        if (!entry) return Effect.void;
        entry.inFlight -= 1;
        entry.lastActiveAt = self.now();
        const lifecycle = params.lifecycle ?? entry.lifecycle;
        return lifecycle?.type === "single_response" && entry.inFlight === 0 ? self.drop(key, entry) : Effect.void;
      });
      // One permit per key: turns run FIFO and a failed turn releases it, so the next turn still runs.
      const gate = self.gateFor(key);
      const out = yield* gate
        .withPermits(1)(
          Effect.tryPromise({
            try: () => chat(content),
            catch: (cause) =>
              new SessionResolutionError({
                externalId: params.identity,
                reason: "chat_failed",
                cause,
              }),
          }),
        )
        .pipe(Effect.ensuring(finish));
      return { sessionId, reply: out.message };
    });
  }

  /** Tear down every idle or expired session now. Returns how many were closed. */
  sweep(): Effect.Effect<number> {
    const self = this;
    return Effect.gen(function* () {
      let closed = 0;
      for (const [key, entry] of [...self.chatByKey]) {
        if (self.isExpired(entry, entry.lifecycle)) {
          yield* self.drop(key, entry);
          closed += 1;
        }
      }
      return closed;
    });
  }

  /** Number of live chat sessions held. */
  size(): number {
    return this.chatByKey.size;
  }

  release(identity: ExternalIdentity, channelId: string): Effect.Effect<void, never> {
    const key = this.compositeKey(identity, channelId);
    const entry = this.chatByKey.get(key);
    this.chatByKey.delete(key);
    this.chainByKey.delete(key);
    return entry ? this.closeEntry(entry) : Effect.void;
  }

  /** @internal — merge static agent config with optional per-message derive (caller resolves derive). */
  static mergeAgentConfig(base: TriggerAgentConfig | undefined, patch: Partial<TriggerAgentConfig> | undefined): TriggerAgentConfig | undefined {
    if (!base && !patch) return undefined;
    return { ...(base ?? {}), ...(patch ?? {}) };
  }
}
