/**
 * Import of per-agent channel config (`config.channels` + `config.gateway.accessControl` on a saved
 * gateway agent) into the hub's `channels` and `routes` tables.
 *
 * Rules (spec `2026-11-12-channel-routing.md` section 10):
 *  - No data loss, no silent widening, reversible. The agent config is never modified: deleting the
 *    new rows (or `CORTEX_CHANNEL_HUB=off`) hands every channel back to `GatewayChannelHost`.
 *  - Same access semantics. `allowlist` (the framework default; an empty list denies everyone) stays
 *    closed (`open: false`); `blocklist` and `open` become `open: true` with `deny` (an open
 *    route needs cost and turn caps, so the migrated route gets generous ones and says so in
 *    `warnings`). Keys stay `platform:userId`.
 *  - Legacy-listed senders keep full tools: the router gives the agent's own tools only to a route
 *    OWNER (a non-owner's agent is built smaller), so the legacy `allowedSenders` become `owners`
 *    (the person who configured the agent is the one on that list). Every other sender the legacy
 *    policy let through (open / blocklist) is `ReadOnly` with no memory. A route with no listed
 *    sender has no owner, and its warning says how to add one.
 *  - Webhook channels stay on the legacy host: the router cannot give a webhook route anything but
 *    ReadOnly tools (it rejects `senderTools` on webhook routes), which would change behavior.
 *  - Routes are marked `migrated_from=<agentId>` and follow the agent's config until someone edits
 *    them in the hub (an edit detaches the row), so changing a saved agent's allowlist in the agent
 *    panel is not silently ignored.
 */
import type { Database } from "bun:sqlite";
import type { RouteSpecInput, ToolExposure } from "@reactive-agents/channels";
import {
  getChannel,
  getRoute,
  insertChannel,
  insertRoute,
  listChannels,
  listRoutes,
  replaceRoute,
  routeToSpecInput,
  sameRouteInput,
  updateChannel,
  deleteChannel,
  deleteRoute,
} from "../db/channel-hub-queries.js";
import { mergeCortexUiToolNames } from "./cortex-agent-config.js";
import { parseCortexChannels, parseCortexGatewayConfig, type CortexChannelEntry } from "./channel-config.js";
import { shellExecuteRequested } from "./cortex-to-agent-config.js";

/** Caps a migrated `open` route gets (the framework refuses an open route without all three). */
export const MIGRATED_OPEN_CAPS = { maxCostPerDayUsd: 25, maxTurnsPerHour: 120, maxTurnsPerSenderPerHour: 60 } as const;
/** Per-sender cap on a migrated route: the legacy path had none; the router's own default is 6/hour. */
export const MIGRATED_SENDER_TURNS_PER_HOUR = 60;

/** The saved-agent fields migration reads. */
export interface MigrationAgent {
  readonly agentId: string;
  readonly name: string;
  readonly status: string;
  readonly agentType: string;
  readonly config: Record<string, unknown>;
}

/** A channel the plan creates. */
export interface PlannedChannel {
  readonly id: string;
  readonly platform: string;
  readonly label: string | null;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly enabled: boolean;
  readonly migratedFrom: string;
}

/** A line the user should read: what changed relative to the legacy behavior. */
export interface MigrationWarning {
  readonly agentId: string;
  readonly channelId: string;
  readonly routeId?: string;
  readonly message: string;
}

/** What a migration would create. Pure data; {@link applyMigration} writes it. */
export interface MigrationPlan {
  readonly channels: readonly PlannedChannel[];
  readonly routes: readonly { readonly spec: RouteSpecInput; readonly migratedFrom: string }[];
  readonly warnings: readonly MigrationWarning[];
  /** Channels left on the legacy host, with the reason. */
  readonly legacy: readonly { readonly agentId: string; readonly channelId: string; readonly reason: string }[];
}

/** The stable route id for an agent's channel entry. */
export const migratedRouteId = (agentId: string, channelId: string): string => `route-${agentId}-${channelId}`;

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

