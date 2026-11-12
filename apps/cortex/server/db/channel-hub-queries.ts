/**
 * Channel hub persistence: channels, routes and the audit trail.
 *
 * A channel row holds only non-secret settings (credentials stay sealed in the key store under
 * `channel:<id>:<field>`). A route row mirrors the framework `RouteSpec`: the columns the hub
 * filters on (channel, enabled, priority, target) plus `spec_json` for the rest. The router
 * state tables (seen ids, turn counters, spend, leases) are read and written by
 * `services/channel-hub-store.ts`, not here.
 */
import type { Database } from "bun:sqlite";
import { Either, Schema } from "effect";
import { RouteSpec, type RouteSpecInput } from "@reactive-agents/channels";

/** What a route points at. `session` is the typed extension point for chat-session targets (next slice). */
export type RouteTarget =
  | { readonly kind: "agent"; readonly agentId: string }
  | { readonly kind: "session"; readonly sessionId: string };

const SESSION_PREFIX = "session:";

/** The framework `RouteSpec.target.agentId` string for a target (`session:<id>` for chat sessions, the bare id for agents). */
export const encodeRouteTarget = (target: RouteTarget): string =>
  target.kind === "agent" ? target.agentId : `${SESSION_PREFIX}${target.sessionId}`;

/** Inverse of {@link encodeRouteTarget}. */
export const parseRouteTarget = (value: string): RouteTarget =>
  value.startsWith(SESSION_PREFIX)
    ? { kind: "session", sessionId: value.slice(SESSION_PREFIX.length) }
    : { kind: "agent", agentId: value };

/** The route fields that live in `spec_json` (everything the columns do not carry). */
export type RouteBody = Omit<RouteSpecInput, "id" | "enabled" | "priority" | "target" | "match"> & {
  readonly match?: Omit<RouteSpecInput["match"], "channelId">;
};

/** A saved channel (non-secret). */
export interface ChannelRecord {
  readonly id: string;
  readonly platform: string;
  readonly label: string | null;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly enabled: boolean;
  /** Gateway agent whose per-agent `config.channels` produced this row; null when created in the hub. */
  readonly migratedFrom: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** A saved route. */
export interface RouteRecord {
  readonly id: string;
  readonly channelId: string;
  readonly enabled: boolean;
  readonly priority: number;
  readonly target: RouteTarget;
  readonly body: RouteBody;
  readonly migratedFrom: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface ChannelRow {
  id: string;
  platform: string;
  label: string | null;
  settings_json: string;
  enabled: number;
  migrated_from: string | null;
  created_at: number;
  updated_at: number;
}

interface RouteRow {
  id: string;
  channel_id: string;
  enabled: number;
  priority: number;
  target_kind: string;
  target_id: string;
  spec_json: string;
  migrated_from: string | null;
  created_at: number;
  updated_at: number;
}

const parseObject = (raw: string): Record<string, unknown> => {
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v)) : {};
  } catch {
    return {};
  }
};

