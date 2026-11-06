// Run: bun test packages/reasoning/tests/kernel/seam-content-parts-readers.test.ts --timeout 15000
//
// Plan 9 Phase 4 stage D2 (principle 8: media must not silently vanish inside
// the kernel). Pins the readers D1 left open:
//  1. from-kernel-state records an assistant thought made of parts (it was
//     dropped by a `typeof content === "string"` gate).
//  2. Compaction and the finalize projection trace count each non-text part at
//     the fixed MEDIA_PART_CHARS (they counted media as 0 chars).
//  3. The thought-event prompt trace and the ContextSynthesized payload flatten
//     LLMMessage blocks through llm-provider's messageContentToString (they kept
//     only `text` blocks, so tool-use and image blocks read as "").
import { describe, it, expect } from "bun:test";
import { contentText, type ContentPart } from "@reactive-agents/core";
import { messageContentToString, type LLMMessage } from "@reactive-agents/llm-provider";
import { fromKernelState } from "../../src/assembly/from-kernel-state.js";
import { compact } from "../../src/assembly/compaction.js";
import { MEDIA_PART_CHARS, contentChars } from "../../src/assembly/content-chars.js";
import { project } from "../../src/assembly/project.js";
import { EventLog } from "../../src/assembly/event-log.js";
import { ResultStore } from "../../src/assembly/result-store.js";
import { resolveCapability } from "../../src/assembly/capability.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";
import { initialKernelState, transitionState } from "../../src/kernel/state/kernel-state.js";
import { toTraceMessages } from "../../src/kernel/capabilities/reason/normalize-think-response.js";
import { llmMessageToSynthesisPayload } from "../../src/kernel/state/kernel-hooks.js";

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const IMAGE_PART: ContentPart = { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_1PX } };

describe("D2: assistant thoughts made of parts survive from-kernel-state", () => {
  const base = initialKernelState({ maxIterations: 3, strategy: "reactive", kernelType: "react" });
  const run = (assistant: ContentPart[] | string) =>
    fromKernelState(
      transitionState(base, {
        messages: [
          { role: "user", content: "Describe the image." },
          { role: "assistant", content: assistant },
        ],
      }),
      CONTEXT_PROFILES.mid,
      { system: "P" },
      { schemas: [] },
    ).log.byKind("thought");

  it("a parts thought with a media part is recorded with its text and parts", () => {
    const parts: ContentPart[] = [{ type: "text", text: "I see " }, IMAGE_PART];
    expect(run(parts)).toEqual([{ kind: "thought", text: "I see ", parts }]);
  });

  it("text-only parts collapse to a string thought (canonical form, no parts)", () => {
    expect(run([{ type: "text", text: "a" }, { type: "text", text: "b" }])).toEqual([{ kind: "thought", text: "ab" }]);
  });

  it("string thoughts are unchanged (blank ones still skipped)", () => {
    expect(run("plan")).toEqual([{ kind: "thought", text: "plan" }]);
    expect(run("  ")).toEqual([]);
  });
});

describe("D2: media parts count at a fixed per-part cost", () => {
  it("MEDIA_PART_CHARS is 4,000 chars (~1,000 tokens at 4 chars/token), independent of byte size", () => {
    expect(MEDIA_PART_CHARS).toBe(4_000);
    expect(contentChars("abc")).toBe(3);
    expect(contentChars([{ type: "text", text: "ab" }, IMAGE_PART])).toBe(2 + MEDIA_PART_CHARS);
    const big: ContentPart = { type: "image", source: { type: "base64", media_type: "image/png", data: "A".repeat(50_000) } };
    expect(contentChars([big])).toBe(MEDIA_PART_CHARS);
    expect(
      contentChars([
        { type: "audio", source: { type: "base64", media_type: "audio/wav", data: "AAAA" } },
        { type: "file", ref: { uri: "file:///r.pdf", media_type: "application/pdf" } },
      ]),
    ).toBe(2 * MEDIA_PART_CHARS);
  });

  it("compaction: a thread whose text fits but whose images do not is compacted", () => {
    const result = compact({
      messages: [
        { role: "user", content: "goal" },
        { role: "user", content: [IMAGE_PART] },
        { role: "user", content: "tail" },
      ],
      limitChars: 100,
      resultInfo: new Map(),
    });
    expect(result.attempted).toBe(true);
    expect(result.shrank).toBe(true);
    expect(result.droppedBlocks).toBe(1);
    expect(result.messages.some((m) => typeof m.content !== "string")).toBe(false);
  });

  it("finalize: the projection trace counts the image part in chars", () => {
    const log = new EventLog().append({
      kind: "goal",
      text: "look",
      parts: [{ type: "text", text: "look" }, IMAGE_PART],
    });
    const cap = resolveCapability({ window: 8000, outputBudget: 1000, dialect: "native-fc", tier: "local" });
    const { request, trace } = project({ log, capability: cap, store: new ResultStore(), persona: { system: "P" }, tools: { schemas: [] } });
    const textChars = request.messages.reduce((n, m) => n + contentText(m.content).length, 0);
    expect(trace.projection?.chars).toBe(request.systemPrompt.length + textChars + MEDIA_PART_CHARS);
    expect(trace.projection?.sections.find((s) => s.name === "evidence")?.chars).toBe(textChars + MEDIA_PART_CHARS);
    // The goal turn's trace record carries the same size.
    expect(trace.messages[0]).toMatchObject({ role: "user", chars: "look".length + MEDIA_PART_CHARS });
  });
});

describe("D2: LLMMessage readers flatten through messageContentToString", () => {
  const thread: LLMMessage[] = [
    { role: "user", content: "hi" },
    {
      role: "assistant",
      content: [
        { type: "text", text: "plan" },
        { type: "tool_use", id: "c1", name: "web-search", input: { q: "x" } },
      ],
    },
    { role: "user", content: [{ type: "text", text: "look" }, IMAGE_PART] },
  ];

  it("the thought prompt trace is the llm-exchange projection (tool-use blocks keep a marker)", () => {
    const out = toTraceMessages(thread);
    expect(out).toEqual(thread.map((m) => ({ role: m.role, content: messageContentToString(m.content) })));
    expect(out[1]!.content).toBe("plan[tool_use:web-search]");
  });

  it("the ContextSynthesized payload uses the same projection; empty text stays null", () => {
    expect(llmMessageToSynthesisPayload(thread[1]!)).toEqual({ role: "assistant", content: "plan[tool_use:web-search]" });
    expect(llmMessageToSynthesisPayload({ role: "assistant", content: [{ type: "tool_use", id: "c2", name: "t", input: {} }] })).toEqual({
      role: "assistant",
      content: "[tool_use:t]",
    });
    expect(llmMessageToSynthesisPayload({ role: "assistant", content: [{ type: "text", text: "  " }] })).toEqual({ role: "assistant", content: null });
    expect(llmMessageToSynthesisPayload({ role: "user", content: "s" })).toEqual({ role: "user", content: "s" });
  });
});
