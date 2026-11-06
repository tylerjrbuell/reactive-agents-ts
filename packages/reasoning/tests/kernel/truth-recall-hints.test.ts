// Run: bun test packages/reasoning/tests/kernel/truth-recall-hints.test.ts --timeout 15000
//
// Truthfulness audit 2026-11-06, item 3: harness text told the model to call
// recall(...) while recall was off the wire (73 real-model runs): the overflow
// preview ("Re-read any section with recall(…)"), the compaction stub
// ("retrievable by reference: recall(…)"), the gather-dedup nudge and the
// code-execute failure text ("use recall() + manual extraction").
//
// One predicate now decides: `recallHintIfCallable` (assembly/ref-grammar.ts)
// renders a recall pointer only when recall is offered. When a pointer does
// render, the recall-overflow gate sees it (tool_result or compaction stub)
// and keeps recall callable, so text and surface agree.
//
// RED-ON-CUT: make recallHintIfCallable ignore `recallCallable` and the
// "recall not offered" tests fail.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { project } from "../../src/assembly/project.js";
import { EventLog } from "../../src/assembly/event-log.js";
import { ResultStore } from "../../src/assembly/result-store.js";
import { resolveCapability } from "../../src/assembly/capability.js";
import { compact, type CompactMessage, type ResultInfo } from "../../src/assembly/compaction.js";
import { buildDedupNudge } from "../../src/assembly/gather-dedup.js";
import {
  filterRecallByOverflow,
  recallKeyVisibleInWindow,
} from "../../src/kernel/capabilities/reason/think-guards.js";

const cap = resolveCapability({ window: 1000, outputBudget: 2000, dialect: "native-fc", tier: "local" });

/** One overflowing scratchpad-backed web-search result, projected with `schemas`. */
function projectOverflow(schemas: readonly { name: string }[]) {
  const prev = process.env.RA_TOOL_RESULT_BUDGET_CHARS;
  process.env.RA_TOOL_RESULT_BUDGET_CHARS = "200";
  try {
    const store = new ResultStore();
    const big = Array.from({ length: 40 }, (_, j) => ({ n: j, note: `fact ${j} ${"y".repeat(40)}` }));
    store.putWithRef("_tool_result_1", "web-search", big);
    const log = new EventLog()
      .append({ kind: "goal", text: "gather facts" })
      .append({ kind: "tool_called", tool: "web-search", callId: "c1", args: { q: "q" } })
      .append({ kind: "tool_result", callId: "c1", ref: "_tool_result_1", shape: "Array(40)" });
    return project({ log, capability: cap, store, persona: { system: "Agent" }, tools: { schemas } }).request;
  } finally {
    if (prev === undefined) delete process.env.RA_TOOL_RESULT_BUDGET_CHARS;
    else process.env.RA_TOOL_RESULT_BUDGET_CHARS = prev;
  }
}

const toolResultText = (messages: readonly { role: string; content: unknown }[]): string =>
  messages
    .filter((m) => m.role === "tool_result")
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("\n");

const recallSchema = { name: "recall" };
const webSchema = { name: "web-search" };

describe("truth item 3 — no recall instruction unless recall is callable", () => {
  it("overflow preview, recall NOT offered: no recall(…) text", () => {
    const req = projectOverflow([webSchema]);
    const text = toolResultText(req.messages);
    expect(text).toContain("content truncated");
    expect(text).not.toContain("recall(");
  });

  it("overflow preview, recall offered: pointer renders AND the gate keeps recall callable", () => {
    const req = projectOverflow([webSchema, recallSchema]);
    expect(toolResultText(req.messages)).toContain('recall("_tool_result_1"');
    const gated = filterRecallByOverflow([webSchema, recallSchema], req.messages);
    expect(gated.map((s) => s.name)).toContain("recall");
  });

  const thread = (): CompactMessage[] => [
    { role: "user", content: "goal" },
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "web-search", arguments: {} }] },
    { role: "tool_result", toolCallId: "c1", toolName: "web-search", content: "x".repeat(3000) },
    { role: "assistant", content: "", toolCalls: [{ id: "c2", name: "web-search", arguments: {} }] },
    { role: "tool_result", toolCallId: "c2", toolName: "web-search", content: "z".repeat(300) },
  ];
  const info: ReadonlyMap<string, ResultInfo> = new Map([
    ["c1", { ref: "_tool_result_1", preserve: false }],
    ["c2", { ref: "_tool_result_2", preserve: false }],
  ]);

  it("compaction stub, recall NOT offered: names the stored key, no recall instruction", () => {
    const out = compact({ messages: thread(), limitChars: 1000, resultInfo: info, recallCallable: false });
    const stub = out.messages.find((m) => typeof m.content === "string" && m.content.startsWith("[history compacted:"));
    expect(stub).toBeDefined();
    expect(stub!.content).not.toContain("recall(");
    expect(stub!.content).not.toContain("retrievable");
    expect(stub!.content).toContain("_tool_result_1");
  });

  it("compaction stub, recall offered: pointer renders AND the gate recognizes the stub", () => {
    const out = compact({ messages: thread(), limitChars: 1000, resultInfo: info, recallCallable: true });
    const stub = out.messages.find((m) => typeof m.content === "string" && m.content.startsWith("[history compacted:"));
    expect(stub!.content).toContain('recall("_tool_result_1", full: true)');
    expect(recallKeyVisibleInWindow([{ role: "user", content: stub!.content }])).toBe(true);
    // a user message that merely mentions recall does not open the gate
    expect(recallKeyVisibleInWindow([{ role: "user", content: 'please recall("_tool_result_1")' }])).toBe(false);
  });

  it("gather-dedup nudge from the act phase never instructs a recall call", () => {
    const nudge = buildDedupNudge([{ toolName: "web-search", argsHash: "h", priorRef: "_tool_result_1" }]);
    expect(nudge).not.toContain("recall(");
  });

  it("code-execute failure text carries no bare recall() instruction", () => {
    const src = readFileSync(
      new URL("../../src/kernel/capabilities/act/tool-execution.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toContain("use recall() + manual extraction");
    expect(src).toContain("Fix the code and retry.`");
  });
});
