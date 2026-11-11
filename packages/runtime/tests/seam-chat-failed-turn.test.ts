// Run: bun test packages/runtime/tests/seam-chat-failed-turn.test.ts --timeout 15000
//
// A failed run is recorded as a FAILED turn, never as an assistant reply
// (chat/history-hygiene.ts `assistantTurnOf`, read by chat/engine.ts).
//
// Defect (2026-11-10, Cortex duplicated chat steps): `streamTurn` recorded every
// `StreamCompleted` as an assistant reply, including `success: false`. The
// failed run's narration ("Let me pull sessions...") then rode the next turn's
// history as if the agent had answered, so the model re-did the same steps.
//
// Contract (documented on ChatMessage.failed / ChatEngine.streamTurn):
//   - the user turn is kept (a follow-up such as "try again" has a referent);
//   - the assistant row's content is the failure note
//     `[previous run failed: <cause>; no answer was given]`, never the output;
//   - the row carries `failed: true` and `error: <cause>` so apps can render it;
//   - the published ChatTurn carries the same note;
//   - a paused run (awaiting approval/interaction) is not a failure.
//
// Pins:
//   F1 — streamTurn: StreamCompleted success:false → failed row, note content.
//   F2 — the next turn's history carries the note, not the narration.
//   F3 — turn() tool path: AgentResult success:false → failed row; the reply
//        exposes `failed` + `error`.
//   F4 — success rows are unchanged (no `failed` key).
//   F5 — a paused run is recorded as before (not marked failed).
//   F6 — streamTurn: the published assistant ChatTurn carries `failed` + `error`.
//   F7 — turn() tool path: same on the published ChatTurn; a successful run's
//        ChatTurn has no `failed` / `error` key.
//
// Red-on-cut: in chat/engine.ts record `event.output` instead of
// `assistantTurnOf(event)`; F1, F2 fail. Drop the `failed`/`error` spread in
// `#publishTurns`; F6, F7 fail.
import { describe, it, expect } from "bun:test";
import { ChatEngine } from "../src/chat/engine.js";
import type { ChatMessage } from "../src/chat.js";
import type { AgentResult } from "../src/builder/types.js";
import type { RunHandle } from "../src/run-controller.js";
import type { AgentStreamEvent } from "../src/stream-types.js";
import type { ChatTurnEvent } from "@reactive-agents/core";

const NARRATION = "Let me pull sessions and events for the period.";
const CAUSE = "ollama call failed: XML syntax error on line 1: unexpected EOF";
const NOTE = `[previous run failed: ${CAUSE}; no answer was given]`;
const META = { duration: 0, cost: 0, tokensUsed: 5, stepsCount: 1 } as const;

function stubHandle(events: readonly AgentStreamEvent[]): RunHandle {
  async function* gen(): AsyncGenerator<AgentStreamEvent> {
    for (const e of events) yield e;
  }
  return Object.assign(gen(), {
    pause: () => {},
    resume: () => {},
    stop: (_o?: { reason?: string }) => {},
    terminate: (_o?: { reason?: string }) => {},
    status: () => "running" as const,
    inspect: () => undefined,
  });
}

function streamEngine(terminals: readonly AgentStreamEvent[]) {
  const published: ChatTurnEvent[] = [];
  const historiesSent: (readonly ChatMessage[])[] = [];
  let call = 0;
  const engine = new ChatEngine(
    {
      complete: async () => ({ message: "unused" }),
      runStreamTask: (_input, opts) => {
        historiesSent.push(opts.history);
        return stubHandle([terminals[call++]!]);
      },
      publishTurn: async (t) => {
        published.push(t);
      },
    },
    { sessionId: "sess_session_failed" },
  );
  return { engine, published, historiesSent };
}

async function drain(handle: RunHandle): Promise<void> {
  for await (const _e of handle) void _e;
}

const failedCompleted: AgentStreamEvent = {
  _tag: "StreamCompleted",
  output: NARRATION,
  metadata: META,
  taskId: "t1",
  success: false,
  terminatedBy: "llm_error",
  error: CAUSE,
};

