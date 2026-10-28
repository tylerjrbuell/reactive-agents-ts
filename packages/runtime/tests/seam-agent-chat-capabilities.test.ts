import { describe, it, expect } from "bun:test";
import { Effect, Layer, ManagedRuntime } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { makeChatComplete, makeChatPublishTurn } from "../src/agent/chat-capabilities.js";

const runtime = () =>
  ManagedRuntime.make(
    Layer.merge(TestLLMServiceLayer([{ match: "", text: "hello there" }]), EventBusLive),
  );

describe("chat-capabilities (shared ChatEngine host capabilities)", () => {
  it("complete() routes a plain completion through the LLM gateway", async () => {
    const rt = runtime();
    const out = await makeChatComplete(rt)({
      messages: [{ role: "user", content: "hi" }],
      systemPrompt: "be brief",
    });
    expect(out.message).toBe("hello there");
    await rt.dispose();
  });

  it("publishTurn() puts a ChatTurn on the agent's EventBus", async () => {
    const rt = runtime();
    const seen: string[] = [];
    await rt.runPromise(
      EventBus.pipe(
        Effect.flatMap((bus) =>
          bus.on("ChatTurn", (e) => Effect.sync(() => void seen.push(e.content))),
        ),
      ),
    );
    await makeChatPublishTurn(rt, "test:publish")({
      _tag: "ChatTurn",
      taskId: "t",
      sessionId: "s",
      role: "user",
      content: "ping",
      routedVia: "direct-llm",
    });
    expect(seen).toEqual(["ping"]);
    await rt.dispose();
  });
});
