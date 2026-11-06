// Run: bun test packages/reasoning/tests/kernel/seam-tool-content-act.test.ts --timeout 15000
//
// Plan 9 Phase 4 stage E, kernel act seam (principle 8: media must not vanish
// inside the kernel). A tool that returns `toolContent([text, image])`:
//  1. reaches the tool-result message as typed parts (it was JSON.stringify'd
//     to a quoted text view, so the image never left the tool);
//  2. leaves a text-view observation step (contentText: text parts only);
//  3. reaches the provider request: tool-role content is a string, so the image
//     becomes the deterministic tool-role stub (to-llm-messages, stage C rules);
//  4. never puts its media parts into the ResultStore (they would render as
//     base64 bullets); the tool_result event carries them instead.
// Unbranded results keep today's exact strings.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService, TestLLMService, type LLMMessage } from "@reactive-agents/llm-provider";
import type { ContentPart } from "@reactive-agents/core";
import { toolContent } from "@reactive-agents/tools";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { runKernel } from "../../src/kernel/loop/runner.js";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import {
  toolContentView,
  toolResultMessageContent,
  mediaPartsOf,
} from "../../src/kernel/capabilities/act/tool-result-content.js";
import { fromKernelState } from "../../src/assembly/from-kernel-state.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";
import { initialKernelState, transitionState } from "../../src/kernel/state/kernel-state.js";

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const IMAGE_PART: ContentPart = { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_1PX } };
const TEXT_PART: ContentPart = { type: "text", text: "Chart rendered" };
const TOOL = "render-chart";
const TOOL_SCHEMA = {
  name: TOOL,
  description: "render a chart",
  parameters: [{ name: "spec", type: "string", description: "chart spec", required: true }],
};
const IMAGE_STUB = "[image omitted: image/png; tool results carry text only]";

function recordingLLM() {
  const turns: (readonly LLMMessage[])[] = [];
  const base = TestLLMService([
    { toolCall: { name: TOOL, args: { spec: "bar" } } },
    { text: "FINAL ANSWER: the chart is rendered." },
  ]);
  const record = (req: { readonly messages: readonly LLMMessage[]; readonly purpose?: string }) => {
    if (req.purpose === undefined || req.purpose === "think") turns.push(req.messages);
  };
  const layer = Layer.succeed(
    LLMService,
    LLMService.of({
      ...base,
      complete: (req) => {
        record(req);
        return base.complete(req);
      },
      stream: (req) => {
        record(req);
        return base.stream(req);
      },
    }),
  );
  return { layer, turns };
}

async function driveRun(result: unknown) {
  const { layer, turns } = recordingLLM();
  const tools = mockToolServiceLayer({
    execute: () => Effect.succeed({ success: true, result }),
    getTool: (name: string) => Effect.succeed({ name, description: "render a chart", parameters: TOOL_SCHEMA.parameters }),
    listTools: () => Effect.succeed([TOOL_SCHEMA]),
  });
  const state = await Effect.runPromise(
    runKernel(
      reactKernel,
      { task: "Render a bar chart.", availableToolSchemas: [TOOL_SCHEMA], allToolSchemas: [TOOL_SCHEMA] } as never,
      { maxIterations: 4, strategy: "react", kernelType: "react" } as never,
    ).pipe(Effect.provide(Layer.merge(layer, tools))),
  );
  const toolMessage = state.messages.find((m) => m.role === "tool_result");
  const observation = state.steps.find((s) => s.type === "observation" && s.metadata?.toolCallId !== undefined);
  // The provider request of the turn after the tool ran: its tool-role message.
  const wireTool = turns
    .flatMap((t) => t)
    .find((m) => m.role === "tool");
  return { toolMessage, observation, wireTool };
}

