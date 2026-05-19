import { describe, it, expect } from "bun:test";
import { Effect, Layer, Ref, Stream } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { StreamEvent } from "@reactive-agents/llm-provider";
import { executeReActKernel } from "../../src/kernel/loop/react-kernel.js";

// Capturing mock: records every systemPrompt the sub-kernel LLM is asked with,
// then immediately ends the run with a final answer so the kernel terminates.
function capturingLLM(sink: Ref.Ref<string[]>) {
  const record = (req: { systemPrompt?: string }) =>
    Ref.update(sink, (xs) => [...xs, req.systemPrompt ?? ""]);
  const answer = "FINAL ANSWER: done";
  const stream = (req: { systemPrompt?: string }) =>
    Effect.as(
      record(req),
      Stream.make(
        { type: "text_delta" as const, text: answer },
        { type: "content_complete" as const, content: answer },
        { type: "usage" as const, usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7, estimatedCost: 0 } },
      ) as Stream.Stream<StreamEvent, never>,
    );
  return Layer.succeed(LLMService, {
    complete: (req: { systemPrompt?: string }) =>
      Effect.as(record(req), { content: answer, usage: { totalTokens: 7, estimatedCost: 0 }, model: "test" }),
    stream,
    embed: () => Effect.succeed([]),
    getModelInfo: () => Effect.succeed({ contextWindow: 8000, id: "test", provider: "test" }),
  } as any);
}

describe("Bug 2 — sub-kernel forwards custom environmentContext", () => {
  it("executeReActKernel injects caller environmentContext custom fields into the system prompt", async () => {
    const sink = await Effect.runPromise(Ref.make<string[]>([]));

    await Effect.runPromise(
      executeReActKernel({
        task: "say hello",
        availableToolSchemas: [],
        environmentContext: { ProbeKey: "PROBE_VALUE_XYZ" },
        maxIterations: 1,
      } as any).pipe(Effect.provide(capturingLLM(sink))),
    );

    const prompts = await Effect.runPromise(Ref.get(sink));
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.join("\n")).toContain("ProbeKey: PROBE_VALUE_XYZ");
  }, 15000);
});
