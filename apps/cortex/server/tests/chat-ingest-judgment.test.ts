// Run: bun run repo test apps/cortex/server/tests/chat-ingest-judgment.test.ts
//
// Judgment events carry no taskId, so chat ingest files them under the turn's one open chat
// root; without a root (or with two) they stay dropped rather than land on the wrong run.
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import { attachChatIngest, type ChatIngestSink } from "../services/chat-ingest.js";
import type { CortexIngestMessage } from "../types.js";

function harness() {
  const sent: { runId: string; tag: string; agentId: string; sessionId?: string }[] = [];
  const sink: ChatIngestSink = {
    handleEvent: (agentId, runId, msg: CortexIngestMessage) => {
      sent.push({ runId, agentId, tag: (msg.event as { _tag: string })._tag, ...(msg.sessionId ? { sessionId: msg.sessionId } : {}) });
      return Effect.void;
    },
  };
  let handler: (e: AgentEvent) => void = () => {};
  const agent = { subscribe: async (h: (e: AgentEvent) => void) => ((handler = h), () => {}) };
  const emit = (e: Record<string, unknown>) => handler(e as unknown as AgentEvent);
  return { sent, sink, agent, emit };
}

const evaluated = { _tag: "JudgmentEvaluated", site: "agent.judge", backend: "jev", answers: [], latencyMs: 5 };
const failed = { _tag: "JudgmentFailed", site: "agent.judge", backend: "jev", errorTag: "JudgmentTimeout", message: "t", latencyMs: 5 };
const shadow = { _tag: "JudgmentShadow", site: "strategy-selection", judged: "reactive", current: "reactive", agreement: true, confidence: 0.9 };

describe("chat ingest of judgment events", () => {
  it("files Evaluated, Failed and Shadow under the open chat root, with the chat identity", async () => {
    const h = harness();
    await attachChatIngest(h.agent, h.sink, { sessionId: "sess-1", stableAgentId: "chat-agent" });
    h.emit({ _tag: "AgentStarted", taskId: "root-1", agentId: "chat-agent" });
    h.emit(evaluated);
    h.emit(failed);
    h.emit(shadow);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.sent.filter((s) => s.tag.startsWith("Judgment")).map((s) => [s.tag, s.runId, s.agentId])).toEqual([
      ["JudgmentEvaluated", "root-1", "chat-agent"],
      ["JudgmentFailed", "root-1", "chat-agent"],
      ["JudgmentShadow", "root-1", "chat-agent"],
    ]);
  });

  it("drops them before any root started and after it ended", async () => {
    const h = harness();
    await attachChatIngest(h.agent, h.sink, { sessionId: "sess-1", stableAgentId: "chat-agent" });
    h.emit(evaluated);
    h.emit({ _tag: "AgentStarted", taskId: "root-1", agentId: "chat-agent" });
    h.emit({ _tag: "AgentCompleted", taskId: "root-1", agentId: "chat-agent" });
    h.emit(failed);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.sent.filter((s) => s.tag.startsWith("Judgment"))).toEqual([]);
  });

  it("does not guess between two open roots", async () => {
    const h = harness();
    await attachChatIngest(h.agent, h.sink, { sessionId: "sess-1", stableAgentId: "chat-agent" });
    h.emit({ _tag: "AgentStarted", taskId: "root-1", agentId: "chat-agent" });
    h.emit({ _tag: "AgentStarted", taskId: "root-2", agentId: "chat-agent" });
    h.emit(evaluated);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.sent.filter((s) => s.tag.startsWith("Judgment"))).toEqual([]);
  });

  it("other taskId-less events are still dropped", async () => {
    const h = harness();
    await attachChatIngest(h.agent, h.sink, { sessionId: "sess-1", stableAgentId: "chat-agent" });
    h.emit({ _tag: "AgentStarted", taskId: "root-1", agentId: "chat-agent" });
    h.emit({ _tag: "SomethingElse" });
    await new Promise((r) => setTimeout(r, 0));
    expect(h.sent.map((s) => s.tag)).toEqual(["AgentStarted"]);
  });
});
