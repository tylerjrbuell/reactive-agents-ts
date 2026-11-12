/**
 * Hosts the messaging channels of gateway agents.
 *
 * A gateway agent with enabled channels needs a long-lived agent: the framework starts the
 * adapters on `agent.start()` and the gateway loop (access control, queue, crons) runs until it
 * stops. The minute-tick cron runner (`gateway-process-manager.ts`) builds a fresh one-shot agent
 * per fire and never starts the gateway; this host is the other half. Both build through
 * `buildCortexAgent`, so a channel reply and a scheduled fire run the same configured agent.
 *
 * One entry per gateway agent: `sync` (re)starts it from the saved config, `stop` tears it down
 * (loop, subscription, webhook listeners, agent resources). `status` reads live adapter
 * connection state, the schedule registry and the event tracker (`gateway-status.ts`).
 *
 * Failure is data: a channel that cannot start is reported in `status()`, never thrown into the
 * process manager's caller.
 */
import { Effect, Exit, Scope } from "effect";
import type { Database } from "bun:sqlite";
import type { Layer } from "effect";
import { startGatewayIngress } from "@reactive-agents/gateway";
import type { ChannelAdapter, ConnectionState } from "@reactive-agents/channels";
import { emitErrorSwallowed, errorTag, type AgentEvent } from "@reactive-agents/core";
import { cortexLog, formatErrorDetails } from "../cortex-log.js";
import { getMcpServersByIds, parseMcpConfig } from "../db/mcp-queries.js";
import { buildCortexAgent, type BuildCortexAgentParams, type MCPServerConfig } from "./build-cortex-agent.js";
import { buildChannelAdapters, type BuiltChannels, type WebhookMount } from "./channel-adapters.js";
import { enabledChannels, parseCortexChannels, type CortexChannelEntry, type CortexGatewayConfig } from "./channel-config.js";
import { installedChannelCredentials } from "./channel-credentials.js";
import { normalizeCortexAgentConfig } from "./cortex-agent-config.js";
import { GatewayEventTracker, type GatewayTrackerSnapshot } from "./gateway-status.js";
import { CortexIngestService } from "./ingest-service.js";

type Agent = Awaited<ReturnType<typeof buildCortexAgent>>;

/** One channel's live state as the overview shows it. */
export interface ChannelLiveState {
  readonly id: string;
  readonly kind: CortexChannelEntry["kind"];
  readonly label: string | null;
  readonly enabled: boolean;
  /** `not-started` = host not running; `skipped` = could not be built (see `reason`). */
  readonly state: ConnectionState["status"] | "not-started" | "skipped";
  /** Failure class and a credential-free message, when the connection failed or is retrying. */
  readonly error: { readonly kind: string; readonly message: string } | null;
  readonly reason: string | null;
  readonly received: number;
  readonly sent: number;
  readonly failed: number;
  readonly lastEventAt: number | null;
  readonly lastFailure: string | null;
}

/** One framework schedule with its recent runs. */
export interface ScheduleView {
  readonly id: string;
  readonly name: string | null;
  readonly cron: string | null;
  readonly instruction: string;
  readonly enabled: boolean;
  readonly nextFireAt: number | null;
  readonly runCount: number;
  readonly runs: readonly { readonly firedAt: number; readonly status: string; readonly error: string | null; readonly deliveryStatus: string | null }[];
}

/** The host's report for one gateway agent. */
export interface HostedGatewayStatus {
  /** `running` = loop started; `starting`; `failed` (see `error`); `idle` = nothing to host. */
  readonly phase: "idle" | "starting" | "running" | "failed";
  readonly error: string | null;
  readonly startedAt: number | null;
  readonly channels: readonly ChannelLiveState[];
  readonly schedules: readonly ScheduleView[];
  readonly queue: GatewayTrackerSnapshot["queue"] & { readonly capacity: number | null; readonly overflow: string | null };
  readonly denied: number;
  readonly activity: GatewayTrackerSnapshot["activity"];
  readonly stats: Readonly<Record<string, number>> | null;
}