const toChannel = (r: ChannelRow): ChannelRecord => ({
  id: r.id,
  platform: r.platform,
  label: r.label,
  settings: parseObject(r.settings_json),
  enabled: r.enabled !== 0,
  migratedFrom: r.migrated_from,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toRoute = (r: RouteRow): RouteRecord => ({
  id: r.id,
  channelId: r.channel_id,
  enabled: r.enabled !== 0,
  priority: r.priority,
  target: r.target_kind === "session" ? { kind: "session", sessionId: r.target_id } : { kind: "agent", agentId: r.target_id },
  // The body was written by `routeBodyOf` (a RouteSpecInput minus the column fields); a hand-edited
  // row that no longer decodes is rejected by `validateRoutes` when the hub loads it.
  body: parseObject(r.spec_json) as RouteBody,
  migratedFrom: r.migrated_from,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// ─── Channels ───

/** Every saved channel, oldest first. */
export function listChannels(db: Database): ChannelRecord[] {
  return (db.prepare("SELECT * FROM cortex_channels ORDER BY created_at, id").all() as ChannelRow[]).map(toChannel);
}

/** One channel, or null. */
export function getChannel(db: Database, id: string): ChannelRecord | null {
  const row = db.prepare("SELECT * FROM cortex_channels WHERE id = ?").get(id) as ChannelRow | null;
  return row ? toChannel(row) : null;
}

/** Insert a channel. Returns false (and changes nothing) when the id exists, so a re-run migration never overwrites an edit. */
export function insertChannel(
  db: Database,
  c: { readonly id: string; readonly platform: string; readonly label?: string | null; readonly settings: Readonly<Record<string, unknown>>; readonly enabled?: boolean; readonly migratedFrom?: string | null },
): boolean {
  const r = db
    .prepare(
      "INSERT OR IGNORE INTO cortex_channels (id, platform, label, settings_json, enabled, migrated_from) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(c.id, c.platform, c.label ?? null, JSON.stringify(c.settings), c.enabled === false ? 0 : 1, c.migratedFrom ?? null);
  return r.changes > 0;
}

/** Patch a channel's label, settings or enabled flag. Returns the new record or null. */
export function updateChannel(
  db: Database,
  id: string,
  patch: { readonly label?: string | null; readonly settings?: Readonly<Record<string, unknown>>; readonly enabled?: boolean },
): ChannelRecord | null {
  const cur = getChannel(db, id);
  if (!cur) return null;
  db.prepare("UPDATE cortex_channels SET label = ?, settings_json = ?, enabled = ?, updated_at = ? WHERE id = ?").run(
    patch.label !== undefined ? patch.label : cur.label,
    JSON.stringify(patch.settings ?? cur.settings),
    (patch.enabled ?? cur.enabled) ? 1 : 0,
    Date.now(),
    id,
  );
  return getChannel(db, id);
}

/** The hub now owns this channel: it stops following the agent config it was migrated from. */
export function detachChannel(db: Database, id: string): void {
  db.prepare("UPDATE cortex_channels SET migrated_from = NULL WHERE id = ?").run(id);
}

/** Delete a channel row (its routes are the caller's decision). */
export function deleteChannel(db: Database, id: string): boolean {
  return db.prepare("DELETE FROM cortex_channels WHERE id = ?").run(id).changes > 0;
}

// ─── Routes ───

/** Every saved route in declaration order (creation time, then id). */
export function listRoutes(db: Database): RouteRecord[] {
  return (db.prepare("SELECT * FROM cortex_routes ORDER BY created_at, id").all() as RouteRow[]).map(toRoute);
}

/** One route, or null. */
export function getRoute(db: Database, id: string): RouteRecord | null {
  const row = db.prepare("SELECT * FROM cortex_routes WHERE id = ?").get(id) as RouteRow | null;
  return row ? toRoute(row) : null;
}

/** The route's framework input form: columns folded back into a `RouteSpecInput`. */
export function routeToSpecInput(r: RouteRecord): RouteSpecInput {
  const { match, ...rest } = r.body;
  return {
    ...rest,
    id: r.id,
    enabled: r.enabled,
    priority: r.priority,
    match: { ...match, channelId: r.channelId },
    target: { agentId: encodeRouteTarget(r.target) },
  };
}

const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).filter(([, y]) => y !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x,
  );

const decodeRoute = Schema.decodeUnknownEither(RouteSpec);

/** The input with the framework defaults applied (an input that does not decode is compared as written). */
const withDefaults = (s: RouteSpecInput): unknown => {
  const d = decodeRoute(s);
  return Either.isRight(d) ? Schema.encodeSync(RouteSpec)(d.right) : s;
};

/** Whether two route inputs are the same rule (key order and explicit defaults do not count). */
export const sameRouteInput = (a: RouteSpecInput, b: RouteSpecInput): boolean => canonical(withDefaults(a)) === canonical(withDefaults(b));

/** Split a framework route input into the column fields and the stored body. */
export function routeFromSpecInput(spec: RouteSpecInput): Pick<RouteRecord, "id" | "channelId" | "enabled" | "priority" | "target" | "body"> {
  const { id, enabled, priority, target, match, ...rest } = spec;
  const { channelId, ...matchRest } = match;
  return {
    id,
    channelId,
    enabled: enabled !== false,
    priority: priority ?? 100,
    target: parseRouteTarget(target.agentId),
    body: { ...rest, ...(Object.keys(matchRest).length > 0 ? { match: matchRest } : {}) },
  };
}

/** Insert a route; false when the id exists (a re-run migration never overwrites an edit). */
export function insertRoute(db: Database, spec: RouteSpecInput, migratedFrom: string | null = null): boolean {
  const r = routeFromSpecInput(spec);
  return (
    db
      .prepare(
        "INSERT OR IGNORE INTO cortex_routes (id, channel_id, enabled, priority, target_kind, target_id, spec_json, migrated_from) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        r.id,
        r.channelId,
        r.enabled ? 1 : 0,
        r.priority,
        r.target.kind,
        r.target.kind === "agent" ? r.target.agentId : r.target.sessionId,
        JSON.stringify(r.body),
        migratedFrom,
      ).changes > 0
  );
}

/** Replace a route's fields (keeps `migrated_from` and `created_at`). Returns false when it does not exist. */
export function replaceRoute(db: Database, spec: RouteSpecInput): boolean {
  const r = routeFromSpecInput(spec);
  return (
    db
      .prepare(
        "UPDATE cortex_routes SET channel_id = ?, enabled = ?, priority = ?, target_kind = ?, target_id = ?, spec_json = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        r.channelId,
        r.enabled ? 1 : 0,
        r.priority,
        r.target.kind,
        r.target.kind === "agent" ? r.target.agentId : r.target.sessionId,
        JSON.stringify(r.body),
        Date.now(),
        r.id,
      ).changes > 0
  );
}

/** The hub now owns this route: it stops following the agent config it was migrated from. */
export function detachRoute(db: Database, id: string): void {
  db.prepare("UPDATE cortex_routes SET migrated_from = NULL WHERE id = ?").run(id);
}

/** Delete one route. */
export function deleteRoute(db: Database, id: string): boolean {
  return db.prepare("DELETE FROM cortex_routes WHERE id = ?").run(id).changes > 0;
}

/** Delete every route on a channel. Returns how many. */
export function deleteRoutesOfChannel(db: Database, channelId: string): number {
  return db.prepare("DELETE FROM cortex_routes WHERE channel_id = ?").run(channelId).changes;
}

// ─── Audit ───

/** One audit row as the API lists it. */
export interface ChannelAuditRecord {
  readonly id: number;
  readonly at: number;
  readonly actor: string;
  readonly action: string;
  readonly subject: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

/** Append an audit row. `detail` must carry classification only: never message text or a secret. */
export function appendChannelAudit(
  db: Database,
  entry: { readonly actor: string; readonly action: string; readonly subject: string; readonly detail?: Readonly<Record<string, unknown>> },
): void {
  db.prepare("INSERT INTO cortex_channel_audit (at, actor, action, subject, detail_json) VALUES (?, ?, ?, ?, ?)").run(
    Date.now(),
    entry.actor,
    entry.action,
    entry.subject,
    JSON.stringify(entry.detail ?? {}),
  );
}

/** The newest audit rows, newest first. */
export function listChannelAudit(db: Database, limit = 100): ChannelAuditRecord[] {
  const rows = db.prepare("SELECT * FROM cortex_channel_audit ORDER BY id DESC LIMIT ?").all(limit) as Array<{
    id: number;
    at: number;
    actor: string;
    action: string;
    subject: string;
    detail_json: string;
  }>;
  return rows.map((r) => ({ id: r.id, at: r.at, actor: r.actor, action: r.action, subject: r.subject, detail: parseObject(r.detail_json) }));
}
