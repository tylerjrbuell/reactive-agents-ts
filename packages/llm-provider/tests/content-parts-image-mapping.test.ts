// Plan 9 Phase 4 stage C seam pins: image parts at the provider boundary.
// Zero-token: every assertion runs on the pure wire mappers / projection.
import { describe, it, expect } from "bun:test";
import { Effect, Logger, HashMap } from "effect";
import type { ImagePart, MediaSource } from "@reactive-agents/core";
import type { ContentBlock, LLMMessage } from "../src/types.js";
import { isImageSource, ImageSourceSchema, TextContentBlockSchema } from "../src/content-blocks.js";
import {
  IMAGES_ALLOWED,
  base64DecodedBytes,
  degradedStub,
  emitContentDegradations,
  mediaPlaceholder,
  resolveContentPolicy,
  type ContentPolicy,
} from "../src/content-parts.js";
import { messageContentToString } from "../src/exchange-projection.js";
import { toOpenAIMessages } from "../src/providers/openai.js";
import { mapOpenAIMessages } from "../src/providers/openai-messages.js";
import { toLiteLLMMessages } from "../src/providers/litellm.js";
import { toGeminiContents } from "../src/providers/gemini-messages.js";
import { toOllamaMessages } from "../src/providers/ollama-messages.js";

// 41 KB of decoded bytes: 41*1024 = 41984 bytes -> 55980 base64 chars, one "=" pad.
const PNG_41KB = `${"A".repeat(55_979)}=`;
const png: ContentBlock = { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_41KB } };
const tinyPng: ContentBlock = { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } };
const urlJpeg: ContentBlock = { type: "image", source: { type: "url", media_type: "image/jpeg", data: "https://example.com/cat.jpg" } };
const text = (t: string): ContentBlock => ({ type: "text", text: t });

const BLOCKED_MODEL: ContentPolicy = { imageBlocked: "model-no-image-input" };

// A text-only conversation exercising every role and block kind (byte-identity fixture).
const TEXT_ONLY: readonly LLMMessage[] = [
  { role: "system", content: "sys" },
  { role: "user", content: "hello" },
  { role: "user", content: [text("a"), text("b")] },
  {
    role: "assistant",
    content: [text("calling"), { type: "tool_use", id: "t1", name: "file-read", input: { path: "x" } }],
  },
  { role: "tool", toolCallId: "t1", toolName: "file-read", content: "result" },
  { role: "assistant", content: "done" },
];

describe("seam: content-blocks derive from core parts", () => {
  it("a core ImagePart with a wire MIME type narrows to an image block", () => {
    const part: ImagePart = { type: "image", source: { type: "base64", media_type: "image/png", data: "x" } };
    expect(isImageSource(part.source)).toBe(true);
    const tiff: MediaSource = { type: "base64", media_type: "image/tiff", data: "x" };
    expect(isImageSource(tiff)).toBe(false);
  });

  it("schemas keep the core field names", () => {
    expect(Object.keys(ImageSourceSchema.fields).sort()).toEqual(["data", "media_type", "type"]);
    expect(Object.keys(TextContentBlockSchema.fields).sort()).toEqual(["cache_control", "text", "type"]);
  });
});

describe("seam: resolveContentPolicy", () => {
  it("blocks images when the provider declares no image input", () => {
    expect(resolveContentPolicy(undefined).imageBlocked).toBe("provider-no-image-input");
    expect(resolveContentPolicy(["text"]).imageBlocked).toBe("provider-no-image-input");
  });

  it("blocks images when an authoritative capability row says no vision", () => {
    expect(resolveContentPolicy(["text", "image"], { supportsVision: false, source: "static-table" }).imageBlocked).toBe(
      "model-no-image-input",
    );
    expect(resolveContentPolicy(["text", "image"], { supportsVision: false, source: "probe" }).imageBlocked).toBe(
      "model-no-image-input",
    );
  });

  it("admits images on a guessed (fallback) row and on vision rows", () => {
    expect(resolveContentPolicy(["text", "image"], { supportsVision: false, source: "fallback" })).toEqual(IMAGES_ALLOWED);
    expect(resolveContentPolicy(["text", "image"], { supportsVision: true, source: "static-table" })).toEqual(IMAGES_ALLOWED);
  });
});

