// Run: bun test packages/diagnose/tests/cause-report.test.ts --timeout 15000
//
// Single-run `rax-diagnose cause` prints the framework's plain words for the
// cause and the next steps the diagnosis justifies (one vocabulary with Cortex).
import { describe, it, expect } from "bun:test";
import { analyzeCause, attributeFailure, causeDescription, parseTrace } from "@reactive-agents/trace";
import { renderCauseReport } from "../src/commands/cause.js";

const line = (o: Record<string, unknown>): string => JSON.stringify(o);
const providerFailure = [
  line({ kind: "run-started", runId: "P", iter: -1, seq: 0, timestamp: 1, task: "t", model: "m", provider: "ollama", config: {} }),
  line({ kind: "guard-fired", runId: "P", iter: 0, seq: 1, timestamp: 2, guard: "terminal_decision", outcome: "terminate", reason: "llm_error", metadata: { terminatedBy: "llm_error", status: "failed", authority: "error" } }),
  line({ kind: "run-completed", runId: "P", iter: -1, seq: 2, timestamp: 3, status: "failure", terminatedBy: "llm_error", error: "model not found", totalTokens: 0, totalCostUsd: 0, durationMs: 1 }),
].join("\n");

describe("rax-diagnose cause — single-run report", () => {
  it("prints the cause's meaning and its next step", () => {
    const trace = parseTrace(providerFailure);
    const analysis = analyzeCause(trace);
    expect(analysis).toMatchObject({ cause: "provider-error", subCause: "model-not-found" });
    const out = renderCauseReport(analysis, attributeFailure(trace));
    expect(out).toContain(`meaning   ${causeDescription("provider-error")}`);
    expect(out).toContain("next      Check the model name; for Ollama, pull the model first.");
    expect(out).toContain("attribution ");
  });

  it("prints no next line when the diagnosis justifies none", () => {
    const stopped = [
      line({ kind: "run-started", runId: "S", iter: -1, seq: 0, timestamp: 1, task: "t", model: "m", provider: "ollama", config: {} }),
      line({ kind: "run-aborted", runId: "S", iter: -1, seq: 1, timestamp: 2, causeClass: "interrupt", reason: "user-stop", durationMs: 1 }),
    ].join("\n");
    const trace = parseTrace(stopped);
    const out = renderCauseReport(analyzeCause(trace), attributeFailure(trace));
    expect(out).toContain("meaning   Stopped by the user");
    expect(out).not.toContain("next ");
  });
});
