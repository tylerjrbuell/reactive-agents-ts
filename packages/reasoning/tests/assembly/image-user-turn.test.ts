// Run: bun test packages/reasoning/tests/assembly/image-user-turn.test.ts --timeout 15000
//
// Plan 9 Phase 4 stage D1 (principle 8: no core type assumes string turns).
// A scripted, zero-token run whose seeded user turn carries an image part must
// reach the provider as an image ContentBlock. Before D1 the kernel message
// content was `string`, the goal event carried only text and `toLLMMessages`
// passed content through, so an image could not survive project().
//
// Also pins the text-only invariant the goldens rely on: text-only content stays
// ONE string on the wire (no part arrays for text runs).
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import {
  LLMService,
  TestLLMService,
  type CompletionRequest,
  type LLMMessage,
} from "@reactive-agents/llm-provider";
import type { ContentPart } from "@reactive-agents/core";
import { executeReactive } from "../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import { toLLMMessages } from "../../src/assembly/to-llm-messages.js";
import { initialKernelState, transitionState } from "../../src/kernel/state/kernel-state.js";
import { seedPassState } from "../../src/kernel/state/pass-seed.js";

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const IMAGE_PART: ContentPart = { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_1PX } };

/** TestLLMService wrapped to record every agent-call message list it receives. */
function capturingLayer(seen: LLMMessage[][]): Layer.Layer<LLMService> {
  const base = TestLLMService([{ text: "FINAL ANSWER: a single pixel." }]);
  const record = (request: CompletionRequest) => {
    seen.push([...request.messages]);
  };
  return Layer.succeed(
    LLMService,
    LLMService.of({
      ...base,
      complete: (request) => {
        record(request);
        return base.complete(request);
      },
      stream: (request) => {
        record(request);
        return base.stream(request);
      },
    }),
  );
}

const imageBlocksIn = (messages: readonly LLMMessage[]) =>
  messages.flatMap((m) =>
    m.role === "user" && typeof m.content !== "string" ? m.content.filter((b) => b.type === "image") : [],
  );

describe("D1: an image user turn reaches the provider as an image block", () => {
  it("scripted run: the seeded image part survives project() and toLLMMessages", async () => {
    const seen: LLMMessage[][] = [];
    const program = executeReactive({
      taskDescription: "Describe the attached image.",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
      initialMessages: [
        { role: "user", content: [{ type: "text", text: "Describe the attached image." }, IMAGE_PART] },
      ],
    });
    await Effect.runPromise(provideTestEnvelope(program.pipe(Effect.provide(capturingLayer(seen)))));

    expect(seen.length).toBeGreaterThan(0);
    const first = seen[0]!;
    const images = imageBlocksIn(first);
    expect(images).toHaveLength(1);
    // The provider image block is the core image part (same field names).
    expect(images[0]).toEqual(IMAGE_PART);
    // The text part rides in the same user turn, before the image; volatile-tail
    // text (outstanding requirements) follows as text parts, never by stringifying
    // the parts array (the "[object Object]" failure this pin caught).
    const userTurn = first.find((m) => m.role === "user" && typeof m.content !== "string");
    const blocks = userTurn && typeof userTurn.content !== "string" ? userTurn.content : [];
    expect(blocks.slice(0, 2)).toEqual([{ type: "text", text: "Describe the attached image." }, IMAGE_PART]);
    expect(blocks.slice(2).every((b) => b.type === "text")).toBe(true);
    expect(JSON.stringify(first)).not.toContain("[object Object]");
  });

  // End-to-end canonical form: seed normalization (pass-seed) and goal
  // normalization (from-kernel-state) both enforce it, so this goes red only
  // when both are cut; the seedPassState unit pin below isolates the seed layer.
  it("scripted run: seeded text-only parts collapse to one string on the wire", async () => {
    const seen: LLMMessage[][] = [];
    const program = executeReactive({
      taskDescription: "Say hi.",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
      initialMessages: [
        { role: "user", content: [{ type: "text", text: "Say " }, { type: "text", text: "hi." }] },
      ],
    });
    await Effect.runPromise(provideTestEnvelope(program.pipe(Effect.provide(capturingLayer(seen)))));

    const firstUser = seen[0]!.find((m) => m.role === "user");
    expect(typeof firstUser?.content).toBe("string");
    expect(String(firstUser?.content).startsWith("Say hi.")).toBe(true);
  });

  it("seedPassState: the seeded kernel thread is canonical before any reader sees it", () => {
    const base = initialKernelState({ maxIterations: 3, strategy: "reactive", kernelType: "react" });
    const seeded = transitionState(base, {
      messages: [
        { role: "user", content: [{ type: "text", text: "Say " }, { type: "text", text: "hi." }] },
        { role: "user", content: [{ type: "text", text: "see " }, IMAGE_PART] },
      ],
    });
    const out = seedPassState(seeded, {});
    expect(out.messages[0]!.content).toBe("Say hi.");
    expect(out.messages[1]!.content).toEqual([{ type: "text", text: "see " }, IMAGE_PART]);
    // String-only threads are returned untouched (same reference).
    const plain = transitionState(base, { messages: [{ role: "user", content: "x" }] });
    expect(seedPassState(plain, {}).messages).toBe(plain.messages);
  });

  it("text-only content stays one string on the wire (golden byte invariant)", () => {
    const out = toLLMMessages([
      { role: "user", content: "plain goal" },
      { role: "assistant", content: "" },
    ]);
    expect(out).toEqual([
      { role: "user", content: "plain goal" },
      { role: "assistant", content: "" },
    ]);
  });

  it("toLLMMessages: image/audio/file parts map deterministically", () => {
    const out = toLLMMessages([
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          IMAGE_PART,
          { type: "image", source: { type: "base64", media_type: "image/tiff", data: "AAAA" } },
          { type: "audio", source: { type: "base64", media_type: "audio/wav", data: "AAAA" }, transcript: "hello" },
          { type: "file", ref: { uri: "file:///w/report.pdf", media_type: "application/pdf", name: "report.pdf" } },
        ],
      },
      {
        role: "tool_result",
        toolCallId: "c1",
        toolName: "shot",
        content: [{ type: "text", text: "ok " }, IMAGE_PART],
      },
    ]);
    expect(out[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "look" },
        IMAGE_PART,
        { type: "text", text: "[image omitted: image/tiff; unsupported image type]" },
        { type: "text", text: "[audio omitted: audio/wav; transcript: hello]" },
        { type: "text", text: "[file: report.pdf (application/pdf) at file:///w/report.pdf]" },
      ],
    });
    // Provider stage E: a tool result with a non-text part goes as text/image
    // blocks (same part rule as user turns); text-only tool content stays a string.
    expect(out[1]).toEqual({
      role: "tool",
      toolCallId: "c1",
      toolName: "shot",
      content: [{ type: "text", text: "ok " }, IMAGE_PART],
    });
  });
});