/** The built-in tool names a saved agent selects (the user's pick plus the shell when requested). */
export const configToolNames = (config: Record<string, unknown>): string[] => {
  const tools = Array.isArray(config.tools) ? config.tools.filter((t): t is string => typeof t === "string") : undefined;
  const additional = str(config.additionalToolNames);
  const shellAdd = str(config.terminalShellAdditionalCommands);
  const shellAllow = str(config.terminalShellAllowedCommands);
  const names = mergeCortexUiToolNames(tools, additional);
  const shell = shellExecuteRequested({
    ...(config.terminalTools === true ? { terminalTools: true as const } : {}),
    ...(tools ? { tools } : {}),
    ...(additional ? { additionalToolNames: additional } : {}),
    ...(shellAdd ? { terminalShellAdditionalCommands: shellAdd } : {}),
    ...(shellAllow ? { terminalShellAllowedCommands: shellAllow } : {}),
  });
  if (shell && !names.includes("shell-execute")) names.push("shell-execute");
  return names;
};

/** Whether the legacy host would have hosted this agent's channels: an active gateway agent. */
export const agentIsHosted = (a: Pick<MigrationAgent, "status" | "agentType">): boolean => a.status === "active" && a.agentType === "gateway";

const routeFor = (agent: MigrationAgent, entry: CortexChannelEntry): { spec: RouteSpecInput; warnings: string[] } => {
  const gateway = parseCortexGatewayConfig(agent.config.gateway);
  const ac = gateway?.accessControl;
  const policy = ac?.accessPolicy ?? "allowlist";
  const warnings: string[] = [];
  const open = policy === "open" || policy === "blocklist";
  // A sender the user listed in the legacy allowlist ran the agent's full tools. In the router only an
  // owner runs the agent's own tools (a non-owner's agent is built smaller), so the legacy-listed senders
  // become the route's owners: same tools as before, and the listed person is the one who runs the agent.
  // Anyone else the legacy policy let through (open / blocklist) is a stranger: read-only tools.
  const owners = [...(ac?.allowedSenders ?? [])];
  const deny = policy === "allowlist" || policy === "blocklist" ? [...(ac?.blockedSenders ?? [])] : [];
  const senderTools: ToolExposure = { _tag: "ReadOnly" };

  if (owners.length > 0) {
    warnings.push(
      `${owners.length} sender(s) from the legacy allowlist are now route owners and keep the agent's full tools, exactly as before. Owners will also be the people who can approve risky tools from a message once that ships. Remove anyone who should not have that power.`,
    );
  }
  if (open) {
    warnings.push(
      `Legacy policy "${policy}" accepted any sender. The route is open with caps of ${MIGRATED_OPEN_CAPS.maxTurnsPerSenderPerHour} turns per sender per hour, ${MIGRATED_OPEN_CAPS.maxTurnsPerHour} per hour and ${MIGRATED_OPEN_CAPS.maxCostPerDayUsd} USD per day. Strangers now run with read-only tools and no memory${owners.length === 0 ? "; this route has no owner, so nobody runs the agent's full tools. Add yourself as an owner (platform:userId, for example telegram:123456789) in the Routes editor" : ""}.`,
    );
  }

  const spec: RouteSpecInput = {
    id: migratedRouteId(agent.agentId, entry.id),
    enabled: agentIsHosted(agent) && entry.enabled,
    match: { channelId: entry.id },
    target: { agentId: agent.agentId },
    session: ac?.mode === "task" ? "stateless" : "per-conversation",
    allow: [],
    deny,
    owners,
    open,
    senderTools,
    ...(str(ac?.replyToUnknown) ? { deniedReply: str(ac?.replyToUnknown) } : {}),
    maxTurnsPerSenderPerHour: open ? MIGRATED_OPEN_CAPS.maxTurnsPerSenderPerHour : MIGRATED_SENDER_TURNS_PER_HOUR,
    ...(open ? { maxTurnsPerHour: MIGRATED_OPEN_CAPS.maxTurnsPerHour, maxCostPerDayUsd: MIGRATED_OPEN_CAPS.maxCostPerDayUsd } : {}),
  };
  return { spec, warnings };
};

