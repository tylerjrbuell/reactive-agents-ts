import { describe, it, expect } from "bun:test";
import { attributeFailure, analyzeCause } from "../src/index.js";
import type { Trace, TraceEvent } from "../src/index.js";
import { mk } from "./fixtures/mk-event.js";

// Pins for leverage-scan item 6 (wiki/Research/Harness-Reports/2026-11-07-leverage-scan.md):
// a write boundary refusing the content the model supplied read
// `environment:tool-failure` (cause tool-failure, 3+ failed calls or a repeated
// identical one) or `unattributed`. A tool refusing model content is not an
// environment fault. Synthetic traces only: invented task, paths and content
// that reproduce the recorded shape (file-write refusing invalid `.json`).

let seq = 0;
const at = (iter: number) => ({ runId: "synth", iter, seq: seq++, timestamp: 1000 + seq });
const trace = (events: TraceEvent[]): Trace => ({ runId: "synth", events });

const TASK = 'Answer the questions in ./questions.md and write ./answers.json, a JSON array of {"id", "answer"}.';
const started = () => mk({ ...at(-1), kind: "run-started", task: TASK, model: "m", provider: "ollama", config: {} });
const contract = () =>
  mk({
    ...at(0), kind: "contract-compiled", horizon: "short",
    requirements: [{ id: "artifact:./answers.json", kind: "artifact-produced" }],
    deliverables: [{ id: "artifact:./answers.json", kind: "file" }],
  });
const exchange = (iter: number, content: string) =>
  mk({
    ...at(iter), kind: "llm-exchange", provider: "ollama", model: "m", requestKind: "stream", purpose: "think",
    systemPrompt: "You are a helpful assistant.", messages: [{ role: "user", content: TASK }], toolSchemaNames: ["file-write"],
    response: { content: "", toolCalls: [{ name: "file-write", arguments: { path: "./answers.json", content } }] },
  });
const end = (iter: number, toolName: string, args: Record<string, unknown>, r: { ok: boolean; error?: string; result?: string }) => [
  mk({ ...at(iter), kind: "tool-call-start", toolName }),
  mk({ ...at(iter), kind: "tool-call-end", toolName, args, ...r }),
];
const completed = () =>
  mk({
    ...at(-1), kind: "run-completed", status: "failure", terminatedBy: "max_iterations", totalTokens: 1, totalCostUsd: 0, durationMs: 1,
    outcome: { status: "failed", success: false, terminatedBy: "max_iterations", provenance: "model-final", verdict: null, answerSatisfied: null },
  });
const graded = () =>
  mk({ ...at(-1), kind: "eval-graded", score: 0, passed: false, threshold: 1, checks: [{ name: "answers.json is a JSON array", passed: false }], grader: "verifiable", taskId: "t1" });

// The model copied a quoted phrase from the task into a string with one escape level too few.
const QUOTED = '[{"id": "Q1", "answer": "the "component model", which wraps modules"}]';
// Truncated mid-array: no content-preserving repair parses it.
const CUT = '[{"id": "Q1", "answer": "forty-two"';
const refusal = (hint: boolean) =>
  "[Tool error: File write failed: Refusing to write answers.json: the content is not valid JSON (JSON Parse error: Expected '}'). " +
  "Pass `content` as the JSON value itself (an object or array, not a string); it is saved as valid JSON." +
  (hint ? " → Malformed JSON in arguments. Ensure valid JSON syntax." : "") + "]";

/** `n` identical refused writes of `content` (cause: tool-failure/repeated-identical-call), then `tail`. */
function refusedRun(content: string, opts: { n?: number; hint?: boolean; tail?: () => TraceEvent[] } = {}): Trace {
  const ev: TraceEvent[] = [started(), contract()];
  for (let i = 0; i < (opts.n ?? 3); i++) {
    ev.push(exchange(i, content));
    ev.push(...end(i, "file-write", { path: "/w/answers.json", content }, { ok: false, error: refusal(opts.hint ?? false) }));
  }
  // The tail is built here so its events come after the refusals (seq order).
  ev.push(...(opts.tail?.() ?? []), completed(), graded());
  return trace(ev);
}

