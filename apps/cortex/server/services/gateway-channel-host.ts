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
 * (loop, subscription, webhook listeners, agent resources). `status` reads the framework's own
 * accessors (`agent.channelStatus()`: adapter state and message counters; `agent.gatewayStatus()`:
 * run stats and the live inbound queue), the schedule registry and the activity feed folded from
 * events (`gateway-status.ts`).
 *
 * Failure is data: a channel that cannot start is reported in `status()`, never thrown into the
 * process manager's caller.
 */
import { Effect, Exit, Scope } from "effect";
import type { Database } from "bun:sqlite";
import type { Layer } from "effect";
import type { AdapterInfo, ChannelAdapter, ConnectionState } from "@reactive-agents/channels";
import { emitErrorSwallowed, errorTag, type AgentEvent } from "@reactive-agents/core";
import { cortexLog, formatErrorDetails } from "../cortex-log.js";
import { getEnabledMcpConfigsByIds } from "../db/mcp-queries.js";
import { buildCortexAgent, type BuildCortexAgentParams, type MCPServerConfig } from "./build-cortex-agent.js";
import { buildChannelAdapters, type BuiltChannels } from "./channel-adapters.js";
import { mountWebhookIngress } from "./channel-ingress.js";
import { enabledChannels, parseCortexChannels, parseCortexGatewayConfig, type CortexChannelEntry, type CortexGatewayConfig } from "./channel-config.js";
import { installedChannelCredentials } from "./channel-credentials.js";
import { normalizeCortexAgentConfig } from "./cortex-agent-config.js";
import type { HubStatus } from "./channel-hub.js";
import { hubActivityFor, hubChannelState, hubDenied, hubHostPhase, mergeActivity } from "./gateway-hub-overlay.js";
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
  /** The framework's per-adapter counters (`agent.channelStatus()`); zero until the host runs. */
  readonly received: number;
  readonly sent: number;
  readonly failed: number;
  readonly lastInboundAt: number | null;
  readonly lastSentAt: number | null;
  /**
   * Where the counts above come from: `stored` = durable rows that survive a restart (hub channels with the
   * durable inbox), `restart` = counted since the host or hub started. Absent reads as `restart`.
   */
  readonly countsFrom?: "stored" | "restart";
  /** Failure class of the latest failed delivery (`auth`, `rate_limited`, ...). */
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
  /** The framework's live inbound queue (`gatewayStatus().inboundQueue`); before it runs, zero depth and the saved bounds. */
  readonly queue: {
    /** Cleared to run, waiting for the single worker. */
    readonly ready: number;
    /** Held by the policy until a limit window rolls. */
    readonly deferred: number;
    /** Discarded because a list was full, since the gateway started. */
    readonly dropped: number;
    readonly capacity: number | null;
    readonly overflow: string | null;
  };
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
    /** Whether the channel hub hosts this channel id (set by the process manager once the hub runs). */
    private hubOwns: (channelId: string) => boolean = () => false,
  ) {}

  /** Install the hub's ownership predicate. Channels it claims are skipped by {@link sync}. */
  setHubOwnership(owns: (channelId: string) => boolean): void {
    this.hubOwns = owns;
  }

  /** Whether the saved config has channels worth hosting. */
  static hasChannels(config: Record<string, unknown>): boolean {
    return enabledChannels(parseCortexChannels(config.channels)).length > 0;
  }

  /** (Re)start hosting from the saved config; stops first. A config with no enabled channel just stops. */
  sync(agentId: string, name: string, configRaw: Record<string, unknown>): Promise<void> {
    const previous = this.teardown(agentId);
    const config = normalizeCortexAgentConfig(configRaw);
    const all = parseCortexChannels(config.channels);
    // The single-poller guard: a channel the hub hosts is never also built here, or two pollers
    // would fight over one bot token. Removing this filter fails `channel-hub-single-poller.test.ts`.
    const entries = all.filter((e) => !this.hubOwns(e.id));
    const handedToHub = enabledChannels(all).length - enabledChannels(entries).length;
    // Framework crons live on this agent's gateway loop: keep hosting it (without the hub's channels) when it has any.
    const cronsOnly = handedToHub > 0 && (parseCortexGatewayConfig(config.gateway)?.crons?.length ?? 0) > 0;
    if (enabledChannels(entries).length === 0 && !cronsOnly) return previous;
    return previous.then(() => this.start(agentId, name, config, entries, cronsOnly));
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
  async status(agentId: string, configRaw: Record<string, unknown>, hub: HubStatus | null = null): Promise<HostedGatewayStatus> {
    const entries = parseCortexChannels(configRaw.channels);
    // Channels the hub hosts are reported from the hub's own status (`gateway-hub-overlay.ts`), not as zeros.
    const hubViews = new Map((hub?.channels ?? []).map((c) => [c.id, c] as const));
    const hubIds = new Set(entries.filter((e) => this.hubOwns(e.id)).map((e) => e.id));
    const h = this.hosted.get(agentId);
    const snap = this.trackers.get(agentId)?.snapshot();
    const running = h?.agent && h.phase === "running" ? h.agent : null;
    // The framework's own accessors: per-adapter state and counters, the live queue and the run stats.
    const adapterInfo = new Map((running?.channelStatus()?.adapters ?? []).map((a) => [a.id, a] as const));
    const gw = running ? await running.gatewayStatus() : null;
    const channels = await Promise.all(
      entries.map((e) => (hubIds.has(e.id) ? hubChannelState(e, hubViews.get(e.id)) : this.channelState(e, h, adapterInfo.get(e.id)))),
    );
    const q = gw?.inboundQueue;
    const phase = hubHostPhase({ phase: h?.phase ?? "idle", error: h?.error ?? null, startedAt: h?.startedAt ?? null }, hubIds.size, hub);
    return {
      ...phase,
      channels,
      schedules: await this.schedules(h),
      queue: {
        ready: q?.ready ?? 0,
        deferred: q?.deferred ?? 0,
        dropped: q?.dropped ?? 0,
        capacity: q?.capacity ?? h?.gateway?.queue?.capacity ?? null,
        overflow: q?.overflow ?? h?.gateway?.queue?.overflow ?? null,
      },
      denied: (snap?.denied ?? 0) + (hub ? hubDenied(hub, hubIds) : 0),
      activity: hub && hubIds.size > 0 ? mergeActivity(snap?.activity ?? [], hubActivityFor(hub, hubIds)) : (snap?.activity ?? []),
      stats: gw ? { ...gw.stats } : null,
    };
  }

  // ── internals ──

  private async channelState(e: CortexChannelEntry, h: Hosted | undefined, info: AdapterInfo | undefined): Promise<ChannelLiveState> {
    const base = {
      id: e.id,
      kind: e.kind,
      label: e.label ?? null,
      enabled: e.enabled,
      received: info?.messagesReceived ?? 0,
      sent: info?.messagesSent ?? 0,
      failed: info?.deliveryFailures ?? 0,
      lastInboundAt: info?.lastInboundAt ?? null,
      lastSentAt: info?.lastSentAt ?? null,
      lastFailure: info?.lastError?.kind ?? null,
    };
    const skipReason = h?.skipped.get(e.id);
    if (skipReason) return { ...base, state: "skipped", error: null, reason: skipReason };
    const adapter = h?.adapters.find((a) => a.id === e.id);
    if (!adapter || h?.phase !== "running") return { ...base, state: "not-started", error: null, reason: e.enabled ? null : "Disabled." };
    const st = info?.state ?? (await Effect.runPromise(adapter.currentState));
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

  private async start(
    agentId: string,
    name: string,
    config: Record<string, unknown>,
    entries: readonly CortexChannelEntry[],
    cronsOnly = false,
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

    if (built.adapters.length === 0 && !cronsOnly) {
      h.phase = "failed";
      h.error = "No channel could be started. Fix the ones marked below.";
      return;
    }

    try {
      const mcpIds = (config.mcpServerIds as string[] | undefined)?.filter((x) => typeof x === "string" && x.length > 0) ?? [];
      const mcpConfigs = getEnabledMcpConfigsByIds(this.db, mcpIds);
      const params = this.toBuildParams({ agentId, name, config, mcpConfigs });
      h.gateway = params.gateway;
      const agent = await buildCortexAgent({ ...params, gateway: params.gateway ?? {}, channelAdapters: built.adapters });
      // (an empty adapter list leaves `.withChannels` off: only the gateway loop and its crons run)
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

      if (built.webhooks.length > 0) h.ingress = await mountWebhookIngress(built.webhooks);

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
