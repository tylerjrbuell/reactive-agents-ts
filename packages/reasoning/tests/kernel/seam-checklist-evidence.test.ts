// File: tests/kernel/seam-checklist-evidence.test.ts
//
// Todo evidence reconciliation (owner 2026-11-19: runs finished "success" with
// dangling todo rows, e.g. Cortex traces 01M7T7ESGHR5* ending 1/6 done and
// 01M7T73E1AK9* ending 2/5 done). Root cause in those traces: the model wrote
// tool hints in the provider FC spelling (`functions.umami_list_websites`)
// while the tool ran as `umami/list_websites`, and the harness auto-ticked
// SEEDED plans only. Nothing ticked the model's own rows, nothing closed the
// "compile the report" row the accepted answer delivered, and nothing said
// which rows were left without evidence.
//
// Pins (all deterministic, zero prompt change):
//   - toolHintMatches: separator / case / `functions.` namespace collapse;
//   - evidenceTicks: a successful call ticks the earliest open row naming it
//     (in_progress first), one row per call, never a row the model already
//     settled, never a reversed row;
//   - the per-turn seam ticks a model-built list (no seed) with provenance;
//   - the terminal: answer rows close on the accepted answer, rows without
//     evidence are reported unresolved and stay open;
//   - two scripted reactive runs reproducing the 1/6 and 2/5 shapes.
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { foldAdvisory, type ChecklistFact } from "@reactive-agents/core";
import {
  checklistReconciliation,
  evidenceTicks,
  isAnswerRow,
  reconcileChecklistAtTerminal,
  toolHintMatches,
} from "../../src/kernel/capabilities/verify/checklist-evidence.js";
import { applyFollowPlanGuidance } from "../../src/kernel/loop/iterate-follow-plan-seam.js";
import { appendEntries, type LedgerEntryInput, type RunLedger } from "../../src/kernel/ledger/run-ledger.js";
import { recordChecklistItems } from "../../src/kernel/ledger/emit.js";
import { initialKernelState, transitionState, type KernelInput, type KernelState } from "../../src/kernel/state/kernel-state.js";
import { executeReactive } from "../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";

const led = (...entries: LedgerEntryInput[]): RunLedger => appendEntries(undefined, entries);
const add = (iteration: number, items: { id: string; title: string; tool?: string }[]): LedgerEntryInput => ({
  kind: "checklist-item",
  iteration,
  change: { op: "add", items },
  toolCallId: `todo-${iteration}`,
});
const mark = (iteration: number, id: string, status: "pending" | "in_progress" | "completed"): LedgerEntryInput => ({
  kind: "checklist-item",
  iteration,
  change: { op: "status", id, status },
  toolCallId: `todo-mark-${iteration}-${id}`,
});
const result = (iteration: number, toolName: string, success = true, toolCallId = `call-${toolName}-${iteration}`): LedgerEntryInput => ({
  kind: "tool-result",
  iteration,
  toolName,
  toolCallId,
  success,
  preview: "ok",
});
const answerAccepted = (iteration: number): LedgerEntryInput[] => [
  { kind: "requirement", iteration: 0, requirementId: "answer", status: "declared", description: "produce a substantive answer that addresses the task", requirementKind: "question-answered" },
  { kind: "requirement", iteration, requirementId: "answer", status: "satisfied" },
];
const statuses = (ledger: RunLedger | undefined): string[][] =>
  foldAdvisory((ledger ?? []).flatMap((e): ChecklistFact[] => (e.kind === "checklist-item" ? [e] : []))).map((i) => [i.id, i.status]);
const harnessFacts = (ledger: RunLedger | undefined) =>
  (ledger ?? []).flatMap((e) => (e.kind === "checklist-item" && e.provenance !== undefined ? [e] : []));

/** The 01M7T7ESGHR5* list: five tool rows in the provider spelling plus a hint-less report row. */
const UMAMI_ROWS = [
  { id: "1", title: "List all websites available to analyze", tool: "functions.umami_list_websites" },
  { id: "2", title: "Get the date range of data available for each website", tool: "functions.umami_get_website_daterange" },
  { id: "3", title: "Get website stats for the last week", tool: "functions.umami_get_website_stats" },
  { id: "4", title: "Get website metrics for top pages, referrers, and countries", tool: "functions.umami_get_website_metrics" },
  { id: "5", title: "Get website traffic trends", tool: "functions.umami_get_website_traffic" },
  { id: "6", title: "Compile the analysis report" },
];

