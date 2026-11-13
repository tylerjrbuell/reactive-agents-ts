// Run: bun run repo test apps/cortex/server/tests/chat-tool-intent.test.ts
//
// Cortex chat does not restate the framework's tool-intent rule. With tools on, `agent.chat` takes
// the tool loop because the agent has capability tools, whatever the wording ("what is bitcoin
// worth?" matches no tool-intent pattern). Only the user's tools-off switch is passed (`useTools: false`).
import { describe, expect, it } from "bun:test";
import { rmDbFiles, tmpDbPath } from "./helpers/tmp-db.js";
import { openDatabase } from "../db/schema.js";
import { ChatSessionService } from "../services/chat-session-service.js";

const scenario = [
  { toolCall: { name: "file-read", args: { path: "/definitely/not/here.txt" } } },
  { text: "final answer" },
];

function setup() {
  const path = tmpDbPath("chat-tool-intent");
  const db = openDatabase(path);
  return { svc: new ChatSessionService(db), cleanup: () => (db.close(), rmDbFiles(path)) };
}

describe("chat tool intent", () => {
  it("a tools-on turn with non-matching wording takes the tool loop without Cortex passing useTools", async () => {
    const { svc, cleanup } = setup();
    try {
      const id = await svc.createSession({
        agentConfig: { provider: "test", model: "test-model", tools: ["file-read"], testScenario: scenario },
      });
      const reply = await svc.chat(id, "what is bitcoin worth?");
      expect(reply.toolsUsed).toContain("file-read");
    } finally {
      cleanup();
    }
  }, 60_000);

  it("the tools-off switch keeps the turn off the tool loop", async () => {
    const { svc, cleanup } = setup();
    try {
      const id = await svc.createSession({
        agentConfig: { provider: "test", model: "test-model", tools: ["file-read"], enableTools: false, testScenario: scenario },
      });
      const reply = await svc.chat(id, "what is bitcoin worth?");
      expect(reply.toolsUsed ?? []).not.toContain("file-read");
    } finally {
      cleanup();
    }
  }, 60_000);
});
