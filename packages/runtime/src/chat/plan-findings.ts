/**
 * plan-findings.ts — plan recon findings on their way from a planning run to
 * the execute run (spec 2026-11-16-plan-execute-posture-robustness.md, Addendum).
 *
 * A plan-posture run with recon on appends `plan-finding` facts to its ledger
 * (`{ kind, id, tool, summary }`). This module is the runtime side:
 *
 *  - {@link findingsOfEntries} — pure: ledger entries -> `PlanFinding`s (watchers, streams);
 *  - {@link mergeFindings}     — pure: add new findings to held ones, deduped, ids kept;
 *  - {@link findingsMetadata} / {@link readPlanFindings} — the per-run carrier
 *                                (`task.metadata.context.planFindings`) that ends at
 *                                `RunEnvelopeRails.planFindings`;
 */
import type { PlanFinding, Task } from "@reactive-agents/core";

/** Options-bag mixin: a run that starts with the findings its plan recorded. */
export interface PlanFindingsOption {
  /** Recon findings of the plan being executed; rendered once as context in the execute run. */
  readonly planFindings?: readonly PlanFinding[];
}

/** Key under `task.metadata.context` that carries the findings into the engine. */
export const PLAN_FINDINGS_CONTEXT_KEY = "planFindings";

const isFindingEntry = (e: Record<string, unknown>): boolean =>
  e.kind === "plan-finding" && typeof e.id === "string" && typeof e.tool === "string" && typeof e.summary === "string";

/** The plan findings among ledger entries (other kinds and malformed entries are ignored). Pure. */
export function findingsOfEntries(entries: ReadonlyArray<Record<string, unknown>>, at: number): PlanFinding[] {
  return entries.filter(isFindingEntry).map((e) => ({ id: e.id as string, tool: e.tool as string, summary: e.summary as string, at }));
}

/**
 * Add `incoming` findings to `held` ones. A finding already held (same tool and
 * summary) is dropped; a new one whose id is taken (a later run restarts at `f1`)
 * gets the next free `f<n>`. Held findings keep their ids. Pure.
 */
export function mergeFindings(held: readonly PlanFinding[], incoming: readonly PlanFinding[]): readonly PlanFinding[] {
  const out = [...held];
  for (const f of incoming) {
    if (out.some((h) => h.tool === f.tool && h.summary === f.summary)) continue;
    const ids = new Set(out.map((h) => h.id));
    let n = out.length + 1;
    while (ids.has(`f${n}`)) n += 1;
    out.push(ids.has(f.id) ? { ...f, id: `f${n}` } : f);
  }
  return out.length === held.length ? held : out;
}

/** Spread into `task.metadata.context`: non-empty findings under {@link PLAN_FINDINGS_CONTEXT_KEY}, else nothing. */
export const findingsMetadata = (findings: readonly PlanFinding[] | undefined): Record<string, unknown> =>
  findings !== undefined && findings.length > 0 ? { [PLAN_FINDINGS_CONTEXT_KEY]: findings } : {};

/** Read the findings back off a task, dropping anything malformed. Undefined when absent or empty. */
export function readPlanFindings(task: Pick<Task, "metadata">): readonly PlanFinding[] | undefined {
  const raw = task.metadata?.context?.[PLAN_FINDINGS_CONTEXT_KEY];
  if (!Array.isArray(raw)) return undefined;
  const items = raw.filter(
    (r): r is PlanFinding =>
      typeof r === "object" && r !== null && typeof (r as PlanFinding).id === "string" && typeof (r as PlanFinding).tool === "string" && typeof (r as PlanFinding).summary === "string",
  );
  return items.length > 0 ? items : undefined;
}
