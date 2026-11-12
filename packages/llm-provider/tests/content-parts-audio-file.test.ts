// Audio and file parts at the provider boundary: wire path or honest, deterministic
// degrade, never a silent drop. Zero-token: pure wire mappers, no network or keys.
import { describe, it, expect } from "bun:test";
import { Effect, Logger, HashMap } from "effect";
import type { ContentBlock, LLMMessage } from "../src/types.js";
import {
  FILE_INLINE_MAX_BYTES,
  degradedStub,
  emitContentDegradations,
  mediaPlaceholder,
  resolveContentPolicy,
  type ContentPolicy,
} from "../src/content-parts.js";
import { messageContentToString } from "../src/exchange-projection.js";
import { resolveCapability } from "../src/capability-resolver.js";
import { mapOpenAIMessages, OPENAI_INPUT_MODALITIES } from "../src/providers/openai-messages.js";
import { toLiteLLMMessages } from "../src/providers/litellm.js";
import { toAnthropicMessages, ANTHROPIC_INPUT_MODALITIES } from "../src/providers/anthropic-messages.js";
import { toGeminiContents, GEMINI_INPUT_MODALITIES } from "../src/providers/gemini-messages.js";
import { toOllamaMessages, OLLAMA_INPUT_MODALITIES } from "../src/providers/ollama-messages.js";

// 120 KB decoded: 120*1024 = 122880 bytes -> 163840 base64 chars, no pad.
const WAV_120KB = "A".repeat(163_840);
const wav = (extra: { transcript?: string } = {}): ContentBlock => ({
  type: "audio",
  source: { type: "base64", media_type: "audio/wav", data: WAV_120KB },
  ...extra,
});
const text = (t: string): ContentBlock => ({ type: "text", text: t });
const dataUri = (mediaType: string, body: string): string =>
  `data:${mediaType};base64,${Buffer.from(body, "utf8").toString("base64")}`;
const file = (uri: string, media_type: string, name?: string): ContentBlock => ({
  type: "file",
  ref: { uri, media_type, ...(name !== undefined ? { name } : {}) },
});

const SEND: ContentPolicy = { imageBlocked: undefined, audio: "send" };
const NO_AUDIO_MODEL: ContentPolicy = { imageBlocked: undefined, audio: "model-no-audio-input" };
const NO_AUDIO_STUB = "[audio omitted: audio/wav, 120 KB; model has no audio input]";

describe("seam: Capability.supportsAudioIn resolution", () => {
  it("static rows: gemini and OpenAI audio models accept audio, other rows do not", () => {
    expect(resolveCapability("gemini", "gemini-2.5-flash").supportsAudioIn).toBe(true);
    expect(resolveCapability("openai", "gpt-4o-audio-preview").supportsAudioIn).toBe(true);
    expect(resolveCapability("openai", "gpt-4o-audio-preview").supportsVision).toBe(false);
    expect(resolveCapability("openai", "gpt-4o").supportsAudioIn).toBeUndefined();
    expect(resolveCapability("anthropic", "claude-sonnet-4-5").supportsAudioIn).toBeUndefined();
  });
});

describe("seam: resolveContentPolicy audio admission", () => {
  it("a provider that declares no audio carries no audio verdict (image policy unchanged)", () => {
    expect(resolveContentPolicy(["text", "image"], { supportsVision: true, source: "static-table" })).toEqual({
      imageBlocked: undefined,
    });
    expect(resolveContentPolicy(ANTHROPIC_INPUT_MODALITIES).audio).toBeUndefined();
  });

  it("sends audio only on an authoritative row with supportsAudioIn", () => {
    const cap = { supportsVision: false, supportsAudioIn: true as const };
    expect(resolveContentPolicy(OPENAI_INPUT_MODALITIES, { ...cap, source: "static-table" }).audio).toBe("send");
    expect(resolveContentPolicy(OPENAI_INPUT_MODALITIES, { ...cap, source: "probe" }).audio).toBe("send");
  });

  it("an authoritative row without audio blocks it; a guessed row is unverified", () => {
    expect(
      resolveContentPolicy(OPENAI_INPUT_MODALITIES, { supportsVision: true, source: "static-table" }).audio,
    ).toBe("model-no-audio-input");
    for (const source of ["fallback", "inferred", "user"] as const) {
      expect(
        resolveContentPolicy(OPENAI_INPUT_MODALITIES, { supportsVision: true, supportsAudioIn: true, source }).audio,
      ).toBe("model-audio-unverified");
    }
    expect(resolveContentPolicy(OPENAI_INPUT_MODALITIES).audio).toBe("model-audio-unverified");
  });
});

