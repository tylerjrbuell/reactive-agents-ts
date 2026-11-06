// Run: bun test apps/cortex/server/tests/chat-turn-assessments.test.ts --timeout 30000
//
// Goal segments take progress from the run's own `evidenceDelta` (runtime `goalRunOf`).
// This drives REAL `ChatSessionService.chat()` turns on the test provider and pins that
// the turn reports its root-run `AssessmentEmitted` events, and that `segmentRunOf`
// turns a tool-producing turn into progress.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { applySchema } from "../db/schema.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { segmentRunOf } from "../services/chat-goal-service.js";

let root: string;
let db: Database;
let svc: ChatSessionService;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cortex-turn-assess-"));
  db = new Database(":memory:");
  applySchema(db);
  svc = new ChatSessionService(db);
});
afterAll(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe("chat() turn → run verdict for goals", () => {
  it("a tool-producing turn reports root-run assessments with positive evidenceDelta", async () => {
    const id = await svc.createSession({
      agentConfig: {
        provider: "test",
        strategy: "reactive",
        maxIterations: 4,
        tools: ["file-write"],
        workspace: root,
        testScenario: [
          { toolCall: { name: "file-write", args: { path: join(root, "out.txt"), content: "hello" } } },
          { text: "wrote it" },
        ],
      },
    });
    const turn = await svc.chat(id, "write the file");
    await svc.deleteSession(id);

    expect(turn.turnEvents?.length ?? 0).toBeGreaterThan(0);
    expect(turn.turnEvents?.every((e) => e._tag === "AssessmentEmitted")).toBe(true);
    const run = segmentRunOf(turn);
    expect(run.evidenceDelta ?? 0).toBeGreaterThan(0);
    // session.chat() does not expose the exit-gate verdict yet (runtime assembleToolReply).
    expect(run.goalAchieved).toBeNull();
  }, 30_000);

  it("a tools-off turn runs no kernel: no events, delta 0, not progress", async () => {
    const id = await svc.createSession({ agentConfig: { provider: "test", enableTools: false } });
    const turn = await svc.chat(id, "hi");
    await svc.deleteSession(id);
    expect(turn.turnEvents).toEqual([]);
    expect(segmentRunOf(turn).evidenceDelta).toBe(0);
  }, 30_000);
});
