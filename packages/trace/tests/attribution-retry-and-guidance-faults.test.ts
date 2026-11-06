import { describe, it, expect } from "bun:test";
import { attributeFailure, verdictOf } from "../src/index.js";
import type { Trace, TraceEvent } from "../src/index.js";
import { mk } from "./fixtures/mk-event.js";

// Pins for two attribution instrument faults found by the Workstream H verdict
// (wiki/Research/Harness-Reports/2026-11-06-workstream-h-verdict.md, "Instrument
// faults" (a) and (b)). Synthetic traces only: invented task text, ids and content
// that reproduce the decisive shape.
//   (a) a dropped retry byte-identical to a call that already failed twice read
//       harness:tool-call-dropped (and, under it, harness:misleading-guidance for
//       the retry steer that named the failed tool)
//   (b) a run whose deciding turn told the model to call a tool while the request
//       offered no tool schemas read model:never-engaged

let seq = 0;
const at = (iter: number) => ({ runId: "synth", iter, seq: seq++, timestamp: 1000 + seq });
const trace = (events: TraceEvent[]): Trace => ({ runId: "synth", events });

const started = (task: string) => mk({ ...at(-1), kind: "run-started", task, model: "m", provider: "ollama", config: {} });
const contract = (tools: string[], files: string[]) =>
  mk({
    ...at(0), kind: "contract-compiled", horizon: "short",
    requirements: [
      ...tools.map((t) => ({ id: `tool:${t}`, kind: "tool-coverage" })),
      ...files.map((f) => ({ id: `artifact:./${f}`, kind: "artifact-produced" })),
    ],
    deliverables: files.map((f) => ({ id: `artifact:./${f}`, kind: "file" })),
  });
const surface = (iter: number, tools: string[]) =>
  mk({ ...at(iter), kind: "tool-surface-resolved", visible: tools, callable: tools, reasons: tools.map((t) => ({ tool: t, reason: "visible: required" })) });
interface Ex {
  readonly iter: number;
  readonly schemas: string[];
  readonly messages: { role: string; content: string }[];
  readonly content?: string;
  readonly toolCalls?: { name: string; arguments: Record<string, unknown> }[];
  readonly purpose?: string;
}
const exchange = (x: Ex) =>
  mk({
    ...at(x.iter), kind: "llm-exchange", provider: "ollama", model: "m", requestKind: "stream", purpose: x.purpose ?? "think",
    systemPrompt: "You are a helpful assistant. Use the provided tools when needed to complete tasks.",
    messages: x.messages, toolSchemaNames: x.schemas,
    response: { content: x.content ?? "", ...(x.toolCalls ? { toolCalls: x.toolCalls } : {}) },
  });
const failedCall = (iter: number, toolName: string, args: Record<string, unknown>, error: string) => [
  mk({ ...at(iter), kind: "tool-call-start", toolName }),
  mk({ ...at(iter), kind: "tool-call-end", toolName, args, ok: false, error }),
];
const retrySignal = (iter: number, id: string, tool: string, streak: number) => [
  mk({
    ...at(iter), kind: "harness-signal-injected", signalKind: "redirect", origin: "test", signalId: id, targetPolicy: "denied-tool-retry",
    contentPreview: `Recovery required: prior tool path failed (${tool}). Retry ${tool} with corrected arguments.`, contentLen: 80,
    metadata: { trigger: "repeated-identical-failure", toolName: tool, streak },
  }),
  mk({ ...at(iter), kind: "signal-rendered", signalId: id, renderedInIter: iter, renderedSection: "guidance" }),
];
const guard = (iter: number, g: string, outcome: string, reason: string, metadata: Record<string, unknown> = {}) =>
  mk({ ...at(iter), kind: "guard-fired", guard: g, outcome, reason, metadata });
const completed = (terminatedBy: string) =>
  mk({
    ...at(-1), kind: "run-completed", status: "failure", terminatedBy, totalTokens: 1, totalCostUsd: 0, durationMs: 1,
    outcome: { status: "failed", success: false, terminatedBy, provenance: "model-final", verdict: null, answerSatisfied: null },
  });
const graded = (check: string) =>
  mk({ ...at(-1), kind: "eval-graded", score: 0, passed: false, threshold: 1, checks: [{ name: check, passed: false }], grader: "verifiable", taskId: "t1" });

// ─── (a) dropped identical retry ─────────────────────────────────────────────

const BAD_JSON = "[{\"id\": \"Q1\", \"answer\": \"forty-two\"";
const ERR = "File write failed: Refusing to write items.json: the content is not valid JSON";
const TASK = "Write ./items.json, a JSON array with one answer per question.";
const userMsg = [{ role: "user", content: TASK }];

/** Failed writes of the same bad content, a retry steer after each, then one more identical write dropped by a stop. */
function identicalRetryDropped(failures: number): Trace {
  const ev: TraceEvent[] = [started(TASK), contract(["file-write"], ["items.json"]), surface(0, ["file-write"])];
  for (let i = 0; i < failures; i++) {
    ev.push(exchange({ iter: i, schemas: ["file-write"], messages: userMsg, toolCalls: [{ name: "file-write", arguments: { path: "./items.json", content: BAD_JSON } }] }));
    ev.push(...failedCall(i, "file-write", { path: "/w/items.json", content: BAD_JSON }, ERR));
    // The ledger counts a coverage requirement as met on invocation, even a failed one.
    if (i === 0) ev.push(mk({ ...at(i), kind: "ledger-entry", entries: [{ kind: "requirement", requirementId: "tool:file-write", status: "satisfied", seq: 1 }] }));
    ev.push(...retrySignal(i + 1, `sig-${i + 1}`, "file-write", i + 1));
  }
  // Keys reordered, path spelled the same: the canonical args are identical.
  ev.push(exchange({ iter: failures, schemas: ["file-write"], messages: userMsg, toolCalls: [{ name: "file-write", arguments: { content: BAD_JSON, path: "./items.json" } }] }));
  ev.push(guard(failures, "dispatcher_early_stop", "terminate", "dispatcher_early_stop", { evaluatorReason: "\"file-write\" failed 2 times; redirect nudge was ignored" }));
  ev.push(guard(failures, "pending_batch", "warn", "dropped", { calls: ["file-write(./items.json)"] }));
  ev.push(completed("harness_deliverable"), graded("items.json is a valid JSON array"));
  return trace(ev);
}

