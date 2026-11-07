import { describe, it, expect } from "bun:test";
import { attributeFailure, renderAttribution, tallyAttributions, mechanismActivity, compareActivity, runsWithMechanism, CAUSE_ATTRIBUTION, verdictOf } from "../src/index.js";
import type { Trace, TraceEvent } from "../src/index.js";
import { mk } from "./fixtures/mk-event.js";

// Harness-vs-model attribution (feedback-loop design D2): one synthetic
// fixture per reason. Each fixture holds only the facts its rule reads.

let seq = 0;
const at = (iter: number) => ({ runId: "r1", iter, seq: seq++, timestamp: 1000 + seq });
const trace = (events: TraceEvent[]): Trace => ({ runId: "r1", events });

const started = () => mk({ ...at(-1), kind: "run-started", task: "t", model: "m", provider: "ollama", config: {} });
const contract = (tools: string[], files: string[] = []) =>
  mk({
    ...at(0), kind: "contract-compiled", horizon: "short",
    requirements: [
      ...tools.map((t) => ({ id: `tool:${t}`, kind: "tool-coverage" })),
      ...files.map((f) => ({ id: `artifact:./${f}`, kind: "artifact-produced" })),
    ],
    deliverables: files.map((f) => ({ id: `artifact:./${f}`, kind: "file" })),
  });
interface Ex {
  readonly iter: number;
  readonly messages?: { role: string; content: string; truncated?: boolean }[];
  readonly content?: string;
  readonly toolCalls?: { name: string; arguments: Record<string, unknown> }[];
}
const exchange = (x: Ex) =>
  mk({
    ...at(x.iter), kind: "llm-exchange", provider: "ollama", model: "m", requestKind: "stream", purpose: "think",
    systemPrompt: "You are a helpful assistant.", messages: x.messages ?? [{ role: "user", content: "do the task" }],
    toolSchemaNames: ["file-read", "file-write"],
    response: { content: x.content ?? "", ...(x.toolCalls ? { toolCalls: x.toolCalls } : {}) },
  });
const start = (iter: number, toolName: string) => mk({ ...at(iter), kind: "tool-call-start", toolName });
const end = (iter: number, toolName: string, args: Record<string, unknown>, ok: boolean, out: string) =>
  mk({ ...at(iter), kind: "tool-call-end", toolName, args, ok, ...(ok ? { result: out } : { error: out }) });
const call = (iter: number, toolName: string, args: Record<string, unknown>, ok: boolean, out: string) =>
  [start(iter, toolName), end(iter, toolName, args, ok, out)];
const guard = (iter: number, g: string, outcome: string, reason: string, metadata?: Record<string, unknown>) =>
  mk({ ...at(iter), kind: "guard-fired", guard: g, outcome, reason, ...(metadata ? { metadata } : {}) });
const completed = (status: "success" | "failure", terminatedBy: string, outcome: Record<string, unknown> = {}, output?: string) =>
  mk({
    ...at(-1), kind: "run-completed", status, terminatedBy, totalTokens: 1, totalCostUsd: 0, durationMs: 1,
    ...(output !== undefined ? { output } : {}),
    outcome: { status: status === "success" ? "completed" : "failed", success: status === "success", terminatedBy, provenance: "model-final", verdict: null, answerSatisfied: null, ...outcome },
  });
const graded = (passed: boolean, checks: { name: string; passed: boolean }[]) =>
  mk({ ...at(-1), kind: "eval-graded", score: passed ? 1 : 0.5, passed, threshold: 1, checks, grader: "verifiable", taskId: "t1" });
const assess = (iter: number, evidenceDelta: number) =>
  mk({ ...at(iter), kind: "assessment", phase: "gather", band: "green", evidenceDelta, requirementsSatisfied: 1, requirementsOutstanding: 1, deliverablesProduced: 0, deliverablesMissing: 1, burnRatio: 0.3 });
const signal = (iter: number, id: string, content: string, extra: Record<string, unknown>) =>
  mk({ ...at(iter), kind: "harness-signal-injected", signalKind: "redirect", origin: "test", contentPreview: content, contentLen: content.length, signalId: id, ...extra });
