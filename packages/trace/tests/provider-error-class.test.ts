// Provider sub-cause keyed on the structural error class (2026-11-10).
//
// `provider-error-lines-2026-11-10.json` holds real event lines from
// ~/.reactive-agents/traces: per run, the run-started, the last failed
// llm-exchange, the terminal_decision guard and run-completed. Free text the
// provider rule does not read is scrubbed (task, system prompt, messages,
// output, thinking preview, Groq org ids, and one run-completed.error that was
// model prose). Every errorClass field and provider message is verbatim.
import { describe, it, expect } from "bun:test";
import { analyzeCause, isTraceEvent } from "../src/index.js";
import type { Trace, TraceEvent } from "../src/index.js";
import lines from "./fixtures/provider-error-lines-2026-11-10.json";
import { mk } from "./fixtures/mk-event.js";

const real = (runId: keyof typeof lines): Trace => {
  const events: TraceEvent[] = lines[runId].filter((e: unknown): e is TraceEvent => isTraceEvent(e));
  expect(events.length).toBe(lines[runId].length);
  return { runId, events };
};

describe("provider sub-cause on real traces", () => {
  // [runId, expected subCause, what the run carries, what it read as before 2026-11-10]
  const cases: readonly (readonly [keyof typeof lines, string, string])[] = [
    ["01M7320F4K6SANX75DKRWJXBKC", "malformed-output", "Ollama 'XML syntax error ... closed by </parameter>', tag LLMError (was: no sub-cause)"],
    ["01M743QE2VN8J0XBD5HN45D522", "malformed-output", "Ollama 'XML syntax error ...: unexpected EOF', tag LLMRateLimitError (was: rate)"],
    ["01M73GNDMGG0TMZD9JS78NASAC", "malformed-output", "XML error only in the llm-exchange message, tag LLMRateLimitError (was: rate)"],
    ["01M6MM8BW9446ZYHP7RRNH8V49", "malformed-output", "Groq 'Tool call validation failed', tag LLMError (was: no sub-cause)"],
    ["01M6FE0V9F53NZ6F10STT7AD26", "token-rate-exceeded", "Groq 413 ITPM, no class at all (was: context-overflow)"],
    ["01M6MN3D526QNJ3XT9BJ1MF4YH", "token-rate-exceeded", "Groq 429 OTPM, tag LLMRateLimitError (was: rate)"],
    ["01M6RHEDB9X7NNM78P6QGAG668", "token-rate-exceeded", "Groq 413 TPM, tag LLMContextOverflowError (was: context-overflow)"],
    ["01M6FD60JH9SSWXD8QQ3JYN5YJ", "quota", "control: Anthropic credit balance, unchanged"],
  ];
  for (const [runId, sub, why] of cases) {
    it(`${runId} => provider-error/${sub} (${why})`, () => {
      const c = analyzeCause(real(runId));
      expect(c).toMatchObject({ cause: "provider-error", subCause: sub, confidence: "decisive" });
    });
  }

  it("evidence names the basis: a message shape, not the stale tag", () => {
    const c = analyzeCause(real("01M743QE2VN8J0XBD5HN45D522"));
    const detail = c.evidence.map((e) => e.detail).join(" | ");
    expect(detail).toContain("errorClass=LLMRateLimitError");
    expect(detail).toContain("subCause from message shape");
  });
});

// ── Synthetic: structural class precedence ─────────────────────────────────────
let seq = 0;
const base = () => ({ runId: "r1", iter: 1, seq: seq++, timestamp: 1000 + seq });
const started = () => mk({ ...base(), iter: -1, kind: "run-started", task: "t", model: "m", provider: "groq", config: {} });
const terminal = (meta: Record<string, unknown> = {}) =>
  mk({ ...base(), kind: "guard-fired", guard: "terminal_decision", outcome: "terminate", reason: "llm_error", metadata: { terminatedBy: "llm_error", status: "failed", authority: "error", ...meta } });
const completed = (error: string, outcome: Record<string, unknown> = {}) =>
  mk({
    ...base(), iter: -1, kind: "run-completed", status: "failure", terminatedBy: "llm_error", error, totalTokens: 1, totalCostUsd: 0, durationMs: 1,
    outcome: { status: "failed", terminatedBy: "llm_error", provenance: "none", verdict: null, answerSatisfied: false, success: false, authority: "error", ...outcome },
  });
const run = (events: TraceEvent[]): Trace => ({ runId: "r1", events });

describe("provider sub-cause: structural errorClass first", () => {
  it("outcome.errorClass malformed_output wins over a rate-limit message and tag", () => {
    const c = analyzeCause(run([started(), terminal({ errorClass: "LLMRateLimitError" }), completed("429 rate limit", { errorClass: "malformed_output" })]));
    expect(c.subCause).toBe("malformed-output");
    expect(c.evidence.map((e) => e.detail).join()).toContain("subCause from errorClass");
  });

  it("terminal_decision errorClass token_rate_exceeded wins over the LLMContextOverflowError tag", () => {
    const c = analyzeCause(run([started(), terminal({ errorClass: "token_rate_exceeded" }), completed("413 too large", { errorClass: "LLMContextOverflowError" })]));
    expect(c.subCause).toBe("token-rate-exceeded");
  });

  it("the LLMMalformedOutputError tag alone maps to malformed-output", () => {
    expect(analyzeCause(run([started(), terminal(), completed("LLM stream failed", { errorClass: "LLMMalformedOutputError" })])).subCause).toBe("malformed-output");
  });

  it("errorClass unknown is not structural: the tag and text tables still run", () => {
    expect(analyzeCause(run([started(), terminal({ errorClass: "unknown" }), completed("Your credit balance is too low")])).subCause).toBe("quota");
  });

  it("red-on-cut: a plain 'Rate limit reached ... Used N' (budget spent by earlier calls) stays rate, not token-rate-exceeded", () => {
    const c = analyzeCause(run([started(), terminal(), completed("429 Rate limit reached for model on tokens per minute (TPM): Limit 6000, Used 5900, Requested 800", { errorClass: "LLMRateLimitError" })]));
    expect(c.subCause).toBe("rate");
  });
});
