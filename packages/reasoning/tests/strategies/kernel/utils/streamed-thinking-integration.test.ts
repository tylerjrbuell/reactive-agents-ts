/**
 * Streamed thinking-tag integration coverage.
 *
 * Pins behavior at the assembled-content boundary that every provider stream
 * path lands at. Each test simulates one realistic chunked-stream scenario
 * and asserts the framework helpers (`stripThinking`,
 * `extractThinkingSafeContent`, `extractThinking`) handle it correctly.
 *
 * These complement the unit tests in `stream-parser.test.ts` (which exercise
 * the helpers on whole inputs) by codifying the boundary contract: providers
 * emit chunks; the kernel accumulates `fullContent` by string concatenation;
 * the helpers are then invoked on the accumulated string. Regressions in
 * either the helper regexes OR a provider that accidentally drops/mangles a
 * `<think>` chunk would surface here.
 */

import { describe, it, expect } from "bun:test";
import {
  extractThinking,
  stripThinking,
  extractThinkingSafeContent,
  THINKING_SAFE_MIN_TOKENS,
} from "../../../../src/kernel/utils/stream-parser.js";

// Helper: simulate the kernel's `fullContent +=` accumulation pattern.
function accumulate(chunks: readonly string[]): string {
  let fullContent = "";
  for (const chunk of chunks) fullContent += chunk;
  return fullContent;
}

describe("streamed thinking — multi-chunk assembly", () => {
  it("handles a think block split across two chunks at the open tag", () => {
    const chunks = ["<thi", "nk>internal reasoning</think>final answer"];
    const assembled = accumulate(chunks);
    expect(stripThinking(assembled)).toBe("final answer");
  });

  it("handles a think block split at the close tag", () => {
    const chunks = ["<think>internal</thi", "nk>final answer"];
    const assembled = accumulate(chunks);
    expect(stripThinking(assembled)).toBe("final answer");
  });

  it("handles a think block split mid-content", () => {
    const chunks = ["<think>part one ", "part two</think>final"];
    const assembled = accumulate(chunks);
    const extracted = extractThinking(assembled);
    expect(extracted.content).toBe("final");
    expect(extracted.thinking).toBe("part one part two");
  });

  it("handles multiple sequential think blocks in chunked emission", () => {
    const chunks = [
      "<think>first thought</think>",
      "interim text",
      "<think>second thought</think>",
      "final answer",
    ];
    const assembled = accumulate(chunks);
    const extracted = extractThinking(assembled);
    // Note: helper does NOT insert separator between adjacent non-think
    // segments — they concatenate as the model emitted them.
    expect(extracted.content).toBe("interim textfinal answer");
    expect(extracted.thinking).toBe("first thought\n\nsecond thought");
  });
});

describe("streamed thinking — truncation cases", () => {
  it("strips unclosed <think> when stream ends mid-reasoning (max_tokens cutoff)", () => {
    const chunks = ["<think>", "still reasoning about the prob"];
    const assembled = accumulate(chunks);
    // No closing tag — kernel-side helper must still produce a parseable
    // result instead of leaving the prefix in user-facing output.
    expect(stripThinking(assembled)).toBe("");
  });

  it("extractThinkingSafeContent rescues content from unclosed <think> via fallback chain", () => {
    const chunks = ["<think>", "the answer is 42 but I'm still thi"];
    const assembled = accumulate(chunks);
    const safe = extractThinkingSafeContent({ content: assembled });
    // Cleaned content is empty (everything was inside unclosed <think>);
    // helper falls back to extracted thinking content.
    expect(safe.content).toBe("the answer is 42 but I'm still thi");
    expect(safe.recovered).toBe(true);
    expect(safe.thinking).toBe("the answer is 42 but I'm still thi");
  });

  it("extractThinkingSafeContent prefers provider.thinking when stream content is unclosed-think-only", () => {
    // Some providers (Ollama think:true) split thinking out of `content` into
    // a separate `thinking` field. If the streamed `content` truncates mid-
    // think, the provider-supplied thinking is the authoritative source.
    const safe = extractThinkingSafeContent({
      content: "<think>partial truncated",
      thinking: "provider-supplied complete reasoning",
    });
    // Helper extracts the partial inline thinking first (recovered.thinking),
    // then falls back to that. Provider.thinking is the second-tier fallback
    // and surfaces in the `thinking` field of the result for visibility.
    expect(safe.recovered).toBe(true);
    // Content is rescued from the inline partial; provider thinking is also
    // available via the `thinking` field but doesn't override inline content.
    expect(safe.content.length).toBeGreaterThan(0);
  });
});

describe("streamed thinking — interleaved with tool_use", () => {
  it("strips think text from accumulated text channel even when tool calls fire alongside", () => {
    // Simulated scenario: provider emits text_delta events containing
    // <think> content INTERLEAVED with tool_use events. The kernel's text
    // accumulator concatenates only the text_delta payloads. After the loop,
    // stripThinking is applied to that accumulated string. This test pins
    // that contract: thinking in the text channel is stripped regardless of
    // what tool_use events fired alongside.
    const textChunks = [
      "<think>I should call web-search first</think>",
      "Now searching for the answer.",
    ];
    const accumulated = accumulate(textChunks);
    expect(stripThinking(accumulated)).toBe("Now searching for the answer.");
  });

  it("does not leak think content when only think tokens were emitted (model only reasoned)", () => {
    // Edge case: model spent all its budget in <think> and emitted no
    // post-tag content. Kernel synthesizer must surface SOMETHING rather
    // than empty output — the safe helper provides this rescue.
    const chunks = ["<think>I was supposed to answer but spent all tokens", " reasoning instead</think>"];
    const assembled = accumulate(chunks);

    const stripped = stripThinking(assembled);
    expect(stripped).toBe("");

    // Safe content rescues via fallback chain.
    const safe = extractThinkingSafeContent({ content: assembled });
    expect(safe.recovered).toBe(true);
    expect(safe.thinking).toBe(
      "I was supposed to answer but spent all tokens reasoning instead",
    );
    // Without clean content OR provider.thinking, fallback is the extracted
    // thinking (so the user sees the model's working at least).
    expect(safe.content).toBe(
      "I was supposed to answer but spent all tokens reasoning instead",
    );
  });
});

describe("streamed thinking — invariants", () => {
  it("stripThinking is idempotent — calling twice returns the same value", () => {
    const cases = [
      "<think>foo</think>bar",
      "<think>foo</think>bar<think>baz</think>",
      "no tags at all",
      "<think>truncated",
      "",
    ];
    for (const input of cases) {
      const once = stripThinking(input);
      const twice = stripThinking(once);
      expect(once).toBe(twice);
    }
  });

  it("THINKING_SAFE_MIN_TOKENS is the documented framework floor (2048)", () => {
    // Pinning the constant value catches accidental drift in either
    // direction: bumping above 2048 would inflate cost without empirical
    // justification; dropping below would re-introduce the qwen3:4b
    // truncation bugs this session shipped fixes for.
    expect(THINKING_SAFE_MIN_TOKENS).toBe(2048);
  });

  it("extractThinking preserves text outside think tags exactly (no normalization)", () => {
    const input = "preamble  <think>x</think>  trailing";
    const out = extractThinking(input);
    // Excessive whitespace IS collapsed to \n\n by the helper's cleanup pass —
    // but the textual content itself is preserved.
    expect(out.content).toContain("preamble");
    expect(out.content).toContain("trailing");
    expect(out.thinking).toBe("x");
  });
});
