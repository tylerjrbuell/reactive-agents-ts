/**
 * /api/channels: the channel hub's channels and routes.
 *
 * - GET    /                      channels (with credential masks) and routes (full specs), plus rejected rows
 * - GET    /status                live hub report (same block `GET /api/gateway/status` carries as `hub`)
 * - GET    /migration             dry run of the per-agent import (`migrate --plan`)
 * - POST   /migrate               apply the import now
 * - POST   /                      { kind, label?, settings?, enabled? } create a channel
 * - PATCH  /:channelId            { label?, settings?, enabled? }
 * - DELETE /:channelId?force=1    remove a channel (routes on it need force) and its credentials
 * - POST   /routes                { route, confirm? } create a route
 * - PATCH  /routes/:routeId       { route, confirm? } change a route (the patch merges over the saved one; a `null` value clears that field)
 * - DELETE /routes/:routeId
 * - POST   /explain, /simulate    { channelId, userId, text, isGroup?, mentionsSelf? }
 * - GET    /audit                 who changed which route and when
 *
 * Owners come from here and from code, never from a message: nothing in the inbound path writes a
 * route. A change that WIDENS access (an added owner, `open`, `senderTools: AgentDefault`) is refused
 * with 409 unless `confirm` names it (`owners:<id>`, `open:<id>`, `agent-default:<id>`), and every
 * route change is appended to the audit trail. Validation is the framework's (`validateRoutes`), so
 * an open route without caps, an AgentDefault surface with no owner or a webhook route with a user
 * list cannot be saved. No response carries a credential.
 */
import { Effect, Either, Schema } from "effect";
import { Elysia, t } from "elysia";
import type { Database } from "bun:sqlite";
import { RouteSpec, validateRoutes, wideningChanges, type RouteSpecInput } from "@reactive-agents/channels";
import { getGatewayAgent } from "../db/queries.js";
import {
  appendChannelAudit,
  deleteChannel,
  deleteRoute,
  deleteRoutesOfChannel,
  detachChannel,
  detachRoute,
  getChannel,
  getRoute,
  insertChannel,
  insertRoute,
  listChannelAudit,
  listChannels,
  listRoutes,
  parseRouteTarget,
  replaceRoute,
  routeToSpecInput,
  updateChannel,
} from "../db/channel-hub-queries.js";
import { CHANNEL_KINDS, parseCortexChannels, type ChannelKind } from "../services/channel-config.js";
import type { ChannelCredentials } from "../services/channel-credentials.js";
import type { ChannelHub } from "../services/channel-hub.js";
import { loadValidRoutes } from "../services/channel-hub-store.js";
import { withDefaultAck } from "../services/channel-ack-default.js";

const Kind = t.Union([t.Literal("telegram"), t.Literal("signal"), t.Literal("webhook")]);
const ACTOR = "cortex-admin";

const decodeRouteInput = Schema.decodeUnknownEither(Schema.encodedSchema(RouteSpec));

/** The body as a framework route input, or undefined when it does not have the RouteSpec shape. */
const asRouteInput = (raw: unknown): RouteSpecInput | undefined => {
  const d = decodeRouteInput(raw);
  return Either.isRight(d) ? d.right : undefined;
};

const randomHex =(n: number): string => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, n);

