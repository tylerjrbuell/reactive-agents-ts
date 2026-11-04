// Run: bun test packages/reasoning/src/kernel/loop/exit-gate-truthful-terminals.test.ts --timeout 20000
//
// Regressions from the exit gate (df2abde2e), found in Cortex verification
// 2026-11-04.
//
// K1: a one-shot tool-less `direct` run (Cortex compaction) whose task QUOTES a
// transcript ("create a note ... the tool call failed") derived a
// SideEffectLanded condition from the quoted prose. No action of a tool-less
// run can meet it, so the gate listed "your last tool call failed ... retry it"
// as outstanding and the handoff appended `Unfinished:` to a good summary
// (terminatedBy "abstained"). Fix: the runner seeds only the conditions the
// run's tool surface can meet (`seedPostConditions`).
//
// K2: a loop on a meta-tool with nothing to hand off failed with NO
// terminatedBy, so it narrowed to max_iterations, its authority read
// `none-recorded`, and the user saw "Could not complete the task within the
// available budget" at iteration 4 of 16. Fix: loop-resolution stamps its
// reason; the abstention text names a guard stop instead of the budget.
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { executeDirect } from "../../strategies/direct.js";
import { defaultReasoningConfig } from "../../types/config.js";
import type { ReasoningStep } from "../../types/index.js";
import { provideTestEnvelope } from "../envelope/run-envelope.js";
import { deriveConditions, seedPostConditions } from "../capabilities/verify/derive-conditions.js";
import { describeUnmet, sideEffectLanded } from "../capabilities/verify/post-conditions.js";
import { makeStep } from "../capabilities/sense/step-utils.js";
import { buildAbstentionOutput } from "../capabilities/sense/abstention-synthesis.js";
import { finalizeStrategyResult } from "../capabilities/sense/finalize-result.js";
import { initialKernelState, transitionState } from "../state/kernel-state.js";
import { deriveTerminalAuthority } from "../state/terminal-authority.js";
import { makeKernelInput, makeKernelRunOptions } from "../../testing/kernel-fixtures.js";
import { resolveDetectedLoop } from "./runner-helpers/loop-resolution.js";
import { deriveTerminatedBy } from "./terminate-reason.js";

const TRANSCRIPT_TASK =
  "Summarise this conversation so it can replace the original as context for future turns. " +
  "Keep decisions, facts, names, numbers, file paths, open questions and the user's goals. Be concise; no preamble.\n\n" +
  "User: Please create a note in my notes app and send an email to Bob about the meeting.\n\n" +
  "Assistant: I tried to create the note but the notes tool call failed with a timeout. I will retry once the service is back.";

const SUMMARY =
  "The user asked to create a note about the meeting and email Bob. The note creation failed with a timeout; " +
  "the email is pending. Open question: when the notes service is back.";

const BUDGET_TEXT = "within the available budget";

describe("K1: a tool-less direct run is never held to a side effect quoted in its task", () => {
  it("ships the model's summary as a completed run (no handoff, no Unfinished list, no retry item)", async () => {
    const layer = TestLLMServiceLayer([{ text: SUMMARY }]);
    const result = await Effect.runPromise(
      provideTestEnvelope(
        executeDirect({
          taskDescription: TRANSCRIPT_TASK,
          taskType: "query",
          memoryContext: "",
          availableTools: [],
          config: defaultReasoningConfig,
        }).pipe(Effect.provide(layer)),
      ),
    );
    const meta = result.metadata as Record<string, unknown>;
    expect(result.status).toBe("completed");
    expect(result.output).toBe(SUMMARY);
    expect(String(result.output)).not.toContain("Unfinished:");
    expect(meta["terminatedBy"]).not.toBe("abstained");
    expect(meta["harnessAuthoredOutput"]).toBeUndefined();
    const gateSteps = result.steps.filter((s) => s.metadata?.exitGate !== undefined);
    expect(gateSteps).toEqual([]);
  });

  it("a quoted 'write a file notes.txt' placed before the current-turn marker is not held against the run", async () => {
    // The live Cortex repro: the compaction prompt quotes the user's own
    // request to write a file. Unmarked, the contract (and the runtime F1 veto)
    // rightly treat it as this run's deliverable; the caller keeps quoted text
    // out of the current turn with the `--- Current message ---` marker.
    const task =
      "User: Write a file notes.txt containing three facts about octopuses\n\n" +
      "Assistant: First I will recall three facts, then write them to a file named notes.txt.\n\n" +
      "--- Current message ---\n" +
      "Summarise the conversation above so it can replace the original as context for future turns. Be concise.";
    const summary = "The user wants a file notes.txt with three octopus facts; the assistant planned to recall facts and write the file.";
    const result = await Effect.runPromise(
      provideTestEnvelope(
        executeDirect({
          taskDescription: task,
          taskType: "query",
          memoryContext: "",
          availableTools: [],
          config: defaultReasoningConfig,
        }).pipe(Effect.provide(TestLLMServiceLayer([{ text: summary }]))),
      ),
    );
    expect(result.status).toBe("completed");
    expect(result.output).toBe(summary);
    expect(String(result.output)).not.toContain("Unfinished:");
  });

  it("seedPostConditions keeps ArtifactProduced and ToolCalled on a tool-less surface (contract-aligned)", () => {
    const derived = [
      { kind: "ArtifactProduced", path: "./notes.txt" },
      { kind: "ToolCalled", tool: "web-search" },
      sideEffectLanded(),
    ] as const;
    expect(seedPostConditions(derived, [])).toEqual([
      { kind: "ArtifactProduced", path: "./notes.txt" },
      { kind: "ToolCalled", tool: "web-search" },
    ]);
  });

  it("the quoted transcript still derives SideEffectLanded (the seed, not the deriver, scopes it)", () => {
    expect(deriveConditions(TRANSCRIPT_TASK, [])).toContainEqual(sideEffectLanded());
  });

  it("seedPostConditions drops SideEffectLanded on a meta-only surface and keeps the empty set", () => {
    const derived = deriveConditions(TRANSCRIPT_TASK, []);
    const metaOnly = [{ name: "brief" }, { name: "recall" }, { name: "final-answer" }];
    // Empty (not undefined): an empty stored set stops the Arbitrator's
    // derive-from-task fallback from re-adding the dropped condition.
    expect(seedPostConditions(derived, [])).toEqual([]);
    expect(seedPostConditions(derived, metaOnly)).toEqual([]);
  });

  it("keeps SideEffectLanded when a substantive tool could land it, or the surface is unknown", () => {
    const derived = deriveConditions(TRANSCRIPT_TASK, []);
    expect(seedPostConditions(derived, [{ name: "notes-create" }])).toContainEqual(sideEffectLanded());
    expect(seedPostConditions(derived, undefined)).toContainEqual(sideEffectLanded());
    expect(seedPostConditions([], [])).toBeUndefined();
  });

  it("the side-effect steer never claims a tool call was made", () => {
    const text = describeUnmet([sideEffectLanded()]);
    expect(text).not.toContain("last tool call failed");
    expect(text).toContain("no successful tool call");
  });
});

