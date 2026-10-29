import type { ChecklistGroupWire, ChecklistRowWire, ChecklistSnapshotWire } from "@reactive-agents/ui-core";

/** Display model for one checklist group (the run root or a sub-agent). */
export interface ChecklistGroupView {
  readonly key: string;
  readonly name: string;
  /** 0-100. From requirement rows; from advisory rows only when the group has no requirements. */
  readonly progressPct: number;
  /** Progress text, e.g. "Goal checks 2/3" or "To-do 1/4". */
  readonly label: string;
  readonly sections: {
    /** Gate truth: the run is not done until these are. */
    readonly requirements: readonly ChecklistRowWire[];
    /** The agent's own plan; never gates completion. */
    readonly advisory: readonly ChecklistRowWire[];
  };
  /** The first in-progress advisory row: the single "now doing" line. Extra in-progress rows get no hero treatment. */
  readonly currentAdvisory: ChecklistRowWire | undefined;
  /** True when the group has advisory rows and every one is done (display-only; never gates anything). */
  readonly advisoryDone: boolean;
  readonly activeAdvisoryIds: readonly string[];
  readonly live: boolean;
  /** True once the group has requirements and all are done. */
  readonly collapsedByDefault: boolean;
  /** Sub-agent groups in start order, each with its own progress. Never counted in this group's progress. */
  readonly children: readonly ChecklistGroupView[];
}

/** Root view of a checklist snapshot. */
export type ChecklistView = ChecklistGroupView & { readonly lastSeq: number };

function groupView(g: ChecklistGroupWire): ChecklistGroupView {
  const hasReq = g.requirements.total > 0;
  const { done, total } = hasReq ? g.requirements : g.advisory;
  const progressPct = total === 0 ? 0 : Math.round((done / total) * 100);
  const advisory = g.rows.filter((r) => r.kind === "advisory");
  return {
    key: g.key,
    name: g.label,
    progressPct,
    label: total === 0 ? "" : `${hasReq ? "Goal checks" : "To-do"} ${done}/${total}`,
    sections: {
      requirements: g.rows.filter((r) => r.kind === "requirement"),
      advisory,
    },
    currentAdvisory: advisory.find((r) => r.status === "in_progress"),
    advisoryDone: advisory.length > 0 && advisory.every((r) => r.status === "done"),
    activeAdvisoryIds: g.activeAdvisoryIds,
    live: g.live === true,
    collapsedByDefault: hasReq && g.requirements.done === g.requirements.total,
    children: g.children.map(groupView),
  };
}

/** Project a wire snapshot into the plan-card view model. Root progress ignores children. */
export function checklistView(s: ChecklistSnapshotWire): ChecklistView {
  return { ...groupView(s.root), lastSeq: s.lastSeq };
}
