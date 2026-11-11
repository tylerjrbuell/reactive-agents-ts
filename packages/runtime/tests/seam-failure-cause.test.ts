// Run: bun test packages/runtime/tests/seam-failure-cause.test.ts --timeout 20000
//
// A failed run's `error` is its real cause, never its output text
// (engine/finalize/failure-cause.ts, read by engine/execute-result-assembly.ts).
//
// Defect (2026-11-10, trace 01M73GNDMGG0TMZD9JS78NASAC): a run ended by an
// Ollama stream failure ("ollama call failed ... XML syntax error ... unexpected
// EOF") published `AgentCompleted.error` = the model's last narration, because
// result assembly preferred any non-empty output text over the kernel's error.
//
// Pins:
//   C1 — a kernel/provider failure: error = the kernel's error, not the output.
//   C2 — a runtime veto (outstanding contract): error names the veto and the
//        outstanding items, not the output.
//   C3 — a failed run with no recorded cause: a generic cause naming the
//        termination, still not the output.
//   C4 — a verifier block keeps its own message.
//   C5 — a successful run carries no error.
//   C7 — an empty-output failure: the kernel's cause + "What was attempted"
//        ride error verbatim; the runtime's empty-output veto does not
//        replace them. Red-on-cut: move the veto arm above `reasoning.error`
//        in failure-cause.ts.
//
// Red-on-cut: put `verificationOutcome.output.length > 0 ? verificationOutcome.output :`
// at the head of the error chain in execute-result-assembly.ts; C1-C3 fail.
// (The assembler no longer takes a separate `outputForSuccess`; the output
// reaches it only through `verificationOutcome` and `rr`.)
import { describe, expect, it } from "bun:test";
import type { AgentId, Task, TaskId } from "@reactive-agents/core";
import { assembleTaskResult } from "../src/engine/execute-result-assembly.js";
import type { ExecutionContext } from "../src/types.js";
import type { VerificationOutcome } from "../src/engine/finalize/verification-outcome.js";

const NARRATION = "Let me pull sessions and events for the period.";
const OLLAMA = "ollama call failed (ollama:qwen3): XML syntax error on line 1: unexpected EOF";

const TASK: Task = {
  id: "t1" as TaskId,
  agentId: "a1" as AgentId,
  type: "query",
  input: { question: "q" },
  priority: "medium",
  status: "running",
  metadata: { tags: [] },
  createdAt: new Date(),
};

function makeCtx(metadata: ExecutionContext["metadata"] = {}): ExecutionContext {
  return {
    taskId: "t1",
    agentId: "a1",
    sessionId: "s1",
    phase: "complete",
    agentState: "completed",
    iteration: 3,
    maxIterations: 10,
    messages: [],
    toolResults: [],
    cost: 0,
    tokensUsed: 10,
    startedAt: new Date(),
    metadata,
  };
}

type RR = NonNullable<ExecutionContext["metadata"]["reasoningResult"]>;

function rr(status: string, extra: { error?: string; outstandingCriteria?: readonly string[] } = {}): RR {
  return {
    output: NARRATION,
    status,
    ...(extra.error !== undefined ? { error: extra.error } : {}),
    metadata: {
      cost: 0,
      tokensUsed: 10,
      stepsCount: 3,
      ...(extra.outstandingCriteria !== undefined ? { outstandingCriteria: extra.outstandingCriteria } : {}),
    },
  } as RR;
}

const assemble = (
  ctx: ExecutionContext,
  reasoning: RR | undefined,
  verificationOutcome: VerificationOutcome,
  terminatedByRaw: string,
) =>
  assembleTaskResult({
    task: TASK,
    ctx,
    rr: reasoning,
    verificationOutcome,
    executionDurationMs: 1,
    toolCallLog: [],
    entropyLog: [],
    terminatedByRaw: terminatedByRaw as Parameters<typeof assembleTaskResult>[0]["terminatedByRaw"],
    debrief: undefined,
    boundaryVerification: undefined,
    traceLinkage: null,
    ambientRunMeter: null,
  });

