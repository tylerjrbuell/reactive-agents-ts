/**
 * Lab Skills tab data: the workspace skills an agent can load (framework discovery
 * at the Builder's workspace, `GET /api/skills/workspace`), the Cortex library rows
 * in the desk DB (`GET /api/skills`, not sent to agents yet), one skill's detail,
 * and the create / delete calls for the library. The Lab page owns one instance so
 * the tab count survives tab switches.
 */
import { writable, type Readable } from "svelte/store";
import type { FetchFn } from "./gateway-agents-store.js";

/** A SQLite skill row (GET /api/skills). Lives in cortex.db; agents do not load it. */
export type SkillRow = { id?: string; name?: string; description?: string; content?: string };

/** Which scan root a workspace skill came from. */
export type WorkspaceSkillSource = "agent" | "workspace" | "configured" | "claude" | "global";

/** A skill an agent rooted at the workspace can load (GET /api/skills/workspace). */
export type WorkspaceSkillSummary = {
  name: string;
  description: string;
  /** Absolute SKILL.md path. */
  filePath: string;
  /** Absolute scan dir it was found in. */
  root: string;
  source: WorkspaceSkillSource;
};

/** The directories discovery scanned, in precedence order. */
export type WorkspaceScan = {
  /** Discovery root: the Builder workspace, else the server's launch dir. */
  root: string;
  scanned: { path: string; source: WorkspaceSkillSource; exists: boolean }[];
};

/** What discovery is rooted at and reads (the Builder's workspace and skills settings). */
export type WorkspaceSkillScope = { root?: string; paths?: readonly string[]; global?: boolean };

/** One skill's parsed document (GET /api/skills/workspace/file or /api/skills/sqlite/:id). */
export type SkillDetail = {
  name: string;
  description: string;
  instructions: string;
  metadata: Record<string, unknown>;
  filePath: string;
  resources: { scripts: string[]; references: string[]; assets: string[] };
  declaredFields?: Record<string, unknown>;
};

/** Which catalog row is open. */
export type SkillListSelection =
  | { kind: "workspace"; filePath: string }
  | { kind: "sqlite"; id: string };

/** One row of the single catalog list: a section header, a workspace skill or a library row. */
export type SkillCatalogRow =
  | { t: "hdr"; label: string; note: string }
  | { t: "ws"; s: WorkspaceSkillSummary }
  | { t: "sql"; s: SkillRow; rowKey: string };

/** Skills tab view state the Lab page keeps across tab switches. */
export type LabSkillsUi = {
  filter: string;
  showNewSkillForm: boolean;
  newSkillName: string;
  newSkillInstructions: string;
  newSkillDescription: string;
  newSkillTags: string;
  newSkillSaving: boolean;
  selection: SkillListSelection | null;
  detail: SkillDetail | null;
  detailLoading: boolean;
  detailError: string | null;
};

/** A fresh Skills tab view. */
export function emptySkillsUi(): LabSkillsUi {
  return {
    filter: "",
    showNewSkillForm: false,
    newSkillName: "",
    newSkillInstructions: "",
    newSkillDescription: "",
    newSkillTags: "",
    newSkillSaving: false,
    selection: null,
    detail: null,
    detailLoading: false,
    detailError: null,
  };
}

/** Store state. */
export interface LabSkillsState {
  readonly skills: SkillRow[];
  readonly workspaceSkills: WorkspaceSkillSummary[];
  readonly workspaceScan: WorkspaceScan | null;
  /** Why the last workspace scan failed (e.g. the workspace is not an absolute dir); `null` when it did not. */
  readonly workspaceError: string | null;
}

/** Body of POST /api/skills. */
export type NewSkillBody = { name: string; instructions: string; description?: string; tags?: string[] };

