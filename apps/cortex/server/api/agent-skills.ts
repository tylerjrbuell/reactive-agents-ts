/**
 * Living skills API: an agent's stored skills (framework SkillStore, read and changed
 * through the agent; services/agent-skills.ts) and the lifecycle events its runs
 * reported (cortex.db events).
 *
 *   GET  /api/agent-skills/:agentId                         skills with stats and versions, + the model a refine would use
 *   GET  /api/agent-skills/:agentId/events?skill=           SkillActivated / Refined / RolledBack / Promoted, newest first
 *   POST /api/agent-skills/:agentId/refine                  { provider?, model? } one refinement pass
 *   POST /api/agent-skills/:agentId/skills/:name/rollback   restore the previous version (recorded as a manual rollback)
 *   POST /api/agent-skills/:agentId/skills/:name/mode       { mode: auto | suggest | locked } lock / unlock
 *   POST /api/agent-skills/:agentId/skills/:name/export     { root } write <root>/.agents/skills/<name>/SKILL.md
 *   POST /api/agent-skills/:agentId/library/:libraryId      { evolutionMode?, update? } move a Cortex library row
 *                                                           into the agent's skills (409 on a name clash without update)
 */
import { Elysia, t } from "elysia";
import type { Database } from "bun:sqlite";
import { lastRunModelOf, librarySkillRow, skillLifecycleRows } from "../db/skill-lifecycle-queries.js";
import { isSkillEvolutionMode, type AgentSkillsService, type SkillResult } from "../services/agent-skills.js";
import { checkWorkspaceDir } from "../services/workspace-dir.js";

const STATUS: Record<"missing" | "invalid" | "conflict" | "error", number> = {
  missing: 404,
  invalid: 400,
  conflict: 409,
  error: 500,
};

function send<A>(r: SkillResult<A>, set: { status?: number | string }): A | { error: string } {
  if (r.ok) return r.value;
  set.status = STATUS[r.reason];
  return { error: r.error };
}

/** Router over one {@link AgentSkillsService}; `db` is cortex.db (events, run models, the library). */
export const agentSkillsRouter = (skills: AgentSkillsService, db: Database) =>
  new Elysia({ prefix: "/api/agent-skills" })
    .get("/:agentId", async ({ params, set }) => {
      const r = await skills.list(params.agentId);
      const refineWith = lastRunModelOf(db, params.agentId);
      if (!r.ok && r.reason === "missing") return { agentId: params.agentId, available: false, skills: [], refineWith };
      const value = send(r, set);
      return "error" in value ? value : { agentId: params.agentId, available: true, skills: value, refineWith };
    })
    .get(
      "/:agentId/events",
      ({ params, query }) => ({
        events: skillLifecycleRows(db, params.agentId, {
          ...(query.skill ? { skillName: query.skill } : {}),
          ...(query.limit ? { limit: Number(query.limit) || 300 } : {}),
        }),
      }),
      { query: t.Object({ skill: t.Optional(t.String()), limit: t.Optional(t.String()) }) },
    )
    .post(
      "/:agentId/refine",
      async ({ params, body, set }) => {
        const model = body.provider ? { provider: body.provider, ...(body.model ? { model: body.model } : {}) } : lastRunModelOf(db, params.agentId);
        if (!model) {
          set.status = 400;
          return { error: "No model known for this agent: it has no recorded run. Pass a provider." };
        }
        return send(await skills.refine(params.agentId, model), set);
      },
      { body: t.Object({ provider: t.Optional(t.String()), model: t.Optional(t.String()) }) },
    )
    .post("/:agentId/skills/:name/rollback", async ({ params, set }) =>
      send(await skills.rollback(params.agentId, params.name), set),
    )
    .post(
      "/:agentId/skills/:name/mode",
      async ({ params, body, set }) => send(await skills.setMode(params.agentId, params.name, body.mode), set),
      { body: t.Object({ mode: t.String() }) },
    )
    .post(
      "/:agentId/skills/:name/export",
      async ({ params, body, set }) => {
        const root = checkWorkspaceDir(body.root);
        if (!root.ok) {
          set.status = 400;
          return { error: root.error };
        }
        return send(await skills.exportToWorkspace(params.agentId, params.name, root.path), set);
      },
      { body: t.Object({ root: t.String({ minLength: 1 }) }) },
    )
    .post(
      "/:agentId/library/:libraryId",
      async ({ params, body, set }) => {
        const row = librarySkillRow(db, params.libraryId);
        if (!row) {
          set.status = 404;
          return { error: "Library skill not found" };
        }
        const mode = body?.evolutionMode;
        if (mode !== undefined && !isSkillEvolutionMode(mode)) {
          set.status = 400;
          return { error: `Unknown evolution mode "${mode}"` };
        }
        const r = await skills.importLibrarySkill(params.agentId, row, {
          ...(mode !== undefined ? { evolutionMode: mode } : {}),
          ...(body?.update ? { update: true } : {}),
        });
        if (!r.ok) return send(r, set);
        // A move: the row leaves the deprecated library once the agent has it.
        db.prepare("DELETE FROM skills WHERE id = ?").run(params.libraryId);
        return r.value;
      },
      { body: t.Optional(t.Object({ evolutionMode: t.Optional(t.String()), update: t.Optional(t.Boolean()) })) },
    );