const failed: VerificationOutcome = { output: NARRATION, success: false, blocked: false };

describe("failed run: error is the real cause, never the output text", () => {
  it("C1 provider failure: error = the kernel's error", () => {
    const result = assemble(makeCtx(), rr("failed", { error: OLLAMA }), failed, "llm_error");
    expect(result.error).toBe(OLLAMA);
    expect(result.output).toBe(NARRATION);
  });

  it("C2 outstanding-contract veto: error names the unmet items", () => {
    const ctx = makeCtx({ outstandingContractNotSuccess: true });
    const result = assemble(
      ctx,
      rr("partial", { outstandingCriteria: ["write report.md", "cite sources"] }),
      failed,
      "low_delta_guard",
    );
    expect(result.error).not.toBe(NARRATION);
    expect(result.error).toContain("write report.md");
    expect(result.error).toContain("cite sources");
  });

  it("C3 no recorded cause: a generic cause naming the termination", () => {
    const result = assemble(makeCtx(), rr("partial"), failed, "max_iterations");
    expect(result.error).toBeDefined();
    expect(result.error).not.toBe(NARRATION);
    expect(result.error).toContain("max_iterations");
  });

  it("C4 verifier block keeps its message", () => {
    const blocked: VerificationOutcome = {
      output: "[verification blocked]",
      success: false,
      blocked: true,
      error: "Verification rejected the response: ungrounded",
    };
    const result = assemble(makeCtx({ verificationBlocked: { reason: "ungrounded" } }), rr("completed"), blocked, "final_answer");
    expect(result.error).toBe("Verification rejected the response: ungrounded");
  });

  it("C6 partial (model draft + Unfinished block, refused): output keeps the draft, error names the outstanding items", () => {
    const draft = `${NARRATION}\n\nUnfinished:\n- write the file ./report.md`;
    const terminalOutcome = {
      status: "partial",
      terminatedBy: "stall_deliverable",
      provenance: "model-final",
      verdict: { accepted: false, summary: "1 item unfinished" },
      answerSatisfied: null,
      success: false,
      outstanding: ["answer", "artifact:./report.md"],
    };
    const reasoning = {
      output: draft,
      status: "partial",
      metadata: { cost: 0, tokensUsed: 10, stepsCount: 3, extensions: { terminalOutcome } },
    } as RR;
    const result = assemble(
      makeCtx({ terminalOutcomeNotSuccess: true }),
      reasoning,
      { output: draft, success: false, blocked: false },
      "stall_deliverable",
    );
    expect(result.output).toBe(draft);
    expect(result.error).not.toContain(NARRATION);
    expect(result.error).toContain("artifact:./report.md");
    expect(result.error).toContain("refused");
  });

  it("C7 empty-output failure: the kernel's cause + attempt summary ride error verbatim, ahead of the empty-output veto", () => {
    // Owner decision 2026-11-10: a failed run ships output "" and the kernel
    // puts its cause plus "What was attempted: ..." on `error`. The runtime's
    // generic empty-output veto must not replace that cause.
    const kernelError =
      "Could not complete the task within the available budget.\nWhat was attempted: 2 tool call(s) attempted (search), 0 succeeded.";
    const reasoning = { ...rr("failed", { error: kernelError }), output: "" } as RR;
    const result = assemble(
      makeCtx({ emptyOutputFailure: true }),
      reasoning,
      { output: "", success: false, blocked: false },
      "max_iterations",
    );
    expect(result.output).toBe("");
    expect(result.error).toBe(kernelError);
  });

  it("C5 success carries no error", () => {
    const ok: VerificationOutcome = { output: NARRATION, success: true, blocked: false };
    const result = assemble(makeCtx(), rr("completed"), ok, "final_answer");
    expect(result.error).toBeUndefined();
  });
});
