/**
 * Client for the workspace picker (`GET /api/workspace/check`, `/recent`).
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

/** Last path segment for compact display (`/home/me/project` → `project`). */
export function workspaceLabel(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const i = trimmed.lastIndexOf("/");
  return i >= 0 && i < trimmed.length - 1 ? trimmed.slice(i + 1) : trimmed || "/";
}
