import type { ChecklistGroup, ChecklistRow, ChecklistSnapshot } from "@reactive-agents/core";

/** A checklist row that just finished, with the owning group's label (`root` or child name). */
export interface FinishedRow {
  /** Stable identity: group key + row id. */
  readonly key: string;
  /** `undefined` for the root group; the child's display label otherwise. */
  readonly owner: string | undefined;
  readonly row: ChecklistRow;
}

const SEP = " · ";

function liveChildCount(g: ChecklistGroup): number {
  return g.children.reduce((n, c) => n + (c.live === true ? 1 : 0) + liveChildCount(c), 0);
}

function clip(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  return max === 1 ? "…" : `${text.slice(0, max - 1)}…`;
}

/**
 * Compact one-line checklist summary for the status line. Requirement progress
 * (the gate truth) always comes first, then advisory todo progress with the
 * active item's title, then `N agents` while children are live. Segments that
 * do not fit are dropped from the right; the result never exceeds `maxWidth`.
 */
export function formatChecklistSuffix(s: ChecklistSnapshot, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  const g = s.root;
  const segments: string[] = [];
  if (g.requirements.total > 0) segments.push(`☑ ${g.requirements.done}/${g.requirements.total}`);
  if (g.advisory.total > 0) {
    segments.push(`todo ${g.advisory.done}/${g.advisory.total}`);
    const active = g.rows.find((r) => r.kind === "advisory" && g.activeAdvisoryIds.includes(r.id));
    if (active) segments.push(active.title.replace(/\s+/g, " ").trim());
  }
  const agents = liveChildCount(g);
  if (agents > 0) segments.push(`${agents} agent${agents === 1 ? "" : "s"}`);

  let out = "";
  for (const seg of segments) {
    const candidate = out === "" ? seg : `${out}${SEP}${seg}`;
    if (candidate.length <= maxWidth) { out = candidate; continue; }
    // Only a title segment is worth truncating; counts are dropped whole.
    const room = maxWidth - out.length - SEP.length;
    if (out !== "" && room >= 4 && !/^(\d+ agents?|todo |☑ )/.test(seg)) out = `${out}${SEP}${clip(seg, room)}`;
    break;
  }
  return clip(out, maxWidth);
}

function flatten(g: ChecklistGroup, owner: string | undefined, into: Map<string, FinishedRow & { status: ChecklistRow["status"] }>): void {
  for (const row of g.rows) into.set(`${g.key}\u0000${row.id}`, { key: `${g.key}\u0000${row.id}`, owner, row, status: row.status });
  for (const c of g.children) flatten(c, c.label, into);
}

const isFinished = (status: ChecklistRow["status"]): boolean => status === "done" || status === "blocked";

/** Rows that moved into `done`/`blocked` between `prev` and `next` (transitions only). */
export function newlyFinished(prev: ChecklistSnapshot | undefined, next: ChecklistSnapshot): readonly FinishedRow[] {
  const before = new Map<string, FinishedRow & { status: ChecklistRow["status"] }>();
  const after = new Map<string, FinishedRow & { status: ChecklistRow["status"] }>();
  if (prev) flatten(prev.root, undefined, before);
  flatten(next.root, undefined, after);
  const result: FinishedRow[] = [];
  for (const [key, cur] of after) {
    if (!isFinished(cur.status)) continue;
    const old = before.get(key);
    if (old && old.status === cur.status) continue;
    result.push({ key, owner: cur.owner, row: cur.row });
  }
  return result;
}
