// Run: bun test packages/core/tests/content-summary.test.ts --timeout 15000
//
// The inline-media rule shared by checkpoints (reasoning kernel-codec), traces
// and run results: inline base64 image/audio parts become a summary text stub;
// URL media, file refs and text are kept; audio transcripts survive.
import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  inlineMediaStub,
  isInlineMediaPart,
  redactInlineMedia,
  summarizeParts,
  type ContentPart,
} from "../src/index.js";

const B64 = "iVBORw0KGgoAAAANSUhEUg==";
const sha12 = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 12);

const IMAGE: ContentPart = { type: "image", source: { type: "base64", media_type: "image/png", data: B64 } };
const URL_IMAGE: ContentPart = { type: "image", source: { type: "url", media_type: "image/jpeg", data: "https://x/y.jpg" } };
const FILE: ContentPart = { type: "file", ref: { uri: "ws://a.pdf", media_type: "application/pdf", bytes: 9 } };
const AUDIO: ContentPart = {
  type: "audio",
  source: { type: "base64", media_type: "audio/wav", data: "UklGRg==" },
  transcript: "hello",
};
const TEXT: ContentPart = { type: "text", text: "t" };

describe("redactInlineMedia", () => {
  it("stubs inline base64 media with kind, MIME type, decoded size and sha256 prefix", () => {
    const out = redactInlineMedia([TEXT, IMAGE]);
    expect(out).toEqual([
      TEXT,
      { type: "text", text: `[image omitted from checkpoint: image/png, 16 bytes, sha256:${sha12(B64)}]` },
    ]);
    expect(JSON.stringify(out)).not.toContain(B64);
  });

  it("keeps URL media and file refs untouched", () => {
    const out = redactInlineMedia([URL_IMAGE, FILE, IMAGE]);
    expect(out[0]).toBe(URL_IMAGE);
    expect(out[1]).toBe(FILE);
    expect(out[2]!.type).toBe("text");
  });

  it("keeps an audio transcript in the stub", () => {
    expect(redactInlineMedia([AUDIO])).toEqual([
      { type: "text", text: `[audio omitted from checkpoint: audio/wav, 4 bytes, sha256:${sha12("UklGRg==")}; transcript: hello]` },
    ]);
  });

  it("returns a list without inline media by reference", () => {
    const textOnly: readonly ContentPart[] = [TEXT, { type: "text", text: "u" }];
    expect(redactInlineMedia(textOnly)).toBe(textOnly);
    const refsOnly: readonly ContentPart[] = [URL_IMAGE, FILE];
    expect(redactInlineMedia(refsOnly)).toBe(refsOnly);
  });

  it("agrees with inlineMediaStub and isInlineMediaPart", () => {
    expect(isInlineMediaPart(IMAGE)).toBe(true);
    expect(isInlineMediaPart(URL_IMAGE)).toBe(false);
    expect(isInlineMediaPart(FILE)).toBe(false);
    expect(isInlineMediaPart({ type: "image" })).toBe(false);
    expect(redactInlineMedia([IMAGE])[0]).toEqual(inlineMediaStub(IMAGE as Extract<ContentPart, { type: "image" }>));
  });
});

describe("summarizeParts", () => {
  it("summarizes non-text parts in order; text contributes nothing", () => {
    expect(summarizeParts([TEXT, IMAGE, FILE])).toEqual([
      { type: "image", media_type: "image/png", bytes: 16, sha256: createHash("sha256").update(B64).digest("hex") },
      { type: "file", media_type: "application/pdf", bytes: 9 },
    ]);
    expect(summarizeParts([TEXT])).toEqual([]);
  });
});
