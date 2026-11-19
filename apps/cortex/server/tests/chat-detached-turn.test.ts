// Run: bun run repo test apps/cortex/server/tests/chat-detached-turn.test.ts
/**
 * A streamed chat turn is detached from the SSE connection that started it: closing
 * or reloading the page does not abort it, a new connection re-attaches to its live
 * event buffer (cursor resume included), and Stop stays explicit.
 */
import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import type { AgentStreamEvent } from "@reactive-agents/runtime";
import { chatRouter } from "../api/chat.js";
import type { ChatSessionService } from "../services/chat-session-service.js";
import { DetachedTurns, MAX_BUFFERED_EVENTS, sseFrame } from "../services/chat-detached-turn.js";

const delta = (text: string): AgentStreamEvent => ({ _tag: "TextDelta", text });
const completed = (output: string): AgentStreamEvent => ({
  _tag: "StreamCompleted",
  output,
  metadata: { tokensUsed: 0, cost: 0, stepsCount: 0, duration: 0 },
});

/** A source the test releases event by event. */
function gatedSource() {
  const queue: AgentStreamEvent[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  return {
    emit: (e: AgentStreamEvent) => {
      queue.push(e);
      wake?.();
    },
    close: () => {
      closed = true;
      wake?.();
    },
    async *[Symbol.asyncIterator](): AsyncGenerator<AgentStreamEvent> {
      for (;;) {
        while (queue.length > 0) yield queue.shift()!;
        if (closed) return;
        await new Promise<void>((r) => (wake = r));
      }
    },
  };
}

const collect = async (turn: ReturnType<DetachedTurns["start"]>, from = 0): Promise<{ id: number; tag: string }[]> => {
  const out: { id: number; tag: string }[] = [];
  for await (const n of turn.attach(from)) out.push({ id: n.id, tag: n.event._tag });
  return out;
};

describe("DetachedTurns", () => {
  it("runs the source to its end with nobody attached; a late reader replays everything", async () => {
    const turns = new DetachedTurns();
    const src = gatedSource();
    const turn = turns.start("s", "hi", src);
    src.emit(delta("a"));
    src.emit(delta("b"));
    src.emit(completed("ab"));
    src.close();
    await new Promise((r) => setTimeout(r, 10));
    expect(turn.active).toBe(false);
    expect(await collect(turn)).toEqual([
      { id: 0, tag: "TextDelta" },
      { id: 1, tag: "TextDelta" },
      { id: 2, tag: "StreamCompleted" },
    ]);
    // A finished turn stays attachable for the retention window but is no longer "running".
    expect(turns.get("s")).toBe(turn);
    expect(turns.running("s")).toBeUndefined();
  });

  it("a reader that leaves does not stop the turn; a new reader follows it live from a cursor", async () => {
    const turns = new DetachedTurns();
    const src = gatedSource();
    const turn = turns.start("s", "hi", src);
    src.emit(delta("a"));
    const first = new AbortController();
    const seen: number[] = [];
    const reader = (async () => {
      for await (const n of turn.attach(0, first.signal)) seen.push(n.id);
    })();
    await new Promise((r) => setTimeout(r, 5));
    first.abort();
    await reader;
    expect(seen).toEqual([0]);
    expect(turn.active).toBe(true);

    // The turn goes on without any reader (the page is gone), then a reloaded page attaches after id 0.
    src.emit(delta("b"));
    const late = collect(turn, 1);
    src.emit(completed("ab"));
    src.close();
    expect((await late).map((n) => n.tag)).toEqual(["TextDelta", "StreamCompleted"]);
  });

  it("a source that throws ends the turn with a StreamError", async () => {
    const turns = new DetachedTurns();
    const turn = turns.start("s", "hi", {
      // eslint-disable-next-line require-yield
      async *[Symbol.asyncIterator](): AsyncGenerator<AgentStreamEvent> {
        throw new Error("boom");
      },
    });
    expect((await collect(turn)).map((n) => n.tag)).toEqual(["StreamError"]);
    expect(turn.active).toBe(false);
  });

  it("keeps a bounded buffer: a reader behind it resumes at the oldest kept event", async () => {
    const turns = new DetachedTurns();
    const src = gatedSource();
    const turn = turns.start("s", "hi", src);
    for (let i = 0; i < MAX_BUFFERED_EVENTS + 5; i++) src.emit(delta("x"));
    src.emit(completed("x"));
    src.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(turn.oldestId).toBe(6);
    const got = await collect(turn, 0);
    expect(got[0]?.id).toBe(6);
    expect(got.at(-1)?.tag).toBe("StreamCompleted");
  });

  it("frames carry the event position as the SSE id (the client's resume cursor)", () => {
    expect(sseFrame({ id: 7, event: delta("x") })).toBe('id: 7\ndata: {"_tag":"TextDelta","text":"x"}\n\n');
  });
});

describe("chat stream route: the turn outlives the connection", () => {
  const readFrames = async (res: Response): Promise<{ id?: number; event: AgentStreamEvent }[]> => {
    const text = await res.text();
    return text
      .split("\n\n")
      .filter((f) => f.includes("data: "))
      .map((f) => {
        const id = /^id: (\d+)$/m.exec(f)?.[1];
        const data = /^data: (.*)$/m.exec(f)![1]!;
        return { ...(id !== undefined ? { id: Number(id) } : {}), event: JSON.parse(data) as AgentStreamEvent };
      });
  };

  it("dropping the POST connection mid-wait leaves the turn running; GET active reports it and attach finishes it", async () => {
    const src = gatedSource();
    let signalSeen: AbortSignal | undefined = undefined;
    const svc = {
      sessionConfig: () => null,
      approvals: { hasPending: () => false },
      chatStream: (_id: string, _m: string, signal?: AbortSignal) => {
        signalSeen = signal;
        return src[Symbol.asyncIterator]();
      },
    } as unknown as ChatSessionService;
    const app = new Elysia().use(chatRouter(svc));
    const url = "http://localhost/api/chat/sessions/s1";

    const res = await app.handle(
      new Request(`${url}/chat/stream`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "ask me" }) }),
    );
    expect(res.status).toBe(200);
    src.emit({ _tag: "ApprovalRequested", runId: "r", gateId: "g", toolName: "t", args: {}, subAgent: "alpha" } as AgentStreamEvent);
    // Read the first frame, then drop the connection (page reload).
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain('"_tag":"ApprovalRequested"');
    expect(first.startsWith("id: 0\n")).toBe(true);
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 10));

    // Nothing aborted the run, and the page can ask what is running.
    expect(signalSeen).toBeUndefined();
    const active = (await (await app.handle(new Request(`${url}/chat/active`))).json()) as { active: boolean; message?: string };
    expect(active).toMatchObject({ active: true, message: "ask me" });
    // A second send while it runs is refused, not queued behind it.
    const dup = await app.handle(
      new Request(`${url}/chat/stream`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "again" }) }),
    );
    expect(dup.status).toBe(409);

    // The wait is answered; the reloaded page attaches (cursor 0 = it already saw the request) and gets the rest.
    src.emit(delta("done"));
    src.emit(completed("done"));
    src.close();
    const attached = await app.handle(new Request(`${url}/chat/stream/active?cursor=0`));
    const frames = await readFrames(attached);
    expect(frames.map((f) => [f.id, f.event._tag])).toEqual([[1, "TextDelta"], [2, "StreamCompleted"]]);

    // Attaching without a cursor replays from the start, approval request included.
    const replay = await readFrames(await app.handle(new Request(`${url}/chat/stream/active`)));
    expect(replay.map((f) => f.event._tag)).toEqual(["ApprovalRequested", "TextDelta", "StreamCompleted"]);
    expect(((await (await app.handle(new Request(`${url}/chat/active`))).json()) as { active: boolean }).active).toBe(false);
  });

  it("there is nothing to attach to for a session that never streamed", async () => {
    const svc = { sessionConfig: () => null, approvals: { hasPending: () => false } } as unknown as ChatSessionService;
    const app = new Elysia().use(chatRouter(svc));
    expect((await app.handle(new Request("http://localhost/api/chat/sessions/none/chat/stream/active"))).status).toBe(404);
    expect(await (await app.handle(new Request("http://localhost/api/chat/sessions/none/chat/active"))).json()).toEqual({ active: false });
  });
});
