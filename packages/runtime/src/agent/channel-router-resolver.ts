/**
 * The runtime {@link AgentResolver}: turns a route target into a live agent session.
 *
 * One DISTINCT agent per (routeId, role), built on demand from the target's builder factory with
 * that role's tool surface applied before `build()` (see `channel-tool-narrowing.ts`). Histories
 * are never shared across roles: the session id carries the role. Sender text is passed as the
 * user message only; persona and instructions stay in the agent's own configuration. This module
 * deliberately does not reuse the gateway-bootstrap agent factory, which concatenates persona and
 * message into one user string.
 */
import { Cause, Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { RoutingError } from "@reactive-agents/channels";
import type { AgentResolver, OpenSessionRequest, RoutedReply, RoutedSession } from "@reactive-agents/channels";
import type { ReactiveAgentBuilder } from "../builder.js";
import { narrowToolSurface } from "./channel-tool-narrowing.js";
import { drainWithNarration, makeAcknowledge, toChannelHandle } from "./channel-ack-ports.js";
import type { AgentStreamEvent } from "../stream-types.js";

/** Builds a fresh builder for a route target; called once per (routeId, role). */
export type ChannelAgentFactory = () => ReactiveAgentBuilder;

/** The slice of a built agent the resolver uses (a `ReactiveAgent` satisfies it; tests pass plain doubles). */
export interface ChannelAgentHandle {
  readonly agentId: string;
  readonly dispose: () => Promise<void>;
  readonly session: (options: { readonly id: string; readonly persist: boolean }) => {
    readonly chat: (text: string) => Promise<{ readonly message: string; readonly tokens?: number; readonly cost?: number }>;
    readonly end: () => Promise<void>;
    /** Optional. Full-density stream of one turn; used to forward pre-tool narration. */
    readonly runStream?: (text: string, options: { readonly density: "full" }) => AsyncIterable<AgentStreamEvent>;
  };
  /**
   * Optional side completion (no tools, no history, outside the session's turn gate). Present means
   * the session offers `acknowledge` for `ack.source: "model"` routes.
   */
  readonly complete?: (params: {
    readonly systemPrompt: string;
    readonly messages: ReadonlyArray<{ readonly role: "user" | "assistant"; readonly content: string }>;
    readonly budgetTokens: number;
  }) => Promise<{ readonly message: string }>;
  /**
   * Optional. Empties the PERSISTED history of one session id (rejects when the store fails).
   * Without it, `reset` only clears the in-memory session.
   */
  readonly clearSessionHistory?: (sessionId: string) => Promise<void>;
  readonly run: (text: string) => Promise<{
    readonly output: string;
    readonly agentId: string;
    readonly taskId: string;
    readonly metadata: { readonly tokensUsed: number; readonly cost: number };
  }>;
}

/** Options for {@link makeChannelAgentResolver}. */
export interface ChannelAgentResolverOptions {
  /** Target agents by `RouteSpec.target.agentId`. */
  readonly agents: Readonly<Record<string, ChannelAgentFactory>>;
  /** Persist per-conversation history so a rebuilt agent resumes. Default `true`. */
  readonly persist?: boolean;
  /** Test seam: how a narrowed builder becomes an agent. Default `builder.build()`. */
  readonly build?: (builder: ReactiveAgentBuilder) => Promise<ChannelAgentHandle>;
}

/** The resolver plus the teardown for the agents it built. */
export interface ChannelAgentResolver extends AgentResolver {
  /** Dispose every agent the resolver built. Call once when the router stops. */
  readonly disposeAll: Effect.Effect<void>;
}

const resolveFailed = (req: OpenSessionRequest, message: string, cause?: unknown): RoutingError =>
  new RoutingError({ reason: "resolve_failed", message, routeId: req.routeId, ...(cause !== undefined ? { cause } : {}) });

/** Create the runtime resolver. */
export const makeChannelAgentResolver = (options: ChannelAgentResolverOptions): ChannelAgentResolver => {
  const build = options.build ?? ((b: ReactiveAgentBuilder) => b.build().then(toChannelHandle));
  const built = new Map<string, Promise<ChannelAgentHandle>>();

  const agentFor = (req: OpenSessionRequest): Effect.Effect<ChannelAgentHandle, RoutingError> => {
    const factory = options.agents[req.target.agentId];
    if (factory === undefined) {
      return Effect.fail(resolveFailed(req, `route ${req.routeId}: no agent registered for target "${req.target.agentId}"`));
    }
    const key = `${req.routeId}:${req.role}`;
    return Effect.tryPromise({
      try: () => {
        const cached = built.get(key);
        if (cached) return cached;
        const builder = factory();
        narrowToolSurface(builder, req.toolExposure);
        const pending = build(builder);
        built.set(key, pending);
        pending.catch(() => built.delete(key));
        return pending;
      },
      catch: (cause) => resolveFailed(req, `route ${req.routeId}: agent build failed`, cause),
    });
  };

  const open: AgentResolver["open"] = (req) =>
    Effect.gen(function* () {
      const agent = yield* agentFor(req);
      const sessionId = `${req.routeId}:${req.role}:${req.conversationKey}`;
      const session = req.stateless ? undefined : agent.session({ id: sessionId, persist: options.persist ?? true });
      // A rejecting (or sync-throwing) `end()` is a swallowed, audible failure: it must not die the
      // scope close and strand the remaining sessions.
      yield* Effect.addFinalizer(() =>
        session === undefined
          ? Effect.void
          : Effect.tryPromise({ try: async () => session.end(), catch: (cause) => cause }).pipe(
              Effect.catchAllCause((cause) =>
                emitErrorSwallowed({
                  site: "runtime/src/agent/channel-router-resolver.ts:session.end",
                  tag: errorTag(Cause.squash(cause)),
                }),
              ),
            ),
      );
      const turnFailed = (cause: unknown): RoutingError =>
        new RoutingError({ reason: "turn_failed", message: `route ${req.routeId}: turn failed`, routeId: req.routeId, cause });
      return {
        send: (turn) =>
          Effect.tryPromise({
            try: async (): Promise<RoutedReply> => {
              if (session && turn.onProgress && session.runStream) {
                const r = await drainWithNarration(session.runStream(turn.text, { density: "full" }), turn.onProgress);
                return { text: r.text, agentId: agent.agentId, tokens: r.tokens, costUsd: r.cost };
              }
              if (session) {
                const r = await session.chat(turn.text);
                return {
                  text: r.message,
                  agentId: agent.agentId,
                  ...(r.tokens !== undefined ? { tokens: r.tokens } : {}),
                  ...(r.cost !== undefined ? { costUsd: r.cost } : {}),
                };
              }
              const r = await agent.run(turn.text);
              return {
                text: r.output,
                agentId: r.agentId,
                tokens: r.metadata.tokensUsed,
                costUsd: r.metadata.cost,
                runId: r.taskId,
              };
            },
            catch: turnFailed,
          }),
        ...(agent.complete ? { acknowledge: makeAcknowledge(agent.complete) } : {}),
        // Per-conversation only (stateless has no history). `end()` flushes then clears the in-memory
        // history; the persisted copy is then emptied so a reopen, even after a restart, starts empty.
        // The close-time `end()` then saves the (now empty) history, which stays empty.
        ...(session
          ? {
              reset: Effect.tryPromise({
                try: async () => {
                  await session.end();
                  if (options.persist ?? true) await agent.clearSessionHistory?.(sessionId);
                },
                catch: turnFailed,
              }),
            }
          : {}),
        close: Effect.void,
      } satisfies RoutedSession;
    });

  return {
    open,
    disposeAll: Effect.promise(async () => {
      const agents = [...built.values()];
      built.clear();
      await Promise.allSettled(agents.map(async (a) => (await a).dispose()));
    }),
  };
};
