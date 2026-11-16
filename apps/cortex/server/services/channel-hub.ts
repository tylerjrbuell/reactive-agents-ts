/**
 * The channel hub: ONE in-process framework channel router for every configured channel.
 *
 * Before the hub, a channel was config on one gateway agent and `GatewayChannelHost` kept one
 * long-lived agent (and one poller) per agent. The hub inverts that: a channel is a connection
 * opened once (guarded by a durable per-account lease), a route says which saved agent answers which
 * conversation and who may talk, and the agent is built per (route, role) on demand
 * (`channel-hub-resolver.ts`). Access is the framework's, fail-closed and per route; a non-owner's
 * agent is built with a smaller tool surface (`channel-tool-surface.ts`).
 *
 * Lifecycle: {@link ChannelHub.start} imports per-agent config into the tables (idempotent,
 * `channel-hub-migration.ts`), then starts the router in a Scope. {@link ChannelHub.owns} is what keeps
 * the legacy `GatewayChannelHost` from also polling a hub channel. `CORTEX_CHANNEL_HUB=off` turns the
 * whole hub off and hands every channel back to the legacy host (nothing is migrated, nothing owned).
 *
 * Failure is data: a channel that cannot start, a lost lease or a route that fails validation shows in
 * {@link ChannelHub.status}; nothing here throws into a caller.
 */
import { createHash } from "node:crypto";
import { Cause, Effect, Exit, Option, Schema, Scope } from "effect";
import type { Layer } from "effect";
import type { Database } from "bun:sqlite";
import {
  ChannelAlreadyOwned,
  RoutingError,
  RouteSpec,
  createChannelRouter,
  type AccountLeases,
  type ChannelAdapter,
  type ChannelRouter,
  type InboundEnvelope,
  type RouteExplanation,
  type RouteOutcome,
  type RouterStatus,
  type RouteSpecInput,
} from "@reactive-agents/channels";
import { cortexLog } from "../cortex-log.js";
import { getGatewayAgents, getGatewayAgent } from "../db/queries.js";
import { getChannel, getRoute, listChannels, parseRouteTarget, type ChannelRecord } from "../db/channel-hub-queries.js";
import { buildChannelAdapters, type BuiltChannels } from "./channel-adapters.js";
import { CHANNEL_KINDS, parseCortexChannels, type CortexChannelEntry, type ChannelKind } from "./channel-config.js";
import { installedChannelCredentials } from "./channel-credentials.js";
import { sanitizedCause } from "./channel-hub-failure.js";
import { HubActivityTracker, type HubActivity, type RouteCounters } from "./channel-hub-activity.js";
import { applyMigration, planMigration, type MigrationAgent, type MigrationPlan, type MigrationResult, type MigrationWarning } from "./channel-hub-migration.js";
import { makeHubResolver, type HubResolver, type HubResolverDeps } from "./channel-hub-resolver.js";
import { listLeaseHolders, loadValidRoutes, makeDbLeases, makeDurableRouteMeter, makeDurableRouterStore, type DurableRouterStore, type LeaseHolder, type RejectedRoute } from "./channel-hub-store.js";
import { mountWebhookIngress } from "./channel-ingress.js";
import { ChannelHubStartError } from "../errors.js";
import type { ToBuildParams } from "./gateway-channel-host.js";
import type { CortexIngestService } from "./ingest-service.js";
import type { BuildCortexAgentParams } from "./build-cortex-agent.js";

/** Whether the hub is on: `CORTEX_CHANNEL_HUB=off` (also `0` / `false`) is the rollback switch. */
export const hubEnabledFromEnv = (env: Readonly<Record<string, string | undefined>>): boolean => {
  const v = env.CORTEX_CHANNEL_HUB?.trim().toLowerCase();
  return !(v === "off" || v === "0" || v === "false");
};

