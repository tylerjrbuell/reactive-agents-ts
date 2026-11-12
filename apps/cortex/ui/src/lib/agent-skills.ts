/**
 * Lab Skills · Agent skills: an agent's stored, living skills (server
 * `api/agent-skills.ts`, read through the framework's skill API) and the rules
 * the panel renders by. Version diffs, confidence words and lifecycle entries
 * come from ui-core (`skillLineDiff`, `skillConfidenceLabel`,
 * `skillLifecycleEntryOf`); this module only shapes them for the panel.
 */
import {
  skillConfidenceLabel,
  skillLifecycleEntryOf,
  skillLineDiff,
  type SkillDiffLine,
  type SkillLifecycleEntry,
  type SkillLifecycleEventLike,
} from "@reactive-agents/ui-core";
import { CORTEX_SERVER_URL } from "./constants.js";

/** One stored version (server `AgentSkillVersionDto`). */
export interface AgentSkillVersion {
  readonly version: number;
  readonly status: "active" | "candidate";
  readonly instructions: string;
  readonly refinedAt: string;
  readonly successRateAtRefinement: number;
  readonly useCountAtRefinement: number | null;
}

/** A stored skill (server `AgentSkillDto`). */
export interface AgentSkill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly source: string;
  readonly confidence: string;
  readonly evolutionMode: string;
  readonly version: number;
  readonly instructions: string;
  readonly useCount: number;
  readonly successRate: number;
  readonly refinementCount: number;
  readonly taskCategories: readonly string[];
  readonly lastActivatedAt: string | null;
  readonly lastRefinedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly versions: readonly AgentSkillVersion[];
}

/** GET /api/agent-skills/:agentId. */
export interface AgentSkillsListing {
  readonly agentId: string;
  readonly available: boolean;
  readonly skills: readonly AgentSkill[];
  /** The model a refine runs on (the agent's last recorded run), or `null`. */
  readonly refineWith: { readonly provider: string; readonly model?: string } | null;
}

/** One stored lifecycle event (server `SkillLifecycleRow`). */
export interface SkillEventRow {
  readonly id: number;
  readonly ts: number;
  readonly runId: string;
  readonly event: SkillLifecycleEventLike;
}

/** What a refinement pass did. */
export interface RefineReport {
  readonly refined: number;
  readonly unchanged: number;
  readonly skipped: number;
  readonly failed: number;
}

// ── Rules ────────────────────────────────────────────────────────────────

/** Badge tone per confidence tier: expert reads as an outcome, tentative as quiet. */
export function confidenceTone(confidence: string): "ok" | "accent" | "neutral" {
  return confidence === "expert" ? "ok" : confidence === "trusted" ? "accent" : "neutral";
}

/** The confidence tier in words. */
export const confidenceLabel = skillConfidenceLabel;

/** How the skill may change, in words. */
export function evolutionModeLabel(mode: string): string {
  if (mode === "locked") return "Locked: refinement and promotion skip it";
  if (mode === "suggest") return "Suggest: refinements wait for review";
  if (mode === "auto") return "Evolves from runs";
  return mode;
}

/** Success rate as a percent, `—` before the first use. */
export function successRateText(skill: Pick<AgentSkill, "successRate" | "useCount">): string {
  return skill.useCount === 0 ? "—" : `${Math.round(skill.successRate * 100)}%`;
}

/** One row of the version list: stored versions plus the current one when it is not stored yet. */
export interface VersionRow {
  readonly version: number;
  /** `current` = the version the skill runs now. */
  readonly current: boolean;
  readonly status: "active" | "candidate";
  readonly instructions: string;
  /** When the version was recorded; `null` for the unrecorded current version. */
  readonly at: string | null;
  readonly successRateAtRefinement: number | null;
}