/** Build the channels/routes router. `creds` is null only when no key store is installed. */
export const channelHubRouter = (db: Database, hub: ChannelHub, creds: ChannelCredentials | null) => {
  const platformOf = (channelId: string): string | undefined => getChannel(db, channelId)?.platform;

  const channelView = (id: string) => {
    const c = getChannel(db, id);
    if (!c) return null;
    const kind = CHANNEL_KINDS.find((k) => k === c.platform);
    return { ...c, credentials: creds && kind ? creds.status(c.id, kind) : [] };
  };

  /** Validate one route against the framework rules and the widening gate. Left = the HTTP error to send. */
  const check = (
    candidate: RouteSpecInput,
    confirm: readonly string[],
  ): { readonly ok: true } | { readonly ok: false; readonly status: number; readonly body: Record<string, unknown> } => {
    const checked = Effect.runSync(Effect.either(validateRoutes([candidate], platformOf)));
    if (Either.isLeft(checked)) return { ok: false, status: 400, body: { error: checked.left.message } };
    const [next] = checked.right;
    if (!next) return { ok: false, status: 400, body: { error: "route does not match the RouteSpec schema" } };
    if (next.match.channelId !== "*" && !getChannel(db, next.match.channelId)) {
      return { ok: false, status: 400, body: { error: `no channel ${next.match.channelId}` } };
    }
    const target = parseRouteTarget(next.target.agentId);
    if (target.kind === "session") {
      return { ok: false, status: 400, body: { error: "chat-session targets are not available yet" } };
    }
    if (!getGatewayAgent(db, target.agentId)) return { ok: false, status: 400, body: { error: `no saved agent ${target.agentId}` } };
    const current = loadValidRoutes(db).routes.filter((r) => r.id === next.id);
    const missing = wideningChanges(current, [next]).filter((n) => !confirm.includes(n));
    if (missing.length > 0) {
      return { ok: false, status: 409, body: { error: "confirmation_required", required: missing } };
    }
    return { ok: true };
  };

  const widening = (candidate: RouteSpecInput): string[] => {
    const checked = Effect.runSync(Effect.either(validateRoutes([candidate], platformOf)));
    if (Either.isLeft(checked)) return [];
    const current = loadValidRoutes(db).routes.filter((r) => r.id === candidate.id);
    return [...wideningChanges(current, checked.right)];
  };

  return new Elysia({ prefix: "/api/channels" })
    .get("/", () => ({
      hubEnabled: hub.isEnabled,
      channels: listChannels(db).map((c) => channelView(c.id)),
      routes: listRoutes(db).map((r) => ({ ...routeToSpecInput(r), migratedFrom: r.migratedFrom })),
      rejected: loadValidRoutes(db).rejected,
    }))
    .get("/status", () => hub.status())
    .get("/migration", () => {
      const plan = hub.planMigration();
      return { channels: plan.channels, routes: plan.routes.map((r) => ({ ...r.spec, migratedFrom: r.migratedFrom })), warnings: plan.warnings, legacy: plan.legacy };
    })
    .post("/migrate", async () => ({ result: await hub.migrateNow() }))
    .get("/audit", () => ({ entries: listChannelAudit(db) }))

    // ── Channels ──
    .post("/", ({ body, set }) => {
      const id = `ch-${randomHex(8)}`;
      const [entry] = parseCortexChannels([{ id, kind: body.kind, ...(body.label ? { label: body.label } : {}), enabled: body.enabled !== false, settings: body.settings ?? {} }]);
      if (!entry) {
        set.status = 400;
        return { error: "invalid channel" };
      }
      insertChannel(db, { id, platform: entry.kind, label: entry.label ?? null, settings: { ...entry.settings }, enabled: entry.enabled });
      appendChannelAudit(db, { actor: ACTOR, action: "channel-created", subject: id, detail: { platform: entry.kind } });
      set.status = 201;
      return channelView(id);
    }, {
      body: t.Object({
        kind: Kind,
        label: t.Optional(t.String({ maxLength: 120 })),
        enabled: t.Optional(t.Boolean()),
        settings: t.Optional(t.Record(t.String(), t.Unknown())),
      }),
    })
    .patch("/:channelId", async ({ params, body, set }) => {
      const cur = getChannel(db, params.channelId);
      if (!cur) {
        set.status = 404;
        return { error: "Not found" };
      }
      const kind: ChannelKind | undefined = CHANNEL_KINDS.find((k) => k === cur.platform);
      const [entry] = parseCortexChannels([
        { id: cur.id, kind, enabled: body.enabled ?? cur.enabled, ...(body.label !== undefined ? (body.label ? { label: body.label } : {}) : cur.label ? { label: cur.label } : {}), settings: body.settings ?? cur.settings },
      ]);
      if (!entry) {
        set.status = 400;
        return { error: "invalid channel" };
      }
      updateChannel(db, cur.id, { label: entry.label ?? null, settings: { ...entry.settings }, enabled: entry.enabled });
      detachChannel(db, cur.id);
      appendChannelAudit(db, { actor: ACTOR, action: "channel-updated", subject: cur.id, detail: { enabled: entry.enabled } });
      await hub.refresh();
      return channelView(cur.id);
    }, {
      body: t.Object({
        label: t.Optional(t.String({ maxLength: 120 })),
        enabled: t.Optional(t.Boolean()),
        settings: t.Optional(t.Record(t.String(), t.Unknown())),
      }),
    })
    .delete("/:channelId", async ({ params, query, set }) => {
      const cur = getChannel(db, params.channelId);
      if (!cur) {
        set.status = 404;
        return { error: "Not found" };
      }
      const routes = listRoutes(db).filter((r) => r.channelId === cur.id);
      if (routes.length > 0 && query.force !== "1") {
        set.status = 409;
        return { error: "channel_has_routes", routes: routes.map((r) => r.id) };
      }
      deleteRoutesOfChannel(db, cur.id);
      deleteChannel(db, cur.id);
      creds?.removeAll(cur.id);
      appendChannelAudit(db, { actor: ACTOR, action: "channel-deleted", subject: cur.id, detail: { routesRemoved: routes.length } });
      await hub.refresh();
      return { deleted: true };
    })

    // ── Routes ──
    .post("/routes", async ({ body, set }) => {
      const parsed = asRouteInput(body.route);
      if (!parsed) {
        set.status = 400;
        return { error: "route does not match the RouteSpec schema" };
      }
      const candidate = withDefaultAck(parsed, platformOf(parsed.match.channelId));
      if (getRoute(db, candidate.id)) {
        set.status = 409;
        return { error: "route_exists" };
      }
      const verdict = check(candidate, body.confirm ?? []);
      if (!verdict.ok) {
        set.status = verdict.status;
        return verdict.body;
      }
      const needed = widening(candidate);
      insertRoute(db, candidate, null);
      appendChannelAudit(db, { actor: ACTOR, action: "route-created", subject: candidate.id, detail: { confirmed: needed, channelId: candidate.match.channelId } });
      hub.noteEdit(candidate.id, "route created");
      await hub.refresh();
      set.status = 201;
      return { ...candidate, migratedFrom: null };
    }, { body: t.Object({ route: t.Record(t.String(), t.Unknown()), confirm: t.Optional(t.Array(t.String())) }) })
    .patch("/routes/:routeId", async ({ params, body, set }) => {
      const cur = getRoute(db, params.routeId);
      if (!cur) {
        set.status = 404;
        return { error: "Not found" };
      }
      const patch = body.route;
      // A `null` value clears a field (a merge alone could never remove a cap or an acknowledgement).
      const merged: Record<string, unknown> = { ...routeToSpecInput(cur), ...patch, id: cur.id };
      for (const key of Object.keys(merged)) if (merged[key] === null) delete merged[key];
      const candidate = asRouteInput(merged);
      if (!candidate) {
        set.status = 400;
        return { error: "route does not match the RouteSpec schema" };
      }
      const verdict = check(candidate, body.confirm ?? []);
      if (!verdict.ok) {
        set.status = verdict.status;
        return verdict.body;
      }
      const needed = widening(candidate);
      replaceRoute(db, candidate);
      detachRoute(db, cur.id);
      appendChannelAudit(db, { actor: ACTOR, action: "route-updated", subject: cur.id, detail: { confirmed: needed, fields: Object.keys(patch) } });
      hub.noteEdit(cur.id, "route updated");
      await hub.refresh();
      return { ...candidate, migratedFrom: null };
    }, { body: t.Object({ route: t.Record(t.String(), t.Unknown()), confirm: t.Optional(t.Array(t.String())) }) })
    .delete("/routes/:routeId", async ({ params, set }) => {
      if (!deleteRoute(db, params.routeId)) {
        set.status = 404;
        return { error: "Not found" };
      }
      appendChannelAudit(db, { actor: ACTOR, action: "route-deleted", subject: params.routeId });
      hub.noteEdit(params.routeId, "route deleted");
      await hub.refresh();
      return { deleted: true };
    })

    // ── Probes ──
    .post("/explain", async ({ body, set }) => {
      const r = await hub.explain(body);
      if (!r) {
        set.status = 503;
        return { error: "The channel hub is not running that channel." };
      }
      return r;
    }, { body: t.Object({ channelId: t.String(), userId: t.String(), text: t.String(), isGroup: t.Optional(t.Boolean()), mentionsSelf: t.Optional(t.Boolean()) }) })
    .post("/simulate", async ({ body, set }) => {
      const r = await hub.simulate(body);
      if (!r) {
        set.status = 503;
        return { error: "The channel hub is not running that channel." };
      }
      return r;
    }, { body: t.Object({ channelId: t.String(), userId: t.String(), text: t.String(), isGroup: t.Optional(t.Boolean()), mentionsSelf: t.Optional(t.Boolean()) }) });
};