/** Options for {@link ChannelHub}. The seams are for tests (no network). */
export interface ChannelHubOptions {
  readonly db: Database;
  readonly ingestLayer: Layer.Layer<CortexIngestService>;
  readonly toBuildParams: ToBuildParams;
  /** Default: read from `CORTEX_CHANNEL_HUB`. */
  readonly enabled?: boolean;
  /** How adapters are made from saved channels; default builds real ones from the sealed credentials. */
  readonly makeAdapters?: (entries: readonly CortexChannelEntry[]) => BuiltChannels;
  /** Default: database leases (`makeDbLeases`). */
  readonly leases?: AccountLeases;
  /** Test seam passed to the resolver. */
  readonly prepare?: (params: BuildCortexAgentParams, ctx: { readonly agentId: string; readonly role: "owner" | "sender" }) => BuildCortexAgentParams;
  /** Test seam passed to the resolver: the built config of each (route, role) agent. */
  readonly onBuilt?: HubResolverDeps["onBuilt"];
  /** Test seam passed to the resolver: each built agent (a test reads its persisted session history). */
  readonly onAgent?: HubResolverDeps["onAgent"];
  /** Meter options (`maxMessagesPerDay`, `reserveUsd`); default none. */
  readonly meter?: Parameters<typeof makeDurableRouteMeter>[1];
}

/** Hub run phase. `disabled` = the rollback switch is on; `idle` = nothing to start. */
export type HubPhase = "disabled" | "idle" | "starting" | "running" | "failed";

/** One channel as the overview shows it. */
export interface HubChannelView {
  readonly id: string;
  readonly platform: string;
  readonly label: string | null;
  readonly enabled: boolean;
  /** `idle` = enabled but no enabled route; `skipped` = could not be built (see `reason`). */
  readonly state: "connected" | "connecting" | "reconnecting" | "failed" | "disconnected" | "not-started" | "idle" | "skipped";
  readonly error: { readonly kind: string; readonly message: string } | null;
  readonly reason: string | null;
  readonly conflict: boolean;
  readonly received: number;
  readonly sent: number;
  readonly failed: number;
  readonly migratedFrom: string | null;
}

/** One route as the overview shows it. Counts, never the sender lists. */
export interface HubRouteView {
  readonly id: string;
  readonly channelId: string;
  readonly enabled: boolean;
  /** Loaded into the running router. */
  readonly active: boolean;
  readonly reason: string | null;
  readonly target: { readonly kind: "agent" | "session"; readonly id: string; readonly name: string | null };
  readonly access: { readonly open: boolean; readonly allow: number; readonly deny: number; readonly owners: number };
  readonly senderTools: string;
  readonly session: string;
  /** Why a sender gets the tools it gets: owners run the agent's full tools, everyone else the narrowed surface. */
  readonly roleNote: string | null;
  readonly counters: RouteCounters;
  readonly migratedFrom: string | null;
}

/** The hub's report for the Gateway overview. */
export interface HubStatus {
  readonly enabled: boolean;
  readonly phase: HubPhase;
  readonly error: string | null;
  readonly startedAt: number | null;
  /** False means dedupe and caps reset on restart; always true in Cortex. */
  readonly durableStore: boolean;
  readonly channels: readonly HubChannelView[];
  readonly routes: readonly HubRouteView[];
  /** Route rows the store refused to load (invalid), with the plain reason. */
  readonly rejected: readonly RejectedRoute[];
  /** Who holds each account right now (channel, pid): the page links a duplicate to its owner. */
  readonly leases: readonly LeaseHolder[];
  readonly router: Pick<RouterStatus, "unrouted" | "dropped" | "activeSessions" | "inbox"> | null;
  readonly activity: readonly HubActivity[];
  readonly migration: { readonly warnings: readonly MigrationWarning[]; readonly legacy: MigrationPlan["legacy"] };
}

/** A message to run through the real path without sending anything. */
export interface HubProbeInput {
  readonly channelId: string;
  readonly userId: string;
  readonly text: string;
  readonly isGroup?: boolean;
  readonly mentionsSelf?: boolean;
}

/** What `simulate` returns: the outcome with error causes dropped. */
export type HubSimulation =
  | { readonly outcome: "answered"; readonly routeId: string; readonly role: string; readonly text: string }
  | { readonly outcome: "failed"; readonly routeId: string; readonly role: string; readonly reason: string; readonly detail?: string }
  | { readonly outcome: "unrouted" | "duplicate" }
  | { readonly outcome: "denied"; readonly routeId: string; readonly reason: string }
  | { readonly outcome: "dropped"; readonly reason: string; readonly routeId?: string };

