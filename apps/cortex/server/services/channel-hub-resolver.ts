/**
 * The hub's `AgentResolver`: turns a route target into a live agent session.
 *
 * Target kind `agent` (a saved agent, gateway or ad-hoc) is built through the one Cortex build path
 * (`cortexAgentBuilder`, the same funnel as chat, desk runs and gateway agents) from the agent's saved
 * config, headless (a gated tool call is refused; nothing can hang waiting for an approver on a phone).
 * One DISTINCT agent per (routeId, role): the role's tool surface is applied to the params before the
 * build (`channel-tool-surface.ts`) and the BUILT config is checked against it, so a non-owner's
 * agent cannot carry a tool the route did not allow. Histories are per role: the session id carries it.
 *
 * Target kind `session` (a chat session) is the typed extension point for the next slice: it resolves
 * to a clear `resolve_failed` today.
 *
 * Sender text goes to the agent as the user message only; the persona stays in the agent's own config.
 */
import { Effect } from "effect";
import type { Layer } from "effect";
import type { Database } from "bun:sqlite";
import { RoutingError } from "@reactive-agents/channels";
import type { AgentConfig } from "@reactive-agents/runtime";
import type { AgentResolver, OpenSessionRequest, RoutedReply, RoutedSession } from "@reactive-agents/channels";
import { emitErrorSwallowed, errorTag, type AgentEvent } from "@reactive-agents/core";
import { cortexLog, formatErrorDetails } from "../cortex-log.js";
import { getGatewayAgent } from "../db/queries.js";
import { HubAgentBuildError } from "../errors.js";
import { getMcpServersByIds, parseMcpConfig } from "../db/mcp-queries.js";
import { parseRouteTarget } from "../db/channel-hub-queries.js";
import { cortexAgentBuilder, type BuildCortexAgentParams } from "./build-cortex-agent.js";
import { narrowCortexParams, surfaceViolations } from "./channel-tool-surface.js";
import { normalizeCortexAgentConfig } from "./cortex-agent-config.js";
import type { ToBuildParams } from "./gateway-channel-host.js";
import { CortexIngestService } from "./ingest-service.js";

type Builder = Awaited<ReturnType<typeof cortexAgentBuilder>>;
/** The built agent the resolver talks to. */
export type HubAgent = Awaited<ReturnType<Builder["build"]>>;

/** Everything the resolver needs; the seams are for tests. */
export interface HubResolverDeps {
  readonly db: Database;
  readonly ingestLayer: Layer.Layer<CortexIngestService>;
  /** `gatewayConfigToBuildParams` (injected so this module does not import the process manager). */
  readonly toBuildParams: ToBuildParams;
  /** Test seam: adjust the params before the role's tool surface is applied (e.g. a scripted provider). */
  readonly prepare?: (params: BuildCortexAgentParams, ctx: { readonly agentId: string; readonly role: "owner" | "sender" }) => BuildCortexAgentParams;
  /** Persist per-conversation history so a rebuilt agent resumes. Default true. */
  readonly persistSessions?: boolean;
  /** Called once per built (route, role) agent with the BUILT config: a diagnostic and test seam. */
  readonly onBuilt?: (info: { readonly routeId: string; readonly role: "owner" | "sender"; readonly agentId: string; readonly config: AgentConfig }) => void;
}

/** The resolver plus the teardown and eviction the hub needs. */
export interface HubResolver extends AgentResolver {
  /** Dispose every agent built for `agentId` (its saved config changed); the next turn rebuilds. */
  readonly evictAgent: (agentId: string) => Promise<void>;
  /** Dispose every built agent (hub stop). */
  readonly disposeAll: Effect.Effect<void>;
}

interface Built {
  readonly agentId: string;
  readonly agent: Promise<HubAgent>;
  unsubscribe: (() => void) | null;
}

const resolveFailed = (req: OpenSessionRequest, message: string, cause?: unknown): RoutingError =>
  new RoutingError({ reason: "resolve_failed", message, routeId: req.routeId, ...(cause !== undefined ? { cause } : {}) });

const runIdOf = (event: AgentEvent): string | undefined => {
  const taskId = (event as { taskId?: unknown }).taskId;
  return typeof taskId === "string" && taskId !== "" ? taskId : undefined;
};

