import { afterEach, describe, expect, it } from "bun:test";
import type { ChecklistSnapshotWire } from "@reactive-agents/ui-core";
import { streamAssistantTurn } from "./chat-stream.js";
import { hydrateTurn, type ChatTurn } from "./chat-store.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const snap = (lastSeq: number, status: "pending" | "done"): ChecklistSnapshotWire => ({
  lastSeq,
  root: {
    key: "root", label: "root",
    rows: [{ id: "r1", kind: "requirement", title: "r1", status }],
    requirements: { done: status === "done" ? 1 : 0, total: 1 },
    advisory: { done: 0, total: 0 }, activeAdvisoryIds: [], children: [],
  },
});
const ev = (c: ChecklistSnapshotWire) => `data: ${JSON.stringify({ _tag: "ChecklistUpdated", checklist: c, iteration: 1 })}\n\n`;

async function run(lines: string[], onChecklist?: (c: ChecklistSnapshotWire) => void): Promise<ChatTurn> {
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
    endpoint: "http://x/stream", body: {}, signal: new AbortController().signal, assistantTurnId: 1,
    apply: (f) => { turns = f(turns); },
    ...(onChecklist ? { onChecklist } : {}),
  });
  return turns[0]!;
}

describe("chat-stream checklist", () => {
  it("projects the latest snapshot onto the turn", async () => {
    const t = await run([ev(snap(1, "pending")), ev(snap(2, "done"))]);
    expect(t.checklist?.lastSeq).toBe(2);
    expect(t.checklist?.root.requirements.done).toBe(1);
  });
  it("reports each new snapshot to the host (conversation-level state), not stale ones", async () => {
    const seen: number[] = [];
    await run([ev(snap(1, "pending")), ev(snap(5, "done")), ev(snap(3, "pending"))], (c) => seen.push(c.lastSeq));
    expect(seen).toEqual([1, 5]);
  });
  it("ignores a stale event", async () => {
    const t = await run([ev(snap(5, "done")), ev(snap(3, "pending"))]);
    expect(t.checklist?.lastSeq).toBe(5);
  });
  it("turn without checklist has none", async () => {
    const t = await run([`data: ${JSON.stringify({ _tag: "StreamCompleted", output: "hi", metadata: {} })}\n\n`]);
    expect(t.checklist).toBeUndefined();
  });
  it("hydrates from trace.checklist; old turns unchanged", () => {
    const base: ChatTurn = { id: 1, role: "assistant", content: "x", tokensUsed: 0, ts: 0 };
    expect(hydrateTurn({ ...base, trace: { checklist: snap(2, "done") } }).checklist?.lastSeq).toBe(2);
    expect(hydrateTurn({ ...base, trace: {} })).toEqual(base);
    expect(hydrateTurn(base)).toEqual(base);
  });

  it("hydrateTurn marks a turn whose persisted outcome is a failed run", () => {
    const base: ChatTurn = { id: 1, role: "assistant", content: "x", tokensUsed: 0, ts: 0 };
    const hydrated = hydrateTurn({
      ...base,
      trace: { reasoningSteps: [], toolCalls: [], outcome: { success: false, terminatedBy: "max_iterations" } },
    });
    expect(hydrated.runFailed).toEqual({ terminatedBy: "max_iterations" });
    expect(hydrateTurn({ ...base, trace: { reasoningSteps: [], toolCalls: [] } }).runFailed).toBeUndefined();
  });
});
