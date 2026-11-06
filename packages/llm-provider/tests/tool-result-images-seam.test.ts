// Plan 9 Phase 4 stage E (provider side) seam pins: image parts inside tool
// results reach the model as images where the wire allows it.
// Zero-token: every assertion runs on the pure wire mappers.
import { describe, it, expect } from "bun:test";
import type { ContentBlock, LLMMessage, ToolMessageBlock } from "../src/types.js";
import { IMAGES_ALLOWED, type ContentPolicy } from "../src/content-parts.js";
import { relocateToolImages } from "../src/tool-result-images.js";
import { OPENAI_IMAGE_RULES, mapOpenAIMessages } from "../src/providers/openai-messages.js";
import { toLiteLLMMessages } from "../src/providers/litellm.js";
import { GEMINI_IMAGE_RULES, toGeminiContents } from "../src/providers/gemini-messages.js";
import { toAnthropicMessages } from "../src/providers/anthropic-messages.js";
import { toOllamaMessages } from "../src/providers/ollama-messages.js";

const tinyPng: ToolMessageBlock = { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } };
const urlJpeg: ToolMessageBlock = { type: "image", source: { type: "url", media_type: "image/jpeg", data: "https://example.com/cat.jpg" } };
const text = (t: string): ToolMessageBlock => ({ type: "text", text: t });
const BLOCKED_MODEL: ContentPolicy = { imageBlocked: "model-no-image-input" };

const callTwo: LLMMessage = {
  role: "assistant",
  content: [
    { type: "tool_use", id: "t1", name: "screenshot", input: {} },
    { type: "tool_use", id: "t2", name: "file-read", input: { path: "x" } },
  ],
};
const shot: LLMMessage = { role: "tool", toolCallId: "t1", toolName: "screenshot", content: [text("captured "), tinyPng] };
const read: LLMMessage = { role: "tool", toolCallId: "t2", toolName: "file-read", content: "contents" };

const MOVED = "[image: image/png, 1 KB; attached in the next user message]";
const LABEL = 'Image output of tool "screenshot" (call t1):';

describe("seam: relocateToolImages", () => {
  it("returns the same array when no tool message carries an image", () => {
    const msgs: readonly LLMMessage[] = [callTwo, read, { role: "tool", toolCallId: "t1", content: [text("a"), text("b")] }];
    const r = relocateToolImages(msgs, IMAGES_ALLOWED, OPENAI_IMAGE_RULES);
    expect(r.messages).toBe(msgs);
    expect(r.degraded).toEqual([]);
  });

  it("moves images to one user message after the contiguous tool run", () => {
    const r = relocateToolImages([callTwo, shot, read, { role: "user", content: "next" }], IMAGES_ALLOWED, OPENAI_IMAGE_RULES);
    expect(r.degraded).toEqual([]);
    expect(r.messages).toEqual([
      callTwo,
      { role: "tool", toolCallId: "t1", toolName: "screenshot", content: [text("captured "), text(MOVED)] },
      read,
      { role: "user", content: [text(LABEL), tinyPng] },
      { role: "user", content: "next" },
    ]);
  });

  it("stubs in place, with the user-role reason, an image the user slot cannot carry", () => {
    const r = relocateToolImages(
      [{ role: "tool", toolCallId: "t1", toolName: "fetch", content: [urlJpeg] }],
      IMAGES_ALLOWED,
      GEMINI_IMAGE_RULES,
    );
    expect(r.messages).toEqual([
      {
        role: "tool",
        toolCallId: "t1",
        toolName: "fetch",
        content: [text("[image omitted: image/jpeg, remote url; provider accepts inline base64 images only]")],
      },
    ]);
    expect(r.degraded).toEqual([
      { partType: "image", mediaType: "image/jpeg", bytes: undefined, role: "tool", reason: "url-image-unsupported" },
    ]);
  });

  it("stubs in place and adds no user message when the model has no image input", () => {
    const r = relocateToolImages([shot], BLOCKED_MODEL, OPENAI_IMAGE_RULES);
    expect(r.messages).toEqual([
      {
        role: "tool",
        toolCallId: "t1",
        toolName: "screenshot",
        content: [text("captured "), text("[image omitted: image/png, 1 KB; model has no image input]")],
      },
    ]);
    expect(r.degraded.map((d) => [d.role, d.reason])).toEqual([["tool", "model-no-image-input"]]);
  });
});

