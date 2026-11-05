// Run: bun test packages/reasoning/tests/kernel/seam-model-exit-proposal.test.ts --timeout 20000
//
// Plan 9 item 2b (architecture-convergence program, post-review item 10): the
// model's "done" is a PROPOSAL the exit gate disposes, never an accept on its
// own. The think-dispatch stage used to end a run through side doors (the
// thinking-branch auto-promote that checked required tools plus lexical
// `looksLikeFinalAnswer`, the trivial end_turn fast path, the final_answer
// branch) that called the Arbitrator directly. Now each of those builds an
// `ExitProposal{proposedBy:"model"}` (`decide/model-exit-proposal.ts`) and
// `kernel/loop/exit-gate.ts` disposes it: outstanding = missing required
// tools (state.evidence) + unmet delivery conditions + no answer draft.
// Lexical checks only mark "has a draft".
//
//   (a) a final-looking answer with a required tool still missing is denied
//       by the gate, which names the missing tool;
//   (b) a final-looking answer on a contract-rich task with an unmet delivery
//       condition is denied by the gate (thinking branch and end_turn path);
//   (c) contract-poor task: a plain final answer still ends the run;
//   (d) census: the dispatch stage has no accept path for model text outside
//       the exit gate.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Layer, Option, Stream } from "effect";
import { LLMService, type StreamEvent } from "@reactive-agents/llm-provider";
import { NativeFCDriver, NativeFCStrategy } from "@reactive-agents/tools";
import { handleThinking } from "../../src/kernel/capabilities/reason/think.js";
import {
  initialKernelState,
  noopHooks,
  type KernelContext,
  type KernelInput,
  type KernelState,
} from "../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";
import { artifactProduced } from "../../src/kernel/capabilities/verify/post-conditions.js";
import { disposeExit, exitDeniedBefore } from "../../src/kernel/loop/exit-gate.js";
import type { ReasoningStep } from "../../src/types/index.js";

const STRUCTURED_ANSWER =
  "## France: Population Summary\n\n" +
  "The answer is approximately 68 million residents as of the latest " +
  "official census release.\n\n" +
  "1. Metro areas account for roughly two thirds\n" +
  "2. The figure is updated annually by the statistics institute";

const PLAIN_PROSE =
  "The current population of France is approximately 68 million people, " +
  "according to the latest official census data published by the national " +
  "statistics institute earlier this spring after a full recount.";

const MISSING_FILE = "/nonexistent-ra-2b-pin/report.md";

/** A one-turn LLM whose stream ends with the given text and stop reason. */
function stubLLM(text: string, stopReason: string) {
  const events = [
    { type: "text_delta", text },
    { type: "content_complete", content: text, stopReason },
    { type: "usage", usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12, estimatedCost: 0 } },
  ] as unknown as readonly StreamEvent[];
  return Layer.succeed(LLMService, {
    complete: () =>
      Effect.succeed({
        content: text,
        stopReason,
        usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12, estimatedCost: 0 },
        model: "test-model",
      }) as never,
    stream: () => Effect.succeed(Stream.fromIterable(events) as never),
    completeStructured: () => Effect.succeed({ ok: true }) as never,
    embed: () => Effect.succeed([]),
    countTokens: () => Effect.succeed(0),
    getModelConfig: () => Effect.succeed({} as never),
    getStructuredOutputCapabilities: () => Effect.succeed({} as never),
    capabilities: () => Effect.succeed({} as never),
  } as never);
}

function runThink(args: {
  readonly text: string;
  readonly stopReason: string;
  readonly input: KernelInput;
  readonly meta?: Partial<KernelState["meta"]>;
  readonly evidence?: KernelState["evidence"];
}): Promise<KernelState> {
  const base = initialKernelState({ strategy: "reactive", kernelType: "reactive", maxIterations: 12 });
  const state: KernelState = {
    ...base,
    ...(args.evidence ? { evidence: args.evidence, toolsUsed: new Set(Object.keys(args.evidence.successfulCounts)) } : {}),
    iteration: 1,
    messages: [{ role: "user" as const, content: args.input.task }],
    meta: { ...base.meta, ...(args.meta ?? {}) },
  };
  const context: KernelContext = {
    input: { ...args.input, toolCallResolver: new NativeFCStrategy() },
    profile: CONTEXT_PROFILES.local,
    compression: { budget: 800, previewItems: 5, autoStore: true, codeTransform: true },
    toolService: Option.none(),
    hooks: noopHooks,
    toolCallingDriver: new NativeFCDriver(),
    memoryService: Option.none(),
  };
  return Effect.runPromise(
    handleThinking(state, context).pipe(Effect.provide(stubLLM(args.text, args.stopReason))),
  );
}

const gateRecords = (steps: readonly ReasoningStep[]) =>
  steps.flatMap((s) => (s.metadata?.exitGate ? [s.metadata.exitGate] : []));

const SEARCH_TOOL = { name: "web-search", description: "Search the web.", parameters: [] };
const CENSUS_TOOL = { name: "census-lookup", description: "Look up census data.", parameters: [] };
const SEARCHED: KernelState["evidence"] = {
  successfulCounts: { "web-search": 1 },
  attemptedCounts: { "web-search": 1 },
  permanentlyFailed: [],
  substantive: true,
  seeded: false,
};