describe("ChatEngine records a failed run as a failed turn", () => {
  it("F1 streamTurn: failed StreamCompleted → failed row with the note", async () => {
    const t = streamEngine([failedCompleted]);
    await drain(t.engine.streamTurn("analyze traffic"));
    const h = t.engine.history();
    expect(h).toHaveLength(2);
    expect(h[0]).toMatchObject({ role: "user", content: "analyze traffic" });
    expect(h[1]).toMatchObject({ role: "assistant", content: NOTE, failed: true, error: CAUSE });
    expect(h[1]!.content).not.toContain(NARRATION);
    expect(t.published.map((p) => p.content)).toEqual(["analyze traffic", NOTE]);
  });

  it("F2 the next turn's history carries the note, not the narration", async () => {
    const ok: AgentStreamEvent = { _tag: "StreamCompleted", output: "done", metadata: META, taskId: "t2", success: true };
    const t = streamEngine([failedCompleted, ok]);
    await drain(t.engine.streamTurn("analyze traffic"));
    await drain(t.engine.streamTurn("try again"));
    const sent = t.historiesSent[1]!;
    expect(sent.map((m) => m.content)).toEqual(["analyze traffic", NOTE]);
    const last = t.engine.history()[3]!;
    expect(last).toEqual({ role: "assistant", content: "done", timestamp: last.timestamp });
  });

  it("F3 turn() tool path: failed AgentResult → failed row; reply exposes failed + error", async () => {
    const failedResult: AgentResult = {
      output: NARRATION,
      success: false,
      taskId: "t1",
      agentId: "a",
      metadata: META,
      terminatedBy: "llm_error",
      error: CAUSE,
    };
    const engine = new ChatEngine(
      { complete: async () => ({ message: "unused" }), runTask: async () => failedResult },
      { sessionId: "sess_session_failed" },
    );
    const reply = await engine.turn("analyze traffic", { useTools: true });
    expect(reply.failed).toBe(true);
    expect(reply.error).toBe(CAUSE);
    expect(engine.history()[1]).toMatchObject({ role: "assistant", content: NOTE, failed: true, error: CAUSE });
  });

  it("F4 a failed run with no error names an unknown cause, still not the output", async () => {
    const t = streamEngine([{ _tag: "StreamCompleted", output: NARRATION, metadata: META, success: false }]);
    await drain(t.engine.streamTurn("q"));
    const row = t.engine.history()[1]!;
    expect(row.failed).toBe(true);
    expect(row.content).toBe("[previous run failed: unknown cause; no answer was given]");
  });

  it("F6 streamTurn: the published assistant ChatTurn carries failed + error", async () => {
    const t = streamEngine([failedCompleted]);
    await drain(t.engine.streamTurn("analyze traffic"));
    const assistant = t.published.find((p) => p.role === "assistant");
    expect(assistant).toMatchObject({ role: "assistant", content: NOTE, failed: true, error: CAUSE });
    expect(t.published.find((p) => p.role === "user")).not.toHaveProperty("failed");
  });

  it("F7 turn() tool path publishes failed + error; a successful run publishes no failed field", async () => {
    const published: ChatTurnEvent[] = [];
    const results: AgentResult[] = [
      { output: NARRATION, success: false, taskId: "t1", agentId: "a", metadata: META, terminatedBy: "llm_error", error: CAUSE },
      { output: "done", success: true, taskId: "t2", agentId: "a", metadata: META },
    ];
    let call = 0;
    const engine = new ChatEngine(
      {
        complete: async () => ({ message: "unused" }),
        runTask: async () => results[call++]!,
        publishTurn: async (p) => {
          published.push(p);
        },
      },
      { sessionId: "sess_session_failed" },
    );
    await engine.turn("analyze traffic", { useTools: true });
    await engine.turn("try again", { useTools: true });
    const assistants = published.filter((p) => p.role === "assistant");
    expect(assistants[0]).toMatchObject({ content: NOTE, failed: true, error: CAUSE });
    expect(assistants[1]!.content).toBe("done");
    expect(assistants[1]).not.toHaveProperty("failed");
    expect(assistants[1]).not.toHaveProperty("error");
  });

  it("F5 a paused run is not recorded as failed", async () => {
    const paused: AgentStreamEvent = {
      _tag: "StreamCompleted",
      output: "waiting for approval",
      metadata: META,
      success: false,
      status: "awaiting-approval",
    };
    const t = streamEngine([paused]);
    await drain(t.engine.streamTurn("q"));
    const row = t.engine.history()[1]!;
    expect(row.content).toBe("waiting for approval");
    expect(row.failed).toBeUndefined();
  });
});
