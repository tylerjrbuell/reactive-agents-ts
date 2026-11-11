/**
 * Memory studio: client for `/api/memory` (served through the framework's
 * `agent.memory()` facade) and the pure rules its views share (layer tabs,
 * provenance links, edit patches). Used by the Lab Memory tab
 * (`components/memory/MemoryStudio.svelte`) and the run view's Memory tab.
 */
import { CORTEX_SERVER_URL } from "./constants.js";

/** A semantic entry (server `MemorySemanticDto`). */
export interface SemanticMemory {
  readonly id: string;
  readonly content: string;
  readonly summary: string;
  readonly importance: number;
  readonly verified: boolean;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly accessCount: number;
  readonly lastAccessedAt: string;
  readonly taskId?: string;
  readonly runId?: string;
}

/** A procedural entry, a learned workflow (server `MemoryProceduralDto`). */
export interface ProceduralMemory {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly pattern: string;
  readonly successRate: number;
  readonly useCount: number;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly taskId?: string;
  readonly runId?: string;
}

/** An episodic log entry (server `MemoryEpisodicDto`). */
export interface EpisodicMemory {
  readonly id: string;
  readonly date: string;
  readonly content: string;
  readonly eventType: string;
  readonly taskId?: string;
}

/** One agent's memory (server `MemoryListing`). */
export interface MemoryListing {
  readonly agentId: string;
  readonly available: boolean;
  readonly dbPath: string;
  readonly semantic: readonly SemanticMemory[];
  readonly procedural: readonly ProceduralMemory[];
  readonly episodic: readonly EpisodicMemory[];
}

/** An agent in the studio's picker (server `MemoryAgentRow`). */
export interface MemoryAgent {
  readonly agentId: string;
  readonly label: string;
  readonly kind: "saved-agent" | "chat" | "runs" | "other";
  readonly runCount: number;
  readonly lastRunAt: number | null;
}

/** The three stores the studio browses. */
export type MemoryLayer = "semantic" | "procedural" | "episodic";

/** Display names and one-line explanations per layer. */
export const MEMORY_LAYERS: readonly { readonly id: MemoryLayer; readonly label: string; readonly blurb: string }[] = [
  { id: "semantic", label: "Facts", blurb: "Semantic memory: facts and observations the agent stored. Searchable, editable." },
  { id: "procedural", label: "Workflows", blurb: "Procedural memory: workflows the agent learned. Editable." },
  { id: "episodic", label: "Log", blurb: "Episodic memory: what happened, in order. Read only." },
];

/** Tab items with counts for a listing. */
export function memoryLayerTabs(listing: MemoryListing | null): { id: MemoryLayer; label: string; count?: number }[] {
  return MEMORY_LAYERS.map((l) => (listing ? { id: l.id, label: l.label, count: listing[l.id].length } : { id: l.id, label: l.label }));
}

/** The run view link for a run id. */
export function runHref(runId: string): string {
  return `/run/${encodeURIComponent(runId)}`;
}

/** The Lab Memory tab opened on an agent (and optionally narrowed to one run). */
export function memoryStudioHref(agentId: string, runId?: string): string {
  const q = new URLSearchParams({ agent: agentId });
  if (runId) q.set("run", runId);
  return `/lab?${q.toString()}#memory`;
}

/** Where an entry came from: the run that wrote it, or an honest "not recorded". */
export function provenanceOf(entry: { readonly runId?: string; readonly taskId?: string }):
  | { readonly kind: "run"; readonly runId: string; readonly href: string; readonly taskId?: string }
  | { readonly kind: "unknown" } {
  if (entry.runId) {
    return { kind: "run", runId: entry.runId, href: runHref(entry.runId), ...(entry.taskId ? { taskId: entry.taskId } : {}) };
  }
  return { kind: "unknown" };
}

/** Short form of a long id for labels (`01HX…9KQ`). The full id goes in the tooltip. */
export function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

/** Comma separated tags → a clean list (trimmed, no empties, no duplicates). */
export function parseTags(text: string): string[] {
  return [...new Set(text.split(",").map((t) => t.trim()).filter((t) => t.length > 0))];
}

/** Editable form values for a semantic entry. */
export interface SemanticDraft {
  content: string;
  summary: string;
  importance: string;
  tags: string;
}

/** Editable form values for a procedural entry. */
export interface ProceduralDraft {
  name: string;
  description: string;
  pattern: string;
  tags: string;
}

/** The form values an entry opens with. */
export function semanticDraftOf(e: SemanticMemory): SemanticDraft {
  return { content: e.content, summary: e.summary, importance: String(e.importance), tags: e.tags.join(", ") };
}

/** The form values a workflow opens with. */
export function proceduralDraftOf(e: ProceduralMemory): ProceduralDraft {
  return { name: e.name, description: e.description, pattern: e.pattern, tags: e.tags.join(", ") };
}

/** A patch (changed fields only), `null` when nothing changed, or an error to show. */
export type PatchResult<P> = { readonly ok: true; readonly patch: P | null } | { readonly ok: false; readonly error: string };

/** Fields a semantic edit can change (server `SemanticPatchBody`). */
export interface SemanticPatch {
  content?: string;
  summary?: string;
  importance?: number;
  tags?: string[];
}

/** Fields a procedural edit can change (server `ProceduralPatchBody`). */
export interface ProceduralPatch {
  name?: string;
  description?: string;
  pattern?: string;
  tags?: string[];
}