/** Builds the `buildCortexAgent` params of a saved gateway agent (`gatewayConfigToBuildParams`; injected to keep the import one-way). */
export type ToBuildParams = (input: {
  readonly agentId: string;
  readonly name: string;
  readonly config: Record<string, unknown>;
  readonly mcpConfigs: readonly MCPServerConfig[];
}) => BuildCortexAgentParams;

interface Hosted {
  phase: HostedGatewayStatus["phase"];
  error: string | null;
  startedAt: number | null;
  skipped: ReadonlyMap<string, string>;
  adapters: readonly ChannelAdapter[];
  gateway: CortexGatewayConfig | undefined;
  agent: Agent | null;
  stopLoop: (() => Promise<unknown>) | null;
  unsubscribe: (() => void) | null;
  ingress: Scope.CloseableScope | null;
}

const defaultMakeAdapters = (entries: readonly CortexChannelEntry[]): BuiltChannels => {
  const creds = installedChannelCredentials();
  return creds
    ? buildChannelAdapters(entries, creds)
    : { adapters: [], webhooks: [], skipped: enabledChannels(entries).map((e) => ({ id: e.id, reason: "The credential store is not available." })) };
};

const runIdOf =(event: AgentEvent): string | undefined => {
  const e = event as { taskId?: unknown };
  return typeof e.taskId === "string" && e.taskId !== "" ? e.taskId : undefined;
};

export class GatewayChannelHost {
  private readonly hosted = new Map<string, Hosted>();
  private readonly trackers = new Map<string, GatewayEventTracker>();

  constructor(
    private readonly db: Database,
    private readonly ingestLayer: Layer.Layer<CortexIngestService>,
    private readonly toBuildParams: ToBuildParams,
    /** How adapters are made from saved channels; tests inject scripted ones (no network). */
    private readonly makeAdapters: (entries: readonly CortexChannelEntry[]) => BuiltChannels = defaultMakeAdapters,
  ) {}

  /** Whether the saved config has channels worth hosting. */
  static hasChannels(config: Record<string, unknown>): boolean {
    return enabledChannels(parseCortexChannels(config.channels)).length > 0;
  }

  /** (Re)start hosting from the saved config; stops first. A config with no enabled channel just stops. */
  sync(agentId: string, name: string, configRaw: Record<string, unknown>): Promise<void> {
    const previous = this.teardown(agentId);
    const config = normalizeCortexAgentConfig(configRaw);
    const entries = parseCortexChannels(config.channels);
    if (enabledChannels(entries).length === 0) return previous;
    return previous.then(() => this.start(agentId, name, config, entries));
  }

  /** Stop hosting (no-op when not hosted). */
  stop(agentId: string): Promise<void> {
    return this.teardown(agentId);
  }

  /** Stop everything (server shutdown). */
  async destroy(): Promise<void> {
    await Promise.all([...this.hosted.keys()].map((id) => this.teardown(id)));
  }

  isHosted(agentId: string): boolean {
    return this.hosted.get(agentId)?.phase === "running";
  }

  /** Live report for one agent; an agent that is not hosted still reports its saved channels as `not-started`. */
  async status(agentId: string, configRaw: Record<string, unknown>): Promise<HostedGatewayStatus> {
    const entries = parseCortexChannels(configRaw.channels);
    const h = this.hosted.get(agentId);
    const snap = this.trackers.get(agentId)?.snapshot();
    const channels = await Promise.all(entries.map((e) => this.channelState(e, h, snap)));
    const gateway = h?.gateway;
    return {
      phase: h?.phase ?? "idle",
      error: h?.error ?? null,
      startedAt: h?.startedAt ?? null,
      channels,
      schedules: await this.schedules(h),
      queue: {
        queued: snap?.queue.queued ?? 0,
        deferred: snap?.queue.deferred ?? 0,
        dropped: snap?.queue.dropped ?? 0,
        capacity: gateway?.queue?.capacity ?? null,
        overflow: gateway?.queue?.overflow ?? null,
      },
      denied: snap?.denied ?? 0,
      activity: snap?.activity ?? [],
      stats: await this.stats(h),
    };
  }

