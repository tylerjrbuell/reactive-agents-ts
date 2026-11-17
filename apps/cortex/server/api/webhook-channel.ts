/**
 * /api/channels/:channelId/webhook-*: connecting a caller to a webhook channel.
 *
 * - GET  /:channelId/webhook-info?ingressPort=&route=   the framework's connection info (method, URL, signature
 *                                                       rules, curl / node / openssl examples with a placeholder secret)
 * - POST /:channelId/webhook-secret                     generate a signing secret: stored sealed, returned ONCE here
 * - POST /:channelId/webhook-test  { ingressPort?, route? }  post a signed request to the local ingress, from the server
 *
 * A saved channel supplies its own port and path; the query / body values only fill in for a channel
 * that is not in the hub tables (a per-agent channel being edited in Lab). The secret is read from the
 * sealed store and never leaves it except in the one generate response; no other response, and no
 * test detail, carries it.
 */
import { Elysia, t } from "elysia";
import { getChannel } from "../db/channel-hub-queries.js";
import { CHANNEL_ID_PATTERN } from "../services/channel-config.js";
import type { ChannelCredentials } from "../services/channel-credentials.js";
import type { ChannelHub } from "../services/channel-hub.js";
import {
  WEBHOOK_ROUTE_PATTERN,
  generateWebhookSecret,
  sendWebhookTest,
  webhookInfoFor,
  type WebhookFetch,
  type WebhookSettingsView,
} from "../services/webhook-channel-tools.js";

/** The database handle the hub queries take (typed from them, so this file adds no `bun:sqlite` import). */
type Db = Parameters<typeof getChannel>[0];

/** Test seams. */
export interface WebhookChannelDeps {
  readonly hub?: ChannelHub;
  readonly fetch?: WebhookFetch;
}

type Resolved = { readonly ok: true; readonly settings: WebhookSettingsView } | { readonly ok: false; readonly status: number; readonly error: string };

/** The webhook settings for `channelId`: the saved row's, else the caller's typed values. */
function resolveSettings(db: Db, channelId: string, typed: { ingressPort?: number | undefined; route?: string | undefined }): Resolved {
  if (!CHANNEL_ID_PATTERN.test(channelId)) return { ok: false, status: 400, error: "invalid channel id" };
  const row = getChannel(db, channelId);
  if (row && row.platform !== "webhook") return { ok: false, status: 400, error: "not a webhook channel" };
  const saved = row?.settings ?? {};
  const port = typeof saved.ingressPort === "number" ? saved.ingressPort : typed.ingressPort;
  const route = typeof saved.route === "string" && saved.route ? saved.route : typed.route;
  if (route !== undefined && !WEBHOOK_ROUTE_PATTERN.test(route)) return { ok: false, status: 400, error: "invalid path" };
  if (port !== undefined && !(Number.isInteger(port) && port >= 1 && port <= 65535)) return { ok: false, status: 400, error: "invalid port" };
  return { ok: true, settings: { ...(port !== undefined ? { ingressPort: port } : {}), ...(route !== undefined ? { route } : {}) } };
}

const toPort = (v: string | undefined): number | undefined => (v !== undefined && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** Build the webhook connection router. `creds` is null only when no key store is installed. */
export const webhookChannelRouter = (db: Db, creds: ChannelCredentials | null, deps: WebhookChannelDeps = {}) =>
  new Elysia({ prefix: "/api/channels" })
    .get("/:channelId/webhook-info", ({ params, query, set }) => {
      const r = resolveSettings(db, params.channelId, { ingressPort: toPort(query.ingressPort), route: query.route });
      if (!r.ok) {
        set.status = r.status;
        return { error: r.error };
      }
      return webhookInfoFor(params.channelId, r.settings);
    }, { query: t.Object({ ingressPort: t.Optional(t.String()), route: t.Optional(t.String()) }) })
    .post("/:channelId/webhook-secret", ({ params, set }) => {
      if (!creds) {
        set.status = 503;
        return { error: "The credential store is not available." };
      }
      const r = resolveSettings(db, params.channelId, {});
      if (!r.ok) {
        set.status = r.status;
        return { error: r.error };
      }
      const secret = generateWebhookSecret();
      const saved = creds.set(params.channelId, "webhook", "secret", secret);
      if (!saved.ok) {
        set.status = saved.error.reason === "io" || saved.error.reason === "corrupt" ? 500 : 400;
        return { error: saved.error.message };
      }
      if (deps.hub?.owns(params.channelId)) void deps.hub.refresh();
      // The one place the value leaves the store: the caller copies it to the sender now.
      return { secret, field: saved.value.field, masked: saved.value.masked, updatedAt: saved.value.updatedAt };
    })
    .post("/:channelId/webhook-test", async ({ params, body, set }) => {
      if (!creds) {
        set.status = 503;
        return { error: "The credential store is not available." };
      }
      const r = resolveSettings(db, params.channelId, { ingressPort: body.ingressPort, route: body.route });
      if (!r.ok) {
        set.status = r.status;
        return { error: r.error };
      }
      const secret = creds.value(params.channelId, "secret");
      if (!secret) return { ok: false, status: null, detail: "No signing secret saved." };
      if (r.settings.ingressPort === undefined) return { ok: false, status: null, detail: "No listen port set." };
      return sendWebhookTest({ port: r.settings.ingressPort, route: r.settings.route ?? `/channels/${params.channelId}`, secret }, deps.fetch);
    }, { body: t.Object({ ingressPort: t.Optional(t.Number()), route: t.Optional(t.String()) }) });
