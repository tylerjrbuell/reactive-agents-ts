// Run: bun test packages/runtime/tests/seam-chat-direct-temperature.test.ts --timeout 20000
//
// Seam pin (agent/chat-capabilities.ts `makeChatComplete`): the tools-off chat
// path must not stamp its own sampling temperature on the request. It used to
// hardcode `temperature: 0.7`, which overrode the agent's configured
// temperature (`.withModel({ temperature })` -> LLMConfig.defaultTemperature,
// applied by the provider ONLY when the request omits it), so the same agent
// sampled at 0.1 on `run()` and at 0.7 on a direct chat turn
// (chat-vs-run parity audit, 2026-11-14).
//
// RED-ON-CUT: restoring `temperature: 0.7` in makeChatComplete fails this pin.
import { describe, expect, it } from "bun:test";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { EventBusLive } from "@reactive-agents/core";
import { LLMService, TestLLMServiceLayer, type CompletionRequest } from "@reactive-agents/llm-provider";
import { makeChatComplete } from "../src/agent/chat-capabilities.js";

describe("seam: direct chat completion leaves temperature to the configured default", () => {
  it("sends no temperature on the request", async () => {
    const seen: CompletionRequest[] = [];
    const recording = Layer.map(TestLLMServiceLayer([{ match: "", text: "hi" }]), (ctx) => {
      const svc = Context.get(ctx, LLMService);
      return Context.make(LLMService, {
        ...svc,
        complete: (req: CompletionRequest) => {
          seen.push(req);
          return svc.complete(req);
        },
      });
    });
    const rt = ManagedRuntime.make(Layer.merge(recording, EventBusLive));
    await makeChatComplete(rt)({ messages: [{ role: "user", content: "hello" }], systemPrompt: "be brief" });
    await rt.dispose();
    expect(seen.length).toBe(1);
    expect(seen[0]?.temperature).toBeUndefined();
  });
});
