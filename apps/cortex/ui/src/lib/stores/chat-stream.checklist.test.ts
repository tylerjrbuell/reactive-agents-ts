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

  // Live 2026-11-10: an Anthropic 400 (credit balance). Framework shape since 2026-11-10: a failed
  // run completes with `output: ""` and the cause on `error`.
  it("keeps the run's cause on a failed turn, live (StreamCompleted.error) and after reload (outcome.error)", async () => {
    const cause = "anthropic request failed: 400 Your credit balance is too low to access the Anthropic API.";
    const live = await run([
      `data: ${JSON.stringify({ _tag: "TextDelta", text: "Let me check." })}\n\n`,
      `data: ${JSON.stringify({ _tag: "StreamCompleted", output: "", metadata: {}, success: false, terminatedBy: "llm_error", error: cause })}\n\n`,
    ]);
    expect(live.runFailed).toEqual({ ending: "failed", terminatedBy: "llm_error", error: cause });
    // The streamed narration is not promoted to the answer of a failed run.
    expect(live.content).toBe("");
    const base: ChatTurn = { id: 1, role: "assistant", content: "x", tokensUsed: 0, ts: 0 };
    const hydrated = hydrateTurn({
      ...base,
      trace: { outcome: { success: false, ending: "failed", terminatedBy: "llm_error", error: cause } },
    });
    expect(hydrated.runFailed).toEqual({ ending: "failed", terminatedBy: "llm_error", error: cause });
  });

  it("an abstained turn keeps its reason live and after reload", async () => {
    const abstention = { reason: "no grounded answer", missing: ["web-search"] };
    const live = await run([
      `data: ${JSON.stringify({ _tag: "StreamCompleted", output: "", metadata: {}, success: false, terminatedBy: "abstained", error: "The agent abstained: no grounded answer.", abstention })}\n\n`,
    ]);
    expect(live.runFailed).toMatchObject({ ending: "abstained", abstention });
    const base: ChatTurn = { id: 1, role: "assistant", content: "", tokensUsed: 0, ts: 0 };
    const hydrated = hydrateTurn({ ...base, trace: { outcome: { success: false, ending: "abstained", abstention } } });
    expect(hydrated.runFailed).toEqual({ ending: "abstained", abstention });
  });
});