describe("stage E: a toolContent result reaches the tool-result message as parts", () => {
  it("scripted run: message carries the parts, step text is the text view, provider gets an image block on the tool message", async () => {
    const { toolMessage, observation, wireTool } = await driveRun(toolContent([TEXT_PART, IMAGE_PART]));

    expect(toolMessage?.content).toEqual([TEXT_PART, IMAGE_PART]);
    expect(observation?.content).toBe("Chart rendered");
    expect(observation?.metadata?.contentParts).toEqual([TEXT_PART, IMAGE_PART]);

    // Provider stage E: a tool result with a non-text part goes as text/image
    // blocks (each provider maps them: native tool-result image or relocated
    // user turn), so the image reaches the provider instead of a stub.
    expect(wireTool).toBeDefined();
    expect(wireTool?.content).toEqual([
      { type: "text", text: "Chart rendered" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_1PX } },
    ]);
    expect(JSON.stringify(wireTool?.content)).not.toContain(IMAGE_STUB);
  }, 30000);

  it("scripted run: a text-only toolContent result stays one string on the tool message", async () => {
    const { wireTool } = await driveRun(toolContent([TEXT_PART, { type: "text", text: "!" }]));
    expect(wireTool?.content).toBe("Chart rendered!");
  }, 30000);

  it("scripted run: an unbranded result keeps today's exact JSON string everywhere", async () => {
    const { toolMessage, observation, wireTool } = await driveRun({ rendered: true, bars: 3 });
    const json = JSON.stringify({ rendered: true, bars: 3 });
    expect(toolMessage?.content).toBe(json);
    expect(observation?.content).toBe(json);
    expect(observation?.metadata?.contentParts).toBeUndefined();
    expect(String(wireTool?.content).startsWith(json)).toBe(true);
  }, 30000);
});

describe("stage E: tool-result-content helpers", () => {
  it("toolContentView: unbranded values are not tool content; text-only collapses to one string", () => {
    expect(toolContentView({ parts: [TEXT_PART] })).toBeUndefined();
    expect(toolContentView("Chart rendered")).toBeUndefined();
    expect(toolContentView(toolContent([TEXT_PART, { type: "text", text: "!" }]))).toEqual({ text: "Chart rendered!" });
    expect(toolContentView(toolContent([IMAGE_PART, TEXT_PART]))).toEqual({
      text: "Chart rendered",
      parts: [IMAGE_PART, TEXT_PART],
    });
  });

  it("toolResultMessageContent: unchanged text keeps part order; rewritten text leads, media follows", () => {
    expect(toolResultMessageContent("x")).toBe("x");
    expect(toolResultMessageContent("Chart rendered", [IMAGE_PART, TEXT_PART])).toEqual([IMAGE_PART, TEXT_PART]);
    expect(toolResultMessageContent("[preview]", [TEXT_PART, IMAGE_PART])).toEqual([
      { type: "text", text: "[preview]" },
      IMAGE_PART,
    ]);
    expect(toolResultMessageContent("", [TEXT_PART, IMAGE_PART])).toEqual([IMAGE_PART]);
    expect(mediaPartsOf("s")).toEqual([]);
  });

  it("text split by a media part keeps a separator in the text view, and the unchanged view keeps part order", () => {
    const a: ContentPart = { type: "text", text: "a" };
    const c: ContentPart = { type: "text", text: "c" };
    const view = toolContentView(toolContent([a, IMAGE_PART, c]));
    expect(view?.text).toBe("a\nc");
    expect(view?.parts).toEqual([a, IMAGE_PART, c]);
    expect(toolResultMessageContent("a\nc", [a, IMAGE_PART, c])).toEqual([a, IMAGE_PART, c]);
  });
});

describe("stage E: from-kernel-state keeps media out of the ResultStore", () => {
  it("the store holds the text view; the tool_result event carries the media parts", () => {
    const base = initialKernelState({ maxIterations: 3, strategy: "reactive", kernelType: "react" });
    const input = fromKernelState(
      transitionState(base, {
        messages: [
          { role: "user", content: "Render a bar chart." },
          { role: "assistant", content: "", toolCalls: [{ id: "c1", name: TOOL, arguments: { spec: "bar" } }] },
          { role: "tool_result", toolCallId: "c1", toolName: TOOL, content: [TEXT_PART, IMAGE_PART] },
        ],
      }),
      CONTEXT_PROFILES.mid,
      { system: "P" },
      { schemas: [] },
    );
    const event = input.log.byKind("tool_result")[0]!;
    expect(event.parts).toEqual([IMAGE_PART]);
    expect(input.store.get(event.ref)?.value).toBe("Chart rendered");
  });

  it("string tool results are stored unchanged and carry no parts", () => {
    const base = initialKernelState({ maxIterations: 3, strategy: "reactive", kernelType: "react" });
    const input = fromKernelState(
      transitionState(base, {
        messages: [
          { role: "user", content: "go" },
          { role: "assistant", content: "", toolCalls: [{ id: "c1", name: TOOL, arguments: {} }] },
          { role: "tool_result", toolCallId: "c1", toolName: TOOL, content: '{"ok":true}' },
        ],
      }),
      CONTEXT_PROFILES.mid,
      { system: "P" },
      { schemas: [] },
    );
    const event = input.log.byKind("tool_result")[0]!;
    expect(event.parts).toBeUndefined();
    expect(input.store.get(event.ref)?.value).toBe('{"ok":true}');
  });
});
