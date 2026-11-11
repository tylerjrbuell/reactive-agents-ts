// Run: bun test packages/runtime/tests/seam-agent-outcome.test.ts --timeout 20000
//
// `AgentResult.outcome`: one documented field for how a finished run ended
// ("success" | "partial" | "failed" | "abstained"), so builders never combine
// `success` + `terminatedBy` + `abstention` themselves (owner decision
// 2026-11-10). Paused durable runs carry no outcome; `status` says why.
//
// Pins:
//   O1 — deriveAgentOutcome (engine/finalize/derive-outcome.ts): the whole
//        table, including `success === true` exactly when outcome is "success".
//   O2 — terminalOutcomeFields: a paused run has no outcome; a terminal run
//        passes the engine's outcome through (derives it when absent).
//   O3 — end to end: run() and runStream() report the same outcome for a
//        success, an abstention and an empty-answer failure.
//   O4 — telemetry / learning / debrief record an abstention as "abstained",
//        apart from failures, and it is not a failure pattern.
//   O5 — the output is never refilled from a tool observation, and
//        harness-authored kernel text is not shipped as output
//        (engine/execute-output-derivation.ts). End to end:
//        engine-empty-output-invariant.test.ts case 1.
//
// Red-on-cut: drop the abstained branch of deriveAgentOutcome (O1, O3 red),
// the `outcome` field in terminalOutcomeFields' return (O2, O3 red), the
// abstained branch in deriveRunOutcome (O4 red), restore the observation
// fallback or the harness-authored pass-through in deriveExecOutput (O5 red).
import { describe, expect, it } from "bun:test";
import { ReactiveAgents } from "../src/builder.js";
import type { AgentResult } from "../src/builder/types.js";
import {
  deriveAgentOutcome,
  terminalOutcomeFields,
} from "../src/engine/finalize/derive-outcome.js";
import { deriveExecOutput } from "../src/engine/execute-output-derivation.js";
import { deriveRunOutcome } from "../src/engine/util.js";
import { deriveFailurePattern } from "../src/telemetry-enrichment.js";
import { buildFallbackDebrief } from "../src/debrief.js";

const LOOKUP_RESULT = "Population of Aetheria: 12,000 (lookup table).";

describe("O1 — deriveAgentOutcome: one table", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly input: Parameters<typeof deriveAgentOutcome>[0];
    readonly outcome: ReturnType<typeof deriveAgentOutcome>;
  }> = [
    { name: "clean answer", input: { success: true, terminatedBy: "final_answer", output: "4" }, outcome: "success" },
    { name: "files are the answer (empty output)", input: { success: true, terminatedBy: "end_turn", output: "" }, outcome: "success" },
    { name: "tolerated kernel partial shipped as success", input: { success: true, terminatedBy: "max_iterations", kernelStatus: "partial", output: "draft" }, outcome: "success" },
    { name: "cap hit with a model draft", input: { success: false, terminatedBy: "max_iterations", kernelStatus: "partial", output: "draft" }, outcome: "partial" },
    { name: "outstanding contract with an answer", input: { success: false, terminatedBy: "final_answer", kernelStatus: "partial", output: "half" }, outcome: "partial" },
    { name: "empty answer", input: { success: false, terminatedBy: "end_turn", output: "" }, outcome: "failed" },
    { name: "kernel failed (text present)", input: { success: false, terminatedBy: "guard_stop", kernelStatus: "failed", output: "x" }, outcome: "failed" },
    { name: "provider error", input: { success: false, terminatedBy: "llm_error", output: "partial text" }, outcome: "failed" },
    { name: "abstained label", input: { success: false, terminatedBy: "abstained", output: "" }, outcome: "abstained" },
    { name: "kernel abstained under another label", input: { success: false, terminatedBy: "end_turn", kernelStatus: "abstained", output: "" }, outcome: "abstained" },
  ];
  for (const c of cases) {
    it(`${c.name} → ${c.outcome}`, () => {
      expect(deriveAgentOutcome(c.input)).toBe(c.outcome);
    });
  }

  it("success is true exactly when the outcome is success", () => {
    for (const c of cases) {
      expect(deriveAgentOutcome(c.input) === "success").toBe(c.input.success);
    }
  });
});

describe("O2 — terminalOutcomeFields carries the outcome on terminal runs only", () => {
  it("paused: no outcome, no terminatedBy, success false", () => {
    const f = terminalOutcomeFields(true, { success: true, terminatedBy: "end_turn", outcome: "success", output: "" });
    expect(f).toEqual({ success: false });
  });

  it("terminal: the engine's outcome passes through", () => {
    const f = terminalOutcomeFields(false, { success: false, terminatedBy: "end_turn", outcome: "abstained", output: "" });
    expect(f.outcome).toBe("abstained");
  });

  it("terminal without an engine outcome: derived from the same rule", () => {
    const f = terminalOutcomeFields(false, { success: false, terminatedBy: "max_iterations", output: "draft" });
    expect(f.outcome).toBe("partial");
  });
});