  // ── internals ──

  private async channelState(e: CortexChannelEntry, h: Hosted | undefined, snap: GatewayTrackerSnapshot | undefined): Promise<ChannelLiveState> {
    const counters = snap?.channels[e.id];
    const base = {
      id: e.id,
      kind: e.kind,
      label: e.label ?? null,
      enabled: e.enabled,
      received: counters?.received ?? 0,
      sent: counters?.sent ?? 0,
      failed: counters?.failed ?? 0,
      lastEventAt: counters?.lastEventAt ?? null,
      lastFailure: counters?.lastFailure ?? null,
    };
    const skipReason = h?.skipped.get(e.id);
    if (skipReason) return { ...base, state: "skipped", error: null, reason: skipReason };
    const adapter = h?.adapters.find((a) => a.id === e.id);
    if (!adapter || h?.phase !== "running") return { ...base, state: "not-started", error: null, reason: e.enabled ? null : "Disabled." };
    const st = await Effect.runPromise(adapter.currentState);
    const secrets = this.secretsOf(e);
    const scrub = (m: string) => secrets.reduce((acc, s) => (s.length >= 4 ? acc.split(s).join("••••") : acc), m);
    const error = st.status === "failed" || st.status === "reconnecting" ? { kind: st.error.kind, message: scrub(st.error.message) } : null;
    return { ...base, state: st.status, error, reason: null };
  }

  private secretsOf(e: CortexChannelEntry): string[] {
    const creds = installedChannelCredentials();
    if (!creds) return [];
    return ["token", "account", "secret"].map((f) => creds.value(e.id, f)).filter((v): v is string => v !== undefined);
  }

  private async schedules(h: Hosted | undefined): Promise<ScheduleView[]> {
    if (!h?.agent || h.phase !== "running") return [];
    try {
      const list = await h.agent.schedules().list();
      return list.map((s) => ({
        id: s.id,
        name: s.name ?? null,
        cron: s.cron ?? null,
        instruction: s.instruction,
        enabled: s.enabled,
        nextFireAt: s.nextFireAt,
        runCount: s.runCount,
        runs: [...(s.runs ?? [])].reverse().slice(0, 5).map((r) => ({
          firedAt: r.firedAt,
          status: r.status,
          error: r.error ?? null,
          deliveryStatus: r.delivery && "receiptStatus" in r.delivery ? String(r.delivery.receiptStatus) : r.delivery && "errorKind" in r.delivery ? String(r.delivery.errorKind) : null,
        })),
      }));
    } catch {
      return [];
    }
  }

  private async stats(h: Hosted | undefined): Promise<Record<string, number> | null> {
    if (!h?.agent || h.phase !== "running") return null;
    const s = await h.agent.gatewayStatus();
    return s ? { ...s.stats } : null;
  }