const rendered = (iter: number, id: string) => mk({ ...at(iter), kind: "signal-rendered", signalId: id, renderedInIter: iter, renderedSection: "guidance" });
const effect = (iter: number, id: string, response: string) => mk({ ...at(iter), kind: "signal-effect", signalId: id, response });

const CSV = "hour,temp\n0,18.5\n1,21.2\n2,17.2\n3,18.2";
const readMsgs = (tool: string) => [{ role: "user", content: "compute the mean into mean.txt" }, { role: "assistant", content: "[tool_use:file-read]" }, { role: "tool", content: tool }];

describe("attributeFailure — not failed", () => {
  it("a clean success with a passing grade is not-failed", () => {
    const a = attributeFailure(trace([started(), completed("success", "end_turn"), graded(true, [{ name: "ok", passed: true }])]));
    expect(a.verdict).toBe("not-failed");
    expect(a.reason).toBe("not-failed");
  });

  it("an abstention the grader accepts is not-failed (a correct abstention)", () => {
    const a = attributeFailure(trace([started(), completed("failure", "abstained", { status: "abstained" }), graded(true, [{ name: "abstained (abstainExpected)", passed: true }])]));
    expect(a.verdict).toBe("not-failed");
    expect(a.failureSignals).toContain("run-completed.status=failure");
  });

  it("a run with neither run-completed nor a grade is unattributed: insufficient-trace", () => {
    const a = attributeFailure(trace([started()]));
    expect(a.reason).toBe("unattributed");
    expect(a.confidence).toBe("insufficient-trace");
    expect(a.missing).toContain("run-completed");
  });

  it("an aborted run is owned by the environment through its failure cause", () => {
    const a = attributeFailure(trace([started(), mk({ ...at(-1), kind: "run-aborted", causeClass: "interrupt", reason: "abort", durationMs: 1 })]));
    expect(a.verdict).toBe("environment");
    expect(a.reason).toBe("environment:run-aborted");
    expect(a.cause).toBe("aborted/abort");
    expect(a.missing).toContain("run-completed");
  });
});