async function runBoth(
  scenario: unknown[],
  task: string,
  configure?: (b: ReturnType<typeof ReactiveAgents.create>) => ReturnType<typeof ReactiveAgents.create>,
): Promise<{ run: AgentResult; stream: AgentResult }> {
  const make = async () => {
    let b = ReactiveAgents.create()
      .withName("outcome-pin")
      .withProvider("test")
      .withModel("test")
      .withTestScenario(scenario as never)
      .withReasoning({ defaultStrategy: "reactive" })
      .withMaxIterations(2);
    if (configure) b = configure(b);
    return b.build();
  };
  const a1 = await make();
  const a2 = await make();
  try {
    const run = await a1.run(task);
    let stream: AgentResult | undefined;
    for await (const ev of a2.runStream(task)) {
      if (ev._tag === "StreamCompleted") {
        stream = {
          output: ev.output,
          success: ev.success ?? true,
          taskId: ev.taskId ?? "",
          agentId: ev.agentId ?? "",
          metadata: ev.metadata,
          ...(ev.outcome !== undefined ? { outcome: ev.outcome } : {}),
        };
      }
    }
    expect(stream).toBeDefined();
    return { run, stream: stream! };
  } finally {
    await a1.dispose();
    await a2.dispose();
  }
}

describe("O3 — run() and runStream() report the same outcome", () => {
  it("a clean answer is success", async () => {
    const { run, stream } = await runBoth([{ text: "FINAL ANSWER: 42." }], "What is 6 times 7?");
    expect(run.success).toBe(true);
    expect(run.outcome).toBe("success");
    expect(stream.outcome).toBe("success");
  }, 20000);

  it("an honest decline is abstained, not failed", async () => {
    const { run, stream } = await runBoth(
      [
        { text: "I cannot ground this without the required tool." },
        { text: "I cannot ground this without the required tool." },
      ],
      "What is the population of the fictional city of Aetheria?",
      (b) =>
        b
          .withTools({ builtins: [], adaptive: false } as never)
          .withRequiredTools({ tools: ["tool-that-does-not-exist"] }),
    );
    // Precondition: the run took the abstention path.
    expect(run.terminatedBy).toBe("abstained");
    expect(run.success).toBe(false);
    expect(run.outcome).toBe("abstained");
    expect(stream.outcome).toBe("abstained");
  }, 20000);

  it("an empty answer with nothing delivered is not a success", async () => {
    const { run, stream } = await runBoth([{ text: "" }], "Summarize the plot of Hamlet in one sentence.");
    expect(run.success).toBe(false);
    expect(run.outcome).not.toBe("success");
    expect(stream.outcome).toBe(run.outcome);
  }, 20000);
});

describe("O4 — an abstention is recorded apart from failures", () => {
  it("telemetry / learning classifier: abstained, under any label the kernel abstained on", () => {
    expect(deriveRunOutcome("abstained", false)).toBe("abstained");
    expect(deriveRunOutcome("abstained", true)).toBe("abstained");
    expect(deriveRunOutcome("end_turn", false, "abstained")).toBe("abstained");
    // Vacuity guard: a kernel failure is still a failure.
    expect(deriveRunOutcome("end_turn", false, "failed")).toBe("failure");
  });

  it("an abstention is not a failure pattern", () => {
    expect(deriveFailurePattern("abstained", "abstained", [], undefined)).toBeUndefined();
    expect(deriveFailurePattern("failure", "end_turn", [], undefined)).toBe("unknown");
  });

  it("the debrief says abstained", () => {
    const debrief = buildFallbackDebrief({
      taskPrompt: "What is the population of Aetheria?",
      agentId: "agent-1",
      taskId: "task-1",
      terminatedBy: "abstained",
      toolCallHistory: [],
      errorsFromLoop: [],
      metrics: { tokens: 10, duration: 5, iterations: 1, cost: 0 },
    });
    expect(debrief.outcome).toBe("abstained");
  });
});

describe("O5 — the output is only the model's answer", () => {
  const completedWithObservation = (harnessAuthoredOutput?: boolean) =>
    ({
      output: harnessAuthoredOutput ? "✓ Written to x.txt" : "",
      status: "completed",
      steps: [
        {
          id: "s1",
          type: "observation",
          content: LOOKUP_RESULT,
          metadata: { observationResult: { success: true, toolName: "lookup" } },
        },
      ],
      metadata: { cost: 0, tokensUsed: 1, stepsCount: 1, ...(harnessAuthoredOutput ? { harnessAuthoredOutput: true } : {}) },
    }) as never;

  it("empty model answer + a completed kernel with a tool observation: output stays empty", () => {
    const out = deriveExecOutput({ metadata: { lastResponse: "", reasoningResult: completedWithObservation() } });
    expect(out.outputForSuccess).toBe("");
    expect(out.hasSubstantiveOutput).toBe(false);
  });

  it("harness-authored kernel text is not shipped as output", () => {
    // The kernel's harness_deliverable terminal hands back a normalized tool
    // observation flagged harnessAuthoredOutput; that is not the model's answer.
    const out = deriveExecOutput({
      metadata: { lastResponse: "✓ Written to x.txt", reasoningResult: completedWithObservation(true) },
    });
    expect(out.outputForSuccess).toBe("");
    // Vacuity guard: a model answer passes through untouched.
    expect(deriveExecOutput({ metadata: { lastResponse: " 42 ", reasoningResult: completedWithObservation() } }).outputForSuccess).toBe("42");
  });
});