describe("seam: audio degradation stub", () => {
  it("renders the deterministic stub, keeping a transcript", () => {
    const d = { partType: "audio", mediaType: "audio/wav", bytes: 120 * 1024, role: "user", reason: "model-no-audio-input" } as const;
    expect(degradedStub(d)).toBe(NO_AUDIO_STUB);
    expect(degradedStub({ ...d, transcript: "turn left" })).toBe(
      "[audio omitted: audio/wav, 120 KB; model has no audio input; transcript: turn left]",
    );
    expect(degradedStub({ ...d, reason: "role-no-audio-input", role: "assistant" })).toBe(
      "[audio omitted: audio/wav, 120 KB; provider has no audio input in assistant messages]",
    );
  });

  it("emits a content-part-degraded fact with partType audio and file", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const capture = Logger.make(({ annotations }) => {
      seen.push(Object.fromEntries(HashMap.toEntries(annotations)));
    });
    await Effect.runPromise(
      emitContentDegradations("openai", "gpt-x", [
        { partType: "audio", mediaType: "audio/wav", bytes: 8, role: "user", reason: "model-no-audio-input" },
        { partType: "file", mediaType: "application/pdf", bytes: undefined, role: "user", reason: "file-not-text" },
      ]).pipe(Effect.provide(Logger.replace(Logger.defaultLogger, capture))),
    );
    expect(seen.map((s) => [s.partType, s.reason])).toEqual([
      ["audio", "model-no-audio-input"],
      ["file", "file-not-text"],
    ]);
  });
});

describe("seam: OpenAI audio mapping", () => {
  it("maps wav audio to an input_audio part on an audio-capable model", () => {
    const { messages, degraded } = mapOpenAIMessages([{ role: "user", content: [text("listen"), wav()] }], SEND);
    expect(degraded).toEqual([]);
    expect(messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "listen" },
          { type: "input_audio", input_audio: { data: WAV_120KB, format: "wav" } },
        ],
      },
    ]);
  });

  it("maps mpeg audio to format mp3", () => {
    const mp3: ContentBlock = { type: "audio", source: { type: "base64", media_type: "audio/mpeg", data: "QUJD" } };
    const { messages } = mapOpenAIMessages([{ role: "user", content: [mp3] }], SEND);
    expect(messages[0]).toEqual({
      role: "user",
      content: [{ type: "input_audio", input_audio: { data: "QUJD", format: "mp3" } }],
    });
  });

  it("a model without audio gets the stub in place and a degradation", () => {
    const { messages, degraded } = mapOpenAIMessages([{ role: "user", content: [text("hi "), wav()] }], NO_AUDIO_MODEL);
    expect(messages).toEqual([{ role: "user", content: `hi ${NO_AUDIO_STUB}` }]);
    expect(degraded).toEqual([
      { partType: "audio", mediaType: "audio/wav", bytes: 120 * 1024, role: "user", reason: "model-no-audio-input" },
    ]);
  });

  it("falls back to the transcript text when audio cannot be sent", () => {
    const { messages, degraded } = mapOpenAIMessages(
      [{ role: "user", content: [wav({ transcript: "turn left" })] }],
      NO_AUDIO_MODEL,
    );
    expect(messages).toEqual([
      {
        role: "user",
        content: "[audio omitted: audio/wav, 120 KB; model has no audio input; transcript: turn left]",
      },
    ]);
    expect(degraded[0]?.transcript).toBe("turn left");
  });

  it("stubs a format OpenAI rejects, a URL source, and a non-user role", () => {
    const ogg: ContentBlock = { type: "audio", source: { type: "base64", media_type: "audio/ogg", data: "QUJD" } };
    const url: ContentBlock = { type: "audio", source: { type: "url", media_type: "audio/wav", data: "https://x/a.wav" } };
    const fmt = mapOpenAIMessages([{ role: "user", content: [ogg] }], SEND);
    expect(fmt.degraded[0]?.reason).toBe("audio-format-unsupported");
    const u = mapOpenAIMessages([{ role: "user", content: [url] }], SEND);
    expect(u.degraded[0]?.reason).toBe("url-audio-unsupported");
    expect(u.messages[0]).toEqual({
      role: "user",
      content: "[audio omitted: audio/wav, remote url; provider accepts inline base64 audio only]",
    });
    const asst = mapOpenAIMessages([{ role: "assistant", content: [wav()] }], SEND);
    expect(asst.degraded[0]?.reason).toBe("role-no-audio-input");
  });

  it("text-only requests are unchanged", () => {
    const { messages } = mapOpenAIMessages([{ role: "user", content: [text("a"), text("b")] }], SEND);
    expect(messages).toEqual([{ role: "user", content: "ab" }]);
  });
});