describe("toolHintMatches: one tool, any spelling", () => {
  it("collapses separators, case and the provider's `functions.` namespace", () => {
    expect(toolHintMatches("functions.umami_list_websites", "umami/list_websites")).toBe(true);
    expect(toolHintMatches("umami_get_website_stats", "umami/get_website_stats")).toBe(true);
    expect(toolHintMatches("web_search", "web-search")).toBe(true);
    expect(toolHintMatches("webSearch", "web-search")).toBe(true);
    expect(toolHintMatches("web-search", "web-search")).toBe(true);
  });
  it("never matches a different tool, an empty hint, or a bare namespace", () => {
    expect(toolHintMatches("functions.umami_get_website_stats", "umami/get_website_metrics")).toBe(false);
    expect(toolHintMatches("websearch", "web-search")).toBe(false);
    expect(toolHintMatches("", "web-search")).toBe(false);
    expect(toolHintMatches("functions", "functions")).toBe(true);
    expect(toolHintMatches("functions.", "web-search")).toBe(false);
  });
});

describe("evidenceTicks: a successful call ticks the earliest open row that names it", () => {
  it("(a) model adds 3 hinted rows, calls the tools, never ticks: every row is ticked, each with its call id", () => {
    const ledger = led(
      add(1, UMAMI_ROWS.slice(0, 3)),
      result(2, "umami/list_websites"),
      result(3, "umami/get_website_daterange"),
      result(4, "umami/get_website_stats"),
    );
    expect(evidenceTicks(ledger).map((t) => [t.id, t.toolCallId, t.provenance])).toEqual([
      ["1", "call-umami/list_websites-2", "harness:evidence"],
      ["2", "call-umami/get_website_daterange-3", "harness:evidence"],
      ["3", "call-umami/get_website_stats-4", "harness:evidence"],
    ]);
  });

  it("one call ticks one row: the in_progress row first, else the first open row in list order", () => {
    const rows = [
      { id: "1", title: "search A", tool: "web-search" },
      { id: "2", title: "search B", tool: "web-search" },
      { id: "3", title: "search C", tool: "web-search" },
    ];
    expect(evidenceTicks(led(add(1, rows), result(2, "web-search"))).map((t) => t.id)).toEqual(["1"]);
    expect(evidenceTicks(led(add(1, rows), mark(1, "3", "in_progress"), result(2, "web-search"))).map((t) => t.id)).toEqual(["3"]);
    expect(evidenceTicks(led(add(1, rows), result(2, "web-search", true, "a"), result(3, "web-search", true, "b"))).map((t) => t.id)).toEqual(["1", "2"]);
  });

  it("the model's own mark in the same round as the call settles that row; the call is not re-spent on the next row", () => {
    const rows = [
      { id: "1", title: "search A", tool: "web-search" },
      { id: "2", title: "search B", tool: "web-search" },
    ];
    expect(evidenceTicks(led(add(1, rows), result(2, "web-search"), mark(2, "1", "completed")))).toEqual([]);
    expect(evidenceTicks(led(add(1, rows), mark(2, "1", "completed"), result(2, "web-search")))).toEqual([]);
  });

  it("inert: failed call, guard reply, refused call, call before the row existed, model reversal, plan rows, sub-agent rows", () => {
    const rows = [{ id: "1", title: "Fetch the price", tool: "crypto-price" }];
    expect(evidenceTicks(led(add(1, rows), result(2, "crypto-price", false)))).toEqual([]);
    expect(evidenceTicks(led(add(1, rows), { ...result(2, "crypto-price"), harnessAuthored: true } as LedgerEntryInput))).toEqual([]);
    expect(evidenceTicks(led(add(1, rows), { ...result(2, "crypto-price"), refused: true } as LedgerEntryInput))).toEqual([]);
    expect(evidenceTicks(led(result(0, "crypto-price"), add(1, rows)))).toEqual([]);
    // The harness ticked it, then the model set it back to pending: never re-ticked.
    const reversed = recordChecklistItems(led(add(1, rows), result(2, "crypto-price")), [
      { iteration: 2, change: { op: "status", id: "1", status: "completed" }, toolCallId: "call-crypto-price-2", provenance: "harness:evidence" },
      { iteration: 3, change: { op: "status", id: "1", status: "pending" } },
    ]);
    expect(evidenceTicks(reversed)).toEqual([]);
    expect(evidenceTicks(led({ ...add(1, rows), origin: "plan" } as LedgerEntryInput, result(2, "crypto-price")))).toEqual([]);
    expect(evidenceTicks(led({ ...add(1, rows), pass: "sub-agent:w" } as LedgerEntryInput, result(2, "crypto-price")))).toEqual([]);
  });

  it("idempotent: once the ticks are recorded there is nothing left to tick", () => {
    const ledger = led(add(1, UMAMI_ROWS.slice(0, 2)), result(2, "umami/list_websites"), result(3, "umami/get_website_daterange"));
    const ticks = evidenceTicks(ledger);
    const recorded = recordChecklistItems(
      ledger,
      ticks.map((t) => ({ iteration: 3, change: { op: "status" as const, id: t.id, status: "completed" as const }, toolCallId: t.toolCallId, provenance: t.provenance })),
    );
    expect(evidenceTicks(recorded)).toEqual([]);
  });
});

