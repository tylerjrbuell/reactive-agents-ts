/**
 * A chat shows a tool call's arguments as soon as the call starts: the bus
 * `ToolCallStarted` carries them (core 3c76d020d), and the chat stream fills a
 * stream `ToolCallStarted` that has none from the bus (`withStartedArgs`).
 */
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import { attachChatIngest, withStartedArgs, type ChatIngestSink } from "../services/chat-ingest.js";

const sink: ChatIngestSink = { handleEvent: () => Effect.void };

async function fakeAgent() {
  let handler: ((e: AgentEvent) => void) | undefined;
  const agent = {
    subscribe: async (h: (e: AgentEvent) => void) => {
      handler = h;
      return () => {
        handler = undefined;
      };
    },
  };
  const handle = await attachChatIngest(agent, sink, { sessionId: "s1" });
  return { handle, publish: (e: AgentEvent) => handler?.(e) };
}

describe("chat tool-call arguments while running", () => {
  it("fills a stream ToolCallStarted from the bus ToolCallStarted args", async () => {
    const { handle, publish } = await fakeAgent();
    publish({ _tag: "ToolCallStarted", taskId: "t1", toolName: "shell-execute", callId: "c1", args: { command: "sleep 30" } });
    const out = withStartedArgs({ _tag: "ToolCallStarted", toolName: "shell-execute", callId: "c1" }, handle.startedArgsOf);
    expect(out as unknown).toEqual({ _tag: "ToolCallStarted", toolName: "shell-execute", callId: "c1", args: { command: "sleep 30" } });
  });

  it("keeps the stream's own args, passes other events through, and forgets args at the next turn", async () => {
    const { handle, publish } = await fakeAgent();
    publish({ _tag: "ToolCallStarted", taskId: "t1", toolName: "web-search", callId: "c2", args: { q: "bus" } });
    const own = { _tag: "ToolCallStarted", toolName: "web-search", callId: "c2", args: { q: "stream" } } as const;
    expect(withStartedArgs(own, handle.startedArgsOf)).toBe(own);
    const other = { _tag: "TextDelta", text: "hi" } as const;
    expect(withStartedArgs(other, handle.startedArgsOf)).toBe(other);
    handle.beginTurn();
    const bare = { _tag: "ToolCallStarted", toolName: "web-search", callId: "c2" } as const;
    expect(withStartedArgs(bare, handle.startedArgsOf)).toBe(bare);
  });

  it("without an ingest handle the event is unchanged", () => {
    const bare = { _tag: "ToolCallStarted", toolName: "t", callId: "c" } as const;
    expect(withStartedArgs(bare, undefined)).toBe(bare);
  });
});
