// Run: bun test packages/reasoning/tests/kernel/seam-exit-gate-draft-handoff.test.ts --timeout 20000
//
// Owner decision 2026-11-10 (after the answer-turn change): an exit-gate
// handoff on a run where the MODEL wrote an answer keeps that answer. The run
// ends `partial` (success false) with the model's own draft as output plus the
// harness's deterministic `Unfinished:` list (`unfinishedBlock`, the shape the
// plan-execute strategy handoff already ships). A run the model never answered
// still fails with its evidence attached. In both cases the reconciled
// `terminalOutcome.outstanding` lists the gate's unmet items, so outcome
// readers do not have to parse `result.error`.
//
// RED-ON-CUT: in exit-gate.ts `proposeExit`, set `draftHandoff` to `false`
// (every handoff fails again): (1), (3)-partial and the draft end-to-end test
// go red. Drop `handoffItems` in terminal-outcome.ts `deriveTerminalOutcome`:
// (3)-partial and the draft end-to-end test go red. Drop the
// `failedHandoffItems` term in finalize-result.ts: the failed end-to-end test
// goes red. Drop the handoff clause in terminate.ts's post-condition pass-through:
// (1), (3)-partial and the draft end-to-end test go red (the draft is nulled).
// Drop the handoff skip in runner-terminal-verify-gate.ts: the draft end-to-end
// test goes red (the verifier re-decides and the run reads `completed`).
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBusLive, harnessSynthesisDeliverable } from "@reactive-agents/core";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { proposeExit, unfinishedEvidence } from "../../src/kernel/loop/exit-gate.js";
import { unfinishedBlock } from "../../src/kernel/loop/strategy-exit-gate.js";
import { artifactProduced } from "../../src/kernel/capabilities/verify/post-conditions.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import { resolveCompletionStatus } from "../../src/kernel/state/completion-status.js";
import { deriveTerminalOutcome, kernelReconciledStatus, type TerminalOutcome } from "../../src/kernel/state/terminal-outcome.js";
import { makeKernelInput, makeKernelState } from "../../src/testing/kernel-fixtures.js";
import type { KernelState } from "../../src/kernel/state/kernel-state.js";
import { executeReactive } from "../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { succeedingToolLayer } from "../../src/testing/tool-service-mock.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";

const TASK = "Gather the regional sales data and write a summary report to ./report.md.";
const DRAFT =
  "Sales rose in every region last quarter: the north led with 14% growth, the south grew 9%, and the west grew 6%.";
const EVIDENCE = "north=+14%; south=+9%; west=+6%";

/** The run's one guard nudge, already spent: the next soft exit is disposed `handoff`. */
const spentNudge = makeStep("harness_signal", "earlier nudge", {
  exitGate: { proposedBy: "low_delta_guard", gateDecision: "deny-once", reason: "low_delta_guard", outstanding: ["x"] },
});

const gathered = [
  makeStep("action", "gather({})", { toolCall: { id: "g1", name: "gather", arguments: {} } }),
  makeStep("observation", EVIDENCE, { toolCallId: "g1", observationResult: makeObservationResult("gather", true, EVIDENCE) }),
];

function stateWith(opts: { draft: boolean }): KernelState {
  return makeKernelState({
    iteration: 5,
    llmCalls: 5,
    toolsUsed: new Set(["gather"]),
    steps: [...gathered, ...(opts.draft ? [makeStep("thought", DRAFT)] : []), spentNudge],
    meta: { postConditions: [artifactProduced("./report.md")] },
  } as never);
}

/** A second soft exit (low-delta) on `state`. */
const secondSoftExit = (state: KernelState, requiredTools: readonly string[] = []) =>
  Effect.runPromise(
    proposeExit({
      state,
      proposal: {
        proposedBy: "low_delta_guard",
        kind: "soft",
        reason: "low_delta_guard",
        deliverable: harnessSynthesisDeliverable([], undefined, ""),
      },
      input: makeKernelInput({ task: TASK, requiredTools: [...requiredTools] }),
      maxIterations: 10,
      taskId: "t",
    }).pipe(Effect.provide(EventBusLive)),
  );

const gateItems = (state: KernelState): readonly string[] =>
  state.steps.at(-1)?.metadata?.exitGate?.outstanding ?? [];

const outcomeOf = (state: KernelState): TerminalOutcome =>
  deriveTerminalOutcome({ status: kernelReconciledStatus(state), meta: state.meta, ledger: state.ledger });

