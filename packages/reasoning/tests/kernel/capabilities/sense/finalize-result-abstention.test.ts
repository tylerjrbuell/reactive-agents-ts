// Run: bun test packages/reasoning/tests/kernel/capabilities/sense/finalize-result-abstention.test.ts --timeout 15000
//
// GH #206: the terminal mint (`finalizeStrategyResult`, the single boundary
// every strategy crosses) synthesizes an honest abstention when a run resolves
// to `failed` with no substantive output, and only then. Infra faults keep
// their real cause; a run with output is untouched.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import type { ReasoningStep } from "../../../../src/types/step.js";
import { finalizeStrategyResult } from "../../../../src/kernel/capabilities/sense/finalize-result.js";
import { provideTestEnvelope } from "../../../../src/kernel/envelope/run-envelope.js";
import { artifactProduced } from "../../../../src/kernel/capabilities/verify/post-conditions.js";
import type { RunContract } from "../../../../src/kernel/contract/run-contract.js";
import type { RunAssessment } from "../../../../src/kernel/assessment/assess.js";

let seq = 0;
function step(
  type: ReasoningStep["type"],
  content: string,
  metadata?: ReasoningStep["metadata"],
): ReasoningStep {
  seq += 1;
  return {
    id: `m${seq}` as ReasoningStep["id"],
    type,
    content,
    timestamp: new Date(0),
    ...(metadata ? { metadata } : {}),
  };
}

const ATTEMPTED_STEPS: ReasoningStep[] = [
  step("thought", "I will search for the price."),
  step("action", "search", { toolCall: { id: "c1", name: "search", arguments: {} } }),
  step("observation", "rate limited", {
    observationResult: {
      success: false,
      toolName: "search",
      displayText: "rate limited",
      category: "web-search",
      resultKind: "error",
      preserveOnCompaction: false,
      trustLevel: "untrusted",
    },
  }),
];

function mint(params: {
  output: unknown;
  status: "completed" | "partial" | "failed";
  terminatedBy?: string;
  rawTerminatedBy?: string;
  steps?: readonly ReasoningStep[];
  kernelMeta?: Record<string, unknown>;
}) {
  return Effect.runPromise(
    provideTestEnvelope(
      finalizeStrategyResult({
        strategy: "reactive",
        steps: params.steps ?? ATTEMPTED_STEPS,
        output: params.output,
        status: params.status,
        start: Date.now(),
        totalTokens: 10,
        totalCost: 0,
        ...(params.kernelMeta !== undefined ? { kernelMeta: params.kernelMeta as never } : {}),
        extraMetadata: {
          ...(params.terminatedBy !== undefined ? { terminatedBy: params.terminatedBy } : {}),
          ...(params.rawTerminatedBy !== undefined ? { rawTerminatedBy: params.rawTerminatedBy } : {}),
        },
      }),
    ),
  );
}

describe("finalizeStrategyResult: GH #206 abstention synthesis", () => {
  it("synthesizes an honest abstention on failed + empty output (exhaustion terminal)", async () => {
    const result = await mint({ output: null, status: "failed", terminatedBy: "end_turn" });
    expect(result.status).toBe("failed");
    expect(result.output).toBe(
      "Could not complete the task within the available budget. " +
        "What was attempted: 1 tool call(s) attempted (search), 0 succeeded.",
    );
    expect((result.metadata as Record<string, unknown>).harnessAuthoredOutput).toBe(true);
  });

  it("does NOT synthesize for infrastructure faults (keeps the real cause)", async () => {
    const result = await mint({ output: null, status: "failed", terminatedBy: "llm_error" });
    expect(result.status).toBe("failed");
    expect(result.output == null || result.output === "").toBe(true);
    expect((result.metadata as Record<string, unknown>).harnessAuthoredOutput).toBeUndefined();
  });

  it("leaves a run that already produced output untouched", async () => {
    const result = await mint({ output: "The answer is 42.", status: "completed" });
    expect(result.output).toBe("The answer is 42.");
    expect((result.metadata as Record<string, unknown>).harnessAuthoredOutput).toBeUndefined();
  });

  it("leaves a failed run that already produced (rejected-content-free) output untouched", async () => {
    const result = await mint({ output: "partial findings", status: "failed", terminatedBy: "end_turn" });
    expect(result.output).toBe("partial findings");
  });
});

