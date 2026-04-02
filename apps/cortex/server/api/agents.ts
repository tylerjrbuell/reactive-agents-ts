import { Elysia, t } from "elysia";
import type { Database } from "bun:sqlite";
import {
  getGatewayAgents,
  getGatewayAgent,
  createGatewayAgent,
  updateGatewayAgent,
  deleteGatewayAgent,
} from "../db/queries.js";
import type { GatewayProcessManager } from "../services/gateway-process-manager.js";

function parseConfig(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) as Record<string, unknown>; }
  catch { return {}; }
}

function rowToDto(row: ReturnType<typeof getGatewayAgent>) {
  if (!row) return null;
  const normalizedType: "gateway" | "ad-hoc" =
    row.agent_type === "ad-hoc" || row.agent_id.startsWith("agent-")
      ? "ad-hoc"
      : "gateway";
  return {
    agentId:   row.agent_id,
    name:      row.name,
    config:    parseConfig(row.config),
    type:      normalizedType,
    status:    row.status,
    runCount:  row.run_count,
    lastRunAt: row.last_run_at,
    schedule:  row.schedule,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Agents router — full CRUD + process lifecycle via GatewayProcessManager. */
export const agentsRouter = (db: Database, gateway: GatewayProcessManager) =>
  new Elysia({ prefix: "/api/agents" })

    // ── List ───────────────────────────────────────────────────────────────
    .get("/", () => {
      const agents = getGatewayAgents(db).map(rowToDto);
      // Enrich with live process state
      const procs = new Map(gateway.listProcesses().map((p) => [p.agentId, p]));
      return agents.map((a) => {
        if (!a) return a;
        const proc = procs.get(a.agentId);
        return { ...a, processRunning: proc?.running ?? false, lastFiredAt: proc?.lastFiredAt ?? null };
      });
    })

    // ── Get single ─────────────────────────────────────────────────────────
    .get("/:agentId", ({ params, set }) => {
      const row = getGatewayAgent(db, params.agentId);
      if (!row) { set.status = 404; return { error: "Not found" }; }
      const dto = rowToDto(row);
      const proc = gateway.listProcesses().find((p) => p.agentId === params.agentId);
      return { ...dto, processRunning: proc?.running ?? false };
    })

    // ── Create ─────────────────────────────────────────────────────────────
    .post("/", async ({ body, set }) => {
      const b = body as any;
      const type = (b.type === "ad-hoc" ? "ad-hoc" : "gateway") as "gateway" | "ad-hoc";
      const agentIdPrefix = type === "gateway" ? "gateway" : "agent";
      const agentId = `${agentIdPrefix}-${crypto.randomUUID().slice(0, 8)}`;
      try {
        const config = b.config ?? {};
        const name = b.name ?? "Unnamed Agent";
        createGatewayAgent(db, agentId, name, JSON.stringify(config), b.schedule ?? null, type);

        if (type === "gateway") {
          // Gateway agents maintain a managed process.
          gateway.startProcess(agentId, name, b.schedule ?? null, config);
        }

        if (b.runNow === true) {
          const result = await gateway.triggerNow(agentId);
          if ("error" in result) {
            set.status = 500;
            return { error: result.error, created: true, agentId };
          }
          return { agentId, created: true, runId: result.runId };
        }

        return { agentId, created: true };
      } catch (e) {
        set.status = 500;
        return { error: String(e) };
      }
    }, {
      body: t.Object({
        name:     t.String(),
        type:     t.Optional(t.Union([t.Literal("gateway"), t.Literal("ad-hoc")])),
        config:   t.Optional(t.Record(t.String(), t.Unknown())),
        schedule: t.Optional(t.Nullable(t.String())),
        runNow:   t.Optional(t.Boolean()),
        status:   t.Optional(t.String()),
      }),
    })

    // ── Update ─────────────────────────────────────────────────────────────
    .patch("/:agentId", ({ params, body, set }) => {
      const b = body as any;
      const patch: Parameters<typeof updateGatewayAgent>[2] = {};
      if (b.name !== undefined)     patch.name     = b.name;
      if (b.config !== undefined)   patch.config   = JSON.stringify(b.config);
      if (b.type !== undefined)     patch.type     = b.type;
      if (b.status !== undefined)   patch.status   = b.status;
      if ("schedule" in b)          patch.schedule = b.schedule ?? null;
      updateGatewayAgent(db, params.agentId, patch);

      const row = getGatewayAgent(db, params.agentId);
      if (row) {
        const config = parseConfig(row.config);
        if (row.status === "active" && row.agent_type === "gateway") {
          // Restart with new config/schedule for gateway processes
          gateway.startProcess(params.agentId, row.name, row.schedule, config);
        } else {
          // Ad-hoc agents and paused/stopped gateway agents should not have a running process
          gateway.stopProcess(params.agentId);
        }
      }
      return { updated: true };
    })

    // ── Delete ─────────────────────────────────────────────────────────────
    .delete("/:agentId", ({ params, set }) => {
      gateway.stopProcess(params.agentId);
      const deleted = deleteGatewayAgent(db, params.agentId);
      if (!deleted) { set.status = 404; return { error: "Not found" }; }
      return { deleted: true };
    })

    // ── Trigger now (manual fire, ignores schedule) ─────────────────────────
    .post("/:agentId/trigger", async ({ params, set }) => {
      const result = await gateway.triggerNow(params.agentId);
      if ("error" in result) {
        // Distinguish "not found" from "failed to start"
        set.status = result.error.includes("not found in DB") ? 404 : 500;
        return { error: result.error };
      }
      return { triggered: true, runId: result.runId, agentId: result.agentId };
    });