/** The Lab skills store. */
export interface LabSkillsStore extends Readable<LabSkillsState> {
  /** Scan the workspace the way a run does; keeps the scope for detail reads. */
  loadWorkspace(scope: WorkspaceSkillScope): Promise<void>;
  /** Reload the SQLite list; a failed request keeps the current one. */
  reloadDb(): Promise<void>;
  /** First load: the library list and the workspace skills together. */
  loadInitial(scope?: WorkspaceSkillScope): Promise<void>;
  /** Create a SQLite skill; throws with the server's error. Call `reloadDb` after. */
  create(body: NewSkillBody): Promise<void>;
  /** Delete a SQLite skill; `error` when the server refused. Call `reloadDb` after. */
  remove(id: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Load one skill's document. */
  fetchDetail(sel: SkillListSelection): Promise<{ detail: SkillDetail } | { error: string }>;
}

/** The discovery scope of a Builder config: its workspace, extra skill folders and the global flag. */
export function skillScopeOf(cfg: {
  readonly workspace?: string;
  readonly skills?: { readonly paths?: readonly string[]; readonly global?: boolean };
}): WorkspaceSkillScope {
  return {
    ...(cfg.workspace && cfg.workspace.trim() !== "" ? { root: cfg.workspace.trim() } : {}),
    paths: [...(cfg.skills?.paths ?? [])],
    ...(cfg.skills?.global === true ? { global: true } : {}),
  };
}

/** Query string for a workspace scope (`root`, repeated `paths`, `global=1`, and a skill's `path` for its detail). */
export function workspaceScopeQuery(scope: WorkspaceSkillScope & { path?: string }): string {
  const q = new URLSearchParams();
  if (scope.root && scope.root.trim() !== "") q.set("root", scope.root.trim());
  for (const p of scope.paths ?? []) if (p.trim() !== "") q.append("paths", p.trim());
  if (scope.global === true) q.set("global", "1");
  if (scope.path) q.set("path", scope.path);
  const s = q.toString();
  return s === "" ? "" : `?${s}`;
}

/** Create the store. `fetchFn` is injectable for tests. */
export function createLabSkillsStore(serverUrl: string, fetchFn: FetchFn = (url, init) => fetch(url, init)): LabSkillsStore {
  const state = writable<LabSkillsState>({ skills: [], workspaceSkills: [], workspaceScan: null, workspaceError: null });
  const patch = (p: Partial<LabSkillsState>) => state.update((s) => ({ ...s, ...p }));
  let scope: WorkspaceSkillScope = {};

  const reloadDb = async () => {
    const skillsRes = await fetchFn(`${serverUrl}/api/skills`);
    if (skillsRes.ok) {
      patch({ skills: await skillsRes.json() as SkillRow[] });
    }
  };

  const loadWorkspace = async (next: WorkspaceSkillScope) => {
    scope = next;
    try {
      const res = await fetchFn(`${serverUrl}/api/skills/workspace${workspaceScopeQuery(next)}`);
      const data = (await res.json()) as Partial<WorkspaceScan> & { skills?: WorkspaceSkillSummary[]; error?: string };
      if (!res.ok) {
        patch({ workspaceSkills: [], workspaceScan: null, workspaceError: data.error ?? `HTTP ${res.status}` });
        return;
      }
      patch({
        workspaceSkills: data.skills ?? [],
        workspaceScan: { root: data.root ?? "", scanned: data.scanned ?? [] },
        workspaceError: null,
      });
    } catch (e) {
      patch({ workspaceSkills: [], workspaceScan: null, workspaceError: String(e) });
    }
  };

  return {
    subscribe: state.subscribe,
    loadWorkspace,
    reloadDb,

    async loadInitial(initial = {}) {
      await Promise.all([reloadDb().catch(() => {}), loadWorkspace(initial)]);
    },

    async create(body) {
      const res = await fetchFn(`${serverUrl}/api/skills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errData = (await res.json()) as { error?: string };
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
    },

    async remove(id) {
      const res = await fetchFn(`${serverUrl}/api/skills/${id}`, { method: "DELETE" });
      if (res.ok) return { ok: true };
      const errData = (await res.json()) as { error?: string };
      return { ok: false, error: errData.error ?? `HTTP ${res.status}` };
    },

    async fetchDetail(sel) {
      const url =
        sel.kind === "workspace"
          ? `${serverUrl}/api/skills/workspace/file${workspaceScopeQuery({ ...scope, path: sel.filePath })}`
          : `${serverUrl}/api/skills/sqlite/${encodeURIComponent(sel.id)}`;
      const res = await fetchFn(url);
      const data = (await res.json()) as SkillDetail & { error?: string };
      if (!res.ok) return { error: data.error ?? `HTTP ${res.status}` };
      return { detail: data };
    },
  };
}

/** Where a workspace skill was found, in words. */
export const WORKSPACE_SOURCE_LABEL: Record<WorkspaceSkillSource, string> = {
  agent: "agent folder",
  workspace: ".agents/skills",
  configured: "configured folder",
  claude: ".claude/skills",
  global: "home folder",
};

/**
 * Single scroll list: the workspace skills (agents load these), then the Cortex
 * library in cortex.db (agents do not, yet), each filtered by name or description.
 */
export function skillCatalogRows(workspaceSkills: readonly WorkspaceSkillSummary[], skills: readonly SkillRow[], filter: string): SkillCatalogRow[] {
  const match = (name: string, desc: string) => {
    const qq = filter.trim().toLowerCase();
    if (!qq) return true;
    return name.toLowerCase().includes(qq) || desc.toLowerCase().includes(qq);
  };
  const rows: SkillCatalogRow[] = [];
  const wsFiltered = workspaceSkills.filter((x) => match(x.name, x.description));
  const sqlFiltered = skills.filter((s) =>
    match(String(s.name ?? ""), String(s.description ?? "")),
  );
  if (wsFiltered.length > 0) {
    rows.push({ t: "hdr", label: "Workspace", note: "agents can load these" });
    for (const s of wsFiltered) rows.push({ t: "ws", s });
  }
  if (sqlFiltered.length > 0) {
    rows.push({ t: "hdr", label: "Cortex library", note: "kept in cortex.db, not sent to agents" });
    for (let i = 0; i < sqlFiltered.length; i++) {
      const s = sqlFiltered[i]!;
      rows.push({ t: "sql", s, rowKey: `sql-${String(s.id ?? `i${i}`)}` });
    }
  }
  return rows;
}

/** Frontmatter value as text (objects as JSON). */
export function formatYamlValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
