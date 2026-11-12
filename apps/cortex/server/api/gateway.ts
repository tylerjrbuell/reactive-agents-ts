/**
 * /api/gateway — messaging channels and gateway health.
 *
 * - GET    /status                                     every gateway agent: process, channels (live connection
 *                                                      state), access summary, schedules, queue, recent activity
 * - GET    /channels/:channelId/credentials?kind=      which credentials are saved (masked, never the value)
 * - PUT    /channels/:channelId/credentials/:field     { kind, value } save or replace (write-only)
 * - DELETE /channels/:channelId/credentials/:field?kind=
 * - DELETE /channels/:channelId?kind=                  remove every credential of a deleted channel
 * - POST   /channels/test                              { kind, channelId, settings?, credentials? } cheap auth probe
 *
 * No response or log carries a credential: statuses are masks, probe errors are scrubbed
 * (`channel-adapters.ts`), and a typed `credentials` value in a test is used once and not stored.
 */
import { Elysia, t } from "elysia";
import type { Database } from "bun:sqlite";
import { getGatewayAgents } from "../db/queries.js";
import type { GatewayProcessManager } from "../services/gateway-process-manager.js";
import { probeChannel, type SocketProbe, type TelegramFetch } from "../services/channel-adapters.js";
import {
  CHANNEL_CREDENTIAL_FIELDS,
  CHANNEL_KINDS,
  parseCortexChannels,
  parseCortexGatewayConfig,
  summarizeAccess,
  type ChannelKind,
} from "../services/channel-config.js";
import type { ChannelCredentials } from "../services/channel-credentials.js";

const Kind = t.Union([t.Literal("telegram"), t.Literal("signal"), t.Literal("webhook")]);

const asKind = (v: string): ChannelKind | undefined => CHANNEL_KINDS.find((k) => k === v);

const parseJson = (raw: string): Record<string, unknown> => {
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/** Test seams: the network and socket calls of the connection probe. */
export interface GatewayRouterDeps {
  readonly fetchTelegram?: TelegramFetch;
  readonly probeSocket?: SocketProbe;
}

/** Build the router. `creds` is null only when no key store is installed (credential routes then answer 503). */
export const gatewayRouter = (db: Database, gateway: GatewayProcessManager, creds: ChannelCredentials | null, deps: GatewayRouterDeps = {}) => {
  const unavailable = (set: { status?: number | string }) => {
    set.status = 503;
    return { error: "The credential store is not available." };
  };

  return new Elysia({ prefix: "/api/gateway" })
    .get("/status", async () => {
      const procs = new Map(gateway.listProcesses().map((p) => [p.agentId, p]));
      const rows = getGatewayAgents(db).filter((r) => r.agent_type === "gateway");
      const agents = await Promise.all(
        rows.map(async (row) => {
          const config = parseJson(row.config);
          const proc = procs.get(row.agent_id);
          const hosted = await gateway.channels.status(row.agent_id, config);
          return {
            agentId: row.agent_id,
            name: row.name,
            status: row.status,
            /** Cortex's own cron for one-shot fires (`schedule`); framework crons are under `gateway.schedules`. */
            schedule: row.schedule,
            runCount: row.run_count,
            lastRunAt: row.last_run_at,
            processRunning: proc?.running ?? false,
            lastFiredAt: proc?.lastFiredAt ?? null,
            access: summarizeAccess(parseCortexGatewayConfig(config.gateway)),
            gateway: hosted,
          };
        }),
      );
      return { agents };
    })
    .get("/channels/:channelId/credentials", ({ params, query, set }) => {
      if (!creds) return unavailable(set);
      const kind = asKind(query.kind);
      if (!kind) {
        set.status = 400;
        return { error: "unknown channel kind" };
      }
      return { fields: creds.status(params.channelId, kind) };
    }, { query: t.Object({ kind: t.String() }) })
    .put("/channels/:channelId/credentials/:field", ({ params, body, set }) => {
      if (!creds) return unavailable(set);
      const r = creds.set(params.channelId, body.kind, params.field, body.value);
      if (!r.ok) {
        set.status = r.error.reason === "io" || r.error.reason === "corrupt" ? 500 : 400;
        return { error: r.error.message };
      }
      return r.value;
    }, { body: t.Object({ kind: Kind, value: t.String({ maxLength: 4096 }) }) })
    .delete("/channels/:channelId/credentials/:field", ({ params, query, set }) => {
      if (!creds) return unavailable(set);
      const kind = asKind(query.kind);
      if (!kind) {
        set.status = 400;
        return { error: "unknown channel kind" };
      }
      const r = creds.remove(params.channelId, kind, params.field);
      if (!r.ok) {
        set.status = 400;
        return { error: r.error.message };
      }
      return { fields: creds.status(params.channelId, kind) };
    }, { query: t.Object({ kind: t.String() }) })
    .delete("/channels/:channelId", ({ params, set }) => {
      if (!creds) return unavailable(set);
      creds.removeAll(params.channelId);
      return { removed: true };
    })
    .post("/channels/test", async ({ body, set }) => {
      if (!creds) return unavailable(set);
      // A value typed into the form is used for this probe only; the saved one covers the rest.
      const typed: Record<string, string> = body.credentials ?? {};
      const reader = {
        value: (channelId: string, field: string): string | undefined => {
          const v = CHANNEL_CREDENTIAL_FIELDS[body.kind].includes(field) ? typed[field]?.trim() : undefined;
          return v ? v : creds.value(channelId, field);
        },
      };
      const [entry] = parseCortexChannels([{ id: body.channelId, kind: body.kind, enabled: true, settings: body.settings ?? {} }]);
      if (!entry) {
        set.status = 400;
        return { error: "invalid channel id" };
      }
      return probeChannel(entry, reader, { ...(deps.fetchTelegram ? { fetchTelegram: deps.fetchTelegram } : {}), ...(deps.probeSocket ? { probeSocket: deps.probeSocket } : {}) });
    }, {
      body: t.Object({
        kind: Kind,
        channelId: t.String(),
        settings: t.Optional(t.Record(t.String(), t.Unknown())),
        credentials: t.Optional(t.Record(t.String(), t.String({ maxLength: 4096 }))),
      }),
    });
};
