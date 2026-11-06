/**
 * /api/workspace — the desk's working-directory picker.
 *
 * `GET /check?path=` validates a candidate (absolute, existing directory) and
 * returns the normalised path; `GET /recent` lists workspaces already used by
 * chat sessions and saved agents; `GET /candidates` ranks suggestions (launch
 * directory and its git root, `CORTEX_SKILL_SCAN_ROOT`, recent); `GET /browse`
 * lists the subdirectories of a directory (names only, home directory by default).
 * Single-user local tool, same trust model as the rest of the API.
 */
import { Elysia, t } from "elysia";
import { homedir } from "node:os";
import type { Database } from "bun:sqlite";
import { browseDirectory, checkWorkspaceDir, recentWorkspaces, workspaceCandidates } from "../services/workspace-dir.js";

export const workspaceRouter = (db: Database, opts: { readonly launchDir?: string } = {}) =>
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
    .get("/recent", () => ({ workspaces: recentWorkspaces(db) }))
    .get("/candidates", () => ({
      candidates: workspaceCandidates(db, opts.launchDir ? { launchDir: opts.launchDir } : {}),
      home: homedir(),
    }))
    .get(
      "/browse",
      ({ query, set }) => {
        const r = browseDirectory(query.path ?? homedir(), { hidden: query.hidden === "1" || query.hidden === "true" });
        if (!r.ok) set.status = 400;
        return r;
      },
      { query: t.Object({ path: t.Optional(t.String()), hidden: t.Optional(t.String()) }) },
    );