/** Versions newest first. The current version is always present, marked `current`. */
export function versionRows(skill: AgentSkill): VersionRow[] {
  const rows: VersionRow[] = skill.versions.map((v) => ({
    version: v.version,
    current: v.version === skill.version,
    status: v.status,
    instructions: v.version === skill.version ? skill.instructions : v.instructions,
    at: v.refinedAt,
    successRateAtRefinement: v.successRateAtRefinement,
  }));
  if (!rows.some((r) => r.current)) {
    rows.push({ version: skill.version, current: true, status: "active", instructions: skill.instructions, at: null, successRateAtRefinement: null });
  }
  return rows.sort((a, b) => b.version - a.version);
}

/** The version a diff starts from by default: the one just before `version`, if any. */
export function previousVersion(rows: readonly VersionRow[], version: number): number | null {
  const older = rows.filter((r) => r.version < version).map((r) => r.version);
  return older.length > 0 ? Math.max(...older) : null;
}

/** Line diff from version `from` to version `to`; empty when either is missing. */
export function versionDiff(rows: readonly VersionRow[], from: number, to: number): SkillDiffLine[] {
  const a = rows.find((r) => r.version === from);
  const b = rows.find((r) => r.version === to);
  return a && b ? skillLineDiff(a.instructions, b.instructions) : [];
}

/** Whether Roll back can run: an earlier version is stored. */
export function canRollBack(skill: AgentSkill): boolean {
  return skill.versions.some((v) => v.version === skill.version - 1);
}

/** How a skill may evolve (framework `SkillEvolutionMode`). */
export type SkillMode = "auto" | "suggest" | "locked";

/** The Lock / Unlock action for a skill: a locked skill unlocks to `auto`, any other mode locks. */
export function lockActionOf(skill: Pick<AgentSkill, "evolutionMode">): { readonly mode: SkillMode; readonly label: string; readonly hint: string } {
  return skill.evolutionMode === "locked"
    ? { mode: "auto", label: "Unlock", hint: "Let run outcomes refine, promote and roll back this skill" }
    : { mode: "locked", label: "Lock", hint: "Keep this version: refinement, promotion and regression rollback skip it" };
}

/** The mode choices when moving a library skill in; `auto` first (the library had no evolution). */
export const MOVE_MODE_OPTIONS: readonly { readonly value: SkillMode; readonly label: string }[] = [
  { value: "auto", label: "Evolves from runs" },
  { value: "suggest", label: "Suggest: refinements wait for review" },
  { value: "locked", label: "Locked: kept as written" },
];

/** A timeline entry with its time and run. */
export interface TimelineItem extends SkillLifecycleEntry {
  readonly id: number;
  readonly ts: number;
  /** The run that reported it; `""` for an action taken in Cortex (Refine now, Roll back). */
  readonly runId: string;
}

/** Where a timeline entry came from: its run, or a Cortex action. */
export function timelineOriginOf(item: Pick<TimelineItem, "runId">): { readonly kind: "run"; readonly runId: string } | { readonly kind: "cortex" } {
  return item.runId === "" ? { kind: "cortex" } : { kind: "run", runId: item.runId };
}

/** Stored events as timeline items (ui-core reads each); events it does not know are dropped. */
export function skillTimeline(rows: readonly SkillEventRow[]): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const r of rows) {
    const entry = skillLifecycleEntryOf(r.event);
    if (entry) out.push({ ...entry, id: r.id, ts: r.ts, runId: r.runId });
  }
  return out;
}

/** A refinement pass in one line. */
export function refineSummary(r: RefineReport): string {
  const parts = [`${r.refined} refined`, `${r.unchanged} unchanged`, `${r.skipped} skipped`, `${r.failed} failed`];
  const note = r.skipped > 0 ? " (skipped: too little new evidence since the last refinement)" : "";
  return `${parts.join(" · ")}${note}`;
}

/** The refine model in words (`ollama · qwen3`). */
export function refineModelText(m: AgentSkillsListing["refineWith"]): string | null {
  return m ? (m.model ? `${m.provider} · ${m.model}` : m.provider) : null;
}