describe("seam: degradation stub", () => {
  it("renders the deterministic stub text", () => {
    expect(base64DecodedBytes(PNG_41KB)).toBe(41 * 1024);
    expect(base64DecodedBytes("iVBORw0KGgo=")).toBe(8);
    expect(
      degradedStub({ partType: "image", mediaType: "image/png", bytes: 41 * 1024, role: "user", reason: "model-no-image-input" }),
    ).toBe("[image omitted: image/png, 41 KB; model has no image input]");
    expect(
      degradedStub({ partType: "image", mediaType: "image/jpeg", bytes: undefined, role: "user", reason: "url-image-unsupported" }),
    ).toBe("[image omitted: image/jpeg, remote url; provider accepts inline base64 images only]");
    expect(
      degradedStub({ partType: "image", mediaType: "image/png", bytes: 8, role: "tool", reason: "role-no-image-input" }),
    ).toBe("[image omitted: image/png, 1 KB; provider has no image input in tool messages]");
  });

  it("emits one content-part-degraded log fact per part, without bytes", async () => {
    const seen: Array<{ message: unknown; annotations: Record<string, unknown> }> = [];
    const capture = Logger.make(({ message, annotations }) => {
      seen.push({ message, annotations: Object.fromEntries(HashMap.toEntries(annotations)) });
    });
    await Effect.runPromise(
      emitContentDegradations("openai", "gpt-x", [
        { partType: "image", mediaType: "image/png", bytes: 8, role: "user", reason: "model-no-image-input" },
      ]).pipe(Effect.provide(Logger.replace(Logger.defaultLogger, capture))),
    );
    expect(seen.length).toBe(1);
    expect(seen[0]!.annotations).toEqual({
      event: "content-part-degraded",
      provider: "openai",
      model: "gpt-x",
      partType: "image",
      mediaType: "image/png",
      bytes: "8",
      role: "user",
      reason: "model-no-image-input",
    });
  });
});

describe("seam: messageContentToString placeholders", () => {
  it("text-only flattening is unchanged", () => {
    expect(messageContentToString("plain")).toBe("plain");
    expect(
      messageContentToString([
        text("a"),
        { type: "tool_use", id: "1", name: "web-search", input: {} },
        { type: "tool_result", tool_use_id: "1", content: "r" },
        text("b"),
      ]),
    ).toBe("a[tool_use:web-search][tool_result]b");
  });

  it("an image flattens to [image:<media_type>:<sha256-12>], not empty", () => {
    const flat = messageContentToString([text("look: "), tinyPng]);
    expect(flat).toMatch(/^look: \[image:image\/png:[0-9a-f]{12}\]$/);
    expect(flat).toBe(`look: ${mediaPlaceholder("image", { media_type: "image/png", data: "iVBORw0KGgo=" })}`);
  });

  it("two requests differing only in an image flatten differently", () => {
    const other: ContentBlock = { type: "image", source: { type: "base64", media_type: "image/png", data: "R0lGODlh" } };
    expect(messageContentToString([text("q"), tinyPng])).not.toBe(messageContentToString([text("q"), other]));
  });
});

describe("seam: OpenAI image mapping", () => {
  it("text-only messages are byte-identical to the flattened form", () => {
    expect(JSON.stringify(toOpenAIMessages(TEXT_ONLY))).toBe(
      JSON.stringify([
        { role: "system", content: "sys" },
        { role: "user", content: "hello" },
        { role: "user", content: "ab" },
        {
          role: "assistant",
          content: "calling",
          tool_calls: [{ id: "t1", type: "function", function: { name: "file-read", arguments: '{"path":"x"}' } }],
        },
        { role: "tool", tool_call_id: "t1", content: "result" },
        { role: "assistant", content: "done" },
      ]),
    );
  });

  it("maps a base64 user image to an image_url data-URL part", () => {
    const out = toOpenAIMessages([{ role: "user", content: [text("what is this?"), tinyPng] }]);
    expect(out).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "what is this?" },
          { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
        ],
      },
    ]);
  });

  it("passes a URL image through as image_url", () => {
    const out = toOpenAIMessages([{ role: "user", content: [urlJpeg] }]);
    expect(out[0]).toEqual({
      role: "user",
      content: [{ type: "image_url", image_url: { url: "https://example.com/cat.jpg" } }],
    });
  });

  it("stubs images for a text-only model and reports the degradation", () => {
    const { messages, degraded } = mapOpenAIMessages([{ role: "user", content: [text("see "), png] }], BLOCKED_MODEL);
    expect(messages).toEqual([{ role: "user", content: "see [image omitted: image/png, 41 KB; model has no image input]" }]);
    expect(degraded).toEqual([
      { partType: "image", mediaType: "image/png", bytes: 41 * 1024, role: "user", reason: "model-no-image-input" },
    ]);
  });

  it("stubs an image inside a tool result (no image slot on tool messages)", () => {
    const { messages, degraded } = mapOpenAIMessages(
      [{ role: "tool", toolCallId: "t1", content: [text("shot: "), tinyPng] }],
      IMAGES_ALLOWED,
    );
    expect(messages).toEqual([
      { role: "tool", tool_call_id: "t1", content: "shot: [image omitted: image/png, 1 KB; provider has no image input in tool messages]" },
    ]);
    expect(degraded.map((d) => d.reason)).toEqual(["role-no-image-input"]);
  });
});

