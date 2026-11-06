/**
 * /api/workspace — the desk's working-directory picker.
 *
 * `GET /check?path=` validates a candidate (absolute, existing directory) and
 * returns the normalised path; `GET /recent` lists workspaces already used by
 * chat sessions and saved agents. Single-user local tool, same trust model as
 * the rest of the API.
 */
import { Elysia, t } from "elysia";
import type { Database } from "bun:sqlite";
import { checkWorkspaceDir, recentWorkspaces } from "../services/workspace-dir.js";

export const workspaceRouter = (db: Database) =>
  new Elysia({ prefix: "/api/workspace" })
    .get(
      "/check",
      ({ query, set }) => {
        const r = checkWorkspaceDir(query.path);
        if (!r.ok) set.status = 400;
        return r;
      },
      { query: t.Object({ path: t.String() }) },
    )
    .get("/recent", () => ({ workspaces: recentWorkspaces(db) }));
