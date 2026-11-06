// Run: bun test packages/reasoning/tests/kernel/seam-media-trace-bound.test.ts --timeout 20000
//
// Plan 9 Phase 4 stage F: traces and checkpoints carry media SUMMARIES, never
// raw bytes (trace size, PII). A scripted run whose user turn and tool result
// each carry a 200 KB image:
//  1. writes a normalized trace (toTraceEvent, the shape the recorder persists)
//     under a small bound, with no base64 payload anywhere in it;
//  2. writes durable checkpoints (serializeKernelState via onCheckpoint) under
//     the same bound, with each inline image replaced by a summary stub;
//  3. records the user image and the tool-result image (sent as an image block
//     on the tool message since provider stage E) on `llm-exchange` as `parts`
//     summaries {type, media_type, bytes, sha256};
//  4. records the tool-result audio part (stubbed by toLLMMessages: no provider
//     audio input yet) as a `content-part-degraded` trace fact.
// RED-ON-CUT: drop the `isInlineMediaPart` rule in kernel-codec.ts (checkpoint
// bound fails), the `parts` spread in observable-llm.ts toExchangeMessages
// (summary assertion fails), or the emitContentPartsDegraded call in think.ts
// (degraded-fact assertion fails), or force toToolContent in to-llm-messages.ts
// to the joined string (tool-image summary fails; stage E pin fails too).
import { describe, it, expect } from "bun:test";
import { createHash } from "node:crypto";
import { Effect, Layer, Ref } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import {
  EventBus,
  EventBusLive,
  rootContext,
  base64DecodedBytes,
  inlineMediaStub,
  summarizePart,
  summarizeWireContent,
  type AgentEvent,
  type ContentPart,
  type RunControllerLike,
} from "@reactive-agents/core";
import { bindRun, runControllerSlot, withRunScope } from "@reactive-agents/core/internal/run-scope";
import { toolContent } from "@reactive-agents/tools";
import { toTraceEvent, type TraceEvent } from "@reactive-agents/trace";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { makeObservableLLM } from "../../src/kernel/observable-llm.js";
import { runKernel } from "../../src/kernel/loop/runner.js";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { deserializeKernelState, serializeKernelState } from "../../src/kernel/state/kernel-codec.js";
import { initialKernelState, transitionState } from "../../src/kernel/state/kernel-state.js";
import { degradedParts } from "../../src/assembly/to-llm-messages.js";

// 200 KB of deterministic bytes, base64-encoded (~273 K chars).
const IMAGE_BYTES = 200 * 1024;
const BIG_B64 = Buffer.from(Uint8Array.from({ length: IMAGE_BYTES }, (_, i) => (i * 31 + 7) % 251)).toString("base64");
const B64_PROBE = BIG_B64.slice(1000, 1064); // any 64-char run of the payload
const SHA = createHash("sha256").update(BIG_B64).digest("hex");
const IMAGE: ContentPart = { type: "image", source: { type: "base64", media_type: "image/png", data: BIG_B64 } };
/** Audio has no provider input yet, so toLLMMessages stubs it on the tool message. */
const AUDIO: ContentPart = { type: "audio", source: { type: "base64", media_type: "audio/wav", data: "UklGRg==" } };
const TOOL = "screenshot";
const TOOL_SCHEMA = {
  name: TOOL,
  description: "take a screenshot",
  parameters: [{ name: "url", type: "string", description: "page", required: true }],
};
/** Far below one copy of the image (~273 K chars); a single leaked payload fails it. */
const BOUND = 120_000;

