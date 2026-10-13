// Run: bun test packages/trace/tests/thinking-forensics-compat.test.ts --timeout 15000
/**
 * W1.4 forensics back-compatibility pins (controller ruling #3).
 *
 * The additive-optional `thinkingChars` / `thinkingPreview` fields landed on
 * `LLMExchangeEvent.response`. The law these tests enforce:
 *   1. `isTraceEvent`'s REQUIRED_FIELDS_BY_KIND gained NOTHING — every
 *      `llm-exchange` line recorded BEFORE the fields existed must keep
 *      loading byte-for-byte.
 *   2. A new-format exchange carrying the fields is equally valid.
 *   3. `toTraceEvent` copies the response payload VERBATIM, so forensics
 *      emitted upstream survive normalization without a trace-side edit.
 */
import { describe, it, expect } from "bun:test";
import { isTraceEvent } from "../src/events.js";
import { toTraceEvent } from "../src/normalize.js";
import type { AgentEvent } from "@reactive-agents/core";

const baseFields = { runId: "run-1", timestamp: 1000, iter: 2, seq: 7 };

/** An llm-exchange exactly as recorded before W1.4 (no thinking keys). */
const OLD_FORMAT = {
  ...baseFields,
  kind: "llm-exchange",
  provider: "ollama",
  model: "qwen3:4b",
  requestKind: "stream",
  systemPrompt: "sys",
  messages: [{ role: "user", content: "hi" }],
  toolSchemaNames: [],
  response: { content: "Sure", tokensIn: 100, tokensOut: 5, durationMs: 900 },
};

describe("W1.4 thinking-forensics back-compat", () => {
  it("old-format llm-exchange (no thinking fields) still passes isTraceEvent", () => {
    expect(isTraceEvent(OLD_FORMAT)).toBe(true);
  }, 15000);

  it("new-format llm-exchange (with thinking forensics) also passes isTraceEvent", () => {
    const ev = {
      ...OLD_FORMAT,
      response: {
        ...OLD_FORMAT.response,
        thinkingChars: 500,
        thinkingPreview: "T".repeat(240),
      },
    };
    expect(isTraceEvent(ev)).toBe(true);
  }, 15000);

  it("toTraceEvent copies thinking forensics verbatim from the bus event", () => {
    // Both sides of the wire now DECLARE the forensics fields (core transit
    // type since 91e8d6006, canonical trace schema in events.ts); normalize
    // copies `response` wholesale, so they arrive on the recorded event
    // untouched.
    const responsePayload = {
      content: "Sure",
      tokensIn: 100,
      tokensOut: 5,
      thinkingChars: 1800,
      thinkingPreview: "reasoning prefix",
    };
    const raw: AgentEvent = {
      _tag: "LLMExchangeEmitted",
      taskId: "run-1",
      timestamp: 1000,
      iteration: 2,
      provider: "ollama",
      model: "qwen3:4b",
      requestKind: "stream",
      systemPrompt: "sys",
      messages: [{ role: "user", content: "hi" }],
      toolSchemaNames: [],
      response: responsePayload,
    };
    const ev = toTraceEvent(raw, 3);
    expect(ev?.kind).toBe("llm-exchange");
    const resp = (ev as { response?: Record<string, unknown> }).response ?? {};
    expect(resp.thinkingChars).toBe(1800);
    expect(resp.thinkingPreview).toBe("reasoning prefix");
    // And the recorded event is a valid TraceEvent.
    expect(isTraceEvent(ev)).toBe(true);
  }, 15000);

  it("REQUIRED_FIELDS_BY_KIND for llm-exchange did NOT gain the new fields (pin via rejection)", () => {
    // An llm-exchange MISSING `response` must be rejected (response stays a
    // required field); one MISSING the new optional fields must be accepted —
    // i.e. the required-set is exactly the pre-W1.4 set.
    const { response: _omitted, ...noResponse } = OLD_FORMAT;
    expect(isTraceEvent(noResponse)).toBe(false);
    const { thinkingChars: _tc, thinkingPreview: _tp, ...oldResp } = {
      ...OLD_FORMAT.response,
      thinkingChars: 500,
      thinkingPreview: "x",
    };
    expect(isTraceEvent({ ...OLD_FORMAT, response: oldResp })).toBe(true);
  }, 15000);
});
