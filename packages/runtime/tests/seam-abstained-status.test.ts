// Run: bun test packages/runtime/tests/seam-abstained-status.test.ts --timeout 20000
//
// The kernel's `abstained` strategy status is its own status at every runtime
// reader, and no runtime path writes harness text into `output`.
//
// Owner decisions 2026-11-10: the harness never writes text into output
// (failures and abstentions ship output "" with the cause on `error`), and
// `abstained` stays its own status, separate from `failed` and `completed`.
// The kernel now returns `status: "abstained"` with output "". The runtime
// types `rr.status` as a string, so each reader must name the value.
//
// Pins:
//   A1 — an empty output is NOT refilled from the last tool observation, for
//        any status (execute-output-derivation.ts), and auxiliary passes are
//        fenced off an abstention (util.ts isEnforcedAbstention).
//   A2 — an abstained result is never a success, and the runtime claims no
//        veto over it: the kernel owns the status (execute-success-invariants.ts).
//   A3 — the failure cause of an abstention names the abstention and its
//        reason (failure-cause.ts), in TaskResult.error.
//   A4 — telemetry / learning / debrief classify a kernel abstention as
//        "abstained" (its own label since 2026-11-10), whatever the
//        termination label (util.ts deriveRunOutcome, debrief.ts).
//   H1 — empty output with every declared deliverable landed stays empty: no
//        "Completed: ..." note, no harnessAuthoredOutput; the deliverables ride
//        receipt.deliverables (execute-success-invariants.ts).
//   H2 — a failed strategy puts its message on `error`, not `output`
//        (reasoning-think.ts fallback result; pinned in strategy-fallback.test.ts).
//   H3 — a verifier block withholds the answer with output "" (verification-outcome.ts).
//
// Red-on-cut: revert any one of the edits named above and its cell fails.
import { describe, expect, it } from "bun:test";
import type { AgentId, Task, TaskId } from "@reactive-agents/core";
import { deriveExecOutput } from "../src/engine/execute-output-derivation.js";
import { deriveExecutionSuccess } from "../src/engine/execute-success-invariants.js";
import { deriveFailureCause } from "../src/engine/finalize/failure-cause.js";
import { runtimeStatusAuthority } from "../src/engine/finalize/status-authority.js";
import { applyVerificationOutcome } from "../src/engine/finalize/verification-outcome.js";
import { deriveRunOutcome, isEnforcedAbstention } from "../src/engine/util.js";
import { __testOnlyDeriveDebriefOutcome } from "../src/debrief.js";
import { defaultReactiveAgentsConfig, type ExecutionContext } from "../src/types.js";

type RR = NonNullable<ExecutionContext["metadata"]["reasoningResult"]>;

const TOOL_OBSERVATION = "Population of Aetheria: 12,000 (from cached page).";

function makeTask(question: string): Task {
  return {
    id: "t1" as TaskId,
    agentId: "a1" as AgentId,
    type: "query",
    input: { question },
    priority: "medium",
    status: "running",
    metadata: { tags: [] },
    createdAt: new Date(),
  };
}

function makeCtx(metadata: ExecutionContext["metadata"] = {}): ExecutionContext {
  return {
    taskId: "t1",
    agentId: "a1",
    sessionId: "s1",
    phase: "complete",
    agentState: "completed",
    iteration: 2,
    maxIterations: 10,
    messages: [],
    toolResults: [],
    cost: 0,
    tokensUsed: 10,
    startedAt: new Date(),
    metadata,
  };
}

/** A strategy result fixture; `metadata` takes any extra field (abstention, runLedger) the kernel forwards. */
function rr(
  status: string,
  extra: Omit<Partial<RR>, "metadata"> & { metadata?: Readonly<Record<string, unknown>> } = {},
): RR {
  return {
    output: "",
    status,
    steps: [
      {
        id: "s1",
        type: "observation",
        content: TOOL_OBSERVATION,
        metadata: { observationResult: { success: true, toolName: "web-search" } } as never,
      },
    ],
    ...extra,
    metadata: {
      cost: 0,
      tokensUsed: 10,
      stepsCount: 1,
      ...(extra.metadata ?? {}),
    },
  } as RR;
}

const ABSTENTION = { reason: "the required tool web-search is not available", missing: ["tool:web-search"] };

describe("A1 — an abstention is never refilled from tool observations", () => {
  it("empty output stays empty for any status (2026-11-10: output is only the model's answer)", () => {
    // deriveExecOutput no longer reads the strategy result, so neither an
    // abstained nor a completed kernel's tool observation can reach output.
    // The end-to-end no-refill pin lives in seam-agent-outcome.test.ts (O5).
    const out = deriveExecOutput(makeCtx({ lastResponse: "" }));
    expect(out.outputForSuccess).toBe("");
    expect(out.hasSubstantiveOutput).toBe(false);
  });

  it("auxiliary passes (continuation hooks, verification retry) may not overwrite it", () => {
    // Those passes replace lastResponse unless isEnforcedAbstention fences them.
    expect(isEnforcedAbstention(rr("abstained"))).toBe(true);
    expect(isEnforcedAbstention(rr("completed"))).toBe(false);
  });
});