describe("attributeFailure — harness reasons", () => {
  it("harness:false-veto — the grader passed but the run was marked failed", () => {
    const a = attributeFailure(trace([
      started(), contract(["file-write"], ["out.txt"]),
      exchange({ iter: 0, toolCalls: [{ name: "file-write", arguments: { path: "/w/out.txt", content: "34" } }] }),
      ...call(0, "file-write", { path: "/w/out.txt", content: "34" }, true, "✓ Written"),
      completed("failure", "harness_synthesis", { success: true, authority: "runtime-success-veto:unproduced-deliverable" }),
      graded(true, [{ name: "bun hidden-check.ts", passed: true }]),
    ]));
    expect(a.reason).toBe("harness:false-veto");
    expect(a.verdict).toBe("harness");
    expect(a.confidence).toBe("decisive");
    expect(a.divergenceTurn).toBeUndefined();
  });

  it("harness:false-veto (no grader) — an outstanding deliverable that is a template placeholder is probable", () => {
    const a = attributeFailure(trace([
      started(), contract(["file-write"], ["out-N.txt"]),
      ...call(0, "file-write", { path: "/w/out-1.txt", content: "34" }, true, "✓ Written"),
      ...call(0, "file-write", { path: "/w/out-2.txt", content: "84" }, true, "✓ Written"),
      completed("failure", "controller_early_stop_ungrounded", { outstanding: ["artifact:./out-N.txt"] }),
    ]));
    expect(a.reason).toBe("harness:false-veto");
    expect(a.confidence).toBe("probable");
    expect(a.missing.join(" ")).toContain("eval-graded");
  });

  it("harness:tool-surface — a contract-required tool was hidden from the model", () => {
    const a = attributeFailure(trace([
      started(), contract(["web-search"]),
      mk({ ...at(0), kind: "tool-surface-resolved", visible: ["recall"], callable: ["recall"], reasons: [{ tool: "web-search", reason: "hidden: lazy-undisclosed (not required/relevant/used/discovered/allowed/meta)" }] }),
      exchange({ iter: 0, content: "I cannot search." }),
      completed("failure", "abstained", { status: "abstained" }),
    ]));
    expect(a.reason).toBe("harness:tool-surface");
    expect(a.evidence[0]!.detail).toContain("hidden: lazy-undisclosed");
  });

  it("harness:tool-call-dropped — a native call to write the graded file never ran", () => {
    const a = attributeFailure(trace([
      started(), contract(["file-write"], ["analysis.md"]),
      exchange({ iter: 3, toolCalls: [{ name: "file-write", arguments: { path: "/w/analysis.md", content: "## Primary Cause" } }] }),
      mk({ ...at(3), kind: "strategy-switched", from: "reactive", to: "plan-execute-reflect", reason: "pattern=c (consecutive-thoughts)" }),
      exchange({ iter: 4, content: "## Primary Cause ..." }),
      completed("failure", "harness_deliverable"),
      graded(false, [{ name: "analysis.md exists with the three required sections", passed: false }]),
    ]));
    expect(a.reason).toBe("harness:tool-call-dropped");
    expect(a.target?.ref).toBe("analysis.md");
    expect(a.divergenceTurn?.iter).toBe(3);
  });

  it("a call the tool gate refused and answered is not a dropped call", () => {
    const a = attributeFailure(trace([
      started(), contract(["file-write"], ["analysis.md"]),
      exchange({ iter: 3, toolCalls: [{ name: "file-write", arguments: { path: "/w/analysis.md", content: "## Primary Cause" } }] }),
      guard(3, "tool-gate", "block", "file-write was not run: call budget used", { toolName: "file-write", kind: "budget" }),
      exchange({ iter: 4, content: "## Primary Cause ..." }),
      completed("failure", "harness_deliverable"),
      graded(false, [{ name: "analysis.md exists with the three required sections", passed: false }]),
    ]));
    expect(a.reason).not.toBe("harness:tool-call-dropped");
  });

  it("harness:tool-call-corrupted — a printed call reached the tool with object-literal source in its path", () => {
    const a = attributeFailure(trace([
      started(), contract(["file-read", "file-write"], ["mean.txt"]),
      exchange({ iter: 1, content: "```js\nfile-read({\n  path: \"/w/readings.csv\"\n})\n```" }),
      ...call(1, "file-read", { path: "/w/{\n  path: \"/w/readings.csv\"\n}" }, false, "ENOENT: no such file or directory"),
      exchange({ iter: 2, toolCalls: [{ name: "file-write", arguments: { path: "./mean.txt", content: "23.45" } }] }),
      ...call(2, "file-write", { path: "/w/mean.txt", content: "23.45" }, true, "✓ Written"),
      completed("success", "end_turn"),
      graded(false, [{ name: "mean within 0.01 of 21.8300", passed: false }]),
    ]));
    expect(a.reason).toBe("harness:tool-call-corrupted");
    expect(a.confidence).toBe("decisive");
    expect(a.divergenceTurn?.iter).toBe(2);
  });

  it("a corrupted call the run recovered from before the divergence turn is not the cause", () => {
    const a = attributeFailure(trace([
      started(), contract(["file-read", "file-write"], ["mean.txt"]),
      exchange({ iter: 1, content: "file-read({ path: \"/w/readings.csv\" })" }),
      ...call(1, "file-read", { path: "/w/{ path: \"/w/readings.csv\" }" }, false, "ENOENT"),
      exchange({ iter: 2, toolCalls: [{ name: "file-read", arguments: { path: "/w/readings.csv" } }] }),
      ...call(2, "file-read", { path: "/w/readings.csv" }, true, CSV),
      exchange({ iter: 3, messages: readMsgs(CSV), toolCalls: [{ name: "file-write", arguments: { path: "./mean.txt", content: "20.48" } }] }),
      ...call(3, "file-write", { path: "/w/mean.txt", content: "20.48" }, true, "✓ Written"),
      completed("success", "end_turn"),
      graded(false, [{ name: "mean within 0.01 of 21.8300", passed: false }]),
    ]));
    expect(a.reason).toBe("model:had-evidence-wrong-output");
  });

  it("harness:premature-stop — a harness stop shipped an answer that predates the run's evidence", () => {
    const a = attributeFailure(trace([
      started(), contract(["file-read"]),
      exchange({ iter: 1, content: "I'll use the file-read tool to read the JSON files." }),
      exchange({ iter: 2, toolCalls: [{ name: "file-read", arguments: { path: "/w/a.json" } }] }),
      ...call(2, "file-read", { path: "/w/a.json" }, true, "{\"count\":412}"),
      guard(5, "stall_deliverable", "terminate", "harness_synthesis", { counter: "consecutiveStalled", observed: 4, threshold: 4 }),
      guard(5, "terminal_decision", "terminate", "harness_synthesis", { terminatedBy: "harness_synthesis" }),
      completed("success", "harness_synthesis", {}, "I'll use the file-read tool to read the JSON files."),
      graded(false, [{ name: "output matches /1,?343/", passed: false }]),
    ]));
    expect(a.reason).toBe("harness:premature-stop");
    expect(a.divergenceTurn?.iter).toBe(1);
  });

  it("harness:premature-stop — an early stop with budget left cut a run whose evidence was still growing", () => {
    const a = attributeFailure(trace([
      started(), contract(["file-read", "file-write"], ["report.md"]),
      assess(3, 1), ...call(3, "file-read", { path: "/w/a.txt" }, true, "alpha"),
      assess(4, 1), ...call(4, "file-read", { path: "/w/b.txt" }, true, "beta"),
      guard(5, "dispatcher_early_stop", "terminate", "dispatcher_early_stop", { counter: "iteration", observed: 5, threshold: 14 }),
      completed("failure", "dispatcher-early-stop"),
    ]));
    expect(a.reason).toBe("harness:premature-stop");
    expect(a.confidence).toBe("decisive");
    expect(a.target?.ref).toBe("report.md");
  });

  // Repro (2026-11-04, H3 todo-heavy, qwen3:4b): the task named outputs only as
  // `out-N.txt`, the contract listed none, the model wrote out-1 and ended its turn.
  const todoHeavy = (extra: TraceEvent[]) => [
    started(), contract(["file-read", "file-write"]), ...extra,
    exchange({ iter: 1, toolCalls: [{ name: "file-write", arguments: { path: "/w/out-1.txt", content: "34" } }] }),
    ...call(1, "file-write", { path: "/w/out-1.txt", content: "34" }, true, "✓ Written"),
    completed("success", "end_turn"),
    graded(false, [{ name: "out-1.txt is 34", passed: true }, { name: "out-2.txt is 84", passed: false }, { name: "out-3.txt is 16", passed: false }]),
  ];

  it("harness:completeness-blind — required files never written, the contract never listed them, the run ended on its own", () => {
    const a = attributeFailure(trace(todoHeavy([])));
    expect(a.reason).toBe("harness:completeness-blind");
    expect(a.verdict).toBe("harness");
    expect(a.confidence).toBe("decisive");
    expect(a.target?.ref).toBe("out-2.txt");
    expect(a.evidence[0]!.detail).toContain("out-2.txt, out-3.txt never written");
  });

  it("a file the ledger declared mid-run is known: not completeness-blind", () => {
    const declared = mk({ ...at(1), kind: "ledger-entry", entries: [
      { kind: "requirement", requirementId: "artifact:./out-2.txt", status: "declared" },
      { kind: "requirement", requirementId: "artifact:./out-3.txt", status: "declared" },
    ] });
    expect(attributeFailure(trace(todoHeavy([declared]))).reason).not.toBe("harness:completeness-blind");
  });

  it("a known template deliverable covers its family: not completeness-blind", () => {
    const events = todoHeavy([]);
    events[1] = contract(["file-read", "file-write"], ["out-N.txt"]);
    expect(attributeFailure(trace(events)).reason).not.toBe("harness:completeness-blind");
  });

  it("mechanismActivity: stable keys for guards, signals, switches and requirements by source", () => {
    const act = mechanismActivity(trace([
      ...todoHeavy([mk({ ...at(1), kind: "ledger-entry", entries: [
        { kind: "requirement", requirementId: "artifact:./out-2.txt", status: "declared", requirementKind: "artifact-produced" },
        { kind: "requirement", requirementId: "tool:file-read", status: "declared", requirementKind: "tool-coverage" },
      ] })]),
      guard(2, "exit_gate", "block", "loop_graceful"),
      guard(2, "required_tools", "pass", "ok"),
      signal(2, "s1", "write the answer", { origin: "exit-gate.ts:348" }),
      mk({ ...at(2), kind: "strategy-switched", from: "reactive", to: "plan-execute-reflect", reason: "x" }),
    ]));
    expect([...act].sort()).toEqual([
      "guard:exit_gate:block",
      "requirement:artifact-produced@declared-mid-run",
      "requirement:tool-coverage@unknown",
      "signal:redirect@exit-gate.ts",
      "strategy-switch:reactive->plan-execute-reflect",
    ]);
  });

  it("compareActivity lists changed keys, largest change first; runsWithMechanism counts runs", () => {
    const b = [new Set(["a"]), new Set(["a"])];
    const a = [new Set(["a", "b"]), new Set(["b", "c"])];
    expect(compareActivity(b, a).changed).toEqual([
      { key: "b", before: 0, after: 2 },
      { key: "a", before: 2, after: 1 },
      { key: "c", before: 0, after: 1 },
    ]);
    expect(runsWithMechanism(a, "b")).toBe(2);
    expect(runsWithMechanism(b, "b")).toBe(0);
  });

  it("a stop on a looping run (repetition notices) is not premature", () => {
    const a = attributeFailure(trace([
      started(), contract(["file-read", "file-write"], ["report.md"]),
      assess(3, 1), ...call(3, "file-read", { path: "/w/a.txt" }, true, "alpha [Already done — do NOT repeat.]"),
      assess(4, 1), ...call(4, "file-read", { path: "/w/a.txt" }, true, "alpha [Already done — do NOT repeat.]"),
      guard(5, "dispatcher_early_stop", "terminate", "dispatcher_early_stop", { counter: "iteration", observed: 5, threshold: 14 }),
      completed("failure", "dispatcher-early-stop"),
    ]));
    expect(a.reason).toBe("unattributed");
  });

  it("harness:evidence-truncated — the divergence turn saw only a compressed preview of the tool result", () => {
    const preview = "[file-read result — compressed preview]\nemployee_id,salary\nEMP-001,120000\nEMP-002,127800\n  ...43 more lines";
    const a = attributeFailure(trace([
      started(),
      exchange({ iter: 0, toolCalls: [{ name: "file-read", arguments: { path: "/w/employees.csv" } }] }),
      ...call(0, "file-read", { path: "/w/employees.csv" }, true, preview),
      exchange({ iter: 1, messages: [{ role: "user", content: `DATA FROM PREVIOUS STEPS:\n${preview}` }], content: "# Employee Analysis Report\n\nAverage salary is $131,000 across the team." }),
      ...call(2, "file-write", { path: "/w/report.md", content: "# Employee Analysis Report\n\nAverage salary is $131,000 across the team." }, true, "✓ Written"),
      completed("success", "final_answer"),
      graded(false, [{ name: "report.md salary claim is grounded in the data", passed: false }]),
    ]));
    expect(a.reason).toBe("harness:evidence-truncated");
    expect(a.confidence).toBe("probable");
    expect(a.evidence[0]!.detail).toContain("...43 more lines");
  });

  it("harness:evidence-truncated — the projection dropped a ref and the result is absent", () => {
    const a = attributeFailure(trace([
      started(),
      ...call(0, "file-read", { path: "/w/a.csv" }, true, "qty,sku\n3,SKU-001\n4,SKU-002"),
      mk({ ...at(1), kind: "projection-rendered", sections: ["evidence"], refs: [], droppedRefs: ["res_1"], chars: 100 }),
      exchange({ iter: 1, toolCalls: [{ name: "file-write", arguments: { path: "/w/low.txt", content: "SKU-009" } }] }),
      ...call(1, "file-write", { path: "/w/low.txt", content: "SKU-009" }, true, "✓ Written"),
      completed("success", "end_turn"),
      graded(false, [{ name: "low.txt is exactly the sorted SKUs below 10", passed: false }]),
    ]));
    expect(a.reason).toBe("harness:evidence-truncated");
    expect(a.evidence.some((e) => e.detail.includes("projection dropped refs"))).toBe(true);
  });

  it("harness:evidence-missing — a produced result never reached the divergence turn's request", () => {
    const a = attributeFailure(trace([
      started(),
      ...call(0, "file-read", { path: "/w/a.csv" }, true, "qty,sku\n3,SKU-001\n4,SKU-002"),
      exchange({ iter: 1, messages: [{ role: "user", content: "write the low-stock list" }], toolCalls: [{ name: "file-write", arguments: { path: "/w/low.txt", content: "SKU-009" } }] }),
      ...call(1, "file-write", { path: "/w/low.txt", content: "SKU-009" }, true, "✓ Written"),
      completed("success", "end_turn"),
      graded(false, [{ name: "low.txt is exactly the sorted SKUs below 10", passed: false }]),
    ]));
    expect(a.reason).toBe("harness:evidence-missing");
    expect(a.confidence).toBe("decisive");
  });

  it("harness:evidence-missing is probable when the recorder clipped the request", () => {
    const a = attributeFailure(trace([
      started(),
      ...call(0, "file-read", { path: "/w/a.csv" }, true, "qty,sku\n3,SKU-001\n4,SKU-002"),
      exchange({ iter: 1, messages: [{ role: "user", content: "x".repeat(2000), truncated: true }, { role: "user", content: "other" }], toolCalls: [{ name: "file-write", arguments: { path: "/w/low.txt", content: "SKU-009" } }] }),
      ...call(1, "file-write", { path: "/w/low.txt", content: "SKU-009" }, true, "✓ Written"),
      completed("success", "end_turn"),
      graded(false, [{ name: "low.txt is exactly the sorted SKUs below 10", passed: false }]),
    ]));
    // A clipped request makes the absence unverifiable, so the harness is not blamed.
    expect(a.reason).not.toBe("harness:evidence-missing");
    expect(a.missing.join(" ")).toContain("full request text");
  });

  it("harness:misleading-guidance — guidance steered to an already-satisfied tool and the model followed it", () => {
    const a = attributeFailure(trace([
      started(), contract(["file-read", "file-write"], ["out.txt"]),
      ...call(0, "file-read", { path: "/w/in.txt" }, true, "17"),
      signal(1, "sig-1-1", "Retry file-read with corrected arguments.", { targetTool: "file-read", targetPolicy: "denied-tool-retry" }),
      rendered(1, "sig-1-1"),
      exchange({ iter: 1, toolCalls: [{ name: "file-read", arguments: { path: "/w/in.txt" } }] }),
      ...call(1, "file-read", { path: "/w/in.txt" }, true, "17"),
      completed("failure", "max_iterations"),
    ]));
    expect(a.reason).toBe("harness:misleading-guidance");
    expect(a.target?.ref).toBe("out.txt");
  });
});