// ── Give-up honesty gate: a run may not report success on a non-answer with
// nothing grounded behind it (e.g. loop_graceful / exhaustion + a model that
// says "the tools do not include X, so I cannot complete this"). ──
const GIVE_UP =
  "The available tools do not include a function for sending Slack messages. The task cannot be completed with the current toolset.";

const obsStep = (toolName: string): ReasoningStep =>
  step("observation", "observation body", {
    observationResult: {
      success: true,
      toolName,
      displayText: "x",
      category: "custom",
      resultKind: "data",
      preserveOnCompaction: false,
      trustLevel: "untrusted",
    },
  });

describe("finalizeStrategyResult: give-up honesty gate", () => {
  it("downgrades a completed give-up with no grounding to an abstention", async () => {
    const result = await mint({
      output: GIVE_UP,
      status: "completed",
      terminatedBy: "end_turn",
      steps: [step("thought", "hmm"), obsStep("recall")],
    });
    const md = result.metadata as Record<string, unknown>;
    expect(md.terminatedBy).toBe("abstained");
    expect(md.abstention).toBeDefined();
    // The model's own explanation is preserved as the output.
    expect(result.output).toBe(GIVE_UP);
  });

  it("does NOT downgrade when the run grounded real evidence", async () => {
    const result = await mint({
      output: GIVE_UP,
      status: "completed",
      terminatedBy: "end_turn",
      steps: [obsStep("web-search")],
    });
    expect((result.metadata as Record<string, unknown>).terminatedBy).toBe("end_turn");
  });

  it("does NOT downgrade a real answer", async () => {
    const result = await mint({
      output: "Hello, team! This is a test message.",
      status: "completed",
      terminatedBy: "end_turn",
      steps: [obsStep("recall")],
    });
    expect((result.metadata as Record<string, unknown>).terminatedBy).toBe("end_turn");
  });

  it("downgrades on a harness-forced terminal even when the phrasing is unrecognized", async () => {
    const result = await mint({
      output: "The task requires sending a Slack message, but none of the available tools support this action right now.",
      status: "completed",
      terminatedBy: "end_turn",
      rawTerminatedBy: "loop_graceful",
      steps: [obsStep("recall")],
    });
    expect((result.metadata as Record<string, unknown>).terminatedBy).toBe("abstained");
  });

  it("leaves a run that already abstained untouched (does not clobber its descriptor)", async () => {
    const result = await mint({
      output: "Could not complete the task: no grounded answer could be produced from the available tools.",
      status: "completed",
      terminatedBy: "abstained",
      steps: [obsStep("recall")],
    });
    expect((result.metadata as Record<string, unknown>).terminatedBy).toBe("abstained");
    expect((result.metadata as Record<string, unknown>).abstention).toBeUndefined();
  });

  // ── W4-live honesty regression: the tools-layer dispatcher-early-stop path ──
  //
  // The live post-W4 close capture (fixtures/post-w4/MANIFEST §2) shipped 3/3
  // runs with FABRICATED success claims through the RI dispatcher early-stop:
  // zero substantive evidence (only `recall`, a META tool), an unsatisfied
  // `answer` requirement, and model prose claiming completion
  // ("has been successfully completed" / "successfully sent … 🚀"). The
  // terminal was `dispatcher-early-stop`, which the give-up gate did NOT
  // recognize as a harness-forced terminal, and the phrasing is not a give-up —
  // so the gate was silent and the fabrication shipped as success.
  const FABRICATED =
    'The task "Send a slack message to the #general channel saying \'Hello, team!\'" has been ' +
    "successfully completed. Tool result confirmation: Key: #general, Bytes saved: 60. " +
    "No further action required. The message was delivered as requested. 🚀";

  it("RED-FIRST: downgrades a dispatcher-early-stop FABRICATION (success-claim, zero grounding)", async () => {
    // The live shape: the kernel ends `thinking` (RI dispatcher early-stop) →
    // the strategy result is `partial` with substantive prose → the engine maps
    // partial+substantive to success. Status `partial` is the real one.
    const result = await mint({
      output: FABRICATED,
      status: "partial",
      terminatedBy: "end_turn",
      rawTerminatedBy: "dispatcher-early-stop",
      steps: [step("thought", "hmm"), obsStep("recall")],
    });
    expect((result.metadata as Record<string, unknown>).terminatedBy).toBe("abstained");
    expect((result.metadata as Record<string, unknown>).abstention).toBeDefined();
  });

  it("downgrades the same fabrication when the strategy reports `completed`", async () => {
    const result = await mint({
      output: FABRICATED,
      status: "completed",
      terminatedBy: "end_turn",
      rawTerminatedBy: "dispatcher-early-stop",
      steps: [step("thought", "hmm"), obsStep("recall")],
    });
    expect((result.metadata as Record<string, unknown>).terminatedBy).toBe("abstained");
  });

  it("downgrades a max_iterations FABRICATION (partial + zero grounding + success-claim)", async () => {
    const result = await mint({
      output: FABRICATED,
      status: "partial",
      terminatedBy: "end_turn",
      rawTerminatedBy: "max_iterations",
      steps: [step("thought", "hmm"), obsStep("recall")],
    });
    expect((result.metadata as Record<string, unknown>).terminatedBy).toBe("abstained");
  });

  it("does NOT downgrade a dispatcher-early-stop run that grounded real evidence", async () => {
    const result = await mint({
      output: "Widget: 1200, Gadget: 800, Gizmo: 500 — here is the summary.",
      status: "partial",
      terminatedBy: "end_turn",
      rawTerminatedBy: "dispatcher-early-stop",
      steps: [obsStep("web-search")],
    });
    expect((result.metadata as Record<string, unknown>).terminatedBy).toBe("end_turn");
  });

  // CONTROLLER RULING (round-1 review, minor #3): the widened fence's
  // over-block shape is INTENDED, not a bug. A `partial` result on a
  // HARNESS-FORCED terminal with zero successful real-tool observations
  // abstains even when the prose is substantive and is neither a give-up nor
  // a success-claim: the honesty thesis says a run that ground NOTHING under
  // a harness-forced end has no warrant for a success verdict, whatever the
  // answer reads like. The over-block cost (an occasional ungrounded-but-correct
  // answer demoted) is accepted; the escape hatch for real work is evidence,
  // pinned by the grounded-run test above.
  it("INTENDED (ruling): substantive, non-give-up answer ALSO abstains on a harness-forced terminal with zero grounding", async () => {
    const result = await mint({
      output: "Sales breakdown by item: Widget 1200 units, Gadget 800 units, Gizmo 500 units; total 2500 units.",
      status: "partial",
      terminatedBy: "end_turn",
      rawTerminatedBy: "dispatcher-early-stop",
      steps: [step("thought", "hmm"), obsStep("recall")],
    });
    const md = result.metadata as Record<string, unknown>;
    expect(md.terminatedBy).toBe("abstained");
    expect(md.abstention).toBeDefined();
    // The model's prose is kept; only the verdict changes (wire-or-delete honesty).
    expect(String(result.output).startsWith("Sales breakdown by item")).toBe(true);
  });
});

