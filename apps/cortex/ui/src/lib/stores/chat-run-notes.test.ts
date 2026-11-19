// A finished turn carries what the run reported about how it ended (to-do reconciliation, an answer
// written from unread tool results, the terminal authority): live from `StreamCompleted`, and the same
// after a reload from the stored trace. A run that reported none, or an older row, carries none.
import { afterEach, describe, expect, it } from "bun:test";
import { streamAssistantTurn } from "./chat-stream.js";
import { hydrateTurn, type ChatTurn } from "./chat-store.js";
import { runNotesView } from "../run-notes-view.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const completed = (metadata: Record<string, unknown>, extra: Record<string, unknown> = {}): string =>
  `data: ${JSON.stringify({
    _tag: "StreamCompleted",
    output: "Report written.",
    success: true,
    metadata: { duration: 1000, cost: 0, tokensUsed: 10, stepsCount: 3, ...metadata },
    ...extra,
  })}\n\n`;

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
    endpoint: "http://x/stream", body: {}, signal: new AbortController().signal, assistantTurnId: 1,
    apply: (f) => { turns = f(turns); },
  });
  return turns[0]!;
}

const EXTENSIONS = {
  checklist: {
    total: 3,
    done: 2,
    closedByHarness: [{ id: "1", title: "Search", provenance: "harness:evidence", toolCallId: "c1" }],
    unresolved: [{ id: "3", title: "Email it", status: "pending", reason: "no evidence" }],
  },
  terminalOutcome: { authority: "strategy-accepted" },
};

describe("a live turn's run notes", () => {
  it("StreamCompleted projects the to-do outcome, the unread note and the authority onto the turn", async () => {
    const t = await run([
      completed(
        { extensions: EXTENSIONS },
        { receipt: { interventions: [{ actor: "unread-results-synthesis", evidence: "unread: web-search", whatChanged: "unread-results-synthesis: answer synthesized over x" }] } },
      ),
    ]);
    expect(t.runNotes?.authority).toBe("strategy-accepted");
    expect(t.runNotes?.checklist?.unresolved[0]?.title).toBe("Email it");
    expect(t.runNotes?.unread?.outcome).toBe("synthesized");
    expect(t.runFailed).toBeUndefined();
  });

  it("a run that reported none leaves the turn without notes", async () => {
    expect((await run([completed({})])).runNotes).toBeUndefined();
  });

  it("an unknown authority is kept as a neutral value and the turn still ends as an answer", async () => {
    const t = await run([completed({ extensions: { terminalOutcome: { authority: "from-the-future" } } })]);
    expect(t.runNotes).toEqual({ authority: "from-the-future" });
    expect(runNotesView(t.runNotes)).toBeUndefined();
    expect(t.runFailed).toBeUndefined();
  });
});

describe("a reloaded turn's run notes", () => {
  it("shows exactly what the live turn showed", async () => {
    const live = await run([completed({ extensions: EXTENSIONS })]);
    const stored = JSON.parse(JSON.stringify(live.runNotes));
    const reloaded = hydrateTurn({ id: 2, role: "assistant", content: "Report written.", tokensUsed: 0, ts: 5, trace: { reasoningSteps: [], toolCalls: [], runNotes: stored } } as ChatTurn & { trace: never });
    expect(runNotesView(reloaded.runNotes)).toEqual(runNotesView(live.runNotes));
    expect(runNotesView(reloaded.runNotes)?.accepted?.heading).toBe("Accepted by the strategy");
  });

  it("an older row carries no notes", () => {
    const turn = hydrateTurn({ id: 3, role: "assistant", content: "x", tokensUsed: 0, ts: 5, trace: { reasoningSteps: [], toolCalls: [] } } as ChatTurn & { trace: never });
    expect(turn.runNotes).toBeUndefined();
  });
});