describe("seam: OpenAI tool-result images", () => {
  it("a tool image reaches the model as an image_url part in a follow-up user message", () => {
    const { messages, degraded } = mapOpenAIMessages([callTwo, shot, read], IMAGES_ALLOWED);
    expect(degraded).toEqual([]);
    expect(messages.slice(1)).toEqual([
      { role: "tool", tool_call_id: "t1", content: `captured ${MOVED}` },
      { role: "tool", tool_call_id: "t2", content: "contents" },
      {
        role: "user",
        content: [
          { type: "text", text: LABEL },
          { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
        ],
      },
    ]);
  });
});

describe("seam: LiteLLM tool-result images", () => {
  it("a tool image reaches the model as an image_url part in a follow-up user message", () => {
    const { messages, degraded } = toLiteLLMMessages([shot], IMAGES_ALLOWED);
    expect(degraded).toEqual([]);
    expect(messages).toEqual([
      { role: "tool", tool_call_id: "t1", content: `captured ${MOVED}` },
      {
        role: "user",
        content: [
          { type: "text", text: LABEL },
          { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
        ],
      },
    ]);
  });
});

describe("seam: Gemini tool-result images", () => {
  it("a tool image reaches the model as inlineData in a follow-up user content", () => {
    const { contents, degraded } = toGeminiContents([shot], IMAGES_ALLOWED);
    expect(degraded).toEqual([]);
    expect(contents).toEqual([
      { role: "user", parts: [{ functionResponse: { name: "screenshot", response: { content: `captured ${MOVED}` } } }] },
      { role: "user", parts: [{ text: LABEL }, { inlineData: { mimeType: "image/png", data: "iVBORw0KGgo=" } }] },
    ]);
  });
});

describe("seam: Anthropic tool-result images", () => {
  it("text-only messages keep their exact wire shape", () => {
    const cached: ContentBlock = { type: "text", text: "ctx", cache_control: { type: "ephemeral" } };
    const msgs: readonly LLMMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
      { role: "user", content: [cached, { type: "text", text: "b" }] },
      callTwo,
      read,
      { role: "assistant", content: "done" },
    ];
    const { messages, degraded } = toAnthropicMessages(msgs, IMAGES_ALLOWED);
    expect(degraded).toEqual([]);
    expect(JSON.stringify(messages)).toBe(
      JSON.stringify([
        { role: "user", content: "hello" },
        { role: "user", content: [cached, { type: "text", text: "b" }] },
        { role: "assistant", content: callTwo.content },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: "contents" }] },
        { role: "assistant", content: "done" },
      ]),
    );
  });

  it("a tool image rides the tool_result content blocks natively", () => {
    const { messages, degraded } = toAnthropicMessages([shot], IMAGES_ALLOWED);
    expect(degraded).toEqual([]);
    expect(messages).toEqual([
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            content: [
              { type: "text", text: "captured " },
              { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
            ],
          },
        ],
      },
    ]);
  });

  it("stubs a URL image (SDK image source is base64 only) and a non-vision model's image", () => {
    const url = toAnthropicMessages([{ role: "tool", toolCallId: "t1", content: [urlJpeg] }], IMAGES_ALLOWED);
    expect(url.messages).toEqual([
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            content: [{ type: "text", text: "[image omitted: image/jpeg, remote url; provider accepts inline base64 images only]" }],
          },
        ],
      },
    ]);
    expect(url.degraded.map((d) => d.reason)).toEqual(["url-image-unsupported"]);
    const blocked = toAnthropicMessages([{ role: "user", content: [tinyPng] }], BLOCKED_MODEL);
    expect(blocked.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "[image omitted: image/png, 1 KB; model has no image input]" }] },
    ]);
    expect(blocked.degraded.map((d) => [d.role, d.reason])).toEqual([["user", "model-no-image-input"]]);
  });
});

describe("seam: Ollama tool-result images (stage C mapping, pinned here too)", () => {
  it("a tool image rides the tool message images array", () => {
    const { messages, degraded } = toOllamaMessages([shot], IMAGES_ALLOWED);
    expect(degraded).toEqual([]);
    expect(messages).toEqual([{ role: "tool", content: "captured ", images: ["iVBORw0KGgo="] }]);
  });
});
