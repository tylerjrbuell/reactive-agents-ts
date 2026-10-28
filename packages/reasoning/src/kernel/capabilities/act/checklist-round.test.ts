// Run: bun test packages/reasoning/src/kernel/capabilities/act/checklist-round.test.ts --timeout 15000
//
// Direct-import seam pin for act/checklist-round.ts — the round-local staging
// of `todo` ledger facts (plan 2026-10-28-plan-and-goal-primitives, Task 4).
import { describe, expect, it } from "bun:test";
import { foldAdvisory } from "@reactive-agents/core";
import { recordChecklistItems } from "../../ledger/emit.js";
import { startRound, stageChanges, viewItems, commitRound } from "./checklist-round.js";

const add = (id: string, title: string) => ({ op: "add" as const, items: [{ id, title }] });

describe("checklist-round", () => {
  it("viewItems folds ledger facts and staged changes in staging order", () => {
    const ledger = recordChecklistItems(undefined, [{ iteration: 1, change: add("1", "a") }]);
    const round = startRound();
    stageChanges(round, [add("2", "b")], "tc-1");
    stageChanges(round, [{ op: "status", id: "2", status: "in_progress" }], "tc-2");
    stageChanges(round, [{ op: "status", id: "1", status: "completed" }], "tc-3");
    const items = viewItems(round, ledger);
    expect(items.map((i) => [i.id, i.status])).toEqual([
      ["1", "completed"],
      ["2", "in_progress"],
    ]);
  });

  it("commitRound appends staged facts in order, stamped with the iteration and tool call id", () => {
    const round = startRound();
    stageChanges(round, [add("1", "a")], "tc-1");
    stageChanges(round, [{ op: "status", id: "1", status: "completed" }], "tc-2");
    const out = commitRound(round, undefined, 4);
    const facts = out.filter((e) => e.kind === "checklist-item");
    expect(facts.length).toBe(2);
    expect(facts.map((f) => f.iteration)).toEqual([4, 4]);
    expect(facts.map((f) => (f.kind === "checklist-item" ? f.toolCallId : undefined))).toEqual(["tc-1", "tc-2"]);
    expect(foldAdvisory(facts.flatMap((f) => (f.kind === "checklist-item" ? [f] : []))).map((i) => i.status)).toEqual([
      "completed",
    ]);
  });

  it("commitRound with nothing staged returns the ledger by identity", () => {
    const ledger = recordChecklistItems(undefined, [{ iteration: 1, change: add("1", "a") }]);
    expect(commitRound(startRound(), ledger, 2)).toBe(ledger);
    stageChanges(startRound(), [], "tc-x");
    const r = startRound();
    stageChanges(r, [], "tc-y");
    expect(commitRound(r, ledger, 2)).toBe(ledger);
  });

  it("viewItems ignores facts minted by merged sub-agent passes", () => {
    const base = recordChecklistItems(undefined, [{ iteration: 1, change: add("1", "root item") }]);
    const withChild = [
      ...base,
      { kind: "checklist-item" as const, seq: base.length, iteration: 1, pass: "sub-agent:w" as const, change: add("1", "child item") },
    ];
    expect(viewItems(startRound(), withChild).map((i) => i.title)).toEqual(["root item"]);
  });
});