const encodeRoute = Schema.encodeSync(RouteSpec);

interface Running {
  readonly router: ChannelRouter;
  readonly scope: Scope.CloseableScope;
  readonly ingress: Scope.CloseableScope | null;
  readonly adapters: readonly ChannelAdapter[];
  readonly signature: string;
}

const kindOf = (platform: string): ChannelKind | undefined => CHANNEL_KINDS.find((k) => k === platform);

const entryOf = (c: ChannelRecord): CortexChannelEntry | undefined => {
  const kind = kindOf(c.platform);
  if (!kind) return undefined;
  // Re-run the saved row through the same parser as per-agent config: it cuts settings to the kind's
  // known fields, so a hand-edited row with a stray credential-looking key never reaches an adapter.
  const [entry] = parseCortexChannels([{ id: c.id, kind, ...(c.label ? { label: c.label } : {}), enabled: c.enabled, settings: c.settings }]);
  return entry;
};

const describeFailure = (cause: Cause.Cause<unknown>): string => {
  const e = Cause.failureOption(cause);
  if (Option.isSome(e)) {
    const err = e.value;
    if (err instanceof ChannelAlreadyOwned) return `Another process (pid ${err.ownerPid}) already owns the account behind channel ${err.channelId}.`;
    if (err instanceof RoutingError) return `${err.reason}: ${err.message}`;
  }
  return "The channel router could not start.";
};

/** See the file header. */
export class ChannelHub {
  private running: Running | null = null;
  private phase: HubPhase;
  private error: string | null = null;
  private startedAt: number | null = null;
  private skipped = new Map<string, string>();
  private inactiveRoutes = new Map<string, string>();
  private tracker = this.newTracker();
  private lastPlan: MigrationPlan = { channels: [], routes: [], warnings: [], legacy: [] };
  private chain: Promise<void> = Promise.resolve();
  private readonly store: DurableRouterStore;
  private readonly resolver: HubResolver;
  private readonly leases: AccountLeases;
  private readonly enabled: boolean;
  private readonly makeAdapters: (entries: readonly CortexChannelEntry[]) => BuiltChannels;

  constructor(private readonly opts: ChannelHubOptions) {
    this.enabled = opts.enabled ?? hubEnabledFromEnv(process.env);
    this.phase = this.enabled ? "idle" : "disabled";
    this.store = makeDurableRouterStore(opts.db);
    this.leases = opts.leases ?? makeDbLeases(opts.db);
    this.resolver = makeHubResolver({
      db: opts.db,
      ingestLayer: opts.ingestLayer,
      toBuildParams: opts.toBuildParams,
      ...(opts.prepare ? { prepare: opts.prepare } : {}),
      ...(opts.onBuilt ? { onBuilt: opts.onBuilt } : {}),
      ...(opts.onAgent ? { onAgent: opts.onAgent } : {}),
      onTurnFailed: (f) => this.tracker.noteCause(f.routeId, f.detail),
    });
    this.makeAdapters =
      opts.makeAdapters ??
      ((entries) => {
        const creds = installedChannelCredentials();
        return creds
          ? buildChannelAdapters(entries, creds)
          : { adapters: [], webhooks: [], skipped: entries.filter((e) => e.enabled).map((e) => ({ id: e.id, reason: "The credential store is not available." })) };
      });
  }

  /** A feed that reads each route's saved turn limit, so a timeout line says how long the limit was. */
  private newTracker(): HubActivityTracker {
    return new HubActivityTracker(Date.now, (routeId) => {
      const limit: unknown = getRoute(this.opts.db, routeId)?.body.turnTimeoutMs;
      return typeof limit === "number" ? limit : undefined;
    });
  }

  /** Whether the hub hosts `channelId`: the single-poller rule. True even when the hub failed to start (a failed hub must not hand a channel to a second poller). */
  owns(channelId: string): boolean {
    return this.enabled && getChannel(this.opts.db, channelId) !== null;
  }

