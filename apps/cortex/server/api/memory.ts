/**
 * Memory studio API. Every read and write goes through the framework's
 * `agent.memory()` facade (services/memory-inspector.ts); this router never opens
 * a memory database itself.
 *
 *   GET    /api/memory/agents                       agents with a memory database
 *   GET    /api/memory/:agentId?runId=              semantic / procedural / episodic (runId: what that run wrote)
 *   GET    /api/memory/:agentId/search?q=&runId=    full-text search over semantic memory
 *   PATCH  /api/memory/:agentId/semantic/:id        edit content, summary, importance, verified, tags
 *   DELETE /api/memory/:agentId/semantic/:id
 *   PATCH  /api/memory/:agentId/procedural/:id      edit name, description, pattern, tags
 *   DELETE /api/memory/:agentId/procedural/:id
 */
import { Elysia, t } from "elysia";
import type { Database } from "bun:sqlite";
import { memoryAgentRows } from "../db/memory-agent-queries.js";
import { agentIdsWithMemory, type MemoryInspector, type MemoryResult } from "../services/memory-inspector.js";

/** Status for a failed memory call: unknown agent or id → 404, anything else → 500. */
function sendResult<A>(r: MemoryResult<A>, set: { status?: number | string }): A | { error: string } {
  if (r.ok) return r.value;
  set.status = r.reason === "missing" ? 404 : 500;
  return { error: r.error };
}

const SemanticPatchBody = t.Object({
  content: t.Optional(t.String({ minLength: 1 })),
  summary: t.Optional(t.String()),
  importance: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  verified: t.Optional(t.Boolean()),
  tags: t.Optional(t.Array(t.String())),
});

const ProceduralPatchBody = t.Object({
  name: t.Optional(t.String({ minLength: 1 })),
  description: t.Optional(t.String()),
  pattern: t.Optional(t.String()),
  tags: t.Optional(t.Array(t.String())),
});

/** Router over one {@link MemoryInspector}; `db` (cortex.db) only labels the agent list. */
export const memoryRouter = (inspector: MemoryInspector, db: Database) =>
  new Elysia({ prefix: "/api/memory" })
    .get("/agents", () => ({ agents: memoryAgentRows(db, agentIdsWithMemory()) }))
    .get(
      "/:agentId",
      async ({ params, query, set }) =>
        sendResult(await inspector.list(params.agentId, query.runId ? { runId: query.runId } : {}), set),
      { query: t.Object({ runId: t.Optional(t.String()) }) },
    )
    .get(
      "/:agentId/search",
      async ({ params, query, set }) => {
        const q = query.q.trim();
        if (q === "") return { results: [] };
        const r = await inspector.search(params.agentId, q, {
          ...(query.runId ? { runId: query.runId } : {}),
          ...(query.limit ? { limit: Math.min(200, Math.max(1, Number(query.limit) || 50)) } : {}),
        });
        return r.ok ? { results: r.value } : sendResult(r, set);
      },
      { query: t.Object({ q: t.String(), runId: t.Optional(t.String()), limit: t.Optional(t.String()) }) },
    )
    .patch(
      "/:agentId/semantic/:id",
      async ({ params, body, set }) => sendResult(await inspector.updateSemantic(params.agentId, params.id, body), set),
      { body: SemanticPatchBody },
    )
    .delete("/:agentId/semantic/:id", async ({ params, set }) => {
      const r = await inspector.deleteSemantic(params.agentId, params.id);
      return r.ok ? { deleted: true } : sendResult(r, set);
    })
    .patch(
      "/:agentId/procedural/:id",
      async ({ params, body, set }) => sendResult(await inspector.updateProcedural(params.agentId, params.id, body), set),
      { body: ProceduralPatchBody },
    )
    .delete("/:agentId/procedural/:id", async ({ params, set }) => {
      const r = await inspector.deleteProcedural(params.agentId, params.id);
      return r.ok ? { deleted: true } : sendResult(r, set);
    });