describe("seam: LiteLLM declares no audio", () => {
  it("degrades audio to a stub (provider-no-audio-input) even with an audio-capable row", () => {
    const policy = resolveContentPolicy(["text", "image"], { supportsVision: false, supportsAudioIn: true, source: "static-table" });
    const { messages, degraded } = toLiteLLMMessages([{ role: "user", content: [wav()] }], policy);
    expect(degraded[0]?.reason).toBe("provider-no-audio-input");
    expect(messages[0]).toEqual({
      role: "user",
      content: "[audio omitted: audio/wav, 120 KB; provider has no audio input]",
    });
  });
});

describe("seam: Gemini audio mapping", () => {
  const gemini = resolveContentPolicy(GEMINI_INPUT_MODALITIES, resolveCapability("gemini", "gemini-2.5-flash"));

  it("maps audio to inlineData on a user turn", () => {
    expect(gemini.audio).toBe("send");
    const ogg: ContentBlock = { type: "audio", source: { type: "base64", media_type: "audio/ogg", data: "QUJD" } };
    const { contents, degraded } = toGeminiContents([{ role: "user", content: [text("q"), ogg] }], gemini);
    expect(degraded).toEqual([]);
    expect(contents).toEqual([
      { role: "user", parts: [{ text: "q" }, { inlineData: { mimeType: "audio/ogg", data: "QUJD" } }] },
    ]);
  });

  it("stubs audio on a model turn, an unknown format and a URL", () => {
    const model = toGeminiContents([{ role: "assistant", content: [wav()] }], gemini);
    expect(model.degraded[0]?.reason).toBe("role-no-audio-input");
    const amr: ContentBlock = { type: "audio", source: { type: "base64", media_type: "audio/amr", data: "QUJD" } };
    expect(toGeminiContents([{ role: "user", content: [amr] }], gemini).degraded[0]?.reason).toBe(
      "audio-format-unsupported",
    );
    const url: ContentBlock = { type: "audio", source: { type: "url", media_type: "audio/wav", data: "https://x/a.wav" } };
    const u = toGeminiContents([{ role: "user", content: [url] }], gemini);
    expect(u.degraded[0]?.reason).toBe("url-audio-unsupported");
    expect(u.contents[0]?.parts[0]).toEqual({
      text: "[audio omitted: audio/wav, remote url; provider accepts inline base64 audio only]",
    });
  });

  it("an unverified (guessed) model row degrades audio instead of risking it", () => {
    const guessed = resolveContentPolicy(GEMINI_INPUT_MODALITIES, resolveCapability("gemini", "gemini-unknown-x"));
    const r = toGeminiContents([{ role: "user", content: [wav()] }], guessed);
    expect(r.degraded[0]?.reason).toBe("model-audio-unverified");
    expect(r.contents[0]?.parts[0]).toEqual({
      text: "[audio omitted: audio/wav, 120 KB; model audio input is unverified]",
    });
  });
});

