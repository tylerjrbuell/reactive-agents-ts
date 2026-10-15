// Run: bun test packages/replay/tests/w4-thrash-arbiter.test.ts --timeout 15000
//
// W4.7/W4.1 — the FROZEN false-success fixture, through the replay lane.
//
// The canonical false-success (runId 01M4SXNTN38VM8ZQ0Q85A7FA3E) thrashed
// `discover-tools` with success:true and evidenceDelta:0 on every assessment,
// yet shipped as `status:"success"`. Per the W4 brief correction #1 the thrash is
// FIXTURE-ONLY now: this pin loads the committed trace via `loadRecordedRun` (the
// W0.8 replay-lane loader) and asserts the ONE progress arbiter (design law #5)
// classifies the thrash as NON-PROGRESS and the loop detector now trips on it.
// No live reproduction — the fixture is the oracle.
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import type { ToolCallEvent, TraceEvent } from "@reactive-agents/trace";
import { loadRecordedRun } from "../src/index.js";
import {
  classifyToolResult,
  detectLoop,
  makeObservationResult,
} from "@reactive-agents/reasoning";
import type { ReasoningStep } from "@reactive-agents/reasoning";

const FIXTURE = join(
  import.meta.dir,
  "../../../wiki/Research/Harness-Reports/2026-10-12-live-probe-audit-results/fixtures/01M4SXNTN38VM8ZQ0Q85A7FA3E.jsonl",
);

const toolCalls = (events: readonly TraceEvent[]): ToolCallEvent[] =>
  events.filter((e): e is ToolCallEvent => e.kind === "tool-call-end");

describe("W4 frozen thrash fixture × progress arbiter (replay lane)", () => {
  it("the arbiter classifies the discover-tools thrash as NON-PROGRESS", async () => {
    const run = await loadRecordedRun(FIXTURE);
    const calls = toolCalls(run.trace.events);
    expect(calls.length).toBeGreaterThan(10);
    const discover = calls.filter((c) => c.toolName === "discover-tools");
    expect(discover.length).toBeGreaterThan(10);
    // Every one is a META tool: success-shaped but no task evidence.
    for (const c of discover) {
      const v = classifyToolResult(c.toolName, c.ok ?? true, String(c.result ?? ""));
      expect(v.kind).toBe("non-progress");
      expect(v.reason).toBe("meta-tool");
    }
  }, 15000);

  it("the loop detector trips on the reconstructed thrash (was byte-shape blind)", async () => {
    const run = await loadRecordedRun(FIXTURE);
    const calls = toolCalls(run.trace.events);
    // Reconstruct the action/observation step shape the kernel saw, linking each
    // action to its observation by a synthesized id (the trace carries no id).
    const steps: ReasoningStep[] = [];
    for (const c of calls) {
      const id = `call-${c.seq}`;
      const resultText = String(c.result ?? "");
      steps.push({
        id: `a-${c.seq}` as ReasoningStep["id"],
        type: "action",
        content: JSON.stringify({ tool: c.toolName, input: JSON.stringify(c.args ?? {}) }),
        timestamp: new Date(),
        metadata: { toolCall: { id, name: c.toolName, arguments: {} } },
      });
      steps.push({
        id: `o-${c.seq}` as ReasoningStep["id"],
        type: "observation",
        content: resultText,
        timestamp: new Date(),
        metadata: {
          toolCallId: id,
          observationResult: makeObservationResult(c.toolName, c.ok ?? true, resultText),
        },
      });
    }
    // Local-tier thresholds (maxSameTool=2). Pre-W4.7 the success:true results
    // defeated (d) and the meta actions reset (c) — the loop detector was silent.
    const msg = detectLoop(steps, 2, 3, 4);
    expect(msg).not.toBeNull();
  }, 15000);

  it("the recorded assessments show the false-success precondition the band rule closes", async () => {
    const run = await loadRecordedRun(FIXTURE);
    const assessments = run.trace.events.filter((e) => e.kind === "assessment") as ReadonlyArray<{
      readonly kind: "assessment";
      readonly evidenceDelta: number;
      readonly requirementsOutstanding: number;
      readonly band: string;
    }>;
    expect(assessments.length).toBeGreaterThan(0);
    // evidenceDelta==0 ∧ outstanding>0 on EVERY recorded assessment — exactly the
    // state W4.1's band rule refuses to call "green" (and that (e) counts).
    for (const a of assessments) {
      expect(a.evidenceDelta).toBe(0);
      expect(a.requirementsOutstanding).toBeGreaterThan(0);
    }
  }, 15000);
});