describe("instrument fault (a): a dropped retry identical to a call that failed twice", () => {
  it("is not harness:tool-call-dropped, and the retry steer that named the failed tool is not misleading", () => {
    const a = attributeFailure(identicalRetryDropped(2));
    expect(a.reason).not.toBe("harness:tool-call-dropped");
    expect(a.reason).not.toBe("harness:misleading-guidance");
    expect(a.alsoMatched).not.toContain("harness:tool-call-dropped");
    expect(a.alsoMatched).not.toContain("harness:misleading-guidance");
    expect(a.verdict).not.toBe("harness");
  });

  it("control: the same drop after one failure is still a harness drop (a retry that could have changed the outcome)", () => {
    const a = attributeFailure(identicalRetryDropped(1));
    expect(a.reason).toBe("harness:tool-call-dropped");
  });

  it("control: a dropped retry with corrected args after two failures is still a harness drop", () => {
    const t = identicalRetryDropped(2);
    const events = t.events.map((e) =>
      e.kind === "llm-exchange" && e.iter === 2
        ? { ...e, response: { ...e.response, toolCalls: [{ name: "file-write", arguments: { path: "./items.json", content: "[{\"id\": \"Q1\"}]" } }] } }
        : e);
    expect(attributeFailure({ ...t, events }).reason).toBe("harness:tool-call-dropped");
  });
});

// ─── (b) contradictory guidance on the deciding turn ────────────────────────

const FETCH_TASK = "Fetch https://api.example.test/widgets and write ./widgets.ts exporting them as a typed const.";
const OUTSTANDING = `${FETCH_TASK}\n\nOutstanding requirements:\n- [tool:http-get] call the \`http-get\` tool\n- [tool:file-write] call the \`file-write\` tool`;

/** A shape reprompt, then a final think turn with tools withheld whose Guidance still says to call http-get. */
function withheldTurnDirectsTool(opts: { readonly lastPurpose?: string; readonly lastContent?: string } = {}): Trace {
  const tools = ["http-get", "file-write"];
  return trace([
    started(FETCH_TASK), contract(tools, ["widgets.ts"]), surface(0, tools),
    exchange({ iter: 0, schemas: tools, messages: [{ role: "user", content: OUTSTANDING }], content: "First I'll use the `http-get` tool:\n```bash\nhttp-get https://api.example.test/widgets\n```" }),
    guard(0, "tool_call_extracted", "warn", "unresolved", { source: "text", disposition: "unresolved", callCount: 0 }),
    mk({ ...at(1), kind: "harness-signal-injected", signalKind: "redirect", origin: "unresolved-tool-call-guard", signalId: "sig-1-w", contentPreview: "think call made with tools withheld", contentLen: 35, metadata: { kind: "tools-withheld", strike: 2 } }),
    exchange({
      iter: 1, schemas: [], purpose: opts.lastPurpose ?? "think",
      messages: [{ role: "user", content: OUTSTANDING }, { role: "user", content: "Guidance:\n- Now call http-get with the appropriate arguments." }],
      content: opts.lastContent ?? "Let's fetch the widgets with the `http-get` tool:\n```bash\nhttp-get https://api.example.test/widgets\n```",
    }),
    guard(1, "tool_call_extracted", "warn", "unresolved", { source: "text", disposition: "unresolved", callCount: 0 }),
    guard(2, "terminal_decision", "terminate", "tool_call_unresolved", { terminatedBy: "tool_call_unresolved", status: "failed", authority: "guard:tool_call_unresolved" }),
    completed("tool_call_unresolved"), graded("widgets.ts exists and compiles"),
  ]);
}

describe("instrument fault (b): the deciding turn directed a tool call while offering no tool schemas", () => {
  it("is harness:contradictory-guidance, decisive, citing that turn", () => {
    const t = withheldTurnDirectsTool();
    const a = attributeFailure(t);
    const last = t.events.filter((e) => e.kind === "llm-exchange").at(-1)!;
    expect(a.reason).toBe("harness:contradictory-guidance");
    expect(a.verdict).toBe("harness");
    expect(a.confidence).toBe("decisive");
    expect(a.evidence.some((e) => e.seq === last.seq && e.detail.includes("http-get"))).toBe(true);
    expect(verdictOf(a.reason)).toBe("harness");
  });

  it("control: a tool-less synthesis turn listing outstanding tools is not contradictory guidance", () => {
    const a = attributeFailure(withheldTurnDirectsTool({ lastPurpose: "synthesize" }));
    expect(a.reason).not.toBe("harness:contradictory-guidance");
  });

  it("control: a model that ignored the directive and answered in prose is not attributed to it", () => {
    const a = attributeFailure(withheldTurnDirectsTool({ lastContent: "export const widgets = [] as const;" }));
    expect(a.reason).not.toBe("harness:contradictory-guidance");
  });
});