describe("content refusal attribution (leverage scan item 6)", () => {
  it("cause still reads tool-failure: the fix is the owner, not how the run ended", () => {
    expect(analyzeCause(refusedRun(QUOTED)).cause).toBe("tool-failure");
  });

  it("a refused, repairable .json write is harness:refused-repairable, not environment:tool-failure", () => {
    const a = attributeFailure(refusedRun(QUOTED));
    expect(a.reason).toBe("harness:refused-repairable");
    expect(a.verdict).toBe("harness");
    expect(a.confidence).toBe("decisive");
    expect(a.target?.ref).toBe("answers.json");
    expect(a.evidence[0]?.detail).toContain("repair");
  });

  it("a correct refusal of unrepairable content is model:invalid-content", () => {
    const a = attributeFailure(refusedRun(CUT));
    expect(a.reason).toBe("model:invalid-content");
    expect(a.verdict).toBe("model");
    expect(a.confidence).toBe("decisive");
  });

  it("a single refusal is model:invalid-content, not the run's cap (environment:budget-cap)", () => {
    expect(attributeFailure(refusedRun(CUT, { n: 1 })).reason).toBe("model:invalid-content");
  });

  it("an unrepairable refusal whose hint contradicted its fix is harness:misleading-refusal", () => {
    const a = attributeFailure(refusedRun(CUT, { hint: true }));
    expect(a.reason).toBe("harness:misleading-refusal");
    expect(a.verdict).toBe("harness");
  });

  it("repairable wins over a misleading hint: the repair removes the refusal outright", () => {
    expect(attributeFailure(refusedRun(QUOTED, { hint: true })).reason).toBe("harness:refused-repairable");
  });

  it("a refusal the model recovered from (a later write of the path succeeded) explains nothing", () => {
    const tail = () => end(3, "file-write", { path: "/w/answers.json", content: '[{"id": "Q1", "answer": "x"}]' }, { ok: true, result: "✓ Written to /w/answers.json" });
    const a = attributeFailure(refusedRun(CUT, { n: 1, tail }));
    expect(["harness:refused-repairable", "harness:misleading-refusal", "model:invalid-content"]).not.toContain(a.reason);
  });

  it("a later write replaced by the repetition notice did not write the file: the refusal still counts", () => {
    const tail = () => end(3, "file-write", { path: "/w/answers.json", content: CUT }, { ok: true, result: "⚠️ You have already called file-write 3 times. Stop repeating this tool." });
    expect(attributeFailure(refusedRun(CUT, { n: 1, tail })).reason).toBe("model:invalid-content");
  });

  it("a refused write of a file the run did not have to produce does not fire", () => {
    const ev: TraceEvent[] = [started(), contract(), exchange(0, CUT)];
    ev.push(...end(0, "file-write", { path: "/w/scratch.json", content: CUT }, { ok: false, error: refusal(false).replace(/answers\.json/g, "scratch.json") }));
    ev.push(completed(), graded());
    const a = attributeFailure(trace(ev));
    expect(["harness:refused-repairable", "harness:misleading-refusal", "model:invalid-content"]).not.toContain(a.reason);
  });

  it("a tool that itself failed (no content refusal) stays environment:tool-failure", () => {
    const ev: TraceEvent[] = [started(), contract()];
    for (let i = 0; i < 3; i++) {
      ev.push(exchange(i, QUOTED));
      ev.push(...end(i, "file-write", { path: "/w/answers.json", content: QUOTED }, { ok: false, error: "[Tool error: File write failed: EACCES: permission denied, open '/w/answers.json']" }));
    }
    ev.push(completed(), graded());
    expect(attributeFailure(trace(ev)).reason).toBe("environment:tool-failure");
  });
});
