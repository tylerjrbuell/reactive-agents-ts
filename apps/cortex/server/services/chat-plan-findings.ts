/**
 * A chat session plan's recon findings (`Plan.findings`, recorded when the framework's `planRecon`
 * harness mechanism lets read-effect tools run during planning). The framework owns what a finding
 * is and how it seeds an execute run; Cortex persists the list beside the plan meta and lets the
 * user remove or reword one. These helpers only validate and bound what crosses the wire or the
 * database. Pure.
 */
import type { PlanFinding } from "@reactive-agents/core";

/** Most findings a plan may carry (the framework records at most 6 recon calls per run; edits may add a few). */
export const PLAN_MAX_FINDINGS = 30;
const SUMMARY_MAX = 2000;
const TOOL_MAX = 100;
const ID_MAX = 100;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Trim and bound findings from an editor. `ok: false` carries the reason for a 400. A blank
 * summary or tool is rejected; a duplicate id is rejected; ids are kept as given.
 */
export function cleanPlanFindings(
  raw: readonly PlanFinding[],
): { readonly ok: true; readonly findings: readonly PlanFinding[] } | { readonly ok: false; readonly error: string } {
  if (raw.length > PLAN_MAX_FINDINGS) return { ok: false, error: `Invalid plan: at most ${PLAN_MAX_FINDINGS} findings` };
  const seen = new Set<string>();
  const findings: PlanFinding[] = [];
  for (const f of raw) {
    const id = f.id.trim();
    const tool = f.tool.trim();
    const summary = f.summary.trim();
    if (id === "" || id.length > ID_MAX) return { ok: false, error: `Invalid plan: a finding id must be 1-${ID_MAX} characters` };
    if (tool === "" || tool.length > TOOL_MAX) return { ok: false, error: `Invalid plan: a finding tool must be 1-${TOOL_MAX} characters` };
    if (summary === "" || summary.length > SUMMARY_MAX) return { ok: false, error: `Invalid plan: a finding summary must be 1-${SUMMARY_MAX} characters` };
    if (seen.has(id)) return { ok: false, error: `Invalid plan: duplicate finding id "${id}"` };
    seen.add(id);
    findings.push({ id, tool, summary, ...(typeof f.at === "number" ? { at: f.at } : {}) });
  }
  return { ok: true, findings };
}

/** The findings in a stored value; anything malformed is dropped (a corrupt row never breaks a plan read). */
export function findingsOfStored(raw: unknown): PlanFinding[] {
  if (!Array.isArray(raw)) return [];
  const out: PlanFinding[] = [];
  for (const f of raw) {
    if (!isRecord(f) || typeof f.id !== "string" || typeof f.tool !== "string" || typeof f.summary !== "string") continue;
    out.push({ id: f.id, tool: f.tool, summary: f.summary, ...(typeof f.at === "number" ? { at: f.at } : {}) });
  }
  return out;
}
