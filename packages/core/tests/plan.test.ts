import { describe, it, expect } from "bun:test";
import { Effect, Ref, Schema } from "effect";
import {
  EventBus,
  EventBusLive,
  PlanSchema,
  isPlanEmpty,
  planFromChecklist,
  planToChecklistSeed,
} from "../src/index.js";
import type { AgentEvent, ChecklistRow, ChecklistSnapshot, Plan, PlanRecordedEvent } from "../src/index.js";

const row = (id: string, status: ChecklistRow["status"], kind: ChecklistRow["kind"] = "advisory"): ChecklistRow => ({
  id,
  kind,
  title: `title ${id}`,
  status,
});

const snapshot = (rows: ChecklistRow[]): ChecklistSnapshot => ({
  root: {
    key: "root",
    label: "root",
    rows,
    requirements: { done: 0, total: 0 },
    advisory: { done: 0, total: rows.length },
    activeAdvisoryIds: [],
    children: [],
  },
  lastSeq: 0,
});

const meta = { id: "p1", goal: "ship it", createdAt: 5, source: "harness-derived" as const };

describe("Plan schema", () => {
  it("decodes a valid plan with an optional tool", () => {
    const plan = Schema.decodeUnknownSync(PlanSchema)({
      id: "p1",
      goal: "g",
      steps: [{ id: "1", title: "a", tool: "web-search", status: "in-progress" }, { id: "2", title: "b", status: "skipped" }],
      createdAt: 1,
      source: "model",
    });
    expect(plan.steps[0]?.tool).toBe("web-search");
    expect(plan.steps[1]?.tool).toBeUndefined();
  });

  it("rejects an unknown status or source", () => {
    const bad = { id: "p", goal: "g", steps: [{ id: "1", title: "a", status: "completed" }], createdAt: 1, source: "model" };
    expect(() => Schema.decodeUnknownSync(PlanSchema)(bad)).toThrow();
    expect(() => Schema.decodeUnknownSync(PlanSchema)({ ...bad, steps: [], source: "bot" })).toThrow();
  });
});

describe("plan <-> checklist", () => {
  it("planFromChecklist keeps advisory rows, ids, titles, order; drops requirements; maps status", () => {
    const plan = planFromChecklist(
      snapshot([row("1", "done"), row("req", "pending", "requirement"), row("2", "in_progress"), row("3", "blocked"), row("4", "pending")]),
      { ...meta, tools: { "2": "file-write" } },
    );
    expect(plan.steps.map((s) => [s.id, s.title, s.status])).toEqual([
      ["1", "title 1", "done"],
      ["2", "title 2", "in-progress"],
      ["3", "title 3", "pending"],
      ["4", "title 4", "pending"],
    ]);
    expect(plan.steps[1]?.tool).toBe("file-write");
    expect(plan.steps[0]).not.toHaveProperty("tool");
    expect(plan).toMatchObject(meta);
  });

  it("planToChecklistSeed round-trips ids/titles/status", () => {
    const snap = snapshot([row("1", "done"), row("2", "in_progress"), row("3", "pending")]);
    const seed = planToChecklistSeed(planFromChecklist(snap, meta));
    expect(seed).toEqual([
      { id: "1", title: "title 1", status: "completed" },
      { id: "2", title: "title 2", status: "in_progress" },
      { id: "3", title: "title 3", status: "pending" },
    ]);
  });

  it("skipped seeds as completed; tool hint is dropped from the seed", () => {
    const plan: Plan = { ...meta, steps: [{ id: "1", title: "a", tool: "t", status: "skipped" }] };
    const seed = planToChecklistSeed(plan);
    expect(seed).toEqual([{ id: "1", title: "a", status: "completed" }]);
  });

  it("isPlanEmpty flags a plan with no steps", () => {
    expect(isPlanEmpty(planFromChecklist(snapshot([]), meta))).toBe(true);
    expect(isPlanEmpty({ steps: [{ id: "1", title: "a", status: "pending" }] })).toBe(false);
  });
});

describe("plan events", () => {
  it("are AgentEvent members", () => {
    const a: AgentEvent = { _tag: "PlanRecorded", planId: "p", steps: [], source: "model", timestamp: 1 };
    const b: AgentEvent = { _tag: "PlanStepStatusChanged", planId: "p", stepId: "1", from: "pending", to: "done", timestamp: 2 };
    expect([a._tag, b._tag]).toEqual(["PlanRecorded", "PlanStepStatusChanged"]);
  });

  it("round-trips through EventBus.on with narrowing", async () => {
    const got = await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* EventBus;
        const ref = yield* Ref.make<PlanRecordedEvent | undefined>(undefined);
        yield* bus.on("PlanRecorded", (e) => Ref.set(ref, e));
        yield* bus.publish({
          _tag: "PlanRecorded",
          planId: "p",
          steps: [{ id: "1", title: "a", status: "pending" }],
          source: "user-edited",
          taskId: "t",
          timestamp: 3,
        });
        return yield* Ref.get(ref);
      }).pipe(Effect.provide(EventBusLive)),
    );
    expect(got?.steps).toHaveLength(1);
    expect(got?.source).toBe("user-edited");
  });
});