describe("seam: Anthropic and Ollama have no audio wire path", () => {
  it("Anthropic turns audio into a text block plus a degradation instead of passing it through", () => {
    const policy = resolveContentPolicy(ANTHROPIC_INPUT_MODALITIES, { supportsVision: true, source: "static-table" });
    const { messages, degraded } = toAnthropicMessages([{ role: "user", content: [text("hi"), wav()] }], policy);
    expect(messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "hi" },
          { type: "text", text: "[audio omitted: audio/wav, 120 KB; provider has no audio input]" },
        ],
      },
    ]);
    expect(degraded.map((d) => [d.partType, d.reason])).toEqual([["audio", "provider-no-audio-input"]]);
  });

  it("Ollama keeps the transcript in the stub even when the probe says the model hears audio", () => {
    const policy = resolveContentPolicy(OLLAMA_INPUT_MODALITIES, { supportsVision: true, supportsAudioIn: true, source: "probe" });
    const { messages, degraded } = toOllamaMessages(
      [{ role: "user", content: [wav({ transcript: "hello there" })] }],
      policy,
    );
    expect(messages).toEqual([
      {
        role: "user",
        content: "[audio omitted: audio/wav, 120 KB; provider has no audio input; transcript: hello there]",
      },
    ]);
    expect(degraded.length).toBe(1);
  });
});

describe("seam: file parts", () => {
  const all: ReadonlyArray<readonly [string, (m: readonly LLMMessage[]) => unknown]> = [
    ["openai", (m) => mapOpenAIMessages(m, SEND)],
    ["gemini", (m) => toGeminiContents(m, { imageBlocked: undefined })],
    ["anthropic", (m) => toAnthropicMessages(m, { imageBlocked: undefined })],
    ["ollama", (m) => toOllamaMessages(m, { imageBlocked: undefined })],
  ];

  it("inlines a text-like data-URI file behind its label, on every provider, with no degradation", () => {
    const f = file(dataUri("text/csv", "a,b\n1,2"), "text/csv", "t.csv");
    for (const [, run] of all) {
      const out = JSON.stringify(run([{ role: "user", content: [text("read: "), f] }]));
      expect(out).toContain("[file: text/csv, t.csv]\\na,b\\n1,2");
      expect(out).not.toContain("base64,");
      expect(out).toContain('"degraded":[]');
    }
  });

  it("cuts an oversized inline file at the documented cap with a visible marker", () => {
    const big = "x".repeat(FILE_INLINE_MAX_BYTES + 100);
    const { messages } = mapOpenAIMessages([{ role: "user", content: [file(dataUri("text/plain", big), "text/plain")] }], SEND);
    const content = (messages[0] as { content: string }).content;
    expect(content).toContain(`[truncated: first ${FILE_INLINE_MAX_BYTES} of ${FILE_INLINE_MAX_BYTES + 100} bytes]`);
    expect(content.length).toBeLessThan(FILE_INLINE_MAX_BYTES + 200);
  });

  it("stubs a binary file and a non-inline uri with a degradation, never echoing a data URI", () => {
    const pdf = file(dataUri("application/pdf", "%PDF-1.4"), "application/pdf", "r.pdf");
    const a = mapOpenAIMessages([{ role: "user", content: [pdf] }], SEND);
    expect(a.degraded.map((d) => [d.partType, d.reason])).toEqual([["file", "file-not-text"]]);
    expect(JSON.stringify(a.messages)).not.toContain("base64");
    expect((a.messages[0] as { content: string }).content).toBe(
      "[file omitted: application/pdf, r.pdf; provider has no file input and the file is not text]",
    );

    const path = file("workspace/notes.md", "text/markdown", "notes.md");
    const b = toAnthropicMessages([{ role: "user", content: [path] }], { imageBlocked: undefined });
    expect(b.degraded.map((d) => [d.partType, d.reason])).toEqual([["file", "file-not-inlinable"]]);
    expect(JSON.stringify(b.messages)).toContain(
      "[file omitted: text/markdown, notes.md at workspace/notes.md; provider has no file input and the file is not inline data]",
    );
  });
});

describe("seam: audio and file replay placeholders", () => {
  it("flatten to a hashed placeholder, not empty", () => {
    const flat = messageContentToString([
      text("a"),
      { type: "audio", source: { type: "base64", media_type: "audio/wav", data: "QUJD" } },
      file("workspace/x.md", "text/markdown"),
    ]);
    expect(flat).toBe(
      `a${mediaPlaceholder("audio", { media_type: "audio/wav", data: "QUJD" })}${mediaPlaceholder("file", { media_type: "text/markdown", data: "workspace/x.md" })}`,
    );
    expect(flat).toMatch(/^a\[audio:audio\/wav:[0-9a-f]{12}\]\[file:text\/markdown:[0-9a-f]{12}\]$/);
  });
});
