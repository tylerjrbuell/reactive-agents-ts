import { describe, it, expect } from "bun:test";
import { ChatEngine } from "../../src/chat/engine.js";
import type { ChatEngineCapabilities } from "../../src/chat/engine.js";
import type { ChatMessage } from "../../src/chat.js";

function makeDeps(): {
  calls: { systemPrompt: string; messages: string[] }[];
  deps: ChatEngineCapabilities;
} {
  const calls: { systemPrompt: string; messages: string[] }[] = [];
  return {
    calls,
    deps: {
      complete: async ({ messages, systemPrompt }) => {
        calls.push({ systemPrompt, messages: messages.map((m) => m.content) });
        return { message: `echo:${messages[messages.length - 1]!.content}` };
      },
    },
  };
}

it("direct turn: routes to complete, applies persona + budget semantics", async () => {
  const { calls, deps } = makeDeps();
  const engine = new ChatEngine(deps, { sessionId: "sess_agent_test", maxDirectTokens: 256 });
  const reply = await engine.turn("hi there", {
    extraContext: "extra block",
  });
  expect(calls[0]!.systemPrompt).toContain("extra block");
  expect(reply.message).toBe("echo:hi there");
});

it("records both turns and exposes history() / end()", async () => {
  const { deps } = makeDeps();
  const engine = new ChatEngine(deps, { sessionId: "sess_agent_test" });
  await engine.turn("one");
  await engine.turn("two");
  const h = engine.history();
  expect(h.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  expect(h[1]!.content).toBe("echo:one");
  await engine.end();
  expect(engine.history()).toEqual([]);
});
