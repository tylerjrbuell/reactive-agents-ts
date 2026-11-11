/**
 * Lab Skills tab data: SKILL.md files found on disk, SQLite skills in the desk DB,
 * the skill roots the desk scans, one skill's detail, and the create / delete calls.
 * The Lab page owns one instance so the header's root count survives tab switches.
 */
import { writable, type Readable } from "svelte/store";
import type { FetchFn } from "./gateway-agents-store.js";

/** A SQLite skill row (GET /api/skills). */
export type SkillRow = { id?: string; name?: string; description?: string; content?: string };

/** A SKILL.md found on disk (GET /api/skills/files). */
export type FsSkillSummary = {
  source: "filesystem";
  relPath: string;
  skillDir: string;
  name: string;
  description: string;
};

/** One skill's parsed document (GET /api/skills/file or /api/skills/sqlite/:id). */
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
  | { kind: "filesystem"; relPath: string }
  | { kind: "sqlite"; id: string };

/** One row of the single catalog list: a section header, a disk skill or a SQLite row. */
export type SkillCatalogRow =
  | { t: "hdr"; label: string }
  | { t: "fs"; s: FsSkillSummary }
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
  readonly fsSkills: FsSkillSummary[];
  /** Relative dirs on disk from GET /api/skills/discover (framework `withSkills` hints). */
  readonly discoveredPaths: string[];
}

/** Body of POST /api/skills. */
export type NewSkillBody = { name: string; instructions: string; description?: string; tags?: string[] };

/** The Lab skills store. */
export interface LabSkillsStore extends Readable<LabSkillsState> {
  loadDiscover(): Promise<void>;
  loadFsSkills(): Promise<void>;
  /** Reload the SQLite list; a failed request keeps the current one. */
  reloadDb(): Promise<void>;
  /** First load: SQLite list and disk skills together. */
  loadInitial(): Promise<void>;
  /** Create a SQLite skill; throws with the server's error. Call `reloadDb` after. */
  create(body: NewSkillBody): Promise<void>;
  /** Delete a SQLite skill; `error` when the server refused. Call `reloadDb` after. */
  remove(id: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Load one skill's document. */
  fetchDetail(sel: SkillListSelection): Promise<{ detail: SkillDetail } | { error: string }>;
}

/** Create the store. `fetchFn` is injectable for tests. */
export function createLabSkillsStore(serverUrl: string, fetchFn: FetchFn = (url, init) => fetch(url, init)): LabSkillsStore {
  const state = writable<LabSkillsState>({ skills: [], fsSkills: [], discoveredPaths: [] });
  const patch = (p: Partial<LabSkillsState>) => state.update((s) => ({ ...s, ...p }));

  const reloadDb = async () => {
    const skillsRes = await fetchFn(`${serverUrl}/api/skills`);
    if (skillsRes.ok) {
      patch({ skills: await skillsRes.json() as SkillRow[] });
    }
  };

  return {
    subscribe: state.subscribe,

    async loadDiscover() {
      try {
        const res = await fetchFn(`${serverUrl}/api/skills/discover`);
        patch({ discoveredPaths: res.ok ? ((await res.json()) as { paths?: string[] }).paths ?? [] : [] });
      } catch {
        patch({ discoveredPaths: [] });
      }
    },

    async loadFsSkills() {
      try {
        const res = await fetchFn(`${serverUrl}/api/skills/files`);
        const data = res.ok ? ((await res.json()) as { skills?: FsSkillSummary[] }) : {};
        patch({ fsSkills: data.skills ?? [] });
      } catch {
        patch({ fsSkills: [] });
      }
    },

    reloadDb,

    async loadInitial() {
      await Promise.all([
        fetchFn(`${serverUrl}/api/skills`).then(r => r.ok ? r.json() : []).then(j => { patch({ skills: j as SkillRow[] }); }).catch(() => {}),
        fetchFn(`${serverUrl}/api/skills/files`).then(r => r.ok ? r.json() : { skills: [] }).then((j: { skills?: FsSkillSummary[] }) => { patch({ fsSkills: j.skills ?? [] }); }).catch(() => {}),
      ]);
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
      const url = sel.kind === "filesystem"
        ? `${serverUrl}/api/skills/file?path=${encodeURIComponent(sel.relPath)}`
        : `${serverUrl}/api/skills/sqlite/${encodeURIComponent(sel.id)}`;
      const res = await fetchFn(url);
      const data = (await res.json()) as SkillDetail & { error?: string };
      if (!res.ok) return { error: data.error ?? `HTTP ${res.status}` };
      return { detail: data };
    },
  };
}

/** Single scroll list: section headers + disk skills + SQLite rows, filtered by name or description. */
export function skillCatalogRows(fsSkills: readonly FsSkillSummary[], skills: readonly SkillRow[], filter: string): SkillCatalogRow[] {
  const match = (name: string, desc: string) => {
    const qq = filter.trim().toLowerCase();
    if (!qq) return true;
    return name.toLowerCase().includes(qq) || desc.toLowerCase().includes(qq);
  };
  const rows: SkillCatalogRow[] = [];
  const fsFiltered = fsSkills.filter((x) => match(x.name, x.description));
  const sqlFiltered = skills.filter((s) =>
    match(String(s.name ?? ""), String(s.description ?? "")),
  );
  if (fsFiltered.length > 0) {
    rows.push({ t: "hdr", label: "On disk" });
    for (const s of fsFiltered) rows.push({ t: "fs", s });
  }
  if (sqlFiltered.length > 0) {
    rows.push({ t: "hdr", label: "SQLite (desk DB)" });
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