/** The plan for `agents`: pure, nothing is written. A re-run over unchanged agents yields the same plan. */
export function planMigration(agents: readonly MigrationAgent[]): MigrationPlan {
  const channels: PlannedChannel[] = [];
  const routes: { spec: RouteSpecInput; migratedFrom: string }[] = [];
  const warnings: MigrationWarning[] = [];
  const legacy: { agentId: string; channelId: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const agent of agents) {
    for (const entry of parseCortexChannels(agent.config.channels)) {
      if (entry.kind === "webhook") {
        legacy.push({ agentId: agent.agentId, channelId: entry.id, reason: "Webhook channels stay on the agent: routed webhook senders can only run with read-only tools." });
        continue;
      }
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        channels.push({
          id: entry.id,
          platform: entry.kind,
          label: entry.label ?? null,
          settings: { ...entry.settings },
          enabled: entry.enabled,
          migratedFrom: agent.agentId,
        });
      }
      const { spec, warnings: w } = routeFor(agent, entry);
      routes.push({ spec, migratedFrom: agent.agentId });
      for (const message of w) warnings.push({ agentId: agent.agentId, channelId: entry.id, routeId: spec.id, message });
    }
  }
  return { channels, routes, warnings, legacy };
}

/** What {@link applyMigration} changed. All zero on a re-run over unchanged config. */
export interface MigrationResult {
  readonly channelsAdded: number;
  readonly channelsUpdated: number;
  readonly channelsRemoved: number;
  readonly routesAdded: number;
  readonly routesUpdated: number;
  readonly routesRemoved: number;
}

/**
 * Write `plan`. Idempotent. A row created in (or edited through) the hub has `migrated_from = null`
 * and is never touched; a row still owned by migration follows the agent's config. Rows migrated from
 * one of `scope` (default: every agent in the plan) that the plan no longer contains are removed.
 */
export function applyMigration(db: Database, plan: MigrationPlan, scopeAgentIds: readonly string[]): MigrationResult {
  const r = { channelsAdded: 0, channelsUpdated: 0, channelsRemoved: 0, routesAdded: 0, routesUpdated: 0, routesRemoved: 0 };
  db.transaction(() => {
    for (const c of plan.channels) {
      const cur = getChannel(db, c.id);
      if (!cur) {
        if (insertChannel(db, c)) r.channelsAdded += 1;
      } else if (cur.migratedFrom !== null) {
        const same = cur.label === c.label && cur.enabled === c.enabled && JSON.stringify(cur.settings) === JSON.stringify(c.settings);
        if (!same) {
          updateChannel(db, c.id, { label: c.label, settings: c.settings, enabled: c.enabled });
          r.channelsUpdated += 1;
        }
      }
    }
    for (const { spec, migratedFrom } of plan.routes) {
      const cur = getRoute(db, spec.id);
      if (!cur) {
        if (insertRoute(db, spec, migratedFrom)) r.routesAdded += 1;
      } else if (cur.migratedFrom !== null) {
        if (!sameRouteInput(routeToSpecInput(cur), spec) && replaceRoute(db, spec)) r.routesUpdated += 1;
      }
    }
    const plannedRoutes = new Set(plan.routes.map((x) => x.spec.id));
    const plannedChannels = new Set(plan.channels.map((c) => c.id));
    const inScope = new Set(scopeAgentIds);
    for (const route of listRoutes(db)) {
      if (route.migratedFrom !== null && inScope.has(route.migratedFrom) && !plannedRoutes.has(route.id) && deleteRoute(db, route.id)) r.routesRemoved += 1;
    }
    for (const ch of listChannels(db)) {
      if (ch.migratedFrom !== null && inScope.has(ch.migratedFrom) && !plannedChannels.has(ch.id) && deleteChannel(db, ch.id)) r.channelsRemoved += 1;
    }
  })();
  return r;
}