/** The SKILL.md path an export writes. */
export function exportPathOf(root: string, name: string): string {
  return `${root.replace(/\/+$/, "")}/.agents/skills/${name}/SKILL.md`;
}

// ── API ──────────────────────────────────────────────────────────────────

const url = (agentId: string, rest = ""): string => `${CORTEX_SERVER_URL}/api/agent-skills/${encodeURIComponent(agentId)}${rest}`;

async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

const post = (u: string, body: object, fetchFn: typeof fetch) =>
  fetchFn(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** An agent's skills. */
export async function fetchAgentSkills(agentId: string, fetchFn: typeof fetch = fetch, signal?: AbortSignal): Promise<AgentSkillsListing> {
  return readJson<AgentSkillsListing>(await fetchFn(url(agentId), signal ? { signal } : undefined));
}

/** Lifecycle events, newest first; `skill` narrows to one skill. `signal` cancels a stale request. */
export async function fetchSkillEvents(agentId: string, skill?: string, fetchFn: typeof fetch = fetch, signal?: AbortSignal): Promise<SkillEventRow[]> {
  const q = skill ? `?skill=${encodeURIComponent(skill)}` : "";
  return (await readJson<{ events?: SkillEventRow[] }>(await fetchFn(url(agentId, `/events${q}`), signal ? { signal } : undefined))).events ?? [];
}

/** One refinement pass on the agent's last recorded model. */
export async function refineAgentSkills(agentId: string, fetchFn: typeof fetch = fetch): Promise<RefineReport> {
  return readJson<RefineReport>(await post(url(agentId, "/refine"), {}, fetchFn));
}

/** Restore a skill's previous version; returns the skill after. */
export async function rollbackAgentSkill(agentId: string, name: string, fetchFn: typeof fetch = fetch): Promise<AgentSkill> {
  return readJson<AgentSkill>(await post(url(agentId, `/skills/${encodeURIComponent(name)}/rollback`), {}, fetchFn));
}

/** Export a skill to `<root>/.agents/skills/<name>/SKILL.md`; returns the written path. */
export async function exportAgentSkill(agentId: string, name: string, root: string, fetchFn: typeof fetch = fetch): Promise<string> {
  return (await readJson<{ path: string }>(await post(url(agentId, `/skills/${encodeURIComponent(name)}/export`), { root }, fetchFn))).path;
}

/** Lock, unlock or set a skill's evolution mode; returns the skill after. */
export async function setAgentSkillMode(agentId: string, name: string, mode: SkillMode, fetchFn: typeof fetch = fetch): Promise<AgentSkill> {
  return readJson<AgentSkill>(await post(url(agentId, `/skills/${encodeURIComponent(name)}/mode`), { mode }, fetchFn));
}

/** Options for {@link moveLibrarySkill}. */
export interface MoveLibraryOptions {
  readonly evolutionMode?: SkillMode;
  /** Reload over the agent's same-name skill (its history is kept; changed text is a new version). */
  readonly update?: boolean;
}

/** A move's outcome: the loaded skill, or a name clash the user can resolve with `update`. */
export type MoveLibraryResult =
  | { readonly ok: true; readonly skill: AgentSkill }
  | { readonly ok: false; readonly conflict: string };

/** Move a Cortex library row into the agent's skills. A name clash (409) is a result, not a throw. */
export async function moveLibrarySkill(
  agentId: string,
  libraryId: string,
  options: MoveLibraryOptions = {},
  fetchFn: typeof fetch = fetch,
): Promise<MoveLibraryResult> {
  const res = await post(url(agentId, `/library/${encodeURIComponent(libraryId)}`), options, fetchFn);
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, conflict: body.error ?? "This agent already has a skill with that name." };
  }
  return { ok: true, skill: await readJson<AgentSkill>(res) };
}
