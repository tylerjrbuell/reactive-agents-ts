/**
 * The direct (no-tools) chat path exposes the provider's input/output split on
 * ChatReply, and a provider that reports only a total leaves both halves absent
 * (no fabricated 70/30 split at this layer; the UI applies splitTokens and marks
 * its estimate).
 */
import { describe, expect, it } from "bun:test";
import { ChatEngine, type ChatEngineCapabilities } from "../src/chat/engine.js";
import { assembleToolReply } from "../src/chat/tool-reply.js";
import type { AgentResult, ChatReply } from "../src/index.js";

const engineWith = (complete: ChatEngineCapabilities["complete"]): ChatEngine =>
  new ChatEngine({ complete }, { sessionId: "sess_token_split" });

describe("direct chat reply split", () => {
  it("copies provider-reported input and output tokens", async () => {
    const reply = await engineWith(async () => ({
      message: "hi",
      tokens: 1500,
      inputTokens: 1000,
      outputTokens: 500,
      cost: 0,
    })).turn("hello");
    expect(reply.tokens).toBe(1500);
    expect(reply.inputTokens).toBe(1000);
    expect(reply.outputTokens).toBe(500);
  });

  it("leaves both halves absent when the provider reports only a total", async () => {
    const reply = await engineWith(async () => ({ message: "hi", tokens: 1500 })).turn("hello");
    expect(reply.tokens).toBe(1500);
    expect("inputTokens" in reply).toBe(false);
    expect("outputTokens" in reply).toBe(false);
  });
});

const base: AgentResult = {
  output: "done",
  success: true,
  taskId: "t",
  agentId: "a",
  metadata: { duration: 1, cost: 0, tokensUsed: 1500, stepsCount: 1 },
};

describe("assembleToolReply split", () => {
  it("copies metadata.inputTokens / outputTokens when the run reported them", () => {
    const reply: ChatReply = assembleToolReply(
      { ...base, metadata: { ...base.metadata, inputTokens: 1000, outputTokens: 500 } },
      {},
      {},
    );
    expect(reply.inputTokens).toBe(1000);
    expect(reply.outputTokens).toBe(500);
  });

  it("omits both when the run reported no split", () => {
    const reply = assembleToolReply(base, {}, {});
    expect("inputTokens" in reply).toBe(false);
    expect("outputTokens" in reply).toBe(false);
  });
});