describe("the per-turn seam ticks a model-built list (no seed), silently", () => {
  const input = (over: Partial<KernelInput> = {}): KernelInput => ({ task: "t", ...over }) as KernelInput;
  const fresh = (ledger: RunLedger): KernelState =>
    transitionState(initialKernelState({ maxIterations: 8, strategy: "reactive", kernelType: "react" }), { ledger });

  it("(a) ticks with provenance + call id, adds no guidance text, and is idempotent", () => {
    const s = fresh(led(add(1, UMAMI_ROWS.slice(0, 3)), result(2, "umami/list_websites"), result(2, "umami/get_website_daterange")));
    const applied = applyFollowPlanGuidance(s, input());
    expect(statuses(applied.ledger)).toEqual([["1", "completed"], ["2", "completed"], ["3", "pending"]]);
    expect(harnessFacts(applied.ledger).map((f) => [f.change, f.toolCallId, f.provenance])).toEqual([
      [{ op: "status", id: "1", status: "completed" }, "call-umami/list_websites-2", "harness:evidence"],
      [{ op: "status", id: "2", status: "completed" }, "call-umami/get_website_daterange-2", "harness:evidence"],
    ]);
    expect(applied.pendingGuidance).toEqual(s.pendingGuidance);
    expect(applyFollowPlanGuidance(applied, input())).toBe(applied);
  });

  it("inert under the autoTick kill switch and in plan posture (state identity)", () => {
    const s = fresh(led(add(1, UMAMI_ROWS.slice(0, 1)), result(2, "umami/list_websites")));
    expect(applyFollowPlanGuidance(s, input({ harness: { autoTick: false } } as Partial<KernelInput>))).toBe(s);
    expect(applyFollowPlanGuidance(s, input({ posture: "plan" } as Partial<KernelInput>))).toBe(s);
  });
});

describe("isAnswerRow: rows the accepted answer itself delivers", () => {
  it("synthesis verbs with no file target", () => {
    expect(isAnswerRow("Compile the analysis report")).toBe(true);
    expect(isAnswerRow("Compile a full analysis report based on the collected data")).toBe(true);
    expect(isAnswerRow("Summarize the findings")).toBe(true);
    expect(isAnswerRow("Step 6: write the final answer")).toBe(true);
  });
  it("never a gather row, a file deliverable, or a send/save row", () => {
    expect(isAnswerRow("Get website traffic trends")).toBe(false);
    expect(isAnswerRow("Write the report to report.md")).toBe(false);
    expect(isAnswerRow("Write the summary to a file")).toBe(false);
    expect(isAnswerRow("Send the summary by email")).toBe(false);
  });
});