describe("2b — the model's final answer is a proposal the exit gate disposes", () => {
  it("(a) required tool missing: the gate denies the claim and names the tool", async () => {
    const result = await runThink({
      text: STRUCTURED_ANSWER,
      stopReason: "stop_sequence", // thinking branch (not end_turn)
      input: {
        task: "Look up the population of France with web-search, then cross-check it with census-lookup.",
        availableToolSchemas: [SEARCH_TOOL, CENSUS_TOOL],
        requiredTools: ["web-search", "census-lookup"],
      },
      evidence: SEARCHED, // web-search succeeded; census-lookup never ran
    });
    expect(result.status).not.toBe("done");
    const records = gateRecords(result.steps);
    expect(records).toHaveLength(1);
    expect(records[0]!.proposedBy).toBe("model");
    expect(records[0]!.gateDecision).toBe("deny-once");
    expect(records[0]!.outstanding).toContain("call the `census-lookup` tool");
    expect(result.pendingGuidance?.qualityGateHint).toContain("census-lookup");
  });

  it("(a) zero substantive evidence stays F1's: one grounding redirect, no gate denial", async () => {
    const result = await runThink({
      text: STRUCTURED_ANSWER,
      stopReason: "stop_sequence",
      input: {
        task: "What is the population of France? Use web-search.",
        availableToolSchemas: [SEARCH_TOOL],
        requiredTools: ["web-search"],
      },
    });
    expect(result.status).not.toBe("done");
    expect(gateRecords(result.steps)).toHaveLength(0);
    expect(result.meta.groundingRedirectCount).toBe(1);
  });

  it("(b) unmet delivery condition, thinking branch: the gate denies the final-looking answer", async () => {
    const result = await runThink({
      text: STRUCTURED_ANSWER,
      stopReason: "stop_sequence",
      input: { task: `Write the population summary to ${MISSING_FILE}.`, availableToolSchemas: [SEARCH_TOOL] },
      meta: { postConditions: [artifactProduced(MISSING_FILE)] },
    });
    expect(result.status).not.toBe("done");
    const records = gateRecords(result.steps);
    expect(records).toHaveLength(1);
    expect(records[0]!.proposedBy).toBe("model");
    expect(records[0]!.gateDecision).toBe("deny-once");
    expect(records[0]!.outstanding.join(" ")).toContain(MISSING_FILE);
  });

  it("(b) unmet delivery condition, end_turn path: the gate denies the plain answer", async () => {
    const result = await runThink({
      text: PLAIN_PROSE,
      stopReason: "end_turn",
      input: { task: `Write the population summary to ${MISSING_FILE}.`, availableToolSchemas: [SEARCH_TOOL] },
      meta: { postConditions: [artifactProduced(MISSING_FILE)] },
    });
    expect(result.status).not.toBe("done");
    const records = gateRecords(result.steps);
    expect(records).toHaveLength(1);
    expect(records[0]!.proposedBy).toBe("model");
    expect(records[0]!.outstanding.join(" ")).toContain(MISSING_FILE);
  });

  it("(c) contract-poor task: a plain final answer still ends the run", async () => {
    for (const stopReason of ["stop_sequence", "end_turn"]) {
      const result = await runThink({
        text: PLAIN_PROSE,
        stopReason,
        input: { task: "Tell me about the population of France.", availableToolSchemas: [SEARCH_TOOL] },
      });
      expect(result.status).toBe("done");
      expect(result.output).toContain("68 million");
      // An accept changes nothing about the run: no gate step is written.
      expect(gateRecords(result.steps)).toHaveLength(0);
    }
  });

  it("a model denial never spends the guards' one deny-once nudge, and never hands off", () => {
    const modelDenied = [
      {
        id: "g" as ReasoningStep["id"],
        type: "harness_signal",
        content: "denied",
        timestamp: new Date(),
        metadata: { exitGate: { proposedBy: "model", gateDecision: "deny-once", reason: "end_turn", outstanding: ["x"] } },
      },
    ] as ReasoningStep[];
    expect(exitDeniedBefore(modelDenied)).toBe(false);
    // Repeated model claims with work outstanding keep the run going (the cap bounds it).
    expect(
      disposeExit({ kind: "model", outstanding: ["x"], hasMaterial: true, deniedBefore: true, iteration: 11, llmCalls: 11, maxIterations: 12 }),
    ).toBe("deny-once");
    expect(
      disposeExit({ kind: "model", outstanding: [], hasMaterial: true, deniedBefore: true, iteration: 1, llmCalls: 1, maxIterations: 12 }),
    ).toBe("accept");
  });

  it("(d) census: the dispatch stage has no accept path for model text outside the exit gate", () => {
    const src = (rel: string) =>
      readFileSync(join(import.meta.dir, "../../src/kernel/capabilities", rel), "utf8");
    const dispatch = src("reason/dispatch-think-response.ts");
    expect(dispatch).not.toContain("arbitrateAndApply(");
    expect(dispatch).not.toContain("arbitrate(");
    // Every model-answer intent in the stage is handed to the proposal seam:
    // one `proposeModelExit(` call per intent literal (end_turn fast path,
    // resolver final_answer, answer-shaped thought).
    const intents = dispatch.match(/kind: "(?:agent-final-answer|fast-path-completed)"/g) ?? [];
    const proposals = dispatch.match(/yield\* proposeModelExit\(/g) ?? [];
    expect(proposals).toHaveLength(3);
    expect(intents).toHaveLength(proposals.length);
    // The one direct terminal left in the stage is the earned abstention (not an answer).
    expect(dispatch.match(/\bterminate\(/g) ?? []).toHaveLength(1);
    expect(dispatch).toContain('reason: "abstained"');
    const seam = src("decide/model-exit-proposal.ts");
    expect(seam).toContain("proposeExit(");
    expect(seam).toContain('proposedBy: "model"');
  });
});
