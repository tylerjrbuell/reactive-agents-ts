import { describe, it, expect } from "bun:test";
import { ChatEngine } from "../../src/chat/engine.js";
import { ChatEngineCapabilityError } from "../../src/chat/engine-errors.js";
import type { ChatMessage } from "../../src/chat.js";
import type { AgentResult } from "../../src/builder/types.js";

/**
 * AgentResult-shaped stub, typed via the runtime package's own `AgentResult`
 * import (no `any` / `as any`): carries exactly the fields the reply assembly
 * reads (`metadata.toolCalls`, `metadata.stepsCount`, `metadata.tokensUsed`,
 * `metadata.cost`, `metadata.reasoningSteps`, `metadata.scratchpad`).
 */
function toolResult(output: string): AgentResult {
  return {
    output,
    success: true,
    taskId: "t1",
    agentId: "agent_test",
    metadata: {
      duration: 0,
      cost: 0,
      tokensUsed: 42,
      stepsCount: 2,
      toolCalls: [{ name: "file-read", arguments: {} }],
      reasoningSteps: [{ type: "thought", content: "think" }],
      scratchpad: { k: "v" },
    },
  };
}

describe("ChatEngine tool path (engine plan Task 2)", () => {
  it("tool turn: runTask receives history; reply assembled from AgentResult; published per turn", async () => {
    const seen: { input: string; history: readonly ChatMessage[] }[] = [];
    const publishCalls: unknown[] = [];
    const engine = new ChatEngine(
      {
        complete: async () => ({ message: "unused" }),
        runTask: async (input, opts) => {
          seen.push({ input, history: opts.history });
          return toolResult("did it");
        },
        publishTurn: async (t) => {
          publishCalls.push(t);
        },
      },
      { sessionId: "sess_session_abc" },
    );
    await engine.turn("first", { useTools: true });
    const reply = await engine.turn("second", { useTools: true });

    // runTask receives the RAW prior turn list (windowing/rendering stays owned
    // by run()'s withHistoryBlock); no separator-prefixed context here since no
    // contextSummary capability is wired.
    expect(seen[0]!.input).toBe("first");
    expect(seen[0]!.history).toHaveLength(0);
    expect(seen[1]!.input).toBe("second");
    expect(seen[1]!.history.map((m) => m.content)).toEqual(["first", "did it"]);

    // Reply assembly mirrors agent.chat()'s tool-path mapping exactly.
    expect(reply.message).toBe("did it");
    expect(reply.toolsUsed).toEqual(["file-read"]);
    expect(reply.steps).toBe(2);
    expect(reply.tokens).toBe(42);
    expect(reply.cost).toBe(0);
    expect(reply.reasoningSteps).toEqual([{ type: "thought", content: "think" }]);
    expect(reply.scratchpad).toEqual({ k: "v" });
    expect(reply.citationCheck).toBeUndefined();

    // publishTurn: user+assistant ChatTurn pair per turn (4 calls after 2 turns).
    expect(publishCalls).toHaveLength(4);
  });

  it("useTools:true with no runTask capability is a typed rejection, not a direct fallback", async () => {
    const engine = new ChatEngine(
      { complete: async () => ({ message: "unused" }) },
      { sessionId: "sess_session_abc" },
    );
    const caught = await engine.turn("do work", { useTools: true }).then(
      (reply) => reply,
      (err: unknown) => err,
    );
    // Typed rejection — correctness:  never a silent fallback to the direct
    // path (which would route an agentic request out of the reasoning loop).
    expect(caught).toBeInstanceOf(ChatEngineCapabilityError);
    expect(caught instanceof Error).toBe(true);
    if (!(caught instanceof Error)) {
      throw new Error("expected the caught value to be an Error instance");
    }
    expect(caught.message).toMatch(/runTask/);
  });
});
