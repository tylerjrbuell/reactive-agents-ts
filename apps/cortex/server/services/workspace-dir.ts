/**
 * Workspace directory checks for the `.withTools({ workspace })` control.
 *
 * The framework refuses a workspace that is not an existing directory, but only
 * when the agent is built (the next chat turn / run launch). Cortex checks at the
 * API boundary instead so a bad path fails the request that set it, with a
 * message naming the path.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
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

/** Where a suggested workspace came from, in rank order (see `rankWorkspaceCandidates`). */
export type WorkspaceCandidateSource = "launch-git-root" | "launch" | "scan-root" | "recent";

/** One suggested workspace for the picker. */
export interface WorkspaceCandidate {
  readonly path: string;
  readonly source: WorkspaceCandidateSource;
  readonly isGitRepo: boolean;
}

const SOURCE_RANK: Readonly<Record<WorkspaceCandidateSource, number>> = {
  "launch-git-root": 0,
  launch: 1,
  "scan-root": 2,
  recent: 3,
};

/**
 * Order suggestions: the git root of the directory Cortex was launched from, the
 * launch directory itself, `CORTEX_SKILL_SCAN_ROOT`, then recent workspaces in
 * their own (most recent first) order. A path offered by several sources keeps its
 * best-ranked source. Pure: callers filter to existing directories first.
 */
export function rankWorkspaceCandidates(
  entries: readonly { readonly path: string; readonly source: WorkspaceCandidateSource; readonly isGitRepo: boolean }[],
): WorkspaceCandidate[] {
  const best = new Map<string, { c: WorkspaceCandidate; order: number }>();
  entries.forEach((e, order) => {
    const prev = best.get(e.path);
    if (!prev || SOURCE_RANK[e.source] < SOURCE_RANK[prev.c.source]) best.set(e.path, { c: { path: e.path, source: e.source, isGitRepo: e.isGitRepo }, order: prev?.order ?? order });
  });
  return [...best.values()]
    .sort((a, b) => SOURCE_RANK[a.c.source] - SOURCE_RANK[b.c.source] || a.order - b.order)
    .map((v) => v.c);
}

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** A directory is a git repo when it has a `.git` entry (directory, or file for worktrees/submodules). */
export const isGitRepoDir = (dir: string): boolean => existsSync(join(dir, ".git"));

/** Nearest ancestor (or `dir` itself) holding `.git`; undefined outside a repo. */
export function findGitRoot(dir: string): string | undefined {
  let cur = resolve(dir);
  for (;;) {
    if (isGitRepoDir(cur)) return cur;
    const up = dirname(cur);
    if (up === cur) return undefined;
    cur = up;
  }
}

/**
 * Suggested workspaces for the picker: launch directory (and its git root),
 * `CORTEX_SKILL_SCAN_ROOT` when set, then workspaces chats and saved agents used.
 * Only existing directories are returned.
 */
export function workspaceCandidates(
  db: Database,
  opts: { readonly launchDir?: string; readonly scanRoot?: string | undefined } = {},
): WorkspaceCandidate[] {
  const launch = resolve(opts.launchDir ?? process.cwd());
  const scanRoot = (opts.scanRoot ?? process.env.CORTEX_SKILL_SCAN_ROOT)?.trim();
  const gitRoot = findGitRoot(launch);
  const raw: { path: string; source: WorkspaceCandidateSource }[] = [
    ...(gitRoot ? [{ path: gitRoot, source: "launch-git-root" as const }] : []),
    { path: launch, source: "launch" },
    ...(scanRoot && isAbsolute(scanRoot) ? [{ path: resolve(scanRoot), source: "scan-root" as const }] : []),
    ...recentWorkspaces(db).map((p) => ({ path: resolve(p), source: "recent" as const })),
  ];
  return rankWorkspaceCandidates(raw.filter((e) => isDir(e.path)).map((e) => ({ ...e, isGitRepo: isGitRepoDir(e.path) })));
}

/** One subdirectory in a browse listing (names only: no file contents are read). */
export interface DirEntry {
  readonly name: string;
  readonly path: string;
  readonly isGitRepo: boolean;
}

export type DirListing =
  | {
      readonly ok: true;
      readonly path: string;
      /** Parent directory, or null at the filesystem root. */
      readonly parent: string | null;
      readonly isGitRepo: boolean;
      readonly entries: readonly DirEntry[];
      /** True when more than `limit` subdirectories exist (the rest are not listed). */
      readonly truncated: boolean;
    }
  | { readonly ok: false; readonly error: string };

/** Most subdirectories one browse response lists. */
export const BROWSE_LIMIT = 500;

/**
 * List the subdirectories of an absolute existing directory, sorted by name.
 * Files are never listed and nothing is read beyond directory entries.
 * Dot-directories are left out unless `hidden`; symlinks count when they point at a directory.
 */
export function browseDirectory(raw: string, opts: { readonly hidden?: boolean; readonly limit?: number } = {}): DirListing {
  const checked = checkWorkspaceDir(raw);
  if (!checked.ok) return checked;
  const { path } = checked;
  const limit = opts.limit ?? BROWSE_LIMIT;
  let names: string[];
  try {
    names = readdirSync(path, { withFileTypes: true })
      .filter((d) => (opts.hidden === true || !d.name.startsWith(".")) && (d.isDirectory() || (d.isSymbolicLink() && isDir(join(path, d.name)))))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b));
  } catch (e) {
    return { ok: false, error: `Cannot list ${path}: ${e instanceof Error ? e.message : String(e)}` };
  }
  const up = dirname(path);
  return {
    ok: true,
    path,
    parent: up === path ? null : up,
    isGitRepo: isGitRepoDir(path),
    entries: names.slice(0, limit).map((name) => {
      const p = join(path, name);
      return { name, path: p, isGitRepo: isGitRepoDir(p) };
    }),
    truncated: names.length > limit,
  };
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
