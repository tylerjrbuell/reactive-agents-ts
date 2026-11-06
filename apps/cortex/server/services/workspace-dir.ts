/**
 * Workspace directory checks for the `.withTools({ workspace })` control.
 *
 * The framework refuses a workspace that is not an existing directory, but only
 * when the agent is built (the next chat turn / run launch). Cortex checks at the
 * API boundary instead so a bad path fails the request that set it, with a
 * message naming the path.
 */
import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { Database } from "bun:sqlite";
import { listChatSessions } from "../db/chat-queries.js";
import { getGatewayAgents } from "../db/queries.js";

export type WorkspaceCheck =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly error: string };

/**
 * Accept an absolute path to an existing directory (normalised, no trailing slash).
 * Relative paths are refused: the server's cwd is not something the desk user sees.
 */
export function checkWorkspaceDir(raw: string): WorkspaceCheck {
  const p = raw.trim();
  if (p === "") return { ok: false, error: "Workspace path is empty" };
  if (!isAbsolute(p)) return { ok: false, error: `Workspace must be an absolute path: "${p}"` };
  const path = resolve(p);
  try {
    if (!statSync(path).isDirectory()) return { ok: false, error: `Workspace is not a directory: ${path}` };
  } catch {
    return { ok: false, error: `Workspace directory does not exist: ${path}` };
  }
  return { ok: true, path };
}

/**
 * Check the `workspace` key of a config patch. Returns the patch with a normalised
 * path, an error string, or the patch unchanged when it carries no workspace.
 * An empty string clears the workspace (stored as absent by normalisation).
 */
export function withCheckedWorkspace<T extends { workspace?: string }>(patch: T): { ok: true; patch: T } | { ok: false; error: string } {
  if (patch.workspace === undefined || patch.workspace.trim() === "") return { ok: true, patch };
  const r = checkWorkspaceDir(patch.workspace);
  return r.ok ? { ok: true, patch: { ...patch, workspace: r.path } } : { ok: false, error: r.error };
}

/** Distinct workspaces used by chat sessions (most recent first) then saved agents; at most `limit`. */
export function recentWorkspaces(db: Database, limit = 12): string[] {
  const seen = new Set<string>();
  const add = (cfg: Record<string, unknown>) => {
    const w = cfg.workspace;
    if (typeof w === "string" && w.trim() !== "") seen.add(w.trim());
  };
  for (const s of listChatSessions(db)) add(s.agentConfig);
  for (const a of getGatewayAgents(db)) {
    try {
      add(JSON.parse(a.config) as Record<string, unknown>);
    } catch {
      /* unparseable saved config: skip */
    }
  }
  return [...seen].slice(0, limit);
}