describe("terminal reconciliation", () => {
  it("(c) the accepted answer closes the hint-less report row; (b) a row without evidence is reported unresolved and stays open", () => {
    // 01M7T73E1AK9* shape: list + daterange ticked by the model, stats called, metrics never called.
    const rows = [
      { id: "1", title: "List all accessible websites to identify the target website", tool: "functions.umami_list_websites" },
      { id: "2", title: "Determine the available data range for the selected website", tool: "functions.umami_get_website_daterange" },
      { id: "3", title: "Collect website traffic statistics for the last week", tool: "functions.umami_get_website_stats" },
      { id: "4", title: "Fetch detailed traffic metrics to analyze visitor behavior", tool: "functions.umami_get_website_metrics" },
      { id: "5", title: "Compile a full analysis report based on the collected data" },
    ];
    const ledger = led(
      ...answerAccepted(8),
      add(1, rows),
      result(2, "umami/list_websites"),
      mark(3, "1", "completed"),
      result(4, "umami/get_website_daterange"),
      mark(5, "2", "completed"),
      result(6, "umami/get_website_stats"),
    );
    const facts = reconcileChecklistAtTerminal(ledger, 8);
    expect(facts.map((f) => [f.change, f.provenance])).toEqual([
      [{ op: "status", id: "3", status: "completed" }, "harness:evidence"],
      [{ op: "status", id: "5", status: "completed" }, "harness:answer"],
    ]);
    const closed = recordChecklistItems(ledger, facts);
    expect(statuses(closed)).toEqual([["1", "completed"], ["2", "completed"], ["3", "completed"], ["4", "pending"], ["5", "completed"]]);
    const report = checklistReconciliation(closed);
    expect(report).toEqual({
      total: 5,
      done: 4,
      closedByHarness: [
        { id: "3", title: rows[2]!.title, provenance: "harness:evidence", toolCallId: "call-umami/get_website_stats-6" },
        { id: "5", title: rows[4]!.title, provenance: "harness:answer" },
      ],
      unresolved: [{ id: "4", title: rows[3]!.title, status: "pending", reason: "no evidence" }],
    });
    // Idempotent at the terminal.
    expect(reconcileChecklistAtTerminal(closed, 8)).toEqual([]);
  });

  it("no accepted answer: the report row is not closed, it is reported unresolved", () => {
    const ledger = led(add(1, [{ id: "1", title: "Compile the analysis report" }]));
    expect(reconcileChecklistAtTerminal(ledger, 3)).toEqual([]);
    expect(checklistReconciliation(ledger)?.unresolved).toEqual([
      { id: "1", title: "Compile the analysis report", status: "pending", reason: "no evidence" },
    ]);
  });

  it("a run with no todo rows has no reconciliation record", () => {
    expect(checklistReconciliation(led(...answerAccepted(2)))).toBeUndefined();
    expect(reconcileChecklistAtTerminal(led(...answerAccepted(2)), 2)).toEqual([]);
  });
});

// ─── Scripted runs: the two Cortex traces, end to end ────────────────────────

const UMAMI_TOOLS = [
  "umami/list_websites",
  "umami/get_website_daterange",
  "umami/get_website_stats",
  "umami/get_website_metrics",
  "umami/get_website_traffic",
];
const SCHEMAS = UMAMI_TOOLS.map((name) => ({
  name,
  description: `umami ${name}`,
  parameters: [{ name: "websiteId", type: "string", required: false }],
}));
let served = 0;
const toolLayer = mockToolServiceLayer({
  execute: (req: { toolName: string }) =>
    Effect.succeed({
      success: true,
      result: { tool: req.toolName, data: `row ${++served}: ` + Array.from({ length: 60 }, (_, k) => `v${served}x${k}`).join(" ") },
    }),
  getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: SCHEMAS[0]!.parameters }),
});
let padN = 0;
const pad = (): string => {
  padN += 1;
  return Array.from({ length: 450 }, (_, i) => `t${padN}x${i}`).join(" ");
};
const call = (name: string, args: Record<string, unknown> = { websiteId: "w1" }) => ({ text: pad(), toolCall: { name, args } });
const REPORT =
  "Weekly report for docs.reactiveagents.dev: 623 pageviews, 439 visitors and 455 visits, a 66.8% bounce rate, " +
  "with the top pages, referrers and countries listed in the metrics above.";