describe("attributeFailure — model reasons", () => {
  // Both runs had forcing fire and fail (act-or-answer, no call came back): without that
  // record a forceable no-call stall reads harness:forcing-unused (attribution-forcing-unused.test.ts).
  it("model:ignored-guidance — correct guidance to call an unsatisfied required tool was not followed", () => {
    const a = attributeFailure(trace([
      started(), contract(["file-read"]),
      exchange({ iter: 0, content: "The answer is 42." }),
      signal(1, "sig-1-1", "Grounding required: call file-read now with concrete arguments.", { targetPolicy: "synthesize", metadata: { requiredTools: ["file-read"] } }),
      rendered(1, "sig-1-1"),
      exchange({ iter: 1, content: "The answer is still 42." }),
      guard(1, "act-or-answer", "pass", "no-call", { result: "no-call", tools: [] }),
      effect(2, "sig-1-1", "ignored"),
      completed("failure", "abstained", { status: "abstained" }),
      graded(false, [{ name: "no premature abstention", passed: false }]),
    ]));
    expect(a.reason).toBe("model:ignored-guidance");
    expect(a.verdict).toBe("model");
    expect(a.confidence).toBe("decisive");
  });

  it("model:ignored-guidance is probable when the model printed the call as text", () => {
    const a = attributeFailure(trace([
      started(), contract(["file-read"]),
      signal(1, "sig-1-1", "Grounding required: call file-read now.", { metadata: { requiredTools: ["file-read"] } }),
      rendered(1, "sig-1-1"),
      exchange({ iter: 1, content: "```bash\nfile-read(path=/w/a.csv)\n```" }),
      guard(1, "act-or-answer", "pass", "no-call", { result: "no-call", tools: [] }),
      effect(2, "sig-1-1", "ignored"),
      completed("failure", "abstained", { status: "abstained" }),
    ]));
    expect(a.reason).toBe("model:ignored-guidance");
    expect(a.confidence).toBe("probable");
  });

  it("model:had-evidence-wrong-output — the evidence was in the request and the graded file is wrong", () => {
    const a = attributeFailure(trace([
      started(), contract(["file-read", "file-write"], ["mean.txt"]),
      exchange({ iter: 1, toolCalls: [{ name: "file-read", arguments: { path: "/w/readings.csv" } }] }),
      ...call(1, "file-read", { path: "/w/readings.csv" }, true, CSV),
      exchange({ iter: 2, messages: readMsgs(CSV), toolCalls: [{ name: "file-write", arguments: { path: "./mean.txt", content: "20.48" } }] }),
      ...call(2, "file-write", { path: "/w/mean.txt", content: "20.48" }, true, "✓ Written"),
      completed("success", "end_turn"),
      graded(false, [{ name: "mean within 0.01 of 21.8300", passed: false }]),
    ]));
    expect(a.reason).toBe("model:had-evidence-wrong-output");
    expect(a.target).toEqual({ kind: "file", ref: "mean.txt", source: "contract" });
    expect(a.divergenceTurn?.iter).toBe(2);
    expect(a.confidence).toBe("decisive");
  });

  it("without a grader, a wrong-but-clean run is not judged wrong", () => {
    const a = attributeFailure(trace([
      started(), contract(["file-read", "file-write"], ["mean.txt"]),
      ...call(1, "file-read", { path: "/w/readings.csv" }, true, CSV),
      exchange({ iter: 2, messages: readMsgs(CSV), toolCalls: [{ name: "file-write", arguments: { path: "./mean.txt", content: "20.48" } }] }),
      ...call(2, "file-write", { path: "/w/mean.txt", content: "20.48" }, true, "✓ Written"),
      completed("success", "end_turn"),
    ]));
    expect(a.verdict).toBe("not-failed");
  });
});

