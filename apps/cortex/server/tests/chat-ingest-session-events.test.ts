// Run: bun run repo test apps/cortex/server/tests/chat-ingest-session-events.test.ts
//
// ChatModeChanged and a user-edited PlanRecorded carry no taskId (they happen between turns).
// Chat ingest files them under the open chat root, else holds them for the next root, so the run
// feed shows the mode switch and the plan edit that shaped that run.
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import { attachChatIngest, type ChatIngestSink } from "../services/chat-ingest.js";
import type { CortexIngestMessage } from "../types.js";

function harness() {
  const sent: { runId: string; tag: string }[] = [];
  const sink: ChatIngestSink = {
    handleEvent: (_agentId, runId, msg: CortexIngestMessage) => {
      sent.push({ runId, tag: (msg.event as { _tag: string })._tag });
      return Effect.void;
    },
  };
  let handler: (e: AgentEvent) => void = () => {};
  const agent = { subscribe: async (h: (e: AgentEvent) => void) => ((handler = h), () => {}) };
  const emit = (e: Record<string, unknown>) => handler(e as unknown as AgentEvent);
  return { sent, sink, agent, emit };
}
const mode = { _tag: "ChatModeChanged", sessionId: "s", from: "execute", to: "plan", timestamp: 1 };
const edited = { _tag: "PlanRecorded", planId: "p", steps: [], source: "user-edited", timestamp: 2 };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("chat ingest of session-level events", () => {
  it("holds events that arrive between turns and files them under the next chat root, after its AgentStarted", async () => {
    const h = harness();
    await attachChatIngest(h.agent, h.sink, { sessionId: "s", stableAgentId: "chat-agent" });
    h.emit(mode);
    h.emit(edited);
    await flush();
    expect(h.sent).toEqual([]);
    h.emit({ _tag: "AgentStarted", taskId: "root-1", agentId: "chat-agent" });
    await flush();
    expect(h.sent.map((s) => [s.runId, s.tag])).toEqual([["root-1", "AgentStarted"], ["root-1", "ChatModeChanged"], ["root-1", "PlanRecorded"]]);
  });

  it("files an event under the one open root immediately, and a held event is not replayed on a later root", async () => {
    const h = harness();
    await attachChatIngest(h.agent, h.sink, { sessionId: "s", stableAgentId: "chat-agent" });
    h.emit({ _tag: "AgentStarted", taskId: "root-1", agentId: "chat-agent" });
    h.emit(mode);
    await flush();
    expect(h.sent.filter((s) => s.tag === "ChatModeChanged").map((s) => s.runId)).toEqual(["root-1"]);
    h.emit({ _tag: "AgentCompleted", taskId: "root-1", agentId: "chat-agent" });
    h.emit({ _tag: "AgentStarted", taskId: "root-2", agentId: "chat-agent" });
    await flush();
    expect(h.sent.filter((s) => s.tag === "ChatModeChanged")).toHaveLength(1);
  });

  it("a model-recorded PlanRecorded (it has a taskId) is filed under its own run as before", async () => {
    const h = harness();
    await attachChatIngest(h.agent, h.sink, { sessionId: "s", stableAgentId: "chat-agent" });
    h.emit({ _tag: "AgentStarted", taskId: "root-1", agentId: "chat-agent" });
    h.emit({ ...edited, source: "model", taskId: "root-1" });
    await flush();
    expect(h.sent.map((s) => s.tag)).toEqual(["AgentStarted", "PlanRecorded"]);
  });
});
