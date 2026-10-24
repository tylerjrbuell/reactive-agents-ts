import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { ReactiveAgents } from "../../src/builder.js";
import { LLMService } from "@reactive-agents/llm-provider";
import { TestLLMService } from "@reactive-agents/llm-provider";
import type { CompletionRequest } from "@reactive-agents/llm-provider";

type Req = CompletionRequest;

function makeCapturing(captured: Req[]) {
  const base = TestLLMService([{ text: "chat reply" }]);
  return Layer.succeed(
    LLMService,
    LLMService.of({
      ...base,
      complete: (r: Req) => {
        captured.push(r);
        return base.complete(r);
      },
    }),
  );
}

describe("legacy chat path persona", () => {
  it("persona reaches direct path system prompt when history is supplied", async () => {
    const captured: Req[] = [];
    const agent = await ReactiveAgents.create()
      .withName("q")
      .withProvider("test")
      .withModel("test-model")
      .withPersona({ name: "Quokka", role: "Quokka", tone: "friendly" })
      .withReplayLLM(makeCapturing(captured))
      .build();
    await agent.chat("hello there", undefined, [
      { role: "user", content: "prior", timestamp: 1 },
    ]);
    const sys = captured[0]?.systemPrompt ?? "";
    expect(String(sys)).toContain("Quokka");
    await agent.dispose();
  });
});