// One failure taxonomy (Plan 9 item 7, H3 baseline 2026-11-05 instrument findings).
describe("attributeFailure — shared taxonomy", () => {
  const verdict = (checks: { name: string; passed: boolean }[]) =>
    mk({ ...at(1), kind: "verifier-verdict", action: "final-answer", terminal: true, source: "kernel", verified: false, summary: "rejected", checks });

  it("model:fabrication-vetoed — the run's own fabrication check refused the model's answer, even when a partial grader passed", () => {
    // qwen rw-6: invented before/after benchmarks with only file tools; the hidden check graded the file half only.
    const a = attributeFailure(trace([
      started(), contract(["file-write"], ["report.md"]),
      exchange({ iter: 0, toolCalls: [{ name: "file-write", arguments: { path: "/w/report.md", content: "x" } }] }),
      ...call(0, "file-write", { path: "/w/report.md", content: "x" }, true, "✓ Written"),
      verdict([{ name: "output-not-fabricated-measurement", passed: false }]),
      completed("failure", "final_answer", { success: false }),
      graded(true, [{ name: "bun hidden-check.ts", passed: true }]),
    ]));
    expect(a.reason).toBe("model:fabrication-vetoed");
    expect(a.verdict).toBe("model");
    expect(a.alsoMatched).toContain("harness:false-veto");
  });

  it("a fabrication veto of harness-assembled text stays harness:false-veto", () => {
    // qwen rw-9 run3: the staleness veto made the harness assemble the answer; that text was then vetoed.
    const a = attributeFailure(trace([
      started(), contract(["file-write"], ["prices.md"]),
      verdict([{ name: "output-is-model-authored", passed: false }, { name: "output-not-fabricated-listed-entities", passed: false }]),
      completed("failure", "harness_deliverable", { success: false }),
      graded(true, [{ name: "bun hidden-check.ts", passed: true }]),
    ]));
    expect(a.reason).toBe("harness:false-veto");
  });

  it("harness:subpass-abstained — a pass abstained with 0 LLM calls and the run kept going on top of it", () => {
    // qwen h3-plan-only: a file-read plan step held to file-write abstained pre-loop; the next step invented data.
    const a = attributeFailure(trace([
      started(), contract(["file-read", "file-write"], ["low.txt"]),
      exchange({ iter: 0, content: "plan" }),
      guard(0, "terminal_decision", "terminate", "abstained", { authority: "abstention", iterationCap: { counter: "iteration", observed: 0, threshold: 5, llmCalls: 0, capped: false } }),
      exchange({ iter: 0, toolCalls: [{ name: "file-write", arguments: { path: "/w/low.txt", content: "A123" } }] }),
      ...call(0, "file-write", { path: "/w/low.txt", content: "A123" }, true, "✓ Written"),
      completed("failure", "end_turn", { success: false }),
      graded(false, [{ name: "low.txt is exactly the sorted SKUs below 10", passed: false }]),
    ]));
    expect(a.reason).toBe("harness:subpass-abstained");
    expect(a.verdict).toBe("harness");
  });

  it("an abstention that ends the run (no later LLM call) is not a subpass abstention", () => {
    const a = attributeFailure(trace([
      started(), exchange({ iter: 0, content: "x" }),
      guard(0, "terminal_decision", "terminate", "abstained", { iterationCap: { llmCalls: 0 } }),
      completed("failure", "abstained", { status: "abstained" }),
    ]));
    expect(a.reason).not.toBe("harness:subpass-abstained");
  });

  it("every failure cause has exactly one owner in the taxonomy", () => {
    for (const [cause, reason] of Object.entries(CAUSE_ATTRIBUTION)) {
      expect(reason === "unattributed" || /^(harness|model|environment):/.test(reason)).toBe(true);
      expect(verdictOf(reason)).toBe(reason === "unattributed" ? "unattributed" : (reason.split(":")[0] as "harness" | "model" | "environment"));
      expect(cause.length).toBeGreaterThan(0);
    }
  });
});

