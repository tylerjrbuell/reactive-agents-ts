// Run: bun test packages/reasoning/src/kernel/capabilities/reason/tool-surface-heuristic.test.ts
//
// F6 (2026-07-28) — lazy disclosure read "no classification" as "nothing is
// relevant", so an unclassified run hid EVERY domain tool.
//
// Two defects, one surface:
//
//  1. `computePromptSchemas`' lazy allow-set was fed only by classifier output.
//     With the classifier off, the set was empty, so a tool the task named
//     outright was hidden and the model had to spend an iteration on
//     `discover-tools` to reach it. The never-prune-to-meta-only guard does NOT
//     catch this: one floored builtin counts as a domain tool, so the guard sees
//     a non-empty surface while twenty tools stay hidden.
//
//  2. The runtime unioned the `withTools({ builtins: [...] })` floor INTO
//     `relevantTools`, which made `hasClassification` — literally "did a
//     classifier speak?" — true on runs where none had. That silently disabled
//     the fallback in (1) even after it existed.
//
// Measured live before the fix (haiku-4.5 + qwen3.5-9b, 21-tool surface, task
// "Use the sql-query tool …"): classifier-off took 9 iterations to the
// classifier-on arm's 6, and the extra round trip was the ENTIRE reason the paid
// classifier looked 8-18% cheaper on that cell. After the fix the same cell runs
// 6 iterations at 3,946t vs the classifier's 5,092t.
//
// RED-ON-CUT:
//   - drop `heuristicRelevant` from the lazy allow-set → "surfaces a
//     task-named tool" fails (sql-query goes hidden).
//   - drop `floorTools` from the allow-set → "floor stays visible" fails.
//   - re-union the floor into `relevantTools` at the runtime seam → the
//     `hasClassification` cell fails, because a floor-only run would again
//     report itself as classified.
//
// The "classified run is unchanged" cell is what stops this passing vacuously: a
// heuristic that fired unconditionally would widen every classified surface too,
// which is the regression this must not become.
import { describe, it, expect } from "bun:test";
import { resolveToolSurface } from "./tool-surface.js";
import type { ToolSchema } from "../attend/tool-formatting.js";

const mk = (name: string, description: string): ToolSchema =>
  ({ name, description, parameters: [] }) as ToolSchema;

const SCHEMAS: readonly ToolSchema[] = [
  mk("file-write", "Write content to a file"),
  mk("sql-query", "Run a read-only SQL query against the analytics warehouse"),
  mk("slack-post", "Post a message to a Slack channel"),
  mk("geocode", "Convert a street address into latitude and longitude"),
  mk("recall", "Recall a stored value"),
  mk("discover-tools", "List tools available beyond the current surface"),
];

const TASK =
  "Use the sql-query tool to run the query `SELECT answer FROM t` and report the answer value it returns.";

const base = {
  augmented: SCHEMAS,
  finalAnswerSchema: mk("final-answer", "Emit the final answer"),
  lazyMode: true,
  pressureCritical: false,
  requiredTools: [] as readonly string[],
  relevantTools: [] as readonly string[],
  allowedTools: [] as readonly string[],
  toolsUsed: [] as readonly string[],
  discovered: [] as readonly string[],
  gateBlockedTools: [] as readonly string[],
  missingRequiredTools: [] as readonly string[],
  pruneMinTools: 15,
};

const visibleNames = (r: { visible: readonly ToolSchema[] }) => r.visible.map((t) => t.name);

describe("lazy disclosure on an UNCLASSIFIED run", () => {
  it("surfaces a tool the task names, without requiring discover-tools", () => {
    const r = resolveToolSurface({
      ...base,
      hasClassification: false,
      taskText: TASK,
      floorTools: ["file-write"],
    });

    // The load-bearing assertion. Before the fix this was hidden and the model
    // had to call discover-tools to reach it.
    expect(visibleNames(r)).toContain("sql-query");
    expect(r.reasons.get("sql-query")).toContain("heuristic-relevant");
  });

  it("still prunes tools the task has nothing to do with", () => {
    const r = resolveToolSurface({
      ...base,
      hasClassification: false,
      taskText: TASK,
      floorTools: ["file-write"],
    });

    // Guards against "fix by showing everything" — the surface must still be a
    // surface. Without this, deleting the prune entirely would pass the cell
    // above.
    expect(visibleNames(r)).not.toContain("geocode");
  });

  it("keeps the builtins floor visible even when the heuristic misses it", () => {
    const r = resolveToolSurface({
      ...base,
      hasClassification: false,
      // The task names sql-query and nothing filesystem-ish, so the heuristic
      // surfaces sql-query and NOT file-write. That detail is what makes this
      // cell load-bearing: because a non-META tool is already visible, the
      // never-prune-to-meta-only guard stays silent and cannot rescue the
      // floor. file-write is then visible ONLY if floorTools is honoured —
      // the 2026-07-07 rw-9/rw-7 guarantee, preserved through the
      // floor/classification split.
      //
      // (Phrased without "report"/"write" on purpose: those words feed the
      // heuristic's keyword expansion and would surface file-write on their
      // own, making the assertion pass for the wrong reason. An earlier draft
      // of this cell did exactly that and survived its own red-on-cut.)
      taskText: "Use the sql-query tool to run `SELECT answer FROM t` and tell me the value.",
      floorTools: ["file-write"],
    });

    expect(visibleNames(r)).toContain("file-write");
    expect(r.reasons.get("file-write")).toContain("builtins-floor");
    // Pins the precondition above — if the heuristic ever starts surfacing
    // file-write from this text, the guard changes and this cell silently stops
    // testing the floor.
    expect(visibleNames(r)).toContain("sql-query");
  });
});

describe("lazy disclosure on a CLASSIFIED run", () => {
  it("uses classifier output and does NOT widen the surface with keyword noise", () => {
    const r = resolveToolSurface({
      ...base,
      hasClassification: true,
      relevantTools: ["file-write"],
      taskText: TASK,
      floorTools: ["file-write"],
    });

    // A live classification is the better signal, so the heuristic must stay
    // out of the way. If it fired unconditionally, sql-query would appear here
    // despite the classifier having excluded it — that is the regression this
    // cell exists to catch.
    expect(visibleNames(r)).toContain("file-write");
    expect(visibleNames(r)).not.toContain("sql-query");
  });
});
