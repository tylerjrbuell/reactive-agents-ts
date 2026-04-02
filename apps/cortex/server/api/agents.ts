import { Elysia, t } from "elysia";
import type { Database } from "bun:sqlite";
import {
  getGatewayAgents,
  getGatewayAgent,
  createGatewayAgent,
  updateGatewayAgent,
  deleteGatewayAgent,
} from "../db/queries.js";

/** Agents router — full CRUD for Gateway agents stored in cortex_agents table. */
export const agentsRouter = (db: Database) =>
  new Elysia({ prefix: "/api/agents" })

    // ── List all gateway agents ────────────────────────────────────────────
    .get("/", () => {
      return getGatewayAgents(db).map((row) => ({
        agentId:   row.agent_id,
        name:      row.name,
        config:    parseConfig(row.config),
        status:    row.status,
        runCount:  row.run_count,
        lastRunAt: row.last_run_at,
        schedule:  row.schedule,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    })

    // ── Get single agent ───────────────────────────────────────────────────
    .get("/:agentId", ({ params, set }) => {
      const row = getGatewayAgent(db, params.agentId);
      if (!row) { set.status = 404; return { error: "Not found" }; }
      return {
        agentId:   row.agent_id,
        name:      row.name,
        config:    parseConfig(row.config),
        status:    row.status,
        runCount:  row.run_count,
        lastRunAt: row.last_run_at,
        schedule:  row.schedule,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    })

    // ── Create agent ───────────────────────────────────────────────────────
    .post("/", ({ body, set }) => {
      const agentId = `gateway-${crypto.randomUUID().slice(0, 8)}`;
      try {
        createGatewayAgent(
          db,
          agentId,
          (body as any).name ?? "Unnamed Agent",
          JSON.stringify((body as any).config ?? {}),
          (body as any).schedule ?? null,
        );
        return { agentId, created: true };
      } catch (e) {
        set.status = 500;
        return { error: String(e) };
      }
    }, {
      body: t.Object({
        name:     t.String(),
        config:   t.Optional(t.Record(t.String(), t.Unknown())),
        schedule: t.Optional(t.Nullable(t.String())),
      }),
    })

    // ── Update agent ────────────────────────────────────────────────────────
    .patch("/:agentId", ({ params, body, set }) => {
      const b = body as any;
      const patch: Parameters<typeof updateGatewayAgent>[2] = {};
      if (b.name !== undefined)     patch.name     = b.name;
      if (b.config !== undefined)   patch.config   = JSON.stringify(b.config);
      if (b.status !== undefined)   patch.status   = b.status;
      if ("schedule" in b)          patch.schedule = b.schedule ?? null;
      updateGatewayAgent(db, params.agentId, patch);
      return { updated: true };
    })

    // ── Delete agent ────────────────────────────────────────────────────────
    .delete("/:agentId", ({ params, set }) => {
      const deleted = deleteGatewayAgent(db, params.agentId);
      if (!deleted) { set.status = 404; return { error: "Not found" }; }
      return { deleted: true };
    });

function parseConfig(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) as Record<string, unknown>; }
  catch { return {}; }
}
