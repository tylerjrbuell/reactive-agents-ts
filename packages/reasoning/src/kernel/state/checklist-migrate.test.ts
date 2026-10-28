// Run: bun test packages/reasoning/src/kernel/state/checklist-migrate.test.ts --timeout 15000
//
// One-shot migration of legacy `_todo:*` scratchpad lists into `checklist-item`
// ledger facts at resume (plan 2026-10-28-plan-and-goal-primitives, Task 4).
import { describe, expect, it } from "bun:test";
import { foldAdvisory } from "@reactive-agents/core";
import { initialKernelState, transitionState, type KernelState } from "./kernel-state.js";
import { migrateLegacyTodo } from "./checklist-migrate.js";

const OPTS = { maxIterations: 4, strategy: "reactive", kernelType: "react", taskId: "t1" } as const;

const legacy = (list: unknown): string => JSON.stringify(list);

const withScratch = (entries: Record<string, string>): KernelState =>
  transitionState(initialKernelState(OPTS), { scratchpad: new Map(Object.entries(entries)) });

const itemsOf = (s: KernelState) =>
  foldAdvisory((s.ledger ?? []).flatMap((e) => (e.kind === "checklist-item" ? [e] : [])));

describe("migrateLegacyTodo", () => {
  it("mints add + status facts from the exact _todo:<taskId> key and removes every _todo:* key", () => {
    const s = withScratch({
      "_todo:t1": legacy([
        { id: 1, text: "alpha", status: "done" },
        { id: 2, text: "beta", status: "in_progress" },
        { id: 3, text: "gamma", status: "pending" },
      ]),
      "_todo:t2": legacy([{ id: 1, text: "other", status: "pending" }]),
      keep: "x",
    });
    const out = migrateLegacyTodo(s, "t1");
    expect(itemsOf(out).map((i) => [i.id, i.title, i.status])).toEqual([
      ["1", "alpha", "completed"],
      ["2", "beta", "in_progress"],
      ["3", "gamma", "pending"],
    ]);
    expect([...out.scratchpad.keys()]).toEqual(["keep"]);
  });

  it("falls back to the single _todo:* key when the exact key is absent", () => {
    const out = migrateLegacyTodo(withScratch({ "_todo:old": legacy([{ id: 1, text: "solo", status: "pending" }]) }), "t1");
    expect(itemsOf(out).map((i) => i.title)).toEqual(["solo"]);
    expect([...out.scratchpad.keys()]).toEqual([]);
  });

  it("mints nothing (but still cleans) when the exact key is absent and several others exist", () => {
    const out = migrateLegacyTodo(
      withScratch({
        "_todo:a": legacy([{ id: 1, text: "a", status: "pending" }]),
        "_todo:b": legacy([{ id: 1, text: "b", status: "pending" }]),
      }),
      "t1",
    );
    expect(itemsOf(out)).toEqual([]);
    expect([...out.scratchpad.keys()]).toEqual([]);
  });

  it("filters malformed legacy entries (the legacy parse contract)", () => {
    const out = migrateLegacyTodo(
      withScratch({
        "_todo:t1": legacy([
          { id: 1, text: "ok", status: "pending" },
          { id: "2", text: "string id", status: "pending" },
          { id: 3, text: 7, status: "pending" },
          { id: 4, text: "bad status", status: "weird" },
          null,
        ]),
      }),
      "t1",
    );
    expect(itemsOf(out).map((i) => i.title)).toEqual(["ok"]);
  });

  it("tolerates unparseable payloads and still removes the key", () => {
    const out = migrateLegacyTodo(withScratch({ "_todo:t1": "not json" }), "t1");
    expect(itemsOf(out)).toEqual([]);
    expect(out.scratchpad.has("_todo:t1")).toBe(false);
  });

  it("is idempotent: a second run is a no-op returning the same state", () => {
    const once = migrateLegacyTodo(withScratch({ "_todo:t1": legacy([{ id: 1, text: "a", status: "pending" }]) }), "t1");
    expect(migrateLegacyTodo(once, "t1")).toBe(once);
  });

  it("skips minting when the ledger already holds checklist-item facts, but still cleans", () => {
    const first = migrateLegacyTodo(withScratch({ "_todo:t1": legacy([{ id: 1, text: "a", status: "pending" }]) }), "t1");
    const again = transitionState(first, {
      scratchpad: new Map([["_todo:t1", legacy([{ id: 1, text: "stale", status: "done" }])]]),
    });
    const out = migrateLegacyTodo(again, "t1");
    expect(itemsOf(out).map((i) => i.title)).toEqual(["a"]);
    expect(out.scratchpad.has("_todo:t1")).toBe(false);
  });

  it("returns the state by identity when there is no legacy key", () => {
    const s = withScratch({ keep: "x" });
    expect(migrateLegacyTodo(s, "t1")).toBe(s);
  });
});
