// Run: bun test packages/reasoning/tests/kernel/terminal-post-condition-gate.test.ts --timeout 15000
//
// Terminal PostCondition hard-stop — the success authority at the single-owner
// imperative gateway (kernel/loop/terminate.ts). The Arbitrator's steer gate
// only covers verdict-driven exit-success; imperative paths that route through
// terminate() (stall/harness-deliverable, loop-graceful, oracle-forced,
// required-tool-nudge-exhausted) bypass the verdict. This proves that with
// RA_POST_CONDITIONS=1 + non-empty stored conditions + an unmet ledger, a
// forced termination (e.g. the stall/harness-deliverable path) resolves to
// status:"failed" (honest failure → result.success=false) instead of
// delivering a false success. Flag OFF → byte-identical delivered success.
//
// This is the reproducible proof for the cogito GitHub-MCP false-success
// (trace 01KSWR3S5FEW0KM61PCF1M6946): result.success=TRUE with ./commits.md
// absent because the stall path force-delivered around the gated verdict.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { terminate } from "../../src/kernel/loop/terminate.js";
import { runStallDeliverableStep } from "../../src/kernel/loop/runner-helpers/stall-deliverable.js";
import { defaultVerifier } from "../../src/kernel/capabilities/verify/verifier.js";
import {
  artifactProduced,
  toolCalled,
} from "../../src/kernel/capabilities/verify/post-conditions.js";
import type { KernelState, KernelInput, KernelRunOptions } from "../../src/kernel/state/kernel-state.js";
import type { ReasoningStep } from "../../src/types/index.js";
import type { ObservationResult } from "../../src/types/observation.js";

const PRIOR = process.env.RA_POST_CONDITIONS;
beforeEach(() => { delete process.env.RA_POST_CONDITIONS; });
afterEach(() => {
  if (PRIOR === undefined) delete process.env.RA_POST_CONDITIONS;
  else process.env.RA_POST_CONDITIONS = PRIOR;
});

// A ledger with a substantive NON-write tool artifact (so the stall path has
// `totalArtifacts > 0` and takes the deliver branch) but NO successful
// file-write — exactly the cogito failure shape (it called `recall`, never
// file-write, so ./commits.md was never produced).
function ledgerWithArtifactButNoWrite(): ReasoningStep[] {
  return [
    {
      id: "act-recall" as ReasoningStep["id"],
      type: "action",
      content: "recall(...)",
      timestamp: new Date(),
      metadata: { toolCall: { id: "tc-recall", name: "recall", arguments: { key: "./commits.md" } } },
    },
    {
      id: "obs-recall" as ReasoningStep["id"],
      type: "observation",
      content: JSON.stringify({ items: ["a", "b", "c"] }),
      timestamp: new Date(),
      metadata: {
        toolCallId: "tc-recall",
        // A successful NON-write observation: counts as a deliverable artifact
        // for the stall path, but does NOT satisfy ArtifactProduced(./commits.md).
        storedKey: "_tool_result_1",
        observationResult: {
          success: true,
          toolName: "recall",
          displayText: "recalled 3 items",
          category: "data",
          resultKind: "data",
          preserveOnCompaction: true,
          trustLevel: "untrusted",
        } as ObservationResult,
      },
    },
  ];
}

const unmetConditions = [
  artifactProduced("./commits.md"),
  toolCalled("file-write"),
] as const;

function baseState(overrides: Partial<KernelState> = {}): KernelState {
  return {
    taskId: "t",
    strategy: "reactive",
    kernelType: "react",
    steps: [],
    toolsUsed: new Set(),
    scratchpad: new Map(),
    iteration: 4,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
    status: "thinking",
    output: null,
    error: null,
    llmCalls: 4,
    meta: {},
    controllerDecisionLog: [],
    messages: [],
    pendingGuidance: undefined,
    consecutiveLowDeltaCount: 0,
    readyToAnswerNudgeCount: 0,
    lastMetaToolCall: undefined,
    consecutiveMetaToolCount: 0,
    ...overrides,
  } as KernelState;
}

// ── Unit: terminate() boundary (RED→GREEN at the single-owner gateway) ────────