  /** Whether the rollback switch left the hub on. */
  get isEnabled(): boolean {
    return this.enabled;
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work);
    this.chain = next.then(() => undefined, () => undefined);
    return next;
  }

  // ── Lifecycle ──

  /**
   * Import per-agent config (idempotent) and start the router. The import is synchronous, so by the
   * time this returns {@link ChannelHub.owns} is already true for every migrated channel and the legacy
   * host can be started safely. The returned promise settles when the router has started; never rejects.
   */
  start(): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    this.migrateSync();
    return this.serial(() => this.startRouter());
  }

  private migrateSync(): MigrationResult | null {
    try {
      const agents = this.agentsForMigration();
      this.lastPlan = planMigration(agents);
      const scope = new Set([...agents.map((a) => a.agentId), ...listChannels(this.opts.db).flatMap((c) => (c.migratedFrom ? [c.migratedFrom] : []))]);
      const r = applyMigration(this.opts.db, this.lastPlan, [...scope]);
      if (Object.values(r).some((n) => n > 0)) cortexLog("info", "channels", "Imported per-agent channel config into the hub", { ...r });
      return r;
    } catch (e) {
      cortexLog("warn", "channels", "Channel migration failed; the hub starts with the rows it has", { error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }

  /** Stop the router and dispose built agents. */
  stop(): Promise<void> {
    return this.serial(() => this.stopRouter());
  }

  /** Restart the router only when the channels it should run changed (or `force`). */
  refresh(force = false): Promise<void> {
    return this.serial(async () => {
      if (!this.enabled) return;
      const { signature } = this.desired();
      if (!force && this.running && this.running.signature === signature) return;
      if (!force && !this.running && this.phase === "idle" && signature === this.emptySignature) return;
      await this.stopRouter();
      await this.startRouter();
    });
  }

  private readonly emptySignature = JSON.stringify([]);

  /**
   * A saved agent changed (saved, activated, paused): re-derive the rows migrated from it, drop its built
   * agents, and restart the router if the set of running channels changed. The row update is
   * synchronous, so a caller that runs this BEFORE the legacy host syncs the same agent never lets both
   * poll a newly added channel.
   */
  agentChanged(agentId: string): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    try {
      const row = getGatewayAgent(this.opts.db, agentId);
      const agents = row ? [toMigrationAgent(row)] : [];
      const plan = planMigration(agents);
      applyMigration(this.opts.db, plan, [agentId]);
      this.lastPlan = mergePlan(this.lastPlan, plan, agentId);
    } catch (e) {
      cortexLog("warn", "channels", "Could not refresh the channels migrated from an agent", { agentId, error: e instanceof Error ? e.message : String(e) });
    }
    return this.resolver.evictAgent(agentId).then(() => this.refresh());
  }

  private agentsForMigration(): MigrationAgent[] {
    return getGatewayAgents(this.opts.db).map(toMigrationAgent);
  }

  /** The migration the next start would apply (the dry run behind `migrate --plan`). */
  planMigration(): MigrationPlan {
    return planMigration(this.agentsForMigration());
  }

  /** Apply the migration now (an explicit action; start does it automatically). */
  migrateNow(): Promise<MigrationResult | null> {
    const result = this.migrateSync();
    return this.refresh().then(() => result);
  }

  // ── Router ──

  /** The channels the router should run and the routes that make them worth running. */
  private desired(): { readonly entries: readonly CortexChannelEntry[]; readonly signature: string } {
    const { routes } = loadValidRoutes(this.opts.db);
    const live = routes.filter((r) => r.enabled);
    const entries = listChannels(this.opts.db)
      .filter((c) => c.enabled && live.some((r) => r.match.channelId === c.id || r.match.channelId === "*"))
      .flatMap((c) => {
        const e = entryOf(c);
        return e ? [e] : [];
      });
    const creds = installedChannelCredentials();
    // A replaced credential changes the sealed value, not the row: fold a hash of presence+length-free marker so a save restarts the channel.
    const signature = JSON.stringify(entries.map((e) => [e.id, e.kind, e.settings, creds ? CHANNEL_CREDENTIAL_MARK(creds, e) : null]));
    return { entries, signature };
  }

  private async startRouter(): Promise<void> {
    this.skipped = new Map();
    this.inactiveRoutes = new Map();
    this.error = null;
    const { entries, signature } = this.desired();
    const loaded = loadValidRoutes(this.opts.db);
    if (entries.length === 0) {
      this.phase = "idle";
      for (const r of loaded.routes) this.inactiveRoutes.set(r.id, r.enabled ? "its channel is disabled or not built" : "disabled");
      return;
    }
    this.phase = "starting";
    this.tracker = this.newTracker();
    const built = this.makeAdapters(entries);
    const adapters: ChannelAdapter[] = [];
    const seenAccount = new Map<string, string>();
    for (const a of built.adapters) {
      const fp = a.accountFingerprint;
      const owner = fp ? seenAccount.get(fp) : undefined;
      if (fp && owner) {
        this.skipped.set(a.id, `Same account as channel ${owner}: one connection per account, so this one stays off.`);
        continue;
      }
      if (fp) seenAccount.set(fp, a.id);
      adapters.push(a);
    }
    for (const s of built.skipped) this.skipped.set(s.id, s.reason);
    const started = new Set(adapters.map((a) => a.id));
    const webhooks = built.webhooks.filter((w) => started.has(w.adapter.id));

    const activeRoutes = loaded.routes.filter((r) => r.enabled && (r.match.channelId === "*" || started.has(r.match.channelId)));
    for (const r of loaded.routes) {
      if (!activeRoutes.includes(r)) this.inactiveRoutes.set(r.id, r.enabled ? "its channel is not running" : "disabled");
    }
    if (adapters.length === 0) {
      this.phase = "failed";
      this.error = "No channel could be started. Fix the ones marked below.";
      return;
    }

    let ingress: Scope.CloseableScope | null = null;
    const scope = Effect.runSync(Scope.make());
    try {
      if (webhooks.length > 0) ingress = await mountWebhookIngress(webhooks);
      const exit = await Effect.runPromiseExit(
        Scope.extend(
          createChannelRouter({
            channels: adapters,
            routes: activeRoutes.map((r): RouteSpecInput => encodeRoute(r)),
            agents: this.resolver,
            store: this.store,
            leases: this.leases,
            meter: makeDurableRouteMeter(this.opts.db, this.opts.meter),
            eventBus: { publish: (e) => Effect.sync(() => this.tracker.observe(e)) },
          }),
          scope,
        ),
      );
      if (Exit.isFailure(exit)) throw new ChannelHubStartError({ message: describeFailure(exit.cause) });
      this.running = { router: exit.value, scope, ingress, adapters, signature };
      this.phase = "running";
      this.startedAt = Date.now();
      cortexLog("info", "channels", `Channel hub running: ${adapters.length} channel(s), ${activeRoutes.length} route(s)`);
    } catch (e) {
      this.phase = "failed";
      this.error = e instanceof Error ? e.message : "The channel router could not start.";
      cortexLog("warn", "channels", "Channel hub could not start", { error: this.error });
      await Effect.runPromise(Scope.close(scope, Exit.void)).catch(() => undefined);
      if (ingress) await Effect.runPromise(Scope.close(ingress, Exit.void)).catch(() => undefined);
      await Effect.runPromise(this.resolver.disposeAll).catch(() => undefined);
    }
  }

  private async stopRouter(): Promise<void> {
    const r = this.running;
    this.running = null;
    if (r) {
      await Effect.runPromise(Scope.close(r.scope, Exit.void)).catch(() => undefined);
      if (r.ingress) await Effect.runPromise(Scope.close(r.ingress, Exit.void)).catch(() => undefined);
      await Effect.runPromise(this.resolver.disposeAll).catch(() => undefined);
    }
    if (this.enabled) this.phase = "idle";
    this.startedAt = null;
  }

  // ── Probe ──

  private envelopeOf(input: HubProbeInput, platform: string): InboundEnvelope {
    return {
      id: `probe-${Date.now()}`,
      conversation: { channelId: input.userId, isGroup: input.isGroup === true },
      sender: { platform, userId: input.userId },
      text: input.text,
      attachments: [],
      mentionsSelf: input.mentionsSelf ?? input.isGroup !== true,
      isEcho: false,
      receivedAt: Date.now(),
    };
  }

  /** Pure dry run: which route, why, the sender's role and tool surface. Nothing runs. */
  async explain(input: HubProbeInput): Promise<RouteExplanation | null> {
    const ch = getChannel(this.opts.db, input.channelId);
    if (!this.running || !ch) return null;
    return Effect.runPromise(this.running.router.explain(this.envelopeOf(input, ch.platform), input.channelId));
  }

  /** The real path (dedupe, match, access, limits, a real turn) without sending to the platform. */
  async simulate(input: HubProbeInput): Promise<HubSimulation | null> {
    const ch = getChannel(this.opts.db, input.channelId);
    if (!this.running || !ch) return null;
    const out: RouteOutcome = await Effect.runPromise(this.running.router.simulate(this.envelopeOf(input, ch.platform), input.channelId));
    switch (out._tag) {
      case "Answered": return { outcome: "answered", routeId: out.routeId, role: out.role, text: out.reply.text };
      case "Failed": return { outcome: "failed", routeId: out.routeId, role: out.role, reason: out.error.reason, ...(out.error.cause !== undefined ? { detail: sanitizedCause(out.error.cause) } : {}) };
      case "Unrouted": return { outcome: "unrouted" };
      case "Duplicate": return { outcome: "duplicate" };
      case "Denied": return { outcome: "denied", routeId: out.routeId, reason: out.reason };
      case "Dropped": return { outcome: "dropped", reason: out.reason, ...(out.routeId ? { routeId: out.routeId } : {}) };
    }
  }

  /** Note a route edit made through the API in the activity feed. */
  noteEdit(routeId: string, detail: string): void {
    this.tracker.noteEdit(routeId, detail);
  }

  // ── Status ──

  /** The report the Gateway overview shows. */
  async status(): Promise<HubStatus> {
    const db = this.opts.db;
    const router = this.running ? await Effect.runPromise(this.running.router.status) : null;
    const byId = new Map((router?.channels ?? []).map((c) => [c.id, c] as const));
    const loaded = loadValidRoutes(db);
    const liveRoutes = new Set(this.running ? [...loaded.routes.filter((r) => !this.inactiveRoutes.has(r.id)).map((r) => r.id)] : []);
    const enabledPerChannel = new Set(loaded.routes.filter((r) => r.enabled).map((r) => r.match.channelId));

    const channels = await Promise.all(
      listChannels(db).map(async (c): Promise<HubChannelView> => {
        const base = { id: c.id, platform: c.platform, label: c.label, enabled: c.enabled, migratedFrom: c.migratedFrom };
        const stats = byId.get(c.id);
        const counts = { received: stats?.messagesReceived ?? 0, sent: stats?.messagesSent ?? 0, failed: stats?.deliveryFailures ?? 0 };
        const skip = this.skipped.get(c.id);
        if (skip) return { ...base, ...counts, state: "skipped", error: null, reason: skip, conflict: false };
        const adapter = this.running?.adapters.find((a) => a.id === c.id);
        if (!adapter) {
          const idle = c.enabled && !enabledPerChannel.has(c.id) && !enabledPerChannel.has("*");
          return { ...base, ...counts, state: !c.enabled ? "not-started" : idle ? "idle" : "not-started", error: null, reason: !c.enabled ? "Disabled." : idle ? "No enabled route points at this channel." : null, conflict: false };
        }
        const st = await Effect.runPromise(adapter.currentState);
        const scrub = scrubber(installedChannelCredentials(), c.id);
        const error = st.status === "failed" || st.status === "reconnecting" ? { kind: st.error.kind, message: scrub(st.error.message) } : null;
        return { ...base, ...counts, state: st.status, error, reason: null, conflict: stats?.conflict ?? false };
      }),
    );

    const routes = loaded.records.map((rec): HubRouteView => {
      const spec = loaded.routes.find((r) => r.id === rec.id);
      const rejected = loaded.rejected.find((r) => r.routeId === rec.id);
      const target = parseRouteTarget(rec.target.kind === "agent" ? rec.target.agentId : `session:${rec.target.sessionId}`);
      const targetId = target.kind === "agent" ? target.agentId : target.sessionId;
      const row = target.kind === "agent" ? getGatewayAgent(db, target.agentId) : null;
      const inactive = this.inactiveRoutes.get(rec.id);
      return {
        id: rec.id,
        channelId: rec.channelId,
        enabled: rec.enabled,
        active: liveRoutes.has(rec.id) && rec.enabled,
        reason: rejected ? rejected.reason : !rec.enabled ? "Disabled." : inactive ?? null,
        target: { kind: target.kind, id: targetId, name: row?.name ?? null },
        access: { open: spec?.open ?? false, allow: spec?.allow.length ?? 0, deny: spec?.deny.length ?? 0, owners: spec?.owners.length ?? 0 },
        senderTools: spec ? (spec.senderTools._tag === "Allowlist" ? `Allowlist (${spec.senderTools.tools.length})` : spec.senderTools._tag) : "unknown",
        session: spec?.session ?? "per-conversation",
        roleNote: spec ? roleNote(spec.owners.length, spec.senderTools._tag) : null,
        counters: this.tracker.countersOf(rec.id),
        migratedFrom: rec.migratedFrom,
      };
    });

    return {
      enabled: this.enabled,
      phase: this.phase,
      error: this.error,
      startedAt: this.startedAt,
      durableStore: router?.durableStore ?? this.store.durable,
      channels,
      routes,
      rejected: loaded.rejected,
      leases: listLeaseHolders(db),
      // `inbox` (envelope counts per status) exists only when the router's store keeps a durable inbox.
      router: router ? { unrouted: router.unrouted, dropped: router.dropped, activeSessions: router.activeSessions, ...(router.inbox ? { inbox: router.inbox } : {}) } : null,
      activity: this.tracker.snapshot(),
      migration: { warnings: this.lastPlan.warnings, legacy: this.lastPlan.legacy },
    };
  }
}

/** The plain-words reason behind a route's roles (shown in the overview and the routes editor). */
export const roleNote = (owners: number, senderTools: string): string => {
  const others = senderTools === "ReadOnly" ? "read-only tools and no memory" : senderTools === "Allowlist" ? "only the allow-listed tools and no memory" : "the agent's tools";
  return owners > 0
    ? `${owners} owner(s) run the agent's full tools. Every other allowed sender runs ${others}.`
    : `No owner: every allowed sender runs ${others}. Add an owner (platform:userId, for example telegram:123456789) to give someone the agent's full tools.`;
};

const toMigrationAgent =(row: { agent_id: string; name: string; status: string; agent_type: string; config: string }): MigrationAgent => {
  let config: Record<string, unknown> = {};
  try {
    const v: unknown = JSON.parse(row.config);
    if (v && typeof v === "object" && !Array.isArray(v)) config = Object.fromEntries(Object.entries(v));
  } catch { /* an unreadable config has no channels */ }
  return { agentId: row.agent_id, name: row.name, status: row.status, agentType: row.agent_type, config };
};

/** The plan with `agentId`'s part replaced by `plan` (the dry-run copy shown in status). */
const mergePlan = (all: MigrationPlan, plan: MigrationPlan, agentId: string): MigrationPlan => ({
  channels: [...all.channels.filter((c) => c.migratedFrom !== agentId), ...plan.channels],
  routes: [...all.routes.filter((r) => r.migratedFrom !== agentId), ...plan.routes],
  warnings: [...all.warnings.filter((w) => w.agentId !== agentId), ...plan.warnings],
  legacy: [...all.legacy.filter((l) => l.agentId !== agentId), ...plan.legacy],
});

/** Replace any saved credential of the channel in a message so an upstream error cannot echo it. */
const scrubber = (creds: ReturnType<typeof installedChannelCredentials>, channelId: string) => (message: string): string => {
  if (!creds) return message;
  return ["token", "account", "secret"]
    .map((f) => creds.value(channelId, f))
    .filter((v): v is string => v !== undefined)
    .reduce((acc, s) => (s.length >= 4 ? acc.split(s).join("••••") : acc), message);
};

/** A stable marker of the saved credentials of an entry: it changes when a value is replaced, and is not reversible. */
const CHANNEL_CREDENTIAL_MARK = (creds: NonNullable<ReturnType<typeof installedChannelCredentials>>, e: CortexChannelEntry): string =>
  ["token", "account", "secret"]
    .map((f) => creds.value(e.id, f))
    .map((v) => (v === undefined ? "-" : createHash("sha256").update(v).digest("hex").slice(0, 12)))
    .join(".");

export type { HubResolver };
