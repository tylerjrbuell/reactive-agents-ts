// Run: bun test packages/runtime/tests/status-tolerance-trace.test.ts --timeout 20000
//
// run-completed.status vs run-completed.outcome can never silently contradict:
// the partial+substantive tolerance lane is recorded as a typed exception
// (`outcome.tolerated` + `toleratedBy` + `statusReason`) EXACTLY when it fires;
// vetoes keep their folded authority. Read back via loadTrace (diagnose path).
//
// RED-ON-CUT:
//  - drop the PARTIAL_TOLERANCE_MARKER stamp in engine/execute-success-invariants.ts -> (a) red.
//  - drop the `tolerated` spread in foldRuntimeAuthority (status-authority.ts) -> (a) red.
//  - make deriveFinalStatus always set tolerated -> (b)/(c)/(d) red.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTrace } from "@reactive-agents/trace";
import { ReactiveAgents } from "../src/builder.js";
import { deriveFinalStatus } from "../src/engine/finalize/status-authority.js";
import type { ReconciledOutcome } from "../src/engine/finalize/terminal-outcome-read.js";

const gather = {
  definition: {
    name: "gather",
    description: "gather data",
    parameters: [{ name: "q", type: "string" as const, description: "query", required: true }],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
  },
  handler: () => Effect.succeed("KEY FACT: the metric rose 12%."),
};

const step = (title: string, type: string, extra: Record<string, unknown> = {}) => ({
  title,
  instruction: title,
  type,
  rationale: { why: "needed", confidence: 0.9 },
  ...extra,
});
/** Plan whose tool step names an unknown tool: kernel reports `partial`, output stays substantive. */
const PARTIAL_PLAN = JSON.stringify({
  steps: [step("Gather", "tool_call", { toolName: "nope", toolArgs: {} }), step("Analyze", "analysis")],
});
const loop = Array.from({ length: 8 }, () => ({ toolCall: { name: "gather", args: { q: "a" } } }));

async function runCompleted(strategy: string, scenario: unknown[], iters: number) {
  const dir = await mkdtemp(join(tmpdir(), "ra-tolerance-"));
  const agent = await ReactiveAgents.create()
    .withName(`tol-${strategy}`)
    .withProvider("test")
    .withModel("test")
    .withTestScenario(scenario as never)
    .withTools({ tools: [gather], adaptive: false } as never)
    .withReasoning({ defaultStrategy: strategy as never, enableStrategySwitching: false })
    .withMaxIterations(iters)
    .withObservability({ tracing: { dir } })
    .build();
  await agent.run("Research the topic and summarize it.");
  await agent.dispose();
  for (const name of await readdir(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const rc = (await loadTrace(join(dir, name))).events.find((e) => e.kind === "run-completed");
    if (rc?.kind === "run-completed") return rc;
  }
  throw new Error("no run-completed event in trace");
}

describe("status tolerance is a typed, explained exception", () => {
  it("(a) plan-execute partial + substantive output: success shipped, tolerated=true with toleratedBy", async () => {
    const rc = await runCompleted("plan-execute-reflect", [{ text: PARTIAL_PLAN }, { text: "The metric rose 12 percent last quarter." }], 4);
    expect(rc.status).toBe("success");
    expect(rc.outcome?.status).toBe("partial");
    expect(rc.outcome?.success).toBe(false);
    expect(rc.outcome?.tolerated).toBe(true);
    expect(rc.outcome?.toleratedBy).toBe("partial-substantive-output");
    expect(rc.outcome?.statusReason).toContain("partial-substantive-output");
  }, 30_000);

  it("(b) reactive clean completion: no tolerance, reason recorded", async () => {
    const rc = await runCompleted("reactive", [{ text: "FINAL ANSWER: the metric rose 12%." }], 4);
    expect(rc.status).toBe("success");
    expect(rc.outcome?.status).toBe("completed");
    expect(rc.outcome?.tolerated).toBeUndefined();
    expect(rc.outcome?.toleratedBy).toBeUndefined();
    expect(rc.outcome?.statusReason).toContain("agrees with kernel outcome");
  }, 30_000);

  it("(c) reflexion verified plain answer: no answer-floor veto; success is an explained tolerance", async () => {
    const rc = await runCompleted("reflexion", [{ text: "The metric rose 12% last quarter." }], 4);
    expect(rc.status).toBe("success");
    expect(rc.outcome?.outstanding ?? []).not.toContain("answer");
    expect(rc.outcome?.authority).not.toContain("runtime-success-veto");
    expect(rc.outcome?.tolerated).toBe(true);
  }, 30_000);

  it("(d) tree-of-thought refused deliverable: vetoed, never tolerated", async () => {
    const rc = await runCompleted("tree-of-thought", loop, 2);
    expect(rc.status).toBe("failure");
    expect(rc.outcome?.authority).toBe("runtime-success-veto:outstanding-criteria");
    expect(rc.outcome?.tolerated).toBeUndefined();
  }, 30_000);
});

describe("deriveFinalStatus (unit)", () => {
  const outcome = {
    status: "partial", terminatedBy: null, provenance: "none", verdict: null,
    answerSatisfied: null, success: false, authority: "model-final",
  } as ReconciledOutcome;

  it("tolerated only when success AND the lane marker is set", () => {
    const d = deriveFinalStatus(true, outcome, { partialToleratedBy: "partial-substantive-output" });
    expect(d).toMatchObject({ success: true, status: "success", tolerated: true, toleratedBy: "partial-substantive-output" });
  });
  it("a later flip to failure voids the tolerance (the veto owns it)", () => {
    const d = deriveFinalStatus(false, outcome, { partialToleratedBy: "partial-substantive-output", verificationBlocked: true });
    expect(d.tolerated).toBeUndefined();
    expect(d.authority).toBe("runtime-verifier-gate");
    expect(d.status).toBe("failure");
  });
});