/** Create the resolver. */
export const makeHubResolver = (deps: HubResolverDeps): HubResolver => {
  const built = new Map<string, Built>();

  const buildAgent = async (req: OpenSessionRequest, agentId: string): Promise<HubAgent> => {
    const row = getGatewayAgent(deps.db, agentId);
    if (!row) throw new HubAgentBuildError({ message: `no saved agent "${agentId}"` });
    const config = normalizeCortexAgentConfig(JSON.parse(row.config) as Record<string, unknown>);
    const mcpIds = (config.mcpServerIds as string[] | undefined)?.filter((x) => typeof x === "string" && x.length > 0) ?? [];
    const mcpConfigs = (mcpIds.length > 0 ? getMcpServersByIds(deps.db, mcpIds) : []).map(parseMcpConfig);
    // The agent is not a gateway host here: the router owns access, queueing and channels.
    const { gateway: _gateway, channelAdapters: _adapters, ...base } = deps.toBuildParams({ agentId, name: row.name, config, mcpConfigs });
    const prepared = deps.prepare ? deps.prepare(base, { agentId, role: req.role }) : base;
    const narrowed = narrowCortexParams(prepared, req.toolExposure);
    const builder = await cortexAgentBuilder(narrowed);
    const violations = surfaceViolations(builder.toConfig(), req.toolExposure);
    if (violations.length > 0) {
      throw new HubAgentBuildError({ message: `the built agent exceeds the ${req.toolExposure._tag} surface: ${violations.join(", ")}` });
    }
    deps.onBuilt?.({ routeId: req.routeId, role: req.role, agentId, config: builder.toConfig() });
    const agent = await builder.build();
    const ingest = await Effect.runPromise(CortexIngestService.pipe(Effect.provide(deps.ingestLayer)));
    const entry = built.get(`${req.routeId}:${req.role}`);
    const unsubscribe = await agent.subscribe((event) => {
      const runId = runIdOf(event);
      if (!runId) return;
      Effect.runFork(
        ingest.handleEvent(agent.agentId, runId, { v: 1, agentId: agent.agentId, runId, event }).pipe(
          Effect.catchAll((err) => emitErrorSwallowed({ site: "cortex/server/services/channel-hub-resolver.ts:ingest", tag: errorTag(err) })),
        ),
      );
    });
    if (entry) entry.unsubscribe = unsubscribe;
    return agent;
  };

  const agentFor = (req: OpenSessionRequest): Effect.Effect<HubAgent, RoutingError> => {
    const target = parseRouteTarget(req.target.agentId);
    if (target.kind === "session") {
      return Effect.fail(resolveFailed(req, `route ${req.routeId}: chat-session targets are not available yet`));
    }
    const key = `${req.routeId}:${req.role}`;
    return Effect.tryPromise({
      try: () => {
        const cached = built.get(key);
        if (cached) return cached.agent;
        const pending = buildAgent(req, target.agentId);
        built.set(key, { agentId: target.agentId, agent: pending, unsubscribe: null });
        pending.catch((e) => {
          built.delete(key);
          cortexLog("warn", "channels", `Could not build the agent for route ${req.routeId}`, { routeId: req.routeId, role: req.role, ...formatErrorDetails(e) });
        });
        return pending;
      },
      catch: (cause) => resolveFailed(req, `route ${req.routeId}: agent build failed`, cause),
    });
  };

  const open: AgentResolver["open"] = (req) =>
    Effect.gen(function* () {
      const agent = yield* agentFor(req);
      const sessionId = `${req.routeId}:${req.role}:${req.conversationKey}`;
      const session = req.stateless ? undefined : agent.session({ id: sessionId, persist: deps.persistSessions ?? true });
      yield* Effect.addFinalizer(() => Effect.promise(() => session?.end() ?? Promise.resolve()).pipe(Effect.ignore));
      const turnFailed = (cause: unknown): RoutingError =>
        new RoutingError({ reason: "turn_failed", message: `route ${req.routeId}: turn failed`, routeId: req.routeId, cause });
      return {
        send: (turn) =>
          Effect.tryPromise({
            try: async (): Promise<RoutedReply> => {
              if (session) {
                // No `useTools`: the framework takes the tool loop iff the (narrowed) build has capability tools.
                const r = await session.chat(turn.text);
                return {
                  text: r.message,
                  agentId: agent.agentId,
                  ...(r.tokens !== undefined ? { tokens: r.tokens } : {}),
                  ...(r.cost !== undefined ? { costUsd: r.cost } : {}),
                };
              }
              const r = await agent.run(turn.text);
              return { text: r.output, agentId: r.agentId, tokens: r.metadata.tokensUsed, costUsd: r.metadata.cost, runId: r.taskId };
            },
            catch: turnFailed,
          }),
        close: Effect.void,
      } satisfies RoutedSession;
    });

  const dispose = async (entries: readonly Built[]): Promise<void> => {
    await Promise.allSettled(
      entries.map(async (b) => {
        try { b.unsubscribe?.(); } catch { /* best effort */ }
        await (await b.agent).dispose();
      }),
    );
  };

  return {
    open,
    evictAgent: async (agentId) => {
      const gone = [...built.entries()].filter(([, b]) => b.agentId === agentId);
      for (const [key] of gone) built.delete(key);
      await dispose(gone.map(([, b]) => b));
    },
    disposeAll: Effect.promise(async () => {
      const all = [...built.values()];
      built.clear();
      await dispose(all);
    }),
  };
};
