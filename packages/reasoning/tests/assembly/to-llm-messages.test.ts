import { describe, it, expect } from "bun:test";
import { toLLMMessages } from "../../src/assembly/to-llm-messages.js";
import { project } from "../../src/assembly/project.js";
import { EventLog } from "../../src/assembly/event-log.js";
import { ResultStore } from "../../src/assembly/result-store.js";
import { resolveCapability } from "../../src/assembly/capability.js";

describe("toLLMMessages — ProviderRequest.messages → LLMMessage[]", () => {
  it("user → role:user, content string", () => {
    const out = toLLMMessages([{ role: "user", content: "hi" }]);
    expect(out[0]).toEqual({ role: "user", content: "hi" });
  });

  it("assistant with toolCalls → role:assistant, content = [tool_use blocks]", () => {
    const out = toLLMMessages([
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "get_a", arguments: { x: 1 } }] },
    ]);
    expect(out[0]!.role).toBe("assistant");
    const content = (out[0] as { content: unknown[] }).content;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0]).toEqual({ type: "tool_use", id: "c1", name: "get_a", input: { x: 1 } });
  });

  it("assistant with text + toolCalls → text block then tool_use block", () => {
    const out = toLLMMessages([
      { role: "assistant", content: "thinking", toolCalls: [{ id: "c1", name: "t", arguments: {} }] },
    ]);
    const content = (out[0] as { content: Array<{ type: string }> }).content;
    expect(content[0]!.type).toBe("text");
    expect(content[1]!.type).toBe("tool_use");
  });

  it("sanitizes tool_use name on replay (MCP slash → underscore) for native-FC validity", () => {
    const out = toLLMMessages([
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "github/list_commits", arguments: {} }] },
    ]);
    const content = (out[0] as { content: Array<{ type: string; name?: string }> }).content;
    expect(content[0]!.name).toBe("github_list_commits");
    expect(content[0]!.name!).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  it("sanitizes tool_result toolName on replay (Gemini functionResponse.name parity)", () => {
    const out = toLLMMessages([
      { role: "tool_result", toolCallId: "c1", toolName: "github/list_commits", content: "x" },
    ]);
    expect((out[0] as { toolName?: string }).toolName).toBe("github_list_commits");
  });

  it("assistant without toolCalls → role:assistant, content string", () => {
    const out = toLLMMessages([{ role: "assistant", content: "done" }]);
    expect(out[0]).toEqual({ role: "assistant", content: "done" });
  });

  it("tool_result → role:tool with toolCallId/toolName/content", () => {
    const out = toLLMMessages([
      { role: "tool_result", toolCallId: "c1", toolName: "get_a", content: "result" },
    ]);
    expect(out[0]).toEqual({ role: "tool", toolCallId: "c1", toolName: "get_a", content: "result" });
  });

  it("end-to-end: project() thread converts to a valid LLMMessage[] (opens user, tool roles matched)", () => {
    const cap = resolveCapability({ window: 4000, outputBudget: 2000, dialect: "native-fc", tier: "mid" });
    const store = new ResultStore();
    const r1 = store.put("get_a", { a: 1 });
    const log = new EventLog()
      .append({ kind: "goal", text: "g" })
      .append({ kind: "tool_called", tool: "get_a", callId: "c1", args: {} })
      .append({ kind: "tool_result", callId: "c1", ref: r1, shape: "obj" });
    const { request } = project({ log, capability: cap, store, persona: { system: "A" }, tools: { schemas: [] } });
    const llm = toLLMMessages(request.messages);
    expect(llm[0]!.role).toBe("user");
    // every role is a valid LLMMessage role
    for (const m of llm) expect(["system", "user", "assistant", "tool"]).toContain(m.role);
    // the assistant tool_use id is answered by a tool role with the same toolCallId
    const toolMsg = llm.find((m) => m.role === "tool") as { toolCallId: string } | undefined;
    expect(toolMsg?.toolCallId).toBe("c1");
  });
});