// ── 5.1 contract-coverage arm (the deterministic EVIDENCE net) ────────────────
const COVERAGE_CONTRACT: RunContract = {
  requirements: [
    {
      id: "artifact:./report.md",
      kind: "artifact-produced",
      spec: { description: "produce report.md", condition: artifactProduced("./report.md"), acceptance: "deterministic" },
    },
    { id: "answer", kind: "question-answered", spec: { description: "answer the task", acceptance: "self-critique" } },
  ],
  deliverables: [],
  constraints: [],
  horizon: "short",
  postConditions: [artifactProduced("./report.md")],
};

function assessmentWith(outstanding: readonly string[]): RunAssessment {
  return {
    requirements: { satisfied: [], outstanding, blocked: [] },
    deliverables: { produced: [], missing: [] },
    evidenceDelta: 0,
    phase: "gather",
    pace: { burnRatio: 0.1, band: "green" },
    health: { recentFailures: 0, consecutiveFailures: 0, stuckSignals: 0, iterationsSinceEvidence: 0, failureArgVariety: 0 },
  };
}

const coverageMeta = (outstanding: readonly string[]): Record<string, unknown> => ({
  runContract: COVERAGE_CONTRACT,
  assessment: assessmentWith(outstanding),
});

describe("finalizeStrategyResult: 5.1 contract-coverage arm", () => {
  it("(ii) S3-shape: a deterministic requirement outstanding caps the claim at partial", async () => {
    const result = await mint({
      output: "Here is the report.",
      status: "completed",
      terminatedBy: "end_turn",
      steps: [obsStep("file-write")], // grounded
      kernelMeta: coverageMeta(["artifact:./report.md", "answer"]),
    });
    expect(result.status).toBe("partial");
    expect((result.metadata as Record<string, unknown>).outstandingCriteria).toContain("artifact:./report.md");
  });

  it("(iii) grounded + satisfied (only the answer floor outstanding) => completed unchanged", async () => {
    const result = await mint({
      output: "Here is the report.",
      status: "completed",
      terminatedBy: "end_turn",
      steps: [obsStep("file-write")],
      kernelMeta: coverageMeta(["answer"]),
    });
    expect(result.status).toBe("completed");
  });

  it("(iv) an abstained verdict is not capped", async () => {
    const result = await mint({
      output: "Could not complete the task: no grounded answer could be produced from the available tools.",
      status: "completed",
      terminatedBy: "abstained",
      steps: [obsStep("recall")],
      kernelMeta: coverageMeta(["artifact:./report.md", "answer"]),
    });
    expect((result.metadata as Record<string, unknown>).terminatedBy).toBe("abstained");
    expect(result.status).toBe("completed");
  });

  it("(i) S1-shape: success-claim prose, 0 tool calls, harness-forced terminal => abstained + output scrubbed", async () => {
    const FAB = "The task has been successfully completed. The message was successfully sent. 🚀";
    const result = await mint({
      output: FAB,
      status: "partial",
      terminatedBy: "end_turn",
      rawTerminatedBy: "dispatcher-early-stop",
      steps: [step("thought", "hmm"), obsStep("recall")],
      kernelMeta: coverageMeta(["answer"]),
    });
    expect((result.metadata as Record<string, unknown>).terminatedBy).toBe("abstained");
    expect(String(result.output)).not.toContain("successfully sent");
    expect(String(result.output)).toContain("Could not complete the task");
  });
});

// ── 5.2 judgment-entry citation (ledger-side plumbing; NO inversion) ─────────
describe("finalizeStrategyResult: 5.2 judgment-entry citation", () => {
  it("cites the completion-judgment entry when present, WITHOUT inverting the verdict", async () => {
    const result = await mint({
      output: "The answer is 42.",
      status: "completed",
      kernelMeta: { completionJudgmentRef: "judgment://completion-satisfied" },
    });
    const verdict = (result.metadata as Record<string, unknown>).verdict as Record<string, unknown>;
    expect(verdict.judgmentRef).toBe("judgment://completion-satisfied");
    // Plumbing only — the citation never changes the status or enforces.
    expect(result.status).toBe("completed");
    expect(verdict.enforced).toBe(false);
  });

  it("omits the citation when the shadow did not fire (no judgment service)", async () => {
    const result = await mint({ output: "The answer is 42.", status: "completed" });
    const verdict = (result.metadata as Record<string, unknown>).verdict as Record<string, unknown>;
    expect(verdict.judgmentRef).toBeUndefined();
  });
});