describe("seam: LiteLLM image mapping", () => {
  it("text-only messages are unchanged", () => {
    const { messages, degraded } = toLiteLLMMessages(TEXT_ONLY, IMAGES_ALLOWED);
    expect(degraded).toEqual([]);
    expect(messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
      { role: "user", content: "ab" },
      { role: "assistant", content: "calling" },
      { role: "tool", tool_call_id: "t1", content: "result" },
      { role: "assistant", content: "done" },
    ]);
  });

  it("maps a user image to an image_url part", () => {
    const { messages } = toLiteLLMMessages([{ role: "user", content: [tinyPng] }], IMAGES_ALLOWED);
    expect(messages[0]).toEqual({
      role: "user",
      content: [{ type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } }],
    });
  });
});

describe("seam: Ollama image mapping", () => {
  it("text-only messages are unchanged and carry no images key", () => {
    const { messages, degraded } = toOllamaMessages(TEXT_ONLY, IMAGES_ALLOWED);
    expect(degraded).toEqual([]);
    expect(JSON.stringify(messages)).toBe(
      JSON.stringify([
        { role: "system", content: "sys" },
        { role: "user", content: "hello" },
        { role: "user", content: "ab" },
        { role: "assistant", content: "calling", tool_calls: [{ function: { name: "file-read", arguments: { path: "x" } } }] },
        { role: "tool", content: "result" },
        { role: "assistant", content: "done" },
      ]),
    );
  });

  it("maps a base64 user image to the images array (raw base64)", () => {
    const { messages, degraded } = toOllamaMessages([{ role: "user", content: [text("what?"), tinyPng] }], IMAGES_ALLOWED);
    expect(degraded).toEqual([]);
    expect(messages).toEqual([{ role: "user", content: "what?", images: ["iVBORw0KGgo="] }]);
  });

  it("maps a tool-result image to the tool message images array", () => {
    const { messages } = toOllamaMessages([{ role: "tool", toolCallId: "t1", content: [text("shot"), tinyPng] }], IMAGES_ALLOWED);
    expect(messages).toEqual([{ role: "tool", content: "shot", images: ["iVBORw0KGgo="] }]);
  });

  it("stubs a URL image (Ollama does not fetch URLs)", () => {
    const { messages, degraded } = toOllamaMessages([{ role: "user", content: [urlJpeg] }], IMAGES_ALLOWED);
    expect(messages).toEqual([
      { role: "user", content: "[image omitted: image/jpeg, remote url; provider accepts inline base64 images only]" },
    ]);
    expect(degraded.map((d) => d.reason)).toEqual(["url-image-unsupported"]);
  });

  it("stubs images for a non-vision model", () => {
    const { messages, degraded } = toOllamaMessages([{ role: "user", content: [png] }], BLOCKED_MODEL);
    expect(messages).toEqual([{ role: "user", content: "[image omitted: image/png, 41 KB; model has no image input]" }]);
    expect(degraded.length).toBe(1);
  });
});

describe("seam: Gemini image mapping", () => {
  it("text-only contents are unchanged", () => {
    const { contents, degraded } = toGeminiContents(TEXT_ONLY, IMAGES_ALLOWED);
    expect(degraded).toEqual([]);
    expect(contents).toEqual([
      { role: "user", parts: [{ text: "hello" }] },
      { role: "user", parts: [{ text: "a" }, { text: "b" }] },
      { role: "model", parts: [{ text: "calling" }, { functionCall: { name: "file-read", args: { path: "x" } } }] },
      { role: "user", parts: [{ functionResponse: { name: "file-read", response: { content: "result" } } }] },
      { role: "model", parts: [{ text: "done" }] },
    ]);
  });

  it("maps a base64 user image to inlineData in place", () => {
    const { contents } = toGeminiContents([{ role: "user", content: [text("describe"), tinyPng] }], IMAGES_ALLOWED);
    expect(contents).toEqual([
      { role: "user", parts: [{ text: "describe" }, { inlineData: { mimeType: "image/png", data: "iVBORw0KGgo=" } }] },
    ]);
  });

  it("stubs a URL image and an image inside a tool result", () => {
    const { contents, degraded } = toGeminiContents(
      [
        { role: "user", content: [urlJpeg] },
        { role: "tool", toolCallId: "t1", toolName: "screenshot", content: [tinyPng] },
      ],
      IMAGES_ALLOWED,
    );
    expect(contents).toEqual([
      { role: "user", parts: [{ text: "[image omitted: image/jpeg, remote url; provider accepts inline base64 images only]" }] },
      {
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "screenshot",
              response: { content: "[image omitted: image/png, 1 KB; provider has no image input in tool messages]" },
            },
          },
        ],
      },
    ]);
    expect(degraded.map((d) => d.reason)).toEqual(["url-image-unsupported", "role-no-image-input"]);
  });
});