describe("K2: a loop failure names its real terminal, never the budget", () => {
  const LOOP_MSG = "Loop detected: same tool call repeated 2 times (a meta-tool call is not progress)";
  const briefCall = (i: number): ReasoningStep[] => [
    makeStep("action", "brief", { toolCall: { id: `c${i}`, name: "brief", arguments: { section: "math" } } }),
    makeStep("observation", "tools: 3 available [brief, recall, find]", {
      observationResult: { success: true, toolName: "brief" },
    } as never),
  ];

  const resolveLoop = () => {
    const options = makeKernelRunOptions({ strategy: "reactive", maxIterations: 16 });
    const state = transitionState(
      { ...initialKernelState(options), iteration: 4 },
      { steps: [...briefCall(1), ...briefCall(2)] },
    );
    return Effect.runPromise(
      resolveDetectedLoop({
        state,
        currentInput: makeKernelInput({ task: "What is 17 * 23? Answer briefly." }),
        currentOptions: options,
        loopMsg: LOOP_MSG,
        failureRecoveryRedirects: 0,
        requiredToolNudgeCount: 0,
        maxFailureRecoveryRedirects: 2,
        maxRequiredToolNudges: 2,
        emitLog: () => Effect.void,
      }),
    );
  };

  it("loop-resolution with nothing to hand off fails STAMPED loop_graceful, authority loop-resolution", async () => {
    const r = await resolveLoop();
    expect(r.outcome).toBe("break");
    expect(r.state.status).toBe("failed");
    expect(r.state.meta.terminatedBy).toBe("loop_graceful");
    expect(deriveTerminatedBy(r.state).rawTerminatedBy).toBe("loop_graceful");
    expect(deriveTerminalAuthority(r.state.meta)).toBe("loop-resolution");
  });

  it("the abstention text names the guard stop and its diagnostic, not the budget", () => {
    const steps = [...briefCall(1), ...briefCall(2)];
    const text = buildAbstentionOutput(steps, { terminatedBy: "loop_graceful", error: `${LOOP_MSG}\nOutstanding: x` });
    expect(text).not.toContain(BUDGET_TEXT);
    expect(text).toContain("loop_graceful");
    expect(text).toContain("same tool call repeated 2 times");
    expect(text).not.toContain("Outstanding:");
    // A real cap keeps the budget wording.
    expect(buildAbstentionOutput(steps, { terminatedBy: "max_iterations" })).toContain(BUDGET_TEXT);
  });

  it("the terminal mint threads the raw terminal + error into the abstention text", async () => {
    const r = await resolveLoop();
    const result = await Effect.runPromise(
      provideTestEnvelope(
        finalizeStrategyResult({
          strategy: "reactive",
          steps: r.state.steps,
          output: null,
          status: "failed",
          start: Date.now(),
          totalTokens: 0,
          totalCost: 0,
          error: r.state.error,
          kernelMeta: r.state.meta,
          extraMetadata: { ...deriveTerminatedBy(r.state) },
        }),
      ),
    );
    expect(String(result.output)).not.toContain(BUDGET_TEXT);
    expect(String(result.output)).toContain("loop_graceful");
    expect((result.metadata as Record<string, unknown>)["rawTerminatedBy"]).toBe("loop_graceful");
  });
});
