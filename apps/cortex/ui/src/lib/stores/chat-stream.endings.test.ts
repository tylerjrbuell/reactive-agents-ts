/**
 * Chat turn states from the 2026-11-10 UI audit, on the live stream path:
 * - B2: an interrupted turn (Stop or disconnect) carries its ending and cause, so
 *   it renders the same live and after a reload.
 * - B11: between the request and the model's first token the turn says it waits
 *   on the model, with the time the wait began, instead of "Thinking".
 * - B1: a reloaded turn stored as interrupted by the user reads as stopped.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { streamAssistantTurn } from "./chat-stream.js";
import { hydrateTurn, type ChatTurn } from "./chat-store.js";
import { endingBadge, endingNote, chatTurnOutcome } from "../turn-ending.js";
import { turnEnding } from "./chat-timeline.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const sse = (e: object) => `data: ${JSON.stringify(e)}\n\n`;

async function run(lines: string[], startedAt = 1_000): Promise<{ final: ChatTurn; snapshots: ChatTurn[] }> {
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
  let turns: ChatTurn[] = [{ id: 1, role: "assistant", content: "", tokensUsed: 0, ts: startedAt, streaming: true, awaitingModelSince: startedAt }];
  const snapshots: ChatTurn[] = [];
  await streamAssistantTurn({
    endpoint: "http://x/stream",
    body: {},
    signal: new AbortController().signal,
    assistantTurnId: 1,
    apply: (f) => {
      turns = f(turns);
      snapshots.push(turns[0]!);
    },
  });
  return { final: turns[0]!, snapshots };
}

describe("B2: an interrupted turn carries its ending live", () => {
  it("a disconnect cancellation reads as interrupted with the cause", async () => {
    const { final } = await run([
      sse({ _tag: "TextDelta", text: "partial" }),
      sse({ _tag: "StreamCancelled", reason: "disconnect", iterationsCompleted: 0 }),
    ]);
    expect(final.cancelled).toBeUndefined();
    expect(final.incomplete).toBe(true);
    expect(final.runFailed).toMatchObject({ ending: "interrupted", interruptedBy: "disconnect" });
    expect(final.runFailed?.error).toContain("connection closed");
    const note = endingNote(chatTurnOutcome(final)!);
    expect(note?.kind).toBe("interrupted");
    expect(note?.line).toContain("connection closed");
    expect(endingBadge(final.runFailed!).label).toBe("interrupted");
  });

  it("a user Stop reads as stopped, with its own cause", async () => {
    const { final } = await run([sse({ _tag: "StreamCancelled", reason: "user", iterationsCompleted: 0 })]);
    expect(final.cancelled).toBe(true);
    expect(final.runFailed).toMatchObject({ ending: "interrupted", interruptedBy: "user" });
    expect(turnEnding(final)).toBe("cancelled");
    expect(endingBadge(final.runFailed!).label).toBe("stopped");
  });

  it("a reloaded turn stored as interrupted by the user reads as stopped; by a disconnect, as interrupted", () => {
    const row = (by: "user" | "disconnect") =>
      hydrateTurn({
        id: 2,
        role: "assistant",
        content: "half",
        tokensUsed: 0,
        ts: 5,
        incomplete: true,
        trace: { outcome: { success: false, ending: "interrupted", interruptedBy: by, error: "cause" } },
      });
    expect(row("user").cancelled).toBe(true);
    expect(row("user").runFailed).toMatchObject({ ending: "interrupted", interruptedBy: "user", error: "cause" });
    expect(row("disconnect").cancelled).toBeUndefined();
    expect(turnEnding(row("disconnect"))).toBe("interrupted");
  });
});

describe("B11: the wait on the model before its first token", () => {
  it("keeps the send time as the wait start until the first token, then clears it", async () => {
    const { final, snapshots } = await run([
      sse({ _tag: "PhaseStarted", phase: "think", timestamp: 1 }),
      sse({ _tag: "IterationProgress", iteration: 1, maxIterations: 5, status: "x" }),
      sse({ _tag: "TextDelta", text: "4" }),
      sse({ _tag: "StreamCompleted", output: "4", metadata: {} }),
    ]);
    // Before any token the turn still waits, since the send time.
    expect(snapshots[0]?.awaitingModelSince).toBe(1_000);
    expect(snapshots.some((t) => t.awaitingModelSince === undefined && t.streaming === true)).toBe(true);
    expect(final.awaitingModelSince).toBeUndefined();
  });

  it("waits again once the last tool finishes (the next model call is out)", async () => {
    const { snapshots } = await run([
      sse({ _tag: "ToolCallStarted", toolName: "web-search", callId: "c1" }),
      sse({ _tag: "ToolCallCompleted", toolName: "web-search", callId: "c1", durationMs: 3, success: true }),
    ]);
    const live = snapshots.filter((t) => t.streaming === true);
    const running = live.findIndex((t) => t.toolCalls?.some((c) => c.status === "running"));
    expect(running).toBeGreaterThanOrEqual(0);
    // While the tool runs, nothing waits on the model.
    expect(live[running]?.awaitingModelSince).toBeUndefined();
    // Once it finishes, the next call waits, stamped after the send time.
    const waitingAfter = live
      .slice(running + 1)
      .some((t) => t.toolCalls?.every((c) => c.status !== "running") === true && (t.awaitingModelSince ?? 0) > 1_000);
    expect(waitingAfter).toBe(true);
  });
});
