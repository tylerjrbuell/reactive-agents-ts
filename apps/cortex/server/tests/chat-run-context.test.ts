import { describe, expect, it, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../db/schema.js";
import { upsertRun, updateRunStats, insertEvent, getNextSeq } from "../db/queries.js";
import { buildRunTaskContext } from "../services/chat-run-context.js";

describe("buildRunTaskContext", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
  });

  it("returns null when run does not exist", () => {
    expect(buildRunTaskContext(db, "missing-run")).toBeNull();
  });

  it("includes run id, agent id, and debrief text in task context", () => {
    upsertRun(db, "agent-99", "run-abc");
    updateRunStats(db, "run-abc", {
      debrief: JSON.stringify({ summary: "Found 3 items", outcome: "success" }),
      status: "completed",
    });

    const ctx = buildRunTaskContext(db, "run-abc");
    expect(ctx).not.toBeNull();
    expect(ctx!.cortexRunId).toBe("run-abc");
    expect(ctx!.cortexPriorRun).toContain("run-abc");
    expect(ctx!.cortexPriorRun).toContain("agent-99");
    expect(ctx!.cortexPriorRun).toContain("Found 3 items");
  });

  it("includes recent event types in task context", () => {
    upsertRun(db, "agent-1", "run-ev");
    let seq = getNextSeq(db, "run-ev");
    insertEvent(
      db,
      {
        v: 1,
        agentId: "agent-1",
        runId: "run-ev",
        event: { _tag: "AgentStarted", taskId: "t1", agentId: "agent-1", provider: "test", model: "m" },
      } as import("../types.js").CortexIngestMessage,
      seq,
    );
    seq = getNextSeq(db, "run-ev");
    insertEvent(
      db,
      {
        v: 1,
        agentId: "agent-1",
        runId: "run-ev",
        event: {
          _tag: "ReasoningStepCompleted",
          taskId: "t1",
          strategy: "reactive",
          step: 1,
          totalSteps: 1,
        },
      } as import("../types.js").CortexIngestMessage,
      seq,
    );

    const ctx = buildRunTaskContext(db, "run-ev");
    expect(ctx!.cortexPriorRun).toContain("AgentStarted");
    expect(ctx!.cortexPriorRun).toContain("ReasoningStepCompleted");
  });
});
