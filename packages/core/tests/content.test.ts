// Run: bun test packages/core/tests/content.test.ts --timeout 15000
import { describe, expect, it } from "bun:test";
import { Schema } from "effect";
import {
  ContentPartSchema,
  contentParts,
  contentText,
  normalizeContent,
  type ContentPart,
  type MessageContent,
} from "../src/index.js";

const img: ContentPart = { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBOR" } };

describe("typed content parts", () => {
  it("text-only parts collapse to one string (canonical form keeps replay bytes)", () => {
    expect(normalizeContent([{ type: "text", text: "a" }, { type: "text", text: "b" }])).toBe("ab");
    expect(normalizeContent([])).toBe("");
  });

  it("content with a non-text part stays as parts", () => {
    const c: MessageContent = [{ type: "text", text: "look:" }, img];
    expect(normalizeContent(c)).toBe(c);
  });

  it("normalizeContent is idempotent", () => {
    const samples: MessageContent[] = ["x", [{ type: "text", text: "y" }], [img], [{ type: "text", text: "z" }, img]];
    for (const s of samples) {
      const once = normalizeContent(s);
      expect(normalizeContent(once)).toEqual(once);
    }
  });

  it("contentText joins text parts with no separator and skips media", () => {
    expect(contentText("plain")).toBe("plain");
    expect(contentText([{ type: "text", text: "a" }, img, { type: "text", text: "b" }])).toBe("ab");
  });

  it("contentParts lifts a string into one text part", () => {
    expect(contentParts("hi")).toEqual([{ type: "text", text: "hi" }]);
    expect(contentParts("")).toEqual([]);
    expect(contentParts([img])).toEqual([img]);
  });

  it("schema decodes every part kind and rejects unknown kinds", () => {
    const decode = Schema.decodeUnknownSync(ContentPartSchema);
    expect(decode(img)).toEqual(img);
    expect(decode({ type: "audio", source: { type: "url", media_type: "audio/wav", data: "https://x/a.wav" }, transcript: "hi" }).type).toBe("audio");
    expect(decode({ type: "file", ref: { uri: "file:///w/notes.md", media_type: "text/markdown" } }).type).toBe("file");
    expect(() => decode({ type: "video", data: "x" })).toThrow();
  });
});