  private async start(
    agentId: string,
    name: string,
    config: Record<string, unknown>,
    entries: readonly CortexChannelEntry[],
  ): Promise<void> {
    const built = this.makeAdapters(entries);
    // A platform name is a channel kind (telegram, signal, webhook): events that carry only the platform map to its channel.
    const channelOfPlatform = new Map(entries.map((e) => [e.kind as string, e.id] as const));
    const tracker = new GatewayEventTracker((p) => channelOfPlatform.get(p));
    this.trackers.set(agentId, tracker);

    const h: Hosted = {
      phase: "starting", error: null, startedAt: null,
      skipped: new Map(built.skipped.map((s) => [s.id, s.reason])),
      adapters: built.adapters, gateway: undefined, agent: null,
      stopLoop: null, unsubscribe: null, ingress: null,
    };
    this.hosted.set(agentId, h);

    if (built.adapters.length === 0) {
      h.phase = "failed";
      h.error = "No channel could be started. Fix the ones marked below.";
      return;
    }

    try {
      const mcpIds = (config.mcpServerIds as string[] | undefined)?.filter((x) => typeof x === "string" && x.length > 0) ?? [];
      const mcpConfigs = (mcpIds.length > 0 ? getMcpServersByIds(this.db, mcpIds) : []).map(parseMcpConfig);
      const params = this.toBuildParams({ agentId, name, config, mcpConfigs });
      h.gateway = params.gateway;
      const agent = await buildCortexAgent({ ...params, gateway: params.gateway ?? {}, channelAdapters: built.adapters });
      h.agent = agent;

      const ingest = await Effect.runPromise(CortexIngestService.pipe(Effect.provide(this.ingestLayer)));
      h.unsubscribe = await agent.subscribe((event) => {
        tracker.observe(event);
        const runId = runIdOf(event);
        if (!runId) return;
        Effect.runFork(
          ingest.handleEvent(agent.agentId, runId, { v: 1, agentId: agent.agentId, runId, event }).pipe(
            Effect.catchAll((err) => emitErrorSwallowed({ site: "cortex/server/services/gateway-channel-host.ts:ingest", tag: errorTag(err) })),
          ),
        );
      });

      if (built.webhooks.length > 0) h.ingress = await this.mountWebhooks(built.webhooks);

      if (this.hosted.get(agentId) !== h) {
        await this.release(h);
        return;
      }
      const handle = agent.start();
      h.stopLoop = () => handle.stop();
      void handle.done.then((summary) => {
        if (summary.error && this.hosted.get(agentId) === h) {
          h.phase = "failed";
          h.error = `The gateway loop stopped: ${summary.error}`;
        }
      });
      h.phase = "running";
      h.startedAt = Date.now();
      cortexLog("info", "gateway", `Hosting ${built.adapters.length} channel(s) for "${name}"`, { agentId });
    } catch (e) {
      h.phase = "failed";
      h.error = e instanceof Error ? e.message : String(e);
      cortexLog("warn", "gateway", `Could not host channels for "${name}"`, { agentId, ...formatErrorDetails(e) });
      await this.release(h);
    }
  }

  /** One loopback ingress server per port, mounting that port's webhook adapters. */
  private async mountWebhooks(mounts: readonly WebhookMount[]): Promise<Scope.CloseableScope> {
    const scope = await Effect.runPromise(Scope.make());
    try {
      const ports = [...new Set(mounts.map((m) => m.port))];
      for (const port of ports) {
        const routes = mounts.filter((m) => m.port === port).map((m) => ({
          path: m.route,
          id: m.adapter.id,
          handle: (req: { readonly body: string; readonly headers: Record<string, string> }) =>
            m.adapter.handleRequest({ body: req.body, headers: { ...req.headers } }).pipe(
              Effect.mapError((e) => ({ kind: "auth", message: e.reason })),
            ),
        }));
        await Effect.runPromise(
          startGatewayIngress({ port }, { channelRoutes: routes, onEvent: () => Effect.void }).pipe(Effect.provideService(Scope.Scope, scope)),
        );
      }
      return scope;
    } catch (e) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      throw e;
    }
  }

  private async release(h: Hosted): Promise<void> {
    try { await h.stopLoop?.(); } catch { /* best effort */ }
    try { h.unsubscribe?.(); } catch { /* best effort */ }
    if (h.ingress) await Effect.runPromise(Scope.close(h.ingress, Exit.void)).catch(() => undefined);
    try { await h.agent?.dispose(); } catch (e) {
      cortexLog("warn", "gateway", "agent.dispose() failed for a hosted gateway agent", { ...formatErrorDetails(e) });
    }
    h.stopLoop = null; h.unsubscribe = null; h.ingress = null;
  }

  private async teardown(agentId: string): Promise<void> {
    const h = this.hosted.get(agentId);
    if (!h) return;
    this.hosted.delete(agentId);
    this.trackers.delete(agentId);
    await this.release(h);
    cortexLog("info", "gateway", "Stopped channel hosting", { agentId });
  }
}