async function driveTracedRun() {
  const checkpoints: string[] = [];
  const controller: RunControllerLike = {
    checkpoint: () => Promise.resolve(undefined),
    onCheckpoint: (serialized: string) => {
      checkpoints.push(serialized);
    },
  };
  const tools = mockToolServiceLayer({
    execute: () => Effect.succeed({ success: true, result: toolContent([{ type: "text", text: "Page captured" }, IMAGE, AUDIO]) }),
    getTool: (name: string) => Effect.succeed({ name, description: "take a screenshot", parameters: TOOL_SCHEMA.parameters }),
    listTools: () => Effect.succeed([TOOL_SCHEMA]),
  });
  const llm = makeObservableLLM().pipe(
    Layer.provide(
      TestLLMServiceLayer([
        { toolCall: { name: TOOL, args: { url: "https://example.com" } } },
        { text: "FINAL ANSWER: the page shows a chart." },
      ]),
    ),
  );
  const raw = await Effect.runPromise(
    Effect.gen(function* () {
      const events = yield* Ref.make<AgentEvent[]>([]);
      const bus = yield* EventBus;
      yield* bus.subscribe((ev) => Ref.update(events, (xs) => [...xs, ev]));
      yield* runKernel(
        reactKernel,
        {
          task: "Describe the attached page.",
          availableToolSchemas: [TOOL_SCHEMA],
          allToolSchemas: [TOOL_SCHEMA],
          initialMessages: [{ role: "user", content: [{ type: "text", text: "Describe the attached page." }, IMAGE] }],
        } as never,
        { maxIterations: 4, strategy: "react", kernelType: "react", taskId: "media-bound" } as never,
      );
      return yield* Ref.get(events);
    }).pipe(
      withRunScope(rootContext("media-bound", "agent"), bindRun(runControllerSlot, controller)),
      Effect.provide(Layer.mergeAll(llm, tools, EventBusLive)),
    ) as Effect.Effect<AgentEvent[], never, never>,
  );
  const trace = raw.flatMap((e, i) => {
    const t = toTraceEvent(e, i);
    return t ? [t] : [];
  });
  return { trace, checkpoints };
}

describe("stage F: a run with 200 KB images writes a bounded trace and bounded checkpoints", () => {
  it("trace: under the bound, no base64 payload, both images summarized, tool audio recorded as degraded", async () => {
    const { trace } = await driveTracedRun();
    const jsonl = trace.map((e) => JSON.stringify(e)).join("\n");
    expect(trace.length).toBeGreaterThan(0);
    expect(jsonl).not.toContain(B64_PROBE);
    expect(jsonl.length).toBeLessThan(BOUND);

    // The tool actually ran with its image (else the bound proves nothing).
    expect(trace.some((e) => e.kind === "tool-call-end" && e.toolName === TOOL)).toBe(true);

    const exchanges = trace.flatMap((e) => (e.kind === "llm-exchange" ? [e] : []));
    const summary = { type: "image", media_type: "image/png", bytes: IMAGE_BYTES, sha256: SHA };
    // The user image and (provider stage E) the tool-result image both ride as summaries.
    const userParts = exchanges.flatMap((x) => x.messages.filter((m) => m.role === "user").flatMap((m) => m.parts ?? []));
    const toolParts = exchanges.flatMap((x) => x.messages.filter((m) => m.role === "tool").flatMap((m) => m.parts ?? []));
    expect(userParts[0]).toEqual(summary);
    expect(toolParts[0]).toEqual(summary);
    // Text-only messages carry no parts field (text exchanges unchanged).
    const textOnly = exchanges.flatMap((x) => x.messages.filter((m) => m.role === "assistant"));
    for (const m of textOnly) expect(m.parts).toBeUndefined();

    // Only the audio part was stubbed; the supported images were not degraded.
    const degraded = trace.flatMap((e) => (e.kind === "content-part-degraded" ? [e] : []));
    expect(degraded.length).toBeGreaterThan(0);
    for (const d of degraded) {
      expect(d.role).toBe("tool");
      expect(d.reason).toBe("no provider input for this part yet");
      expect(d.part).toEqual({
        type: "audio",
        media_type: "audio/wav",
        bytes: 4,
        sha256: createHash("sha256").update("UklGRg==").digest("hex"),
      });
    }
  }, 30000);

  it("checkpoints: each under the bound, no base64 payload, the image is a summary stub", async () => {
    const { checkpoints } = await driveTracedRun();
    expect(checkpoints.length).toBeGreaterThan(0);
    for (const c of checkpoints) {
      expect(c).not.toContain(B64_PROBE);
      expect(c.length).toBeLessThan(BOUND);
    }
    // The checkpoint still restores; the seeded image is now the stub text part.
    const restored = deserializeKernelState(checkpoints.at(-1)!);
    const user = restored.messages.find((m) => m.role === "user");
    expect(user?.content).toEqual([
      { type: "text", text: "Describe the attached page." },
      { type: "text", text: `[image omitted from checkpoint: image/png, ${IMAGE_BYTES} bytes, sha256:${SHA.slice(0, 12)}]` },
    ]);
  }, 30000);
});

