// Run: bun test packages/reasoning/tests/kernel/seam-claimed-actions.test.ts --timeout 20000
//
// Ablation 2026-11-10 (stable-tool-list, mimo wide-metric, 12 of 20 runs): the
// model called only `metrics_fetch`, wrote "I've filed a report", and the run
// was accepted as success although `report_file` was offered and never called.
// A completed action the answer claims must be backed by a successful call of a
// matching tool on the surface; otherwise:
//   - the exit gate denies the model's exit and names the unmet action (with
//     tools offered: it is tool work, not an answer turn);
//   - the terminal verifier rejects the answer (`output-not-unbacked-action-claim`).
// The match is derived from tool names, never a tool list.
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { EventBusLive, modelSynthesisDeliverable } from "@reactive-agents/core";
import {
  unbackedClaimedActions,
  succeededToolNames,
} from "../../src/kernel/capabilities/verify/claimed-actions.js";
import { defaultVerifier } from "../../src/kernel/capabilities/verify/verifier.js";
import { proposeExit } from "../../src/kernel/loop/exit-gate.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { makeKernelInput, makeKernelState } from "../../src/testing/kernel-fixtures.js";
import type { ReasoningStep } from "../../src/types/index.js";

const TOOLS = [
  { name: "metrics_fetch", description: "fetch service metrics", parameters: [] },
  { name: "report_file", description: "file an incident report", parameters: [] },
];
const NAMES = TOOLS.map((t) => t.name);
const ANSWER =
  "The p99 latency for checkout rose to 840 ms over the last hour, well above the 300 ms SLO. I've filed a report with the details.";

const observed = (toolName: string, success = true): ReasoningStep =>
  makeStep("observation", `${toolName} result: p99=840`, {
    observationResult: {
      success,
      toolName,
      displayText: "x",
      category: "data",
      resultKind: "data",
      preserveOnCompaction: false,
      trustLevel: "trusted",
    },
  } as never);

describe("seam-claimed-actions: a claimed action needs a successful matching tool call", () => {
  it("detects the trace shape: report_file offered, only metrics_fetch ran", () => {
    const claims = unbackedClaimedActions(ANSWER, NAMES, succeededToolNames([observed("metrics_fetch")]));
    expect(claims.length).toBe(1);
    expect(claims[0]!.tools).toEqual(["report_file"]);
    expect(claims[0]!.phrase).toContain("I've filed a report");
  });

  it("is backed once the matching tool ran successfully (a failed call does not back it)", () => {
    expect(unbackedClaimedActions(ANSWER, NAMES, succeededToolNames([observed("report_file")]))).toEqual([]);
    expect(unbackedClaimedActions(ANSWER, NAMES, succeededToolNames([observed("report_file", false)])).length).toBe(1);
  });

  it("general matching from name words: other tools, passive voice, camelCase, MCP names", () => {
    // camelCase + "/" split comes from `tokenizeToolName` (@reactive-agents/tools); this line pins it reaches matching.
    const none = new Set<string>();
    expect(unbackedClaimedActions("The issue has been created on GitHub.", ["github/createIssue"], none).length).toBe(1);
    expect(unbackedClaimedActions("I wrote the results to the file out.md.", ["file-write"], none).length).toBe(1);
    expect(unbackedClaimedActions("I've emailed the team.", ["email"], none).length).toBe(1);
  });

  it("a passive sentence that names a third party as the doer is a fact, not the agent's claim", () => {
    const none = new Set<string>();
    const tools = ["github/createIssue", "report_file"];
    for (const text of [
      "Issue #12 was created by alice on Monday.",
      "Issue #12 was created by @alice.",
      "The incident report was filed by the on-call engineer.",
    ]) {
      expect({ text, n: unbackedClaimedActions(text, tools, none).length }).toEqual({ text, n: 0 });
    }
    // Still the agent's claim: no doer named, the agent named, or the agent's means.
    for (const text of [
      "Issue #12 was created.",
      "The issue was created by me.",
      "The issue has been created by us on GitHub.",
      "The issue was created by calling the GitHub API.",
    ]) {
      expect({ text, n: unbackedClaimedActions(text, tools, none).length }).toEqual({ text, n: 1 });
    }
  });

  it("does not fire on non-claims or on verbs no tool name carries", () => {
    const none = new Set<string>();
    for (const text of [
      "I have not filed a report yet.",
      "I couldn't file the report because the tool failed.",
      "If you want, I can file a report.",
      "Should I file a report?",
      "I wrote a summary of the metrics below.", // `file-write` needs "file" in the sentence
      "The report shows latency rose.",
      "I've saved you some time by summarising.",
    ]) {
      expect({ text, n: unbackedClaimedActions(text, ["report_file", "file-write"], none).length }).toEqual({ text, n: 0 });
    }
  });

  it("the terminal verifier rejects the unbacked claim and accepts it once backed", () => {
    const verify = (steps: ReasoningStep[]) =>
      defaultVerifier.verify({
        action: "final-answer",
        content: ANSWER,
        actionSuccess: true,
        task: "Check checkout latency and file a report if it breaches the SLO.",
        priorSteps: steps,
        terminal: true,
        toolsUsed: new Set(steps.map((s) => s.metadata?.observationResult?.toolName ?? "")),
        availableUserTools: NAMES,
      });
    const unbacked = verify([observed("metrics_fetch")]);
    const check = unbacked.checks.find((c) => c.name === "output-not-unbacked-action-claim");
    expect(check?.severity).toBe("reject");
    expect(check?.reason).toContain("report_file");
    expect(unbacked.severity).toBe("reject");
    const backed = verify([observed("metrics_fetch"), observed("report_file")]);
    expect(backed.checks.find((c) => c.name === "output-not-unbacked-action-claim")?.passed).toBe(true);
  });

  it("the exit gate denies the model's exit, names the unmet action, and keeps tools (no answer turn)", async () => {
    const propose = (steps: ReasoningStep[]) =>
      Effect.runPromise(
        proposeExit({
          state: makeKernelState({ llmCalls: 2, steps }),
          proposal: {
            proposedBy: "model",
            kind: "soft",
            reason: "final_answer",
            deliverable: modelSynthesisDeliverable({ type: "thought", content: ANSWER, iteration: 2 }),
          },
          input: makeKernelInput({ task: "Check checkout latency and file a report.", availableToolSchemas: TOOLS }),
          maxIterations: 10,
          taskId: "t",
        }).pipe(Effect.provide(EventBusLive)),
      );
    const denied = await propose([observed("metrics_fetch"), makeStep("thought", ANSWER)]);
    expect(denied.decision).toBe("deny");
    const record = denied.state.steps.at(-1)?.metadata?.exitGate;
    expect(record?.outstanding.join(" ")).toContain("`report_file`");
    expect(record?.answerTurnAt).toBeUndefined();
    const backed = await propose([observed("metrics_fetch"), observed("report_file"), makeStep("thought", ANSWER)]);
    expect(backed.state.steps.at(-1)?.metadata?.exitGate?.outstanding.join(" ") ?? "").not.toContain("report_file");
  });
});
