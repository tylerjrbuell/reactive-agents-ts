// Run: bun test packages/trace/tests/ledger-tool-facts.test.ts
//
// Wave C.2 slice 3c — trace consumers read the LEDGER for tool facts.
//
// 09 §3 C1 makes the RunLedger the substrate; the 2026-07-22 ratification adds
// that "no new reader may scan [another view] when a ledger query answers the
// same question". `tool-call-*` events answer a narrower question than they
// look like they do: they record only what THIS run invoked directly. A parent
// that delegates emits exactly one — `spawn-agent` — while its ledger carries
// the whole delegated tree (merged under `sub-agent:<name>` by slice 2).
//
// That drove a WRONG ANSWER, not just a thin one: `deliverableProduced` and
// `substantiveWorkDone` feed the honesty verdict, so a run that correctly
// delegated all of its work scored as having done none, and its success claim
// was reported as unsupported.
//
// RED-ON-CUT: point `honestyEnds`/`toolStarts` back at the event view and the
// delegation cases below fail — the child's file-write becomes invisible.
import { describe, expect, it } from "bun:test";
import { analyzeInterventions, analyzeRun } from "../src/analyze.js";
import type { Trace } from "../src/replay.js";

const base = { runId: "r1", timestamp: 1000, iter: 0 };

/** A parent that delegated: one direct `spawn-agent`, child work only in the ledger. */
const delegatingTrace = (): Trace => ({
  runId: "r1",
  events: [
    { ...base, kind: "run-started", seq: 0, task: "t", model: "m", provider: "p", config: {} },
    { ...base, kind: "tool-call-start", seq: 1, toolName: "spawn-agent" },
    { ...base, kind: "tool-call-end", seq: 2, toolName: "spawn-agent", ok: true },
    {
      ...base, kind: "ledger-entry", seq: 3,
      entries: [
        { kind: "tool-invocation", seq: 0, iteration: 0, toolName: "spawn-agent" },
        { kind: "tool-result", seq: 1, iteration: 0, success: true, toolName: "spawn-agent" },
        // The child's real work, merged into the parent by slice 2.
        { kind: "tool-invocation", seq: 2, iteration: 0, toolName: "file-write", pass: "sub-agent:worker" },
        { kind: "tool-result", seq: 3, iteration: 0, success: true, toolName: "file-write", pass: "sub-agent:worker" },
      ],
    },
    { ...base, kind: "run-completed", seq: 4, status: "success", totalTokens: 10, totalCostUsd: 0, durationMs: 5 },
  ],
} as unknown as Trace);

describe("tool facts prefer the ledger", () => {
  it("counts a delegated child's tools, which the event view cannot see", () => {
    const a = analyzeInterventions(delegatingTrace());
    // CONTROL: the direct call is still counted — if this vanished the ledger
    // view would be replacing the event view rather than completing it.
    expect(a.toolCallCounts["spawn-agent"]).toBe(1);
    // The delegated work now counts as work.
    expect(a.toolCallCounts["file-write"]).toBe(1);
  });

  it("credits a fully-delegating run with the deliverable its child produced", () => {
    const r = analyzeRun(delegatingTrace());
    // The observable change is in the EVIDENCE, not the label: `spawn-agent`
    // already counted as substantive work, so the verdict stayed
    // "claimed-success (unverified)" either way. What flipped is
    // `deliverableProduced` — before slice 3c the child's `file-write` was
    // invisible and the analyzer reported "no deliverable-file write seen" on a
    // run whose delegate had in fact written the deliverable.
    //
    // Asserting the label here would pass vacuously (verified: cutting the fix
    // leaves the label unchanged). This asserts the thing that actually moves.
    expect(r.honesty.evidence).toContain("deliverable tool succeeded");
    expect(r.honesty.evidence).not.toContain("no deliverable-file write seen");
  });

  // The fallback is what keeps historical JSONL and golden fixtures byte-stable.
  it("falls back to tool-call events when the trace has no ledger entries", () => {
    const noLedger = {
      runId: "r2",
      events: [
        { ...base, runId: "r2", kind: "run-started", seq: 0, task: "t", model: "m", provider: "p", config: {} },
        { ...base, runId: "r2", kind: "tool-call-start", seq: 1, toolName: "file-write" },
        { ...base, runId: "r2", kind: "tool-call-end", seq: 2, toolName: "file-write", ok: true },
      ],
    } as unknown as Trace;
    expect(analyzeInterventions(noLedger).toolCallCounts["file-write"]).toBe(1);
  });

  // A ledger carrying only non-tool entries must not blank the event-derived
  // counts — a richer substrate must never become a regression.
  it("keeps the event view when the ledger holds no tool entries", () => {
    const verdictOnly = {
      runId: "r3",
      events: [
        { ...base, runId: "r3", kind: "run-started", seq: 0, task: "t", model: "m", provider: "p", config: {} },
        { ...base, runId: "r3", kind: "tool-call-start", seq: 1, toolName: "file-write" },
        { ...base, runId: "r3", kind: "tool-call-end", seq: 2, toolName: "file-write", ok: true },
        { ...base, runId: "r3", kind: "ledger-entry", seq: 3, entries: [{ kind: "requirement", seq: 0, iteration: 0 }, { kind: "verdict", seq: 1, iteration: 0 }] },
      ],
    } as unknown as Trace;
    expect(analyzeInterventions(verdictOnly).toolCallCounts["file-write"]).toBe(1);
  });
});
