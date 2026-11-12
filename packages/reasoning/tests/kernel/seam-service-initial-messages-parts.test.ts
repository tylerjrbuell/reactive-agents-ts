// Run: bun test packages/reasoning/tests/kernel/seam-service-initial-messages-parts.test.ts --timeout 15000
//
// Seam pin: ReasoningService.execute accepts `initialMessages` whose content is
// core's MessageContent (string | parts), with no cast, and the parts reach the
// provider request unchanged. Before this the service/registry typed content as
// `string`, so runtime needed an unsafe cast to pass an image or audio part.
// Text-only content stays ONE plain string on the wire (replay goldens).
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import {
  LLMService,
  TestLLMService,
  type CompletionRequest,
  type LLMMessage,
} from "@reactive-agents/llm-provider";
import type { ContentPart } from "@reactive-agents/core";
import { ReasoningService } from "../../src/services/reasoning-service.js";
import { createReasoningLayer } from "../../src/runtime.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const IMAGE_PART: ContentPart = { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_1PX } };

const capturing = (seen: LLMMessage[][]) => {
  const base = TestLLMService([{ text: "FINAL ANSWER: done." }]);
  const record = (r: CompletionRequest) => void seen.push([...r.messages]);
  return Layer.succeed(
    LLMService,
    LLMService.of({
      ...base,
      complete: (r) => (record(r), base.complete(r)),
      stream: (r) => (record(r), base.stream(r)),
    }),
  );
};

const run = async (
  strategy: "reactive" | "direct",
  content: string | readonly ContentPart[],
): Promise<LLMMessage[][]> => {
  const seen: LLMMessage[][] = [];
  const layer = Layer.provide(
    createReasoningLayer({ ...defaultReasoningConfig, adaptive: { enabled: false, learning: false } }),
    capturing(seen),
  );
  const program = Effect.gen(function* () {
    const reasoning = yield* ReasoningService;
    yield* reasoning.execute({
      taskDescription: "Describe the attached image.",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      strategy,
      initialMessages: [{ role: "user", content }],
    });
  });
  await Effect.runPromise(provideTestEnvelope(program.pipe(Effect.provide(layer))));
  return seen;
};

describe("ReasoningService.execute initialMessages carries MessageContent parts", () => {
  for (const strategy of ["reactive", "direct"] as const) {
    it(`${strategy}: text + image parts reach LLMRequest.messages`, async () => {
      const seen = await run(strategy, [{ type: "text", text: "Describe the attached image." }, IMAGE_PART]);
      expect(seen.length).toBeGreaterThan(0);
      const user = seen[0]!.find((m) => m.role === "user" && typeof m.content !== "string");
      const blocks = user && typeof user.content !== "string" ? user.content : [];
      expect(blocks.slice(0, 2)).toEqual([{ type: "text", text: "Describe the attached image." }, IMAGE_PART]);
      expect(JSON.stringify(seen[0])).not.toContain("[object Object]");
    });
  }

  it("text-only content stays a plain string on the wire", async () => {
    const seen = await run("reactive", "Describe the attached image.");
    const user = seen[0]!.find((m) => m.role === "user");
    expect(typeof user?.content).toBe("string");
  });
});
