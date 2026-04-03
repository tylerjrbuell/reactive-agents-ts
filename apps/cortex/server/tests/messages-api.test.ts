import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { openDatabase, applySchema } from "../db/schema.js";
import { rmSync } from "node:fs";
import { getRunMessages } from "../db/messages-queries.js";

const TEST_DB_PATH = "/tmp/cortex-messages-test.db";

let db: ReturnType<typeof openDatabase>;

beforeAll(() => {
  db = openDatabase(TEST_DB_PATH);
  // Seed a run and two ReasoningStepCompleted events
  db.prepare(
    `INSERT OR IGNORE INTO cortex_runs (run_id, agent_id, started_at, status) VALUES (?,?,?,?)`,
  ).run("run-msg-1", "agent-1", Date.now(), "completed");

  const msgs1 = [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "What is 2+2?" },
    { role: "assistant", content: "Let me think.", toolCalls: [] },
  ];
  db.prepare(
    `INSERT INTO cortex_events (agent_id, run_id, seq, ts, type, payload) VALUES (?,?,?,?,?,?)`,
  ).run(
    "agent-1",
    "run-msg-1",
    1,
    Date.now(),
    "ReasoningStepCompleted",
    JSON.stringify({
      kernelPass: 1,
      step: 1,
      totalSteps: 1,
      strategy: "reactive",
      thought: "...",
      messages: msgs1,
    }),
  );

  const msgs2 = [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "What is 2+2?" },
    { role: "assistant", content: "The answer is 4.", toolCalls: [] },
  ];
  db.prepare(
    `INSERT INTO cortex_events (agent_id, run_id, seq, ts, type, payload) VALUES (?,?,?,?,?,?)`,
  ).run(
    "agent-1",
    "run-msg-1",
    2,
    Date.now(),
    "ReasoningStepCompleted",
    JSON.stringify({
      kernelPass: 2,
      step: 1,
      totalSteps: 1,
      strategy: "reactive",
      thought: "...",
      messages: msgs2,
    }),
  );
});

afterAll(() => {
  db.close();
  rmSync(TEST_DB_PATH, { force: true });
});

describe("getRunMessages", () => {
  it("returns grouped message threads for a run", () => {
    const groups = getRunMessages(db, "run-msg-1");
    expect(groups).toHaveLength(2);
    expect(groups[0]!.kernelPass).toBe(1);
    expect(groups[0]!.strategy).toBe("reactive");
    expect(groups[0]!.messages).toHaveLength(3);
    expect(groups[0]!.messages[0]!.role).toBe("system");
    expect(groups[1]!.kernelPass).toBe(2);
  });

  it("returns empty array for unknown run", () => {
    const groups = getRunMessages(db, "no-such-run");
    expect(groups).toHaveLength(0);
  });
});

describe("getRunMessages synthetic fields (plan-execute-reflect)", () => {
  let mem: Database;

  beforeAll(() => {
    mem = new Database(":memory:");
    applySchema(mem);
    mem.prepare(
      `INSERT INTO cortex_events (agent_id, run_id, seq, ts, type, payload) VALUES (?,?,?,?,?,?)`,
    ).run(
      "agent-pe",
      "run-pe-1",
      1,
      Date.now(),
      "ReasoningStepCompleted",
      JSON.stringify({
        _tag: "ReasoningStepCompleted",
        taskId: "t1",
        strategy: "plan-execute-reflect",
        step: 2,
        totalSteps: 5,
        thought: "[PLAN 1] Generated 2 steps:\n  s1: Do thing (tool)",
        action: "[STEP 1/2] s1: Do thing (tool → web-search)",
        observation: "[EXEC s1] ✓ results here",
        kernelPass: "plan-execute:step-1:done",
      }),
    );
  });

  afterAll(() => {
    mem.close();
  });

  it("builds a thread from thought/action/observation when messages[] is absent", () => {
    const groups = getRunMessages(mem, "run-pe-1");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.messages).toHaveLength(3);
    expect(groups[0]!.messages[0]!.role).toBe("assistant");
    expect(groups[0]!.messages[1]!.role).toBe("assistant");
    expect(groups[0]!.messages[2]!.role).toBe("tool");
    expect(groups[0]!.phaseLabel).toBe("plan-execute:step-1:done");
  });
});
