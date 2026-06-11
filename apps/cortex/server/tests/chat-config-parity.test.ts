import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../db/schema.js";
import { getChatSession } from "../db/chat-queries.js";
import { ChatSessionService } from "../services/chat-session-service.js";

describe("chat session config — builder tool-field parity", () => {
  it("persists mcpServerIds / agentTools / dynamicSubAgents / additionalToolNames", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const svc = new ChatSessionService(db);

    const id = await svc.createSession({
      name: "tooled",
      agentConfig: {
        provider: "test",
        enableTools: true,
        mcpServerIds: ["mcp-1"],
        agentTools: [{ kind: "remote", toolName: "x", remoteUrl: "http://x" }],
        dynamicSubAgents: { enabled: true, maxIterations: 2 },
        additionalToolNames: "my-tool",
      },
    });

    const row = getChatSession(db, id);
    expect(row).not.toBeNull();
    const cfg = row!.agentConfig as Record<string, unknown>;
    expect(cfg.mcpServerIds).toEqual(["mcp-1"]);
    expect(cfg.agentTools).toEqual([{ kind: "remote", toolName: "x", remoteUrl: "http://x" }]);
    expect(cfg.dynamicSubAgents).toEqual({ enabled: true, maxIterations: 2 });
    expect(cfg.additionalToolNames).toBe("my-tool");
  });
});
