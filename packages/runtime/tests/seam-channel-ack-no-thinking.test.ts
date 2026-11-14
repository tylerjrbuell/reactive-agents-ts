// Run: bun test packages/runtime/tests/seam-channel-ack-no-thinking.test.ts
//
// Seam pin: the model ack must not run extended thinking. A thinking model (ollama mimo-v2.6)
// otherwise spends the router's modelTimeoutMs (3 s) and the token budget reasoning before any
// visible text, so the ack always falls back to canned. Pins: (1) the ack completion carries
// thinking:false, (2) makeChatComplete forwards it onto the CompletionRequest, (3) an unusable
// result reports why (empty | thinking_only | error) and is never used as ack text.
import { describe, expect, test } from "bun:test";
import { Effect, Layer, ManagedRuntime } from "effect";
import type { RoutedTurn } from "@reactive-agents/channels";
import { EventBusLive } from "@reactive-agents/core";
import { LLMService, TestLLMServiceLayer, type CompletionRequest } from "@reactive-agents/llm-provider";
import { makeChatComplete } from "../src/agent/chat-capabilities.js";
import { ACK_MAX_TOKENS, makeAcknowledge, type AckFallbackReason } from "../src/agent/channel-ack-ports.js";
import type { ChannelAgentHandle } from "../src/agent/channel-router-resolver.js";

type Complete = NonNullable<ChannelAgentHandle["complete"]>;

const turn = { text: "fix the bug" } as RoutedTurn;

const run = (complete: Complete) => {
  const reasons: AckFallbackReason[] = [];
  const text = Effect.runPromise(makeAcknowledge(complete, (r) => reasons.push(r))(turn));
  return text.then((t) => ({ text: t, reasons }));
};

/**
 * Scripted thinking model: with thinking on it returns thinking and no content (budget eaten);
 * with thinking:false it answers.
 */
const thinkingModel: Complete = async (p) =>
  p.thinking === false
    ? { message: "  On it, starting now.  " }
    : { message: "", thinking: "Let me think about how to acknowledge this..." };

describe("model ack never runs extended thinking", () => {
  test("thinking model: ack requests no thinking and returns visible text", async () => {
    const out = await run(thinkingModel);
    expect(out.text).toBe("On it, starting now.");
    expect(out.reasons).toEqual([]);
  });

  test("ack budget leaves room for a visible sentence", () => {
    expect(ACK_MAX_TOKENS).toBeGreaterThanOrEqual(60);
    expect(ACK_MAX_TOKENS).toBeLessThanOrEqual(100);
  });

  test("thinking-only response is not used as the ack and reports thinking_only", async () => {
    const out = await run(async () => ({ message: "", thinking: "reasoning only" }));
    expect(out.text).toBe("");
    expect(out.reasons).toEqual(["thinking_only"]);
  });

  test("empty response reports empty", async () => {
    const out = await run(async () => ({ message: "   " }));
    expect(out.text).toBe("");
    expect(out.reasons).toEqual(["empty"]);
  });

  test("provider failure reports error", async () => {
    const out = await run(() => Promise.reject("provider down"));
    expect(out.text).toBe("");
    expect(out.reasons).toEqual(["error"]);
  });

  test("makeChatComplete forwards thinking:false onto the CompletionRequest", async () => {
    const seen: CompletionRequest[] = [];
    const spy = Layer.effect(
      LLMService,
      Effect.map(LLMService, (base) => ({
        ...base,
        complete: (req: CompletionRequest) => {
          seen.push(req);
          return base.complete(req);
        },
      })),
    ).pipe(Layer.provide(TestLLMServiceLayer([{ match: "", text: "On it." }])));
    const rt = ManagedRuntime.make(Layer.merge(spy, EventBusLive));
    const out = await makeChatComplete(rt)({
      messages: [{ role: "user", content: "hi" }],
      systemPrompt: "s",
      budgetTokens: 60,
      thinking: false,
    });
    expect(out.message).toBe("On it.");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.thinking).toBe(false);
    await makeChatComplete(rt)({ messages: [{ role: "user", content: "hi" }], systemPrompt: "s" });
    expect(seen[1]!.thinking).toBeUndefined();
    await rt.dispose();
  });
});
