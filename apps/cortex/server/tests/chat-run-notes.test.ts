/**
 * What a run reports about how it ended (to-do reconciliation, unread-results synthesis, terminal
 * authority) is stored with the chat turn and read back after a reload: the recorder takes it from
 * the turn's `StreamCompleted`, the turns table keeps it, an older row simply has none.
 */
import { describe, expect, test } from "bun:test";
import { TurnTraceRecorder } from "../services/chat-turn-trace.js";
import { appendChatTurn, createChatSession, getChatTurns } from "../db/chat-queries.js";
import { openDatabase } from "../db/schema.js";

const COMPLETED = {
  _tag: "StreamCompleted" as const,
  output: "Here is the report.",
  success: true,
  metadata: {
    duration: 1,
    cost: 0,
    tokensUsed: 0,
    stepsCount: 1,
    extensions: {
      terminalOutcome: { authority: "strategy-accepted" },
      checklist: {
        total: 3,
        done: 2,
        closedByHarness: [{ id: "1", title: "Search", provenance: "harness:evidence", toolCallId: "c1" }],
        unresolved: [{ id: "3", title: "Email it", status: "pending", reason: "no evidence" }],
      },
    },
  },
  receipt: {
    interventions: [{ actor: "unread-results-synthesis", authorityClass: "deterministic", evidence: "unread: web-search", whatChanged: "unread-results-synthesis: answer synthesized over x", iter: 4 }],
  },
};

describe("chat turn run notes", () => {
  test("the recorder keeps the notes of the turn's StreamCompleted, even for a turn with no tool calls", () => {
    const r = new TurnTraceRecorder();
    r.record({ _tag: "TextDelta", text: "Here is the report." });
    r.record(COMPLETED as never);
    const trace = r.finish();
    expect(trace?.runNotes?.authority).toBe("strategy-accepted");
    expect(trace?.runNotes?.checklist?.label).toBe("2/3");
    expect(trace?.runNotes?.unread?.outcome).toBe("synthesized");
  });

  test("a run that reported none stores none", () => {
    const r = new TurnTraceRecorder();
    r.record({ _tag: "TextDelta", text: "hi" });
    r.record({ _tag: "StreamCompleted", output: "hi", metadata: { duration: 1, cost: 0, tokensUsed: 0, stepsCount: 1 } } as never);
    expect(r.finish()?.runNotes).toBeUndefined();
  });

  test("the notes survive the turns table and an older row reads as having none", () => {
    const db = openDatabase(":memory:");
    const sessionId = createChatSession(db, { agentConfig: {} });
    const r = new TurnTraceRecorder();
    r.record(COMPLETED as never);
    appendChatTurn(db, { sessionId, role: "assistant", content: "ok", tokensUsed: 1, trace: r.finish()! });
    appendChatTurn(db, { sessionId, role: "assistant", content: "old", tokensUsed: 1, trace: { reasoningSteps: [], toolCalls: [{ id: "c", name: "t", status: "done", iteration: 1 }] } });
    const [withNotes, older] = getChatTurns(db, sessionId);
    expect(withNotes?.trace?.runNotes).toMatchObject({
      authority: "strategy-accepted",
      unread: { outcome: "synthesized", tools: ["web-search"] },
      checklist: {
        total: 3,
        done: 2,
        closed: [{ id: "1", kind: "evidence", toolCallId: "c1" }],
        unresolved: [{ id: "3", status: "pending", reasonLabel: "no evidence recorded" }],
      },
    });
    expect(older?.trace?.runNotes).toBeUndefined();
  });

  test("an unknown authority and provenance in a stored row degrade, they do not drop the turn", () => {
    const db = openDatabase(":memory:");
    const sessionId = createChatSession(db, { agentConfig: {} });
    appendChatTurn(db, {
      sessionId,
      role: "assistant",
      content: "ok",
      tokensUsed: 1,
      trace: {
        reasoningSteps: [],
        toolCalls: [],
        runNotes: { authority: "from-the-future", checklist: { total: 1, done: 1, label: "1/1", closed: [{ id: "1", title: "A", kind: "other", provenance: "harness:new", label: "closed by the harness" }], unresolved: [] } },
      },
    });
    const notes = getChatTurns(db, sessionId)[0]?.trace?.runNotes;
    expect(notes?.authority).toBe("from-the-future");
    expect(notes?.checklist?.closed[0]?.kind).toBe("other");
  });
});