describe("exit-gate handoff keeps the model's draft", () => {
  it("(1) model wrote an answer, an artifact unmet, second soft exit → partial: draft + Unfinished block", async () => {
    const { decision, state } = await secondSoftExit(stateWith({ draft: true }));
    expect(decision).toBe("handoff");
    const items = gateItems(state);
    expect(items.length).toBeGreaterThan(0);
    expect(items.join(" ")).toContain("report.md");
    expect(state.status).toBe("done");
    expect(state.output).toBe(`${DRAFT}\n\n${unfinishedBlock(items)}`);
    expect(state.meta.harnessAuthoredOutput).not.toBe(true);
    expect(state.meta.deliverableProvenance).toBe("model-final");
    expect(resolveCompletionStatus(state)).toBe("partial");
    expect(state.meta.deliverableDecision?.accepted).toBe(false);
    // The draft is the answer: no raw evidence attachment on a partial.
    expect(unfinishedEvidence(state)).toBeUndefined();
  });

  it("(2) the model never answered → failed, evidence attached (unchanged)", async () => {
    const { decision, state } = await secondSoftExit(stateWith({ draft: false }));
    expect(decision).toBe("handoff");
    expect(state.status).toBe("failed");
    expect(state.error).toContain("Outstanding:");
    expect((unfinishedEvidence(state) ?? []).map((e) => e.content).join("\n")).toContain(EVIDENCE);
  });

  it("a required tool never called is a hard contract: the draft run still fails (missing_required_tool law)", async () => {
    const { decision, state } = await secondSoftExit(stateWith({ draft: true }), ["file-write"]);
    expect(decision).toBe("handoff");
    expect(state.status).toBe("failed");
    expect(state.output).toBeNull();
  });

  it("(3) partial: the refused decision carries the gate's items into terminalOutcome.outstanding", async () => {
    const { state } = await secondSoftExit(stateWith({ draft: true }));
    const outcome = outcomeOf(state);
    expect(outcome.success).toBe(false);
    expect(outcome.status).toBe("partial");
    expect(outcome.outstanding).toEqual([...gateItems(state)]);
  });
});

describe("end to end through the strategy mint", () => {
  const GATHER = { name: "gather", description: "gather sales data", parameters: [{ name: "q", type: "string", required: true }] };
  const run = (turns: Parameters<typeof TestLLMServiceLayer>[0], task = TASK) =>
    Effect.runPromise(
      executeReactive({
        taskDescription: task,
        taskType: "research",
        memoryContext: "",
        availableTools: ["gather"],
        availableToolSchemas: [GATHER],
        config: defaultReasoningConfig,
        maxIterations: 6,
      } as never).pipe(
        Effect.provide(
          Layer.merge(
            TestLLMServiceLayer(turns),
            succeedingToolLayer({ finding: EVIDENCE }, GATHER.parameters),
          ),
        ),
        provideTestEnvelope,
      ),
    );

  const outcomeOfResult = (r: Awaited<ReturnType<typeof run>>) =>
    ((r.metadata as Record<string, unknown>).extensions as Record<string, unknown>).terminalOutcome as TerminalOutcome;

  it("(2)+(3) the model never answered: failed, evidence attached, outcome lists the error's Outstanding items", async () => {
    const r = await run(
      [
        ...Array.from({ length: 5 }, () => ({ toolCall: { name: "gather", args: { q: "a" } } })),
        { text: "FINAL ANSWER: unsynthesized guess." },
      ],
      "Research the topic and summarize it.",
    );
    expect(r.status).toBe("failed");
    const evidence = (r.metadata.extensions as Record<string, unknown>).unfinishedEvidence as readonly { content: string }[];
    expect(evidence.length).toBeGreaterThan(0);
    const line = String(r.error ?? "").split("\n").find((l) => l.startsWith("Outstanding: "));
    expect(line).toBeDefined();
    const items = line!.slice("Outstanding: ".length).split("; ");
    const outcome = outcomeOfResult(r);
    expect(outcome.success).toBe(false);
    for (const item of items) expect(outcome.outstanding).toContain(item);
  });

  it("(1)+(3) a model that answers in prose but never writes the file: draft ships partial, outcome lists the items", async () => {
    const r = await run([{ toolCall: { name: "gather", args: { q: "sales" } } }, ...Array.from({ length: 10 }, () => ({ text: DRAFT }))]);
    const md = r.metadata as Record<string, unknown>;
    const outcome = outcomeOfResult(r);
    expect(r.status).toBe("partial");
    expect(outcome.success).toBe(false);
    expect(md.harnessAuthoredOutput).not.toBe(true);
    const output = String(r.output ?? "");
    expect(output).toStartWith(DRAFT);
    expect(output).toContain("\n\nUnfinished:\n- ");
    expect(output).toContain("report.md");
    const listed = output.slice(output.indexOf("Unfinished:\n") + "Unfinished:\n".length).split("\n").map((l) => l.replace(/^- /, ""));
    for (const item of listed) expect(outcome.outstanding).toContain(item);
  });
});
