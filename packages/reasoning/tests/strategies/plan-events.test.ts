import { describe, expect, it } from "bun:test";
import { Effect, Option, Ref } from "effect";
import { planStepEvents, type PlanEventSnapshotStep } from "../../src/strategies/planning/plan-events.js";
import { makePlanChecklist, type PlanChecklistStep } from "../../src/strategies/planning/plan-checklist.js";
import type { RunLedger } from "../../src/kernel/ledger/run-ledger.js";

const stamp = { planId: "t1", taskId: "t1", agentId: "a1", timestamp: 5 } as const;
const snap = (id: string, title: string, status: PlanEventSnapshotStep["status"]): PlanEventSnapshotStep => ({ id, title, status });

describe("planStepEvents (pure)", () => {
  it("first sync records the plan once with full steps", () => {
    const r = planStepEvents(undefined, [snap("s1", "Research bitcoin", "pending"), snap("s2", "Write report", "pending")], stamp);
    expect(r.events).toEqual([
      {
        _tag: "PlanRecorded",
        planId: "t1",
        steps: [
          { id: "s1", title: "Research bitcoin", status: "pending" },
          { id: "s2", title: "Write report", status: "pending" },
        ],
        source: "model",
        taskId: "t1",
        agentId: "a1",
        timestamp: 5,
      },
    ]);
  });

  it("a patch (step set replaced) records the plan again, with no status events", () => {
    const prev = [snap("s1", "A", "done"), snap("s2", "B", "pending")];
    const r = planStepEvents(prev, [snap("s1", "A", "done"), snap("s3", "Recover B", "pending")], stamp);
    expect(r.events.map((e) => e._tag)).toEqual(["PlanRecorded"]);
  });

  it("status transitions emit one PlanStepStatusChanged each", () => {
    const prev = [snap("s1", "A", "pending"), snap("s2", "B", "pending")];
    const r = planStepEvents(prev, [snap("s1", "A", "in-progress"), snap("s2", "B", "pending")], stamp);
    expect(r.events).toEqual([
      { _tag: "PlanStepStatusChanged", planId: "t1", stepId: "s1", from: "pending", to: "in-progress", taskId: "t1", agentId: "a1", timestamp: 5 },
    ]);
  });

  it("an unchanged sync emits nothing", () => {
    const prev = [snap("s1", "A", "pending")];
    expect(planStepEvents(prev, [snap("s1", "A", "pending")], stamp).events).toEqual([]);
  });
});

describe("PlanChecklist.sync publishes plan events", () => {
  const step = (id: string, title: string, status: PlanChecklistStep["status"]): PlanChecklistStep => ({ id, title, status });

  it("PlanRecorded then status changes on the bus; no-op sync is silent; no bus is fine", async () => {
    const seen: { _tag: string }[] = [];
    const bus = { publish: (e: unknown) => Effect.sync(() => void seen.push(e as { _tag: string })) };
    await Effect.runPromise(
      Effect.gen(function* () {
        const ledger = yield* Ref.make<RunLedger>([]);
        const cl = yield* makePlanChecklist({ ledger, eventBus: Option.some(bus), taskId: "t1", site: "test" });
        yield* cl.sync([step("s1", "A", "pending"), step("s2", "B", "pending")]);
        yield* cl.sync([step("s1", "A", "pending"), step("s2", "B", "pending")]);
        yield* cl.sync([step("s1", "A", "in_progress"), step("s2", "B", "pending")], { active: ["s1"] });
        yield* cl.sync([step("s1", "A", "completed"), step("s2", "B", "pending")]);
        const quiet = yield* makePlanChecklist({ ledger, eventBus: Option.none(), taskId: "t1", site: "test" });
        yield* quiet.sync([step("s1", "A", "pending")]);
      }),
    );
    const plan = seen.filter((e) => e._tag === "PlanRecorded" || e._tag === "PlanStepStatusChanged");
    expect(plan.map((e) => e._tag)).toEqual(["PlanRecorded", "PlanStepStatusChanged", "PlanStepStatusChanged"]);
  });
});
