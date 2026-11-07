import { afterEach, describe, expect, it } from "bun:test";
import { streamAssistantTurn } from "./chat-stream.js";
import { hydrateTurn, type ChatTurn } from "./chat-store.js";
import { charsToTokens } from "@reactive-agents/ui-core";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const top = (e: object) => `data: ${JSON.stringify(e)}\n\n`;

async function run(lines: string[]): Promise<ChatTurn> {
  const enc = new TextEncoder();
  globalThis.fetch = Object.assign(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            for (const l of lines) c.enqueue(enc.encode(l));
            c.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
    { preconnect: (): void => {} },
  );
  let turns: ChatTurn[] = [{ id: 1, role: "assistant", content: "", tokensUsed: 0, ts: 0, streaming: true }];
  await streamAssistantTurn({
    endpoint: "http://x/stream",
    body: {},
    signal: new AbortController().signal,
    assistantTurnId: 1,
    apply: (f) => {
      turns = f(turns);
    },
  });
  return turns[0]!;
}

describe("chat-stream token usage", () => {
  it("two TokenUsage events fold to two calls and set liveTokens to the total", async () => {
    const t = await run([
      top({ _tag: "TokenUsage", callId: "a", tokensTotal: 1500, tokensIn: 1000, tokensOut: 500, estimated: false, model: "m", provider: "p", durationMs: 1, costUsd: 0.01 }),
      top({ _tag: "TokenUsage", callId: "b", tokensTotal: 1000, tokensIn: 800, tokensOut: 200, estimated: false, model: "m", provider: "p", durationMs: 1, costUsd: 0.02 }),
    ]);
    expect(t.usage?.calls).toHaveLength(2);
    expect(t.liveTokens).toBe(2500);
  });

  it("a TokenUsage with only a total marks the call estimated but keeps liveTokens", async () => {
    const t = await run([
      top({ _tag: "TokenUsage", callId: "a", tokensTotal: 400, estimated: true, model: "m", provider: "p", durationMs: 1, costUsd: 0 }),
    ]);
    expect(t.usage?.calls[0]?.estimated).toBe(true);
    expect(t.liveTokens).toBe(400);
  });

  it("a TextDelta with no prior call estimates liveTokens at charsToTokens", async () => {
    const t = await run([top({ _tag: "TextDelta", text: "abcdefgh" })]);
    expect(t.liveTokens).toBe(charsToTokens(8));
  });

  it("ContextPressure gives a measured context", async () => {
    const t = await run([
      top({ _tag: "ContextPressure", tokensUsed: 1000, tokensAvailable: 3000, utilizationPct: 25, level: "low" }),
    ]);
    expect(t.context?.estimated).toBeUndefined();
    expect(t.context?.tokensUsed).toBe(1000);
    expect(t.context?.windowTokens).toBe(4000);
  });

  it("TokenUsage after a measured context counts output and marks it estimated", async () => {
    const t = await run([
      top({ _tag: "ContextPressure", tokensUsed: 1000, tokensAvailable: 3000, utilizationPct: 25, level: "low" }),
      top({ _tag: "TokenUsage", callId: "a", tokensTotal: 1500, tokensIn: 1200, tokensOut: 300, estimated: false, model: "m", provider: "p", durationMs: 1, costUsd: 0 }),
    ]);
    expect(t.context?.tokensUsed).toBeGreaterThan(1200);
    expect(t.context?.estimated).toBe(true);
    expect(t.context?.windowTokens).toBe(4000);
  });

  it("TextDelta after a measured context grows the context by charsToTokens", async () => {
    const t = await run([
      top({ _tag: "ContextPressure", tokensUsed: 1000, tokensAvailable: 3000, utilizationPct: 25, level: "low" }),
      top({ _tag: "TextDelta", text: "abcdefgh" }),
    ]);
    expect(t.context?.tokensUsed).toBe(1000 + charsToTokens(8));
    expect(t.context?.estimated).toBe(true);
    expect(t.context?.windowTokens).toBe(4000);
  });

  it("StreamCompleted.metadata split lands on the turn and clears liveTokens", async () => {
    const t = await run([
      top({ _tag: "StreamCompleted", output: "hi", metadata: { tokensUsed: 1500, inputTokens: 1000, outputTokens: 500, cost: 0, stepsCount: 1, duration: 1 } }),
    ]);
    expect(t.tokensUsed).toBe(1500);
    expect(t.tokensIn).toBe(1000);
    expect(t.tokensOut).toBe(500);
    expect(t.liveTokens).toBeUndefined();
  });

  it("no ContextPressure ever leaves context undefined", async () => {
    const t = await run([top({ _tag: "TextDelta", text: "hi" })]);
    expect(t.context).toBeUndefined();
  });
});