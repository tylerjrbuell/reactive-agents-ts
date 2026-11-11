import type { ChecklistGroupWire, ChecklistRowWire } from "../protocol/events.js";

/**
 * Goal-check view: which of a run's requirement rows carry real information.
 *
 * Every run contract holds one floor requirement ("produce a substantive answer
 * that addresses the task", provenance `floor`), so a checklist that shows it on
 * every turn says nothing. It is IMPLICIT: shown only when it is blocked.
 * Required tools, artifacts, plan steps and user goals are EXPLICIT and always
 * count. Pure.
 */

/**
 * Requirement id the run contract gives its floor requirement (`run-contract.ts`,
 * `provenance: { source: "floor" }`). The checklist wire carries requirement ids
 * but not their provenance, so the id is the stable marker.
 */
export const FLOOR_REQUIREMENT_ID = "answer";

/** True for a requirement every run has (the answer floor): no information unless it fails. */
export function isImplicitRequirement(row: ChecklistRowWire): boolean {
  return row.kind === "requirement" && row.id === FLOOR_REQUIREMENT_ID;
}

/** Overall state of a group's goals. `none` = nothing worth showing. */
export type GoalStatus = "none" | "pending" | "met" | "unmet";

/** What a UI shows for one group's goals. */
export interface GoalSummary {
  /** Requirement rows worth listing: explicit ones, plus an implicit one that is blocked. */
  readonly rows: readonly ChecklistRowWire[];
  /** Explicit requirements done / total (an implicit row never counts). */
  readonly done: number;
  readonly total: number;
  /** Rows that are blocked (explicit or implicit). */
  readonly blocked: number;
  readonly status: GoalStatus;
  /** True when there is something to show (an explicit goal, or a blocked implicit one). */
  readonly show: boolean;
  /** `Goals 3/4`; `Goal check failed` when only an implicit row failed; empty when nothing to show. */
  readonly label: string;
}

/**
 * Summarise a checklist group's requirement rows. `ended` = the run finished:
 * an explicit goal still not done then reads `unmet`, not `pending`.
 */
export function goalSummaryOf(group: Pick<ChecklistGroupWire, "rows">, opts: { readonly ended?: boolean } = {}): GoalSummary {
  const reqs = group.rows.filter((r) => r.kind === "requirement");
  const explicit = reqs.filter((r) => !isImplicitRequirement(r));
  const implicitBlocked = reqs.filter((r) => isImplicitRequirement(r) && r.status === "blocked");
  const rows = [...explicit, ...implicitBlocked];
  const done = explicit.filter((r) => r.status === "done").length;
  const blocked = rows.filter((r) => r.status === "blocked").length;
  const show = rows.length > 0;
  const status: GoalStatus = !show
    ? "none"
    : blocked > 0 || (opts.ended === true && done < explicit.length)
      ? "unmet"
      : done === explicit.length
        ? "met"
        : "pending";
  const label = !show ? "" : explicit.length > 0 ? `Goals ${done}/${explicit.length}` : "Goal check failed";
  return { rows, done, total: explicit.length, blocked, status, show, label };
}

/**
 * The checklist group of one sub-agent, matched by its stable key (live groups
 * are keyed `sub-agent:<name>#<key>`), else by a unique `sub-agent:<name>` /
 * label match. Searches nested groups. `undefined` when none matches.
 */
export function findSubAgentGroup(
  root: Pick<ChecklistGroupWire, "children">,
  agent: { readonly key: string; readonly name: string },
): ChecklistGroupWire | undefined {
  const all: ChecklistGroupWire[] = [];
  const walk = (g: Pick<ChecklistGroupWire, "children">): void => {
    for (const c of g.children) {
      all.push(c);
      walk(c);
    }
  };
  walk(root);
  const tail = (k: string): string => k.slice(k.lastIndexOf("/") + 1);
  const byKey = all.find((g) => tail(g.key).endsWith(`#${agent.key}`));
  if (byKey !== undefined) return byKey;
  const byName = all.filter((g) => tail(g.key) === `sub-agent:${agent.name}` || g.label === agent.name);
  return byName.length === 1 ? byName[0] : undefined;
}