describe("terminate() terminal PostCondition gate — flag ON", () => {
  beforeEach(() => { process.env.RA_POST_CONDITIONS = "1"; });

  it("demotes a forced termination to failed when a stored condition is unmet", () => {
    const state = baseState({
      steps: ledgerWithArtifactButNoWrite(),
      meta: { postConditions: [...unmetConditions] },
    });
    const next = terminate(state, {
      reason: "harness_deliverable",
      output: "Here is a summary of the commits.",
    });
    // Honest failure: NOT a delivered success.
    expect(next.status).toBe("failed");
    expect(next.output).toBeNull(); // transitionState invariant nulls output on fail
    expect(next.error).toContain("./commits.md");
    expect(next.meta.terminatedBy).toBe("harness_deliverable");
  }, 15000);

  it("allows the done transition once the stored conditions ARE met", () => {
    const writeLedger: ReasoningStep[] = [
      {
        id: "act-w" as ReasoningStep["id"],
        type: "action",
        content: "file-write(...)",
        timestamp: new Date(),
        metadata: { toolCall: { id: "tc-w", name: "file-write", arguments: { path: "./commits.md", content: "x" } } },
      },
      {
        id: "obs-w" as ReasoningStep["id"],
        type: "observation",
        content: "ok",
        timestamp: new Date(),
        metadata: {
          toolCallId: "tc-w",
          observationResult: {
            success: true,
            toolName: "file-write",
            displayText: "ok",
            category: "file-write",
            resultKind: "side-effect",
            preserveOnCompaction: true,
            trustLevel: "untrusted",
          } as ObservationResult,
        },
      },
    ];
    const state = baseState({
      steps: writeLedger,
      meta: { postConditions: [...unmetConditions] },
    });
    const next = terminate(state, { reason: "harness_deliverable", output: "Done." });
    expect(next.status).toBe("done");
    expect(next.output).toBe("Done.");
  }, 15000);

  it("no stored conditions -> done transition stands (conservative fallback)", () => {
    const state = baseState({ steps: ledgerWithArtifactButNoWrite(), meta: {} });
    const next = terminate(state, { reason: "harness_deliverable", output: "Summary." });
    expect(next.status).toBe("done");
    expect(next.output).toBe("Summary.");
  }, 15000);
});

describe("terminate() terminal PostCondition gate — flag OFF (byte-identical)", () => {
  it("delivers success even with unmet stored conditions", () => {
    const state = baseState({
      steps: ledgerWithArtifactButNoWrite(),
      meta: { postConditions: [...unmetConditions] },
    });
    const next = terminate(state, { reason: "harness_deliverable", output: "Summary." });
    expect(next.status).toBe("done");
    expect(next.output).toBe("Summary.");
  }, 15000);
});

// ── Integration: the actual stall/harness-deliverable terminate() path ────────

describe("runStallDeliverableStep — terminal gate via the real stall path", () => {
  const input = {
    task: "Fetch the commits and create a markdown file (./commits.md) summarizing them.",
    requiredTools: ["file-write"],
    availableToolSchemas: [{ name: "file-write" } as never, { name: "recall" } as never],
  } as unknown as KernelInput;
  const options = { maxIterations: 10, strategy: "reactive", kernelType: "react", taskId: "t" } as KernelRunOptions;

  it("flag ON: stall deliver-with-artifacts path resolves to failed when ./commits.md was never written", async () => {
    process.env.RA_POST_CONDITIONS = "1";
    const state = baseState({
      steps: ledgerWithArtifactButNoWrite(),
      meta: { postConditions: [...unmetConditions] },
    });
    const { Effect } = await import("effect");
    const result = await Effect.runPromise(
      runStallDeliverableStep({
        state,
        currentInput: input,
        currentOptions: options,
        missingRequiredByCount: [], // required-tool gate not the trigger here
        stallTriggered: true,
        totalArtifacts: 1, // the recall artifact → takes the deliver branch
        consecutiveStalled: 4,
        requiredToolNudgeCount: 0,
        failureRecoveryRedirects: 99, // skip recovery-steering branch
        maxRequiredToolNudges: 4,
        maxFailureRecoveryRedirects: 2,
        verifier: defaultVerifier,
        emitLog: () => Effect.void,
      }),
    );
    expect(result.outcome).toBe("break");
    expect(result.state.status).toBe("failed"); // honest failure, not delivered success
    expect(result.state.output).toBeNull();
  }, 15000);

  it("flag OFF: same stall path delivers (unchanged) with status done", async () => {
    delete process.env.RA_POST_CONDITIONS;
    const state = baseState({
      steps: ledgerWithArtifactButNoWrite(),
      meta: { postConditions: [...unmetConditions] },
    });
    const { Effect } = await import("effect");
    const result = await Effect.runPromise(
      runStallDeliverableStep({
        state,
        currentInput: input,
        currentOptions: options,
        missingRequiredByCount: [],
        stallTriggered: true,
        totalArtifacts: 1,
        consecutiveStalled: 4,
        requiredToolNudgeCount: 0,
        failureRecoveryRedirects: 99,
        maxRequiredToolNudges: 4,
        maxFailureRecoveryRedirects: 2,
        verifier: defaultVerifier,
        emitLog: () => Effect.void,
      }),
    );
    expect(result.outcome).toBe("break");
    expect(result.state.status).toBe("done");
  }, 15000);
});