describe("A2 — an abstention is not a success, and the kernel owns that status", () => {
  it("abstained: success false, no runtime veto marker, no harness note", () => {
    const ctx = makeCtx({ lastResponse: "" });
    const reasoning = rr("abstained", { metadata: { terminatedBy: "abstained", abstention: ABSTENTION } });
    const res = deriveExecutionSuccess({
      ctx,
      task: makeTask("What is the population of Aetheria?"),
      config: defaultReactiveAgentsConfig("a1"),
      rr: reasoning,
      hasSubstantiveOutput: false,
      outputForSuccess: "",
    });
    expect(res.executionSucceeded).toBe(false);
    expect(res.terminatedByRaw).toBe("abstained");
    // The kernel already said "abstained"; the runtime did not flip anything,
    // so no runtime authority (empty-output veto included) claims the status.
    expect(runtimeStatusAuthority(ctx.metadata as Record<string, unknown>)).toBeUndefined();
    expect(ctx.metadata.harnessAuthoredOutput).toBeUndefined();
  });

  it("legacy shape (status completed + terminatedBy abstained) is still vetoed by the runtime", () => {
    const ctx = makeCtx({ lastResponse: "I could not answer." });
    const res = deriveExecutionSuccess({
      ctx,
      task: makeTask("What is the population of Aetheria?"),
      config: defaultReactiveAgentsConfig("a1"),
      rr: rr("completed", { metadata: { terminatedBy: "abstained", abstention: ABSTENTION } }),
      hasSubstantiveOutput: true,
      outputForSuccess: "I could not answer.",
    });
    expect(res.executionSucceeded).toBe(false);
    expect(runtimeStatusAuthority(ctx.metadata as Record<string, unknown>)).toBe("runtime-success-veto:abstained");
  });
});

describe("A3 — the cause of an abstention names the abstention", () => {
  it("abstained with no kernel error: abstention-specific cause with its reason", () => {
    const cause = deriveFailureCause({
      reasoning: { status: "abstained", metadata: { abstention: ABSTENTION } },
      markers: {},
      terminatedBy: "abstained",
    });
    expect(cause).toBe(`The agent abstained: ${ABSTENTION.reason}.`);
  });

  it("abstained with a kernel error: the kernel's cause wins (it carries What was attempted)", () => {
    const kernelError = "Could not complete the task. Cause: no grounded answer.\nWhat was attempted: 0 tool call(s).";
    const cause = deriveFailureCause({
      reasoning: { status: "abstained", error: kernelError, metadata: { abstention: ABSTENTION } },
      markers: {},
      terminatedBy: "abstained",
    });
    expect(cause).toBe(kernelError);
  });
});

describe("A4 — learning / telemetry / debrief classify a kernel abstention as abstained", () => {
  it("kernel status abstained under a non-abstained label: abstained in every lane", () => {
    for (const terminatedBy of ["end_turn", "final_answer", "guard_stop"] as const) {
      expect(deriveRunOutcome(terminatedBy, false, "abstained")).toBe("abstained");
      expect(__testOnlyDeriveDebriefOutcome(terminatedBy, [], "abstained")).toBe("abstained");
    }
    // Vacuity guard: the label alone keeps its verdict.
    expect(deriveRunOutcome("end_turn", false, "completed")).toBe("success");
  });
});

describe("H1 — empty output with landed deliverables stays empty", () => {
  it("no 'Completed: …' note and no harnessAuthoredOutput; success holds", () => {
    const ctx = makeCtx({ lastResponse: "" });
    const res = deriveExecutionSuccess({
      ctx,
      task: makeTask("Write hi to the file ./qa-h1/x.txt."),
      config: defaultReactiveAgentsConfig("a1"),
      rr: rr("completed", {
        steps: [],
        metadata: {
          terminatedBy: "end_turn",
          runLedger: [{ kind: "artifact", seq: 0, iteration: 1, path: "./qa-h1/x.txt", op: "write" }] as never,
        },
      }),
      hasSubstantiveOutput: false,
      outputForSuccess: "",
    });
    expect(res.executionSucceeded).toBe(true);
    expect(ctx.metadata.harnessAuthoredOutput).toBeUndefined();
    expect("emptyOutputCompletionNote" in res).toBe(false);
  });
});

describe("H3 — a verifier block withholds the answer without writing text into output", () => {
  it("blocked: output empty, cause on error", () => {
    const out = applyVerificationOutcome("an ungrounded answer", true, { verificationBlocked: { reason: "ungrounded" } });
    expect(out.output).toBe("");
    expect(out.success).toBe(false);
    expect(out.error).toBe("Verification rejected the response: ungrounded");
  });
});
