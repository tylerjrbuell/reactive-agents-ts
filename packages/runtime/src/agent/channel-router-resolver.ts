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
import { Effect } from "effect";
import { RoutingError } from "@reactive-agents/channels";
import type { AgentResolver, OpenSessionRequest, RoutedReply, RoutedSession } from "@reactive-agents/channels";
import type { ReactiveAgentBuilder } from "../builder.js";
import { narrowToolSurface } from "./channel-tool-narrowing.js";

/** Builds a fresh builder for a route target; called once per (routeId, role). */
export type ChannelAgentFactory = () => ReactiveAgentBuilder;

/** The slice of a built agent the resolver uses (a `ReactiveAgent` satisfies it; tests pass plain doubles). */
export interface ChannelAgentHandle {
  readonly agentId: string;
  readonly dispose: () => Promise<void>;
  readonly session: (options: { readonly id: string; readonly persist: boolean }) => {
    readonly chat: (text: string) => Promise<{ readonly message: string; readonly tokens?: number; readonly cost?: number }>;
    readonly end: () => Promise<void>;
  };
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
  const build = options.build ?? ((b: ReactiveAgentBuilder) => b.build());
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
      yield* Effect.addFinalizer(() => Effect.promise(() => session?.end() ?? Promise.resolve()).pipe(Effect.ignore));
      const turnFailed = (cause: unknown): RoutingError =>
        new RoutingError({ reason: "turn_failed", message: `route ${req.routeId}: turn failed`, routeId: req.routeId, cause });
      return {
        send: (turn) =>
          Effect.tryPromise({
            try: async (): Promise<RoutedReply> => {
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