describe("stage F: part-summary helpers", () => {
  it("summaries carry type, media_type, decoded bytes and the full source sha256", () => {
    expect(base64DecodedBytes("iVBO")).toBe(3);
    expect(base64DecodedBytes("iVA=")).toBe(2);
    expect(base64DecodedBytes("iQ==")).toBe(1);
    expect(summarizePart(IMAGE as Exclude<ContentPart, { type: "text" }>)).toEqual({
      type: "image",
      media_type: "image/png",
      bytes: IMAGE_BYTES,
      sha256: SHA,
    });
    // URL sources have no byte count; a file part's own ref passes through.
    expect(summarizePart({ type: "image", source: { type: "url", media_type: "image/jpeg", data: "https://x/y.jpg" } })).toEqual({
      type: "image",
      media_type: "image/jpeg",
      sha256: createHash("sha256").update("https://x/y.jpg").digest("hex"),
    });
    expect(summarizePart({ type: "file", ref: { uri: "ws://a.pdf", media_type: "application/pdf", bytes: 9 } })).toEqual({
      type: "file",
      media_type: "application/pdf",
      bytes: 9,
    });
  });

  it("summarizeWireContent: image blocks only; strings and text blocks summarize to nothing", () => {
    expect(summarizeWireContent("hello")).toEqual([]);
    expect(summarizeWireContent([{ type: "text", text: "a" }])).toEqual([]);
    expect(summarizeWireContent([{ type: "text", text: "a" }, IMAGE])).toEqual([
      { type: "image", media_type: "image/png", bytes: IMAGE_BYTES, sha256: SHA },
    ]);
  });

  it("checkpoint codec: inline media becomes the stub, URL media and text are kept, an audio transcript survives", () => {
    const url: ContentPart = { type: "image", source: { type: "url", media_type: "image/png", data: "https://x/p.png" } };
    const audio: ContentPart = {
      type: "audio",
      source: { type: "base64", media_type: "audio/wav", data: "UklGRg==" },
      transcript: "hello",
    };
    const state = transitionState(initialKernelState({ maxIterations: 2, strategy: "reactive", kernelType: "react" }), {
      messages: [{ role: "user", content: [{ type: "text", text: "t" }, IMAGE, url, audio] }],
    });
    const json = serializeKernelState(state);
    expect(json).not.toContain(B64_PROBE);
    const content = deserializeKernelState(json).messages[0]!.content;
    expect(content).toEqual([
      { type: "text", text: "t" },
      inlineMediaStub(IMAGE as Extract<ContentPart, { type: "image" }>),
      url,
      { type: "text", text: `[audio omitted from checkpoint: audio/wav, 4 bytes, sha256:${createHash("sha256").update("UklGRg==").digest("hex").slice(0, 12)}; transcript: hello]` },
    ]);
  });

  it("degradedParts agrees with toLLMMessages: supported user images are not degraded, others are", () => {
    const facts = degradedParts([
      { role: "user", content: [{ type: "text", text: "x" }, IMAGE] },
      { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/tiff", data: "AAAA" } }] },
      { role: "user", content: [{ type: "file", ref: { uri: "ws://r.csv", media_type: "text/csv" } }] },
      { role: "tool_result", toolCallId: "c1", content: [{ type: "text", text: "ok" }, IMAGE] },
      { role: "assistant", content: "plain" },
    ]);
    expect(facts.map((f) => [f.role, f.part.type, f.part.media_type, f.reason])).toEqual([
      ["user", "image", "image/tiff", "unsupported image type"],
      ["user", "file", "text/csv", "no provider input for this part yet"],
    ]);
    // Tool results follow the same rule: a supported image maps, audio stubs.
    expect(degradedParts([{ role: "tool_result", toolCallId: "c2", content: [IMAGE, AUDIO] }]).map((f) => [f.role, f.part.type])).toEqual([
      ["tool", "audio"],
    ]);
  });
});