const sameTags = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((t, i) => t === b[i]);

/** Diff a semantic draft against its entry. Content must stay non-empty; importance is 0 to 1. */
export function semanticPatchOf(e: SemanticMemory, d: SemanticDraft): PatchResult<SemanticPatch> {
  const content = d.content.trim();
  if (content === "") return { ok: false, error: "Content cannot be empty" };
  const importance = Number(d.importance.trim());
  if (d.importance.trim() === "" || !Number.isFinite(importance) || importance < 0 || importance > 1) {
    return { ok: false, error: "Importance is a number from 0 to 1" };
  }
  const tags = parseTags(d.tags);
  const patch: SemanticPatch = {
    ...(content !== e.content ? { content } : {}),
    ...(d.summary.trim() !== e.summary ? { summary: d.summary.trim() } : {}),
    ...(importance !== e.importance ? { importance } : {}),
    ...(!sameTags(tags, e.tags) ? { tags } : {}),
  };
  return { ok: true, patch: Object.keys(patch).length > 0 ? patch : null };
}

/** Diff a procedural draft against its workflow. The name must stay non-empty. */
export function proceduralPatchOf(e: ProceduralMemory, d: ProceduralDraft): PatchResult<ProceduralPatch> {
  const name = d.name.trim();
  if (name === "") return { ok: false, error: "Name cannot be empty" };
  const tags = parseTags(d.tags);
  const patch: ProceduralPatch = {
    ...(name !== e.name ? { name } : {}),
    ...(d.description.trim() !== e.description ? { description: d.description.trim() } : {}),
    ...(d.pattern !== e.pattern ? { pattern: d.pattern } : {}),
    ...(!sameTags(tags, e.tags) ? { tags } : {}),
  };
  return { ok: true, patch: Object.keys(patch).length > 0 ? patch : null };
}

/** Local filter over loaded entries (the search box covers semantic memory server-side). */
export function filterEntries<T extends SemanticMemory | ProceduralMemory | EpisodicMemory>(entries: readonly T[], text: string): T[] {
  const q = text.trim().toLowerCase();
  if (q === "") return [...entries];
  return entries.filter((e) => {
    const hay =
      "name" in e
        ? `${e.name} ${e.description} ${e.pattern} ${e.tags.join(" ")}`
        : "summary" in e
          ? `${e.content} ${e.summary} ${e.tags.join(" ")}`
          : `${e.content} ${e.eventType}`;
    return hay.toLowerCase().includes(q);
  });
}

/** Search hint: the framework's full-text query ignores words under 4 characters. */
export function searchHint(query: string): string | null {
  const words = query.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return null;
  return words.every((w) => w.replace(/[^\p{L}\p{N}]/gu, "").length < 4) ? "Search matches words of 4 or more characters." : null;
}

// ── API ──────────────────────────────────────────────────────────────────

/** URL of a memory route (`agentId` and ids are encoded). */
export function memoryUrl(agentId: string, rest = "", query: Record<string, string | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") q.set(k, v);
  const qs = q.toString();
  return `${CORTEX_SERVER_URL}/api/memory/${encodeURIComponent(agentId)}${rest}${qs ? `?${qs}` : ""}`;
}

async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

/** Agents that have a memory database. */
export async function fetchMemoryAgents(fetchFn: typeof fetch = fetch): Promise<MemoryAgent[]> {
  const body = await readJson<{ agents?: MemoryAgent[] }>(await fetchFn(`${CORTEX_SERVER_URL}/api/memory/agents`));
  return body.agents ?? [];
}

/** An agent's memory; `runId` narrows it to what that run wrote. */
export async function fetchMemory(agentId: string, runId?: string, fetchFn: typeof fetch = fetch): Promise<MemoryListing> {
  return readJson<MemoryListing>(await fetchFn(memoryUrl(agentId, "", { runId })));
}

/** Full-text search over semantic memory. */
export async function searchMemory(agentId: string, q: string, runId?: string, fetchFn: typeof fetch = fetch): Promise<SemanticMemory[]> {
  const body = await readJson<{ results?: SemanticMemory[] }>(await fetchFn(memoryUrl(agentId, "/search", { q, runId })));
  return body.results ?? [];
}

async function patchEntry<T>(agentId: string, layer: "semantic" | "procedural", id: string, patch: object, fetchFn: typeof fetch): Promise<T> {
  const res = await fetchFn(memoryUrl(agentId, `/${layer}/${encodeURIComponent(id)}`), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  return readJson<T>(res);
}

/** Save a semantic edit; returns the updated entry. */
export function updateSemanticMemory(agentId: string, id: string, patch: SemanticPatch, fetchFn: typeof fetch = fetch): Promise<SemanticMemory> {
  return patchEntry<SemanticMemory>(agentId, "semantic", id, patch, fetchFn);
}

/** Save a workflow edit; returns the updated workflow. */
export function updateProceduralMemory(agentId: string, id: string, patch: ProceduralPatch, fetchFn: typeof fetch = fetch): Promise<ProceduralMemory> {
  return patchEntry<ProceduralMemory>(agentId, "procedural", id, patch, fetchFn);
}

/** Delete an entry. */
export async function deleteMemoryEntry(
  agentId: string,
  layer: "semantic" | "procedural",
  id: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  await readJson<{ deleted: boolean }>(await fetchFn(memoryUrl(agentId, `/${layer}/${encodeURIComponent(id)}`), { method: "DELETE" }));
}