describe("attributeFailure — unattributed", () => {
  it("an output produced with no tool evidence and no harness fault is unattributed, with the missing signal named", () => {
    const a = attributeFailure(trace([
      started(),
      exchange({ iter: 0, content: "SKU-001\nSKU-002\nSKU-003 are low", toolCalls: [{ name: "file-write", arguments: { path: "/w/low.txt", content: "SKU-001" } }] }),
      ...call(0, "file-write", { path: "/w/low.txt", content: "SKU-001" }, true, "✓ Written"),
      completed("success", "end_turn"),
      graded(false, [{ name: "low.txt is exactly the sorted SKUs below 10", passed: false }]),
    ]));
    expect(a.verdict).toBe("unattributed");
    expect(a.missing.join(" ")).toContain("no tool evidence");
    expect(a.divergenceTurn?.iter).toBe(0);
  });

  it("grader command checks (`bun test ./x.test.ts`) are not taken as a file to write", () => {
    const a = attributeFailure(trace([
      started(),
      ...call(0, "file-read", { path: "/w/src/validator.ts" }, true, "export function validate(input) {\n  if (!input) return false;\n}"),
      exchange({ iter: 1, messages: [{ role: "tool", content: "export function validate(input) {\n  if (!input) return false;\n}" }], toolCalls: [{ name: "file-write", arguments: { path: "/w/src/validator.ts", content: "export function validate() { return true }" } }] }),
      ...call(1, "file-write", { path: "/w/src/validator.ts", content: "export function validate() { return true }" }, true, "✓ Written"),
      completed("success", "end_turn"),
      graded(false, [{ name: "bun test ./hidden-reference.test.ts", passed: false }]),
    ]));
    expect(a.target?.ref).toBe("validator.ts");
    expect(a.reason).toBe("model:had-evidence-wrong-output");
  });
});

describe("renderAttribution / tallyAttributions", () => {
  it("renders the verdict line and evidence, and tallies by verdict and reason", () => {
    const a = attributeFailure(trace([started(), completed("failure", "harness_synthesis", { success: true }), graded(true, [])]));
    const text = renderAttribution(a);
    expect(text).toContain("harness (harness:false-veto)");
    expect(text).toContain("evidence  eval-graded#");
    const t = tallyAttributions([a, attributeFailure(trace([started(), completed("success", "end_turn")]))]);
    expect(t.total).toBe(2);
    expect(t.byVerdict.harness).toBe(1);
    expect(t.byVerdict["not-failed"]).toBe(1);
    expect(t.byReason["harness:false-veto"]).toBe(1);
  });
});