const runReactive = (turns: Parameters<typeof TestLLMServiceLayer>[0]) =>
  Effect.runPromise(
    executeReactive({
      taskDescription: "Analyze my umami website stats for the last week and give me a full report.",
      taskType: "research",
      memoryContext: "",
      availableTools: UMAMI_TOOLS,
      availableToolSchemas: SCHEMAS,
      metaTools: { todo: true },
      config: {
        ...defaultReasoningConfig,
        strategies: {
          ...defaultReasoningConfig.strategies,
          reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations: 12, maxIterationsExplicit: true },
        },
      },
      maxIterations: 12,
    } as never).pipe(Effect.provide(Layer.merge(TestLLMServiceLayer(turns), toolLayer)), provideTestEnvelope),
  );

const ledgerOf = (r: { readonly metadata: unknown }): RunLedger =>
  ((r.metadata as { runLedger?: RunLedger }).runLedger ?? []) as RunLedger;
const reconciliationOf = (r: { readonly metadata: unknown }) =>
  (r.metadata as { extensions?: { checklist?: unknown } }).extensions?.checklist;

describe("scripted runs: no run ends with silently dangling todo rows", () => {
  it("01M7T7ESGHR5* shape (ended 1/6): every called row and the report row are closed by the harness; the uncalled row is reported", async () => {
    const r = await runReactive([
      call("todo", { action: "add", items: UMAMI_ROWS.map((x) => x.title), tools: UMAMI_ROWS.map((x) => x.tool ?? "") }),
      call("umami/list_websites", {}),
      call("todo", { action: "done", id: 1 }),
      call("umami/get_website_daterange"),
      { text: pad(), toolCalls: [
        { name: "umami/get_website_stats", args: { websiteId: "w1" } },
        { name: "umami/get_website_metrics", args: { websiteId: "w1", type: "path" } },
      ] },
      { text: REPORT },
    ]);
    expect(r.status).toBe("completed");
    expect(statuses(ledgerOf(r))).toEqual([
      ["1", "completed"], ["2", "completed"], ["3", "completed"], ["4", "completed"], ["5", "pending"], ["6", "completed"],
    ]);
    const report = reconciliationOf(r) as { done: number; total: number; unresolved: { id: string; reason: string }[]; closedByHarness: { id: string; provenance: string }[] };
    expect([report.done, report.total]).toEqual([5, 6]);
    expect(report.unresolved).toEqual([{ id: "5", title: UMAMI_ROWS[4]!.title, status: "pending", reason: "no evidence" }]);
    expect(report.closedByHarness.map((c) => [c.id, c.provenance])).toEqual([
      ["1", "harness:evidence"], ["2", "harness:evidence"], ["3", "harness:evidence"], ["4", "harness:evidence"], ["6", "harness:answer"],
    ]);
  }, 30000);

  it("01M7T73E1AK9* shape (ended 2/5): all five rows done, nothing unresolved", async () => {
    const rows = [
      { title: "List all accessible websites to identify the target website", tool: "functions.umami_list_websites" },
      { title: "Determine the available data range for the selected website", tool: "functions.umami_get_website_daterange" },
      { title: "Collect website traffic statistics for the last week", tool: "functions.umami_get_website_stats" },
      { title: "Fetch detailed traffic metrics to analyze visitor behavior", tool: "functions.umami_get_website_metrics" },
      { title: "Compile a full analysis report based on the collected data", tool: "" },
    ];
    const r = await runReactive([
      call("todo", { action: "add", items: rows.map((x) => x.title), tools: rows.map((x) => x.tool) }),
      call("umami/list_websites", {}),
      call("todo", { action: "done", id: 1 }),
      call("umami/get_website_daterange"),
      call("todo", { action: "done", id: 2 }),
      call("umami/get_website_stats"),
      call("umami/get_website_metrics", { websiteId: "w1", type: "path" }),
      { text: REPORT },
    ]);
    expect(r.status).toBe("completed");
    expect(statuses(ledgerOf(r)).map(([, s]) => s)).toEqual(["completed", "completed", "completed", "completed", "completed"]);
    const report = reconciliationOf(r) as { unresolved: unknown[]; closedByHarness: { id: string }[] };
    expect(report.unresolved).toEqual([]);
    // The harness ticks right after each call, so the model's later marks of rows 1 and 2 are no-ops.
    expect(report.closedByHarness.map((c) => c.id)).toEqual(["1", "2", "3", "4", "5"]);
  }, 30000);
});
