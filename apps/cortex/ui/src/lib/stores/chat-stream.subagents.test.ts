import { afterEach, describe, expect, it } from "bun:test";
import { streamAssistantTurn } from "./chat-stream.js";
import { hydrateTurn, type ChatTurn } from "./chat-store.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const A = { key: "ka1", runId: "a1", parentRunId: "root", depth: 1, name: "alpha" };
const B = { key: "kb1", runId: "b1", parentRunId: "root", depth: 1, name: "beta" };
const sub = (run: object, event: object) => `data: ${JSON.stringify({ _tag: "SubAgentActivity", run, event })}\n\n`;
const top = (e: object) => `data: ${JSON.stringify(e)}\n\n`;

async function run(lines: string[]): Promise<ChatTurn> {
  const enc = new TextEncoder();
  globalThis.fetch = (async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          for (const l of lines) c.enqueue(enc.encode(l));
          c.close();
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    )) as unknown as typeof fetch;
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

describe("chat-stream sub-agents", () => {
  it("two parallel children fold independently onto the turn, in start order", async () => {
    const t = await run([
      sub(A, { _tag: "PhaseStarted", phase: "sub-agent", timestamp: 1000 }),
      sub(B, { _tag: "PhaseStarted", phase: "sub-agent", timestamp: 1001 }),
      sub(A, { _tag: "ToolCallStarted", toolName: "web-search", callId: "c1" }),
      sub(B, { _tag: "ToolCallStarted", toolName: "file-read", callId: "c2" }),
      sub(A, { _tag: "StreamCompleted", output: "alpha done", metadata: { duration: 500, cost: 0.004, tokensUsed: 10 } }),
      top({ _tag: "StreamCompleted", output: "all done", metadata: {} }),
    ]);
    expect(t.subAgents?.map((s) => s.name)).toEqual(["alpha", "beta"]);
    const [a, b] = t.subAgents!;
    expect(a!.status).toBe("done");
    expect(a!.output).toBe("alpha done");
    expect(a!.turn.toolCalls?.map((c) => c.name)).toEqual(["web-search"]);
    expect(b!.status).toBe("running");
    expect(b!.turn.toolCalls?.map((c) => c.name)).toEqual(["file-read"]);
    expect(t.toolCalls).toEqual([]);
  });

  it("turn without sub-agents has no subAgents field", async () => {
    const t = await run([top({ _tag: "StreamCompleted", output: "hi", metadata: {} })]);
    expect(t.subAgents).toBeUndefined();
  });

  it("hydrateTurn restores persisted children recursively", () => {
    const leaf = { reasoningSteps: [], toolCalls: [] };
    const turn = hydrateTurn({
      id: 2,
      role: "assistant",
      content: "x",
      tokensUsed: 0,
      ts: 0,
      trace: {
        reasoningSteps: [],
        toolCalls: [],
        subAgents: [
          {
            run: A,
            status: "done",
            output: "alpha out",
            startedAt: 1000,
            endedAt: 2000,
            costUsd: 0.004,
            trace: {
              reasoningSteps: [{ iteration: 1, thought: "hm" }],
              toolCalls: [{ id: "c1", name: "web-search", status: "done", iteration: 1 }],
              subAgents: [{ run: { key: "kg1", runId: "g1", parentRunId: "a1", depth: 2, name: "grand" }, status: "failed", trace: leaf, startedAt: 1100 }],
            },
          },
        ],
      },
    } as never);
    const a = turn.subAgents![0]!;
    expect(a.name).toBe("alpha");
    expect(a.status).toBe("done");
    expect(a.turn.toolCalls).toHaveLength(1);
    expect(a.turn.subAgents![0]!.name).toBe("grand");
    expect(a.turn.subAgents![0]!.status).toBe("failed");
  });
});
