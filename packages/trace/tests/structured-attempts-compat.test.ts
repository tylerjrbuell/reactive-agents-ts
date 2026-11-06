// Run: bun test packages/trace/tests/structured-attempts-compat.test.ts --timeout 15000
/**
 * Structured-call attempt split (H3 instrument gap 1, 2026-11-06).
 *
 * `LLMExchangeEvent.response.attempts` is additive optional: old exchanges keep
 * loading, new ones carrying the split are valid, and `toTraceEvent` copies
 * the split verbatim from the bus event.
 */
import { describe, it, expect } from "bun:test";
import { isTraceEvent } from "../src/events.js";
import { toTraceEvent } from "../src/normalize.js";
import type { AgentEvent } from "@reactive-agents/core";

const attempts = [
  { attempt: 0, outputTokens: 10096, stopReason: "max_tokens", thinkingChars: 30000, parsed: false },
  { attempt: 1, outputTokens: 1500, stopReason: "end_turn", parsed: true },
];

const OLD_FORMAT = {
  runId: "run-1",
  timestamp: 1000,
  iter: 0,
  seq: 4,
  kind: "llm-exchange",
  provider: "ollama",
  model: "qwen3:4b",
  requestKind: "completeStructured",
  systemPrompt: "sys",
  messages: [{ role: "user", content: "plan" }],
  toolSchemaNames: [],
  response: { content: "{}", tokensOut: 11596, durationMs: 99000 },
};

describe("structured attempts back-compat", () => {
  it("old completeStructured exchange (no attempts) still passes isTraceEvent", () => {
    expect(isTraceEvent(OLD_FORMAT)).toBe(true);
  }, 15000);

  it("new exchange carrying the attempt split passes isTraceEvent", () => {
    expect(isTraceEvent({ ...OLD_FORMAT, response: { ...OLD_FORMAT.response, attempts } })).toBe(true);
  }, 15000);

  it("toTraceEvent copies the attempt split verbatim", () => {
    const raw: AgentEvent = {
      _tag: "LLMExchangeEmitted",
      taskId: "run-1",
      timestamp: 1000,
      iteration: 0,
      provider: "ollama",
      model: "qwen3:4b",
      requestKind: "completeStructured",
      systemPrompt: "sys",
      messages: [{ role: "user", content: "plan" }],
      toolSchemaNames: [],
      response: { content: "{}", tokensOut: 11596, stopReason: "end_turn", attempts },
    };
    const ev = toTraceEvent(raw, 4);
    expect(ev?.kind).toBe("llm-exchange");
    const resp = ev !== null && ev !== undefined && ev.kind === "llm-exchange" ? ev.response : undefined;
    expect(resp?.attempts).toEqual(attempts);
    expect(isTraceEvent(ev)).toBe(true);
  }, 15000);
});
