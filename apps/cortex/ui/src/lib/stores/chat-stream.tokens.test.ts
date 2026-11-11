import { afterEach, describe, expect, it } from "bun:test";
import { metaNumber, streamAssistantTurn } from "./chat-stream.js";
import { hydrateTurn, type ChatTurn } from "./chat-store.js";
import { charsToTokens } from "@reactive-agents/ui-core";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const top = (e: object) => `data: ${JSON.stringify(e)}\n\n`;

/** Every state the assistant turn went through, with a fake clock that advances 1s per read. */
async function runHistory(lines: string[]): Promise<ChatTurn[]> {
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
  let clock = 0;
  let turns: ChatTurn[] = [{ id: 1, role: "assistant", content: "", tokensUsed: 0, ts: 0, streaming: true }];
  const history: ChatTurn[] = [];
  await streamAssistantTurn({
    endpoint: "http://x/stream",
    body: {},
    signal: new AbortController().signal,
    assistantTurnId: 1,
    now: () => (clock += 1000),
    apply: (f) => {
      turns = f(turns);
      history.push(turns[0]!);
    },
  });
  return history;
}

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

describe("chat-stream output speed", () => {
  it("shows a live estimate while text streams, then clears it when the call reports its measured speed", async () => {
    const history = await runHistory([
      top({ _tag: "TextDelta", text: "abcdefgh" }), // t=1s: first delta, no window yet
      top({ _tag: "TextDelta", text: "abcdefgh" }), // t=2s: 16 chars = 4 tokens over 1s
      top({ _tag: "TokenUsage", callId: "a", tokensTotal: 120, tokensIn: 100, tokensOut: 20, estimated: false, model: "m", provider: "p", durationMs: 1500, firstTokenMs: 500, costUsd: 0 }),
    ]);
    const live = history.map((t) => t.liveRate).filter((r) => r !== undefined);
    expect(live).toEqual([4]);
    const last = history.at(-1)!;
    expect(last.liveRate).toBeUndefined();
    expect(last.usage?.calls[0]?.firstTokenMs).toBe(500);
  });
});

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

  it("many tiny deltas do not compound charsToTokens rounding", async () => {
    const t = await run([
      top({ _tag: "ContextPressure", tokensUsed: 1000, tokensAvailable: 3000, utilizationPct: 25, level: "low" }),
      top({ _tag: "TextDelta", text: "a" }),
      top({ _tag: "TextDelta", text: "b" }),
      top({ _tag: "TextDelta", text: "c" }),
    ]);
    expect(t.context?.tokensUsed).toBe(1000 + charsToTokens(3));
    expect(t.liveUsage?.tokensOut).toBe(charsToTokens(3));
  });

  it("publishes an input estimate from ContextPressure before any call reports", async () => {
    const t = await run([
      top({ _tag: "ContextPressure", tokensUsed: 1000, tokensAvailable: 3000, utilizationPct: 25, level: "low" }),
      top({ _tag: "TextDelta", text: "abcdefgh" }),
    ]);
    expect(t.liveUsage).toMatchObject({ tokensIn: 1000, tokensOut: charsToTokens(8), estimatedIn: true, estimatedOut: true });
    expect(t.liveTokens).toBe(1000 + charsToTokens(8));
  });

  it("reported halves stay measured while the next call streams", async () => {
    const t = await run([
      top({ _tag: "TokenUsage", callId: "a", tokensTotal: 1500, tokensIn: 1000, tokensOut: 500, estimated: false, model: "m", provider: "p", durationMs: 1, costUsd: 0 }),
      top({ _tag: "TextDelta", text: "abcdefgh" }),
    ]);
    expect(t.liveUsage).toMatchObject({
      tokensIn: 1000,
      tokensOut: 500 + charsToTokens(8),
      estimatedIn: false,
      estimatedOut: true,
    });
    expect(t.liveTokens).toBe(1500 + charsToTokens(8));
  });

  it("StreamCompleted falls back to the folded usage when metadata has no split", async () => {
    const t = await run([
      top({ _tag: "TokenUsage", callId: "a", tokensTotal: 1500, tokensIn: 1000, tokensOut: 500, estimated: false, model: "m", provider: "p", durationMs: 1, costUsd: 0 }),
      top({ _tag: "StreamCompleted", output: "hi", metadata: { tokensUsed: 1500, cost: 0, stepsCount: 1, duration: 1 } }),
    ]);
    expect(t.tokensIn).toBe(1000);
    expect(t.tokensOut).toBe(500);
    expect(t.liveUsage).toBeUndefined();
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

  it("live context levels use the runtime's 45/75/90 thresholds", async () => {
    const medium = await run([
      top({ _tag: "ContextPressure", tokensUsed: 4500, tokensAvailable: 5500, utilizationPct: 45, level: "medium" }),
      top({ _tag: "TextDelta", text: "abc" }),
    ]);
    expect(medium.context?.level).toBe("medium");
  });

  it("billed and reasoning tokens land on the folded call", async () => {
    const t = await run([
      top({ _tag: "TokenUsage", callId: "a", tokensTotal: 600, tokensIn: 500, tokensOut: 100, billedTokens: 340, reasoningTokens: 70, estimated: false, model: "m", provider: "p", durationMs: 1, costUsd: 0.01 }),
    ]);
    expect(t.usage?.calls[0]?.billedTokens).toBe(340);
    expect(t.usage?.calls[0]?.reasoningTokens).toBe(70);
    expect(t.usage?.billedTokens).toBe(340);
    expect(t.usage?.reasoningTokens).toBe(70);
  });

  it("a non-numeric terminal tokensUsed is ignored, not leaked onto the turn", async () => {
    const t = await run([
      top({ _tag: "TokenUsage", callId: "a", tokensTotal: 1500, tokensIn: 1000, tokensOut: 500, estimated: false, model: "m", provider: "p", durationMs: 1, costUsd: 0 }),
      top({ _tag: "StreamCompleted", output: "hi", metadata: { tokensUsed: "1500", stepsCount: 1, duration: 1 } }),
    ]);
    expect(t.tokensUsed).toBe(1500);
  });
});

describe("metaNumber", () => {
  it("reads a finite number", () => {
    expect(metaNumber({ tokensUsed: 42, cost: 0 }, "tokensUsed")).toBe(42);
    expect(metaNumber({ cost: 0 }, "cost")).toBe(0);
  });

  it("is undefined for a missing key, null, a string, NaN or Infinity", () => {
    expect(metaNumber({}, "tokensUsed")).toBeUndefined();
    expect(metaNumber({ tokensUsed: null }, "tokensUsed")).toBeUndefined();
    expect(metaNumber({ tokensUsed: "42" }, "tokensUsed")).toBeUndefined();
    expect(metaNumber({ tokensUsed: Number.NaN }, "tokensUsed")).toBeUndefined();
    expect(metaNumber({ tokensUsed: Number.POSITIVE_INFINITY }, "tokensUsed")).toBeUndefined();
  });

  it("is undefined when there is no metadata object", () => {
    expect(metaNumber(undefined, "tokensUsed")).toBeUndefined();
  });
});