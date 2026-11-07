import { describe, it, expect } from "bun:test";
import { attributeFailure, verdictOf } from "../src/index.js";
import type { Trace, TraceEvent } from "../src/index.js";
import { mk } from "./fixtures/mk-event.js";

// harness:forcing-unused (owner decision 2026-11-06, canonical-failure-modes
// report "Instrument note"): a no-call stall the harness could have forced
// (native FC, domain tools offered) but answered with prose is the harness's.
// Forcing that fired and still failed keeps the model label. Synthetic traces
// only: invented task text, ids and content.

let seq = 0;
const at = (iter: number) => ({ runId: "synth-forcing", iter, seq: seq++, timestamp: 1000 + seq });
const trace = (events: TraceEvent[]): Trace => ({ runId: "synth-forcing", events });

type Setting = boolean | "proactive" | "absent";
const started = (task: string, aoa: Setting) =>
  mk({
    ...at(-1), kind: "run-started", task, model: "m", provider: "ollama",
    config: aoa === "absent" ? {} : { mechanisms: { actOrAnswer: aoa } },
  });
const contract = (tools: string[], files: string[] = []) =>
  mk({
    ...at(0), kind: "contract-compiled", horizon: "short",
    requirements: [
      ...tools.map((t) => ({ id: `tool:${t}`, kind: "tool-coverage" })),
      ...files.map((f) => ({ id: `artifact:./${f}`, kind: "artifact-produced" })),
    ],
    deliverables: files.map((f) => ({ id: `artifact:./${f}`, kind: "file" })),
  });
const TOOLS = ["file-read", "file-write"];
interface ExOpts {
  readonly content?: string;
  readonly toolCalls?: { name: string; arguments: Record<string, unknown> }[];
  readonly schemas?: string[];
  /** A tool result the request carries. */
  readonly seen?: string;
}
const exchange = (iter: number, opts: ExOpts = {}) =>
  mk({
    ...at(iter), kind: "llm-exchange", provider: "ollama", model: "m", requestKind: "stream", purpose: "think",
    systemPrompt: "You are a helpful assistant.",
    messages: [{ role: "user", content: "do the task" }, ...(opts.seen !== undefined ? [{ role: "tool", content: opts.seen }] : [])],
    toolSchemaNames: opts.schemas ?? TOOLS,
    response: { content: opts.content ?? "", stopReason: opts.toolCalls ? "tool_use" : "end_turn", ...(opts.toolCalls ? { toolCalls: opts.toolCalls } : {}) },
  });
const call = (iter: number, toolName: string, args: Record<string, unknown>, ok: boolean, out: string) => [
  mk({ ...at(iter), kind: "tool-call-start", toolName }),
  mk({ ...at(iter), kind: "tool-call-end", toolName, args, ok, ...(ok ? { result: out } : { error: out }) }),
];
const signal = (iter: number, id: string, tool: string) => [
  mk({
    ...at(iter), kind: "harness-signal-injected", signalKind: "redirect", origin: "test", signalId: id, targetPolicy: "synthesize",
    contentPreview: `Grounding required: call ${tool} now with concrete arguments.`, contentLen: 60, metadata: { requiredTools: [tool] },
  }),
  mk({ ...at(iter), kind: "signal-rendered", signalId: id, renderedInIter: iter, renderedSection: "guidance" }),
];
const effect = (iter: number, id: string) => mk({ ...at(iter), kind: "signal-effect", signalId: id, response: "ignored" });
const forced = (iter: number, result: string, tools: string[]) =>
  mk({ ...at(iter), kind: "guard-fired", guard: "act-or-answer", outcome: result === "no-call" ? "pass" : "redirect", reason: result, metadata: { result, tools, offered: TOOLS, outstanding: ["file-read"] } });
const completed = (terminatedBy: string, status: "failure" | "success" = "failure") =>
  mk({
    ...at(-1), kind: "run-completed", status, terminatedBy, totalTokens: 1, totalCostUsd: 0, durationMs: 1,
    outcome: { status: status === "success" ? "completed" : "failed", success: status === "success", terminatedBy, provenance: "model-final", verdict: null, answerSatisfied: null },
  });
const graded = (check: string) =>
  mk({ ...at(-1), kind: "eval-graded", score: 0, passed: false, threshold: 1, checks: [{ name: check, passed: false }], grader: "verifiable", taskId: "t1" });

const TASK = "Read the config and report its port.";

/** Guidance to call required file-read, then a no-call turn; `between` sits after that turn. */
function ignoredGuidanceRun(aoa: Setting, between: TraceEvent[] = [], schemas: string[] = TOOLS): Trace {
  return trace([
    started(TASK, aoa), contract(["file-read"]),
    exchange(0, { content: "The port is probably 8080.", schemas }),
    ...signal(1, "sig-1", "file-read"),
    exchange(1, { content: "I'll read the config next.", schemas }),
    ...between,
    effect(2, "sig-1"),
    completed("max_iterations"),
    graded("port matches config"),
  ]);
}

const TWO_INPUTS = "Read /w/alpha.txt and /w/beta.txt, then write summary.txt with both totals.";
const SECOND_TOTAL = "summary.txt holds the second total";
const ALPHA = "total=3";

/** Reads alpha, optionally stalls once, then writes summary.txt without reading beta. */
function unreadInputRun(stall: boolean): Trace {
  return trace([
    started(TWO_INPUTS, false), contract(["file-read", "file-write"], ["summary.txt"]),
    exchange(0, { toolCalls: [{ name: "file-read", arguments: { path: "/w/alpha.txt" } }] }),
    ...call(0, "file-read", { path: "/w/alpha.txt" }, true, ALPHA),
    ...(stall ? [
      exchange(1, { content: "Next I will look at the other file.", seen: ALPHA }),
      exchange(1, { content: "I will read beta.txt now.", seen: ALPHA }),
    ] : []),
    exchange(2, { seen: ALPHA, toolCalls: [{ name: "file-write", arguments: { path: "./summary.txt", content: "alpha 3" } }] }),
    ...call(2, "file-write", { path: "/w/summary.txt", content: "alpha 3" }, true, "written"),
    completed("end_turn", "success"),
    graded(SECOND_TOTAL),
  ]);
}

describe("harness:forcing-unused", () => {
  it("is in the taxonomy and names the harness", () => {
    expect(verdictOf("harness:forcing-unused")).toBe("harness");
  });

  it("an off-mode no-call stall under ignored guidance is the harness's (decisive)", () => {
    const a = attributeFailure(ignoredGuidanceRun(false));
    expect(a.reason).toBe("harness:forcing-unused");
    expect(a.verdict).toBe("harness");
    expect(a.confidence).toBe("decisive");
    expect(a.alsoMatched).toContain("model:ignored-guidance");
    expect(a.evidence[0]?.detail).toContain("actOrAnswer=false");
  });

  it("a trace that does not record actOrAnswer is the harness's, probable", () => {
    const a = attributeFailure(ignoredGuidanceRun("absent"));
    expect(a.reason).toBe("harness:forcing-unused");
    expect(a.confidence).toBe("probable");
    expect(a.missing.join(" ")).toContain("actOrAnswer");
  });

  it("forcing on but not fired on the stall is still the harness's", () => {
    const a = attributeFailure(ignoredGuidanceRun(true));
    expect(a.reason).toBe("harness:forcing-unused");
    expect(a.confidence).toBe("decisive");
  });

  it("forcing fired and the forced reply made no call: the model label stands", () => {
    const a = attributeFailure(ignoredGuidanceRun(true, [
      exchange(1, { content: "Still thinking about it." }),
      forced(1, "no-call", []),
    ]));
    expect(a.reason).toBe("model:ignored-guidance");
  });

  it("forcing fired, the forced call ran and its tool failed: the model label stands", () => {
    const a = attributeFailure(ignoredGuidanceRun(true, [
      exchange(1, { toolCalls: [{ name: "file-read", arguments: { path: "/w/nope.cfg" } }] }),
      forced(1, "called", ["file-read"]),
      ...call(1, "file-read", { path: "/w/nope.cfg" }, false, "ENOENT: no such file"),
    ]));
    expect(a.reason).toBe("model:ignored-guidance");
  });

  it("no domain tool offered on the stalled turns: unchanged (forcing was not available)", () => {
    const a = attributeFailure(ignoredGuidanceRun(false, [], []));
    expect(a.reason).toBe("model:ignored-guidance");
  });

  it("an evidence-not-gathered run with an off-mode stall before the failing write is the harness's", () => {
    const a = attributeFailure(unreadInputRun(true));
    expect(a.reason).toBe("harness:forcing-unused");
    expect(a.alsoMatched).toContain("model:evidence-not-gathered");
    expect(a.target?.ref).toBe("summary.txt");
  });

  it("one stray no-call turn in a run that kept calling keeps the model label (stalls not dominant)", () => {
    const a = attributeFailure(trace([
      started(TWO_INPUTS, false), contract(["file-read", "file-write"], ["summary.txt"]),
      exchange(0, { content: "Let me start." }),
      exchange(1, { toolCalls: [{ name: "file-read", arguments: { path: "/w/alpha.txt" } }] }),
      ...call(1, "file-read", { path: "/w/alpha.txt" }, true, ALPHA),
      exchange(2, { seen: ALPHA, toolCalls: [{ name: "file-read", arguments: { path: "/w/alpha.txt", offset: 1 } }] }),
      ...call(2, "file-read", { path: "/w/alpha.txt", offset: 1 }, true, ALPHA),
      exchange(3, { seen: ALPHA, toolCalls: [{ name: "file-write", arguments: { path: "./summary.txt", content: "alpha 3" } }] }),
      ...call(3, "file-write", { path: "/w/summary.txt", content: "alpha 3" }, true, "written"),
      completed("end_turn", "success"),
      graded(SECOND_TOTAL),
    ]));
    expect(a.reason).toBe("model:evidence-not-gathered");
  });

  it("turns cut by max_tokens are neither stalls nor counted against dominance", () => {
    const cut = (iter: number) => mk({
      ...at(iter), kind: "llm-exchange", provider: "ollama", model: "m", requestKind: "stream", purpose: "think",
      systemPrompt: "s", messages: [{ role: "user", content: "do the task" }], toolSchemaNames: TOOLS,
      response: { content: "", stopReason: "max_tokens" },
    });
    const onlyCut = attributeFailure(ignoredGuidanceRun(false, [cut(1), cut(1), cut(1)]));
    expect(onlyCut.reason).toBe("harness:forcing-unused");
    expect(onlyCut.evidence[0]?.detail).toContain("2 of 2 turn(s)");
  });

  it("an evidence-not-gathered run with no no-call turn keeps the model label", () => {
    const a = attributeFailure(unreadInputRun(false));
    expect(a.reason).toBe("model:evidence-not-gathered");
  });
});
