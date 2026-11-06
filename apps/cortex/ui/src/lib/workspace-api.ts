/**
 * Client for the workspace picker (`GET /api/workspace/check`, `/recent`,
 * `/candidates`, `/browse`) plus the pure helpers its components share.
 * The server is the judge of "existing directory"; the browser cannot stat paths.
 */
import { CORTEX_SERVER_URL } from "./constants.js";

export type WorkspaceCheck = { ok: true; path: string } | { ok: false; error: string };

/** Validate an absolute directory path; network failure reads as a failed check. */
export async function checkWorkspace(path: string, fetchFn: typeof fetch = fetch): Promise<WorkspaceCheck> {
  try {
    const res = await fetchFn(`${CORTEX_SERVER_URL}/api/workspace/check?path=${encodeURIComponent(path)}`);
    const body = (await res.json()) as Partial<{ ok: boolean; path: string; error: string }>;
    if (body.ok === true && typeof body.path === "string") return { ok: true, path: body.path };
    return { ok: false, error: body.error ?? `Workspace check failed (${res.status})` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Workspaces already used by chats and saved agents, most recent first. */
export async function recentWorkspaces(fetchFn: typeof fetch = fetch): Promise<string[]> {
  try {
    const res = await fetchFn(`${CORTEX_SERVER_URL}/api/workspace/recent`);
    if (!res.ok) return [];
    const body = (await res.json()) as { workspaces?: unknown };
    return Array.isArray(body.workspaces) ? body.workspaces.filter((w): w is string => typeof w === "string") : [];
  } catch {
    return [];
  }
}

/** Where a suggested workspace came from (server `WorkspaceCandidateSource`). */
export type WorkspaceSource = "launch-git-root" | "launch" | "scan-root" | "recent";
export type WorkspaceCandidate = { path: string; source: WorkspaceSource; isGitRepo: boolean };

const SOURCES: readonly WorkspaceSource[] = ["launch-git-root", "launch", "scan-root", "recent"];

/** Short explanation of a suggestion's source for the picker row. */
export const workspaceSourceLabel: Readonly<Record<WorkspaceSource, string>> = {
  "launch-git-root": "project Cortex was started in",
  launch: "folder Cortex was started in",
  "scan-root": "CORTEX_SKILL_SCAN_ROOT",
  recent: "used before",
};

/** Ranked suggestions (launch project first) plus the home directory; failures read as none. */
export async function workspaceCandidates(fetchFn: typeof fetch = fetch): Promise<{ candidates: WorkspaceCandidate[]; home: string | null }> {
  try {
    const res = await fetchFn(`${CORTEX_SERVER_URL}/api/workspace/candidates`);
    if (!res.ok) return { candidates: [], home: null };
    const body = (await res.json()) as { candidates?: unknown; home?: unknown };
    const candidates = Array.isArray(body.candidates)
      ? body.candidates.filter((c): c is WorkspaceCandidate => {
          const o = c as Partial<WorkspaceCandidate> | null;
          return !!o && typeof o.path === "string" && SOURCES.includes(o.source as WorkspaceSource);
        }).map((c) => ({ path: c.path, source: c.source, isGitRepo: c.isGitRepo === true }))
      : [];
    return { candidates, home: typeof body.home === "string" ? body.home : null };
  } catch {
    return { candidates: [], home: null };
  }
}

/** Picker rows: the current workspace first (marked current), then the ranked suggestions, deduped. */
export function workspaceSuggestions(current: string, candidates: readonly WorkspaceCandidate[]): { path: string; current: boolean; source?: WorkspaceSource }[] {
  const rows: { path: string; current: boolean; source?: WorkspaceSource }[] = [];
  const seen = new Set<string>();
  const cur = current.trim();
  if (cur !== "") {
    seen.add(cur);
    const c = candidates.find((x) => x.path === cur);
    rows.push({ path: cur, current: true, ...(c ? { source: c.source } : {}) });
  }
  for (const c of candidates) {
    if (seen.has(c.path)) continue;
    seen.add(c.path);
    rows.push({ path: c.path, current: false, source: c.source });
  }
  return rows;
}

export type DirEntry = { name: string; path: string; isGitRepo: boolean };
export type DirListing =
  | { ok: true; path: string; parent: string | null; isGitRepo: boolean; entries: DirEntry[]; truncated: boolean }
  | { ok: false; error: string };

/** Subdirectories of `path` (home directory when omitted). The server refuses relative or missing paths. */
export async function browseWorkspace(path: string | undefined, hidden: boolean, fetchFn: typeof fetch = fetch): Promise<DirListing> {
  const qs = new URLSearchParams();
  if (path) qs.set("path", path);
  if (hidden) qs.set("hidden", "1");
  try {
    const res = await fetchFn(`${CORTEX_SERVER_URL}/api/workspace/browse${qs.size > 0 ? `?${qs}` : ""}`);
    const body = (await res.json()) as Partial<{ ok: boolean; error: string; path: string; parent: string | null; isGitRepo: boolean; entries: DirEntry[]; truncated: boolean }>;
    if (body.ok === true && typeof body.path === "string" && Array.isArray(body.entries)) {
      return { ok: true, path: body.path, parent: body.parent ?? null, isGitRepo: body.isGitRepo === true, entries: body.entries, truncated: body.truncated === true };
    }
    return { ok: false, error: body.error ?? `Browse failed (${res.status})` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Breadcrumb segments for an absolute path: `/home/me` → `/`, `home`, `me` with their full paths. */
export function pathCrumbs(path: string): { label: string; path: string }[] {
  const parts = path.split("/").filter(Boolean);
  return [{ label: "/", path: "/" }, ...parts.map((label, i) => ({ label, path: `/${parts.slice(0, i + 1).join("/")}` }))];
}

/** Last path segment for compact display (`/home/me/project` → `project`). */
export function workspaceLabel(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const i = trimmed.lastIndexOf("/");
  return i >= 0 && i < trimmed.length - 1 ? trimmed.slice(i + 1) : trimmed || "/";
}
