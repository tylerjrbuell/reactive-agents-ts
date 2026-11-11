// Run: bun test packages/runtime/tests/seam-chat-direct-failure.test.ts --timeout 20000
//
// Seam pin (agent/chat-capabilities.ts `makeChatComplete`): a tools-off
// `session.chat()` whose model call fails rejects with the provider's own
// error, so the cause line is the provider message (2026-11-10 review: it
// rejected with a FiberFailure around `Error("LLMError: …")`, so every caller
// printed a class-tag prefix).
//
// Decision: the direct path keeps REJECTING (it is not a run: no result
// envelope, receipt or terminatedBy to carry a failure in). Turning it into a
// resolved `{ failed: true }` reply would silently change every caller's
// try/catch (Cortex's tools-off chat path included). runStream's failure stays
// result-shaped (StreamCompleted success:false); both carry the provider
// message unprefixed.
//
// Cells:
//   (a) the capability rejects with the typed LLMError itself (message clean).
//   (b) through the agent, a provider defect (the test provider throws a raw
//       error): the rejection message is the provider message. Vacuity guard,
//       this shape was already clean.
//   (c) through the agent, a real provider's typed failure (Ollama, model not
//       available or not reachable): no `LLMError: ` / `Error: ` prefix.
//
// RED-ON-CUT (verified by temporary mutation, 2026-11-10): restoring
// `Effect.mapError((e) => Error(String(e)))` + bare `runPromise` fails (a)
// and (c).
import { describe, expect, it } from "bun:test";
import { Effect, Layer, ManagedRuntime } from "effect";
import { EventBusLive } from "@reactive-agents/core";
import { LLMError, LLMService } from "@reactive-agents/llm-provider";
import { makeChatComplete } from "../src/agent/chat-capabilities.js";
import { ReactiveAgents } from "../src/index.js";

const MISSING = "model 'qwen-missing:7b' not found, try pulling it first";

const RESOLVED = Symbol("resolved");
const rejectionOf = async (p: Promise<unknown>): Promise<unknown> => {
  const err = await p.then(
    () => RESOLVED,
    (e: unknown) => e,
  );
  expect(err).not.toBe(RESOLVED);
  return err;
};

describe("tools-off chat failure cause", () => {
  it("(a) makeChatComplete rejects with the provider's typed error", async () => {
    const failing = LLMService.of({
      complete: () => Effect.fail(new LLMError({ message: MISSING, provider: "ollama" })),
    } as never);
    const runtime = ManagedRuntime.make(Layer.mergeAll(Layer.succeed(LLMService, failing), EventBusLive));
    try {
      const err = await rejectionOf(makeChatComplete(runtime)({ messages: [{ role: "user", content: "hi" }], systemPrompt: "s" }));
      expect((err as { _tag?: unknown })._tag).toBe("LLMError");
      expect((err as { message?: unknown }).message).toBe(MISSING);
    } finally {
      await runtime.dispose();
    }
  });

  it("(b) session().chat({ useTools: false }) rejects with the provider message, unprefixed", async () => {
    const agent = await ReactiveAgents.create()
      .withName("chat-direct-failure")
      .withProvider("test")
      .withModel("test")
      .withTestScenario([{ error: MISSING }] as never)
      .build();
    try {
      const err = await rejectionOf(agent.session().chat("hello", { useTools: false }));
      const message = String((err as { message?: unknown }).message);
      expect(message).toBe(MISSING);
      expect(message.startsWith("LLMError")).toBe(false);
      expect(message.startsWith("Error:")).toBe(false);
    } finally {
      await agent.dispose();
    }
  }, 20000);

  it("(c) a real provider's typed failure (unreachable Ollama) reaches chat() unprefixed", async () => {
    const agent = await ReactiveAgents.create()
      .withName("chat-direct-provider-failure")
      .withProvider("ollama", { baseUrl: "http://127.0.0.1:9" })
      .withModel("qwen-missing:7b")
      .build();
    try {
      const err = await rejectionOf(agent.session().chat("hello", { useTools: false }));
      const message = String((err as { message?: unknown }).message);
      expect(message.startsWith("LLMError")).toBe(false);
      expect(message.startsWith("Error:")).toBe(false);
    } finally {
      await agent.dispose();
    }
  }, 20000);
});
