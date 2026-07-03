// Run: bun test packages/reasoning/src/kernel/loop/grounded-terminal.test.ts --timeout 20000
//
// F1 — Grounded-terminal invariant + F3 — repeated-identical-failure escalation.
//
// Root cause (wiki/Research/Harness-Reports/2026-07-02-cogito8b-competitor-bench-root-cause.md):
// small models give up after 1-4 failed tool calls and ship a parametric guess as
// the FIRST terminal answer. Every runtime enforcement mechanism (recovery
// steering, forced abstention, verifier) was keyed to conditions an early
// ungrounded end_turn never reaches.
//
// F1 contract (requiredTools non-empty ONLY — pure-synthesis tasks untouched):
//   attempt 1 with ZERO successful substantive tool calls → reject the terminal
//   ONCE: inject recovery/grounding steering as a harness_signal and continue.
//   attempt 2 still ungrounded → the exit is accepted and the runner's existing
//   forced-abstention path (§7.5) converts it to terminatedBy:"abstained" with
//   result.abstention naming the missing required tools.
// F3 contract: same tool + same normalized error class ≥2 consecutive failures →
//   recovery steering injected immediately (not gated on stall/loop guards).

import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { ToolService } from "@reactive-agents/tools";
import { reactKernel } from "./react-kernel.js";
import { runPass } from "./run-pass.js";
import { makeStep } from "../capabilities/sense/step-utils.js";
import { makeObservationResult } from "../utils/observation-helpers.js";
import type { KernelInput } from "../state/kernel-state.js";
import type { ReasoningStep } from "../../types/index.js";
import { arbitrate, type ArbitrationContext } from "../capabilities/decide/arbitrator.js";
import { decideForcedAbstention } from "./runner-helpers/force-abstention.js";
import {
  GROUNDING_REDIRECT,
  TERMINAL_ANSWER_REASONS,
  hasSuccessfulSubstantiveToolCall,
  buildGroundingRedirectGuidance,
} from "./runner-helpers/grounded-terminal.js";
import {
  detectRepeatedIdenticalToolFailure,
} from "./runner-helpers/recovery-steering.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const failedObs = (toolName: string, error: string): ReasoningStep =>
  makeStep("observation", error, {
    observationResult: makeObservationResult(toolName, false, error),
  });

const successObs = (toolName: string, content: string): ReasoningStep =>
  makeStep("observation", content, {
    observationResult: makeObservationResult(toolName, true, content),
  });

function makeCtx(overrides: Partial<ArbitrationContext>): ArbitrationContext {
  return {
    iteration: 2,
    task: "Look up the answer",
    steps: [],
    toolsUsed: new Set<string>(),
    requiredTools: [],
    ...overrides,
  };
}

const WS_SCHEMA = {
  name: "web-search",
  description: "search the web",
  parameters: [{ name: "query", type: "string", required: true }],
};

const failingToolLayer = Layer.succeed(
  ToolService,
  ToolService.of({
    execute: () => Effect.fail(new Error("connection refused: search backend unreachable")),
    getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: [] }),
    register: () => Effect.void,
    listTools: () => Effect.succeed([]),
    deregister: () => Effect.void,
  } as unknown as Parameters<typeof ToolService.of>[0]),
);

const succeedingToolLayer = Layer.succeed(
  ToolService,
  ToolService.of({
    execute: () => Effect.succeed({ success: true, result: { items: ["result-1", "result-2"] } }),
    getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: [] }),
    register: () => Effect.void,
    listTools: () => Effect.succeed([]),
    deregister: () => Effect.void,
  } as unknown as Parameters<typeof ToolService.of>[0]),
);

const runReactive = (
  input: KernelInput,
  llmLayer: ReturnType<typeof TestLLMServiceLayer>,
  toolLayer: typeof failingToolLayer,
  maxIterations = 8,
) =>
  Effect.runPromise(
    runPass(reactKernel, input, {
      maxIterations,
      strategy: "reactive",
      kernelType: "react",
      taskId: "grounded-terminal-test",
    }).pipe(Effect.provide(Layer.mergeAll(llmLayer, toolLayer))),
  );

const groundingSignals = (steps: readonly ReasoningStep[]) =>
  steps.filter(
    (s) =>
      s.type === "harness_signal" &&
      /Recovery required|Grounding required/.test(s.content),
  );

// ─── F1 unit: the arbitrator gate ────────────────────────────────────────────

describe("F1 unit — grounded-terminal gate in arbitrate()", () => {
  it("first ungrounded terminal (requiredTools, zero successes) → escalate grounding-redirect", () => {
    const ctx = makeCtx({
      requiredTools: ["web-search"],
      steps: [failedObs("web-search", "connection refused: search backend unreachable")],
    });
    const verdict = arbitrate(
      { kind: "agent-final-answer", via: "regex", output: "a parametric guess" },
      ctx,
    );
    expect(verdict.action).toBe("escalate");
    if (verdict.action === "escalate") {
      expect(verdict.nextStrategy).toBe(GROUNDING_REDIRECT);
      expect(verdict.reason).toContain("web-search");
      expect(verdict.reason.length).toBeLessThan(300);
    }
  });

  it("second ungrounded terminal (groundingRedirectCount ≥ 1) → exit-success passes (runner abstains post-loop)", () => {
    const ctx = makeCtx({
      requiredTools: ["web-search"],
      steps: [failedObs("web-search", "connection refused: search backend unreachable")],
      groundingRedirectCount: 1,
    });
    const verdict = arbitrate(
      { kind: "agent-final-answer", via: "regex", output: "a parametric guess" },
      ctx,
    );
    expect(verdict.action).toBe("exit-success");
  });

  it("grounded terminal (successful substantive call) → exit-success unchanged", () => {
    const ctx = makeCtx({
      requiredTools: ["web-search"],
      steps: [successObs("web-search", "found: result-1")],
      toolsUsed: new Set(["web-search"]),
    });
    const verdict = arbitrate(
      { kind: "agent-final-answer", via: "regex", output: "grounded answer from result-1" },
      ctx,
    );
    expect(verdict.action).toBe("exit-success");
  });

  it("no requiredTools → gate never fires (pure-synthesis untouched)", () => {
    const ctx = makeCtx({ requiredTools: [] });
    const verdict = arbitrate(
      { kind: "agent-final-answer", via: "regex", output: "pure synthesis answer" },
      ctx,
    );
    expect(verdict.action).toBe("exit-success");
  });

  it("final-answer TOOL exit is exempt (Lever-8 deliberate-exit precedent) — PostCondition spine owns it", () => {
    // via:"tool" is the model's deliberate structured exit channel (already
    // veto-exempt); graceful-failure tasks legitimately exit through it with
    // zero successful data calls. The gate targets the WEAK-signal give-up
    // family (end_turn / regex narration) only. Ungrounded tool exits remain
    // owned by the PostCondition gate, which derives ToolCalled(requiredTools)
    // and demotes to a state-grounded post-condition-steer instead.
    const ctx = makeCtx({
      requiredTools: ["web-search"],
      steps: [failedObs("web-search", "connection refused: search backend unreachable")],
    });
    const verdict = arbitrate(
      { kind: "agent-final-answer", via: "tool", output: "a deliberate tool exit" },
      ctx,
    );
    // NOT a grounding-redirect: the PostCondition gate (ToolCalled unmet)
    // produces its own steer for this ungrounded tool exit.
    expect(verdict.action).toBe("escalate");
    if (verdict.action === "escalate") {
      expect(verdict.nextStrategy).toBe("post-condition-steer");
    }
  });
});

// ─── F1 unit: helpers ────────────────────────────────────────────────────────

describe("F1 unit — grounded-terminal helpers", () => {
  it("hasSuccessfulSubstantiveToolCall ignores meta-tools and failures", () => {
    expect(hasSuccessfulSubstantiveToolCall([])).toBe(false);
    expect(
      hasSuccessfulSubstantiveToolCall([failedObs("web-search", "boom")]),
    ).toBe(false);
    expect(
      hasSuccessfulSubstantiveToolCall([successObs("pulse", "readyToAnswer: false")]),
    ).toBe(false);
    expect(
      hasSuccessfulSubstantiveToolCall([successObs("web-search", "data")]),
    ).toBe(true);
  });

  it("TERMINAL_ANSWER_REASONS covers the final-answer/end_turn family only", () => {
    for (const r of ["final_answer_tool", "final_answer", "final_answer_regex", "end_turn", "llm_end_turn"]) {
      expect(TERMINAL_ANSWER_REASONS.has(r)).toBe(true);
    }
    expect(TERMINAL_ANSWER_REASONS.has("abstained")).toBe(false);
    expect(TERMINAL_ANSWER_REASONS.has("loop_detected:x")).toBe(false);
  });

  it("guidance names failed tools when failures exist, required tools otherwise; < 300 chars", () => {
    const withFailure = buildGroundingRedirectGuidance(
      [failedObs("web-search", "connection refused")],
      ["web-search"],
    );
    expect(withFailure).toContain("web-search");
    expect(withFailure.length).toBeLessThan(300);

    const noFailure = buildGroundingRedirectGuidance([], ["web-search", "file-write"]);
    expect(noFailure).toContain("web-search");
    expect(noFailure).toContain("Grounding required");
    expect(noFailure.length).toBeLessThan(300);
  });
});

// ─── F1 unit: forced abstention names the missing tools ─────────────────────

describe("F1 unit — decideForcedAbstention names missing required tools", () => {
  it("≥2 ungrounded rejections + named tools → abstention reason lists them", () => {
    const forced = decideForcedAbstention({
      requiredToolUnavailable: false,
      missingRequiredTools: [],
      ungroundedSynthesisRejections: 2,
      iterationsRemaining: 3,
      hasDeliverable: false,
      ungroundedRequiredTools: ["web-search"],
    });
    expect(forced).not.toBeNull();
    expect(forced?.reason).toContain("no successful tool call for required tools");
    expect(forced?.reason).toContain("web-search");
    expect(forced?.missing).toEqual(["tool:web-search"]);
  });

  it("≥2 ungrounded rejections without named tools → generic reason (existing contract)", () => {
    const forced = decideForcedAbstention({
      requiredToolUnavailable: false,
      missingRequiredTools: [],
      ungroundedSynthesisRejections: 2,
      iterationsRemaining: 0,
      hasDeliverable: false,
    });
    expect(forced?.reason).toBe("could not ground an answer in available evidence");
  });
});

// ─── F3 unit: repeated identical failure detector ────────────────────────────

describe("F3 unit — detectRepeatedIdenticalToolFailure", () => {
  it("2 consecutive identical failures (same tool, same error class) → detected", () => {
    const steps = [
      failedObs("web-search", "connection refused: search backend unreachable"),
      makeStep("thought", "let me retry"),
      failedObs("web-search", "connection refused: search backend unreachable"),
    ];
    const hit = detectRepeatedIdenticalToolFailure(steps);
    expect(hit).not.toBeNull();
    expect(hit?.toolName).toBe("web-search");
    expect(hit?.streak).toBe(2);
  });

  it("error strings differing only in digits normalize to the same class", () => {
    const steps = [
      failedObs("http-get", "timeout after 3001ms"),
      failedObs("http-get", "timeout after 2987ms"),
    ];
    expect(detectRepeatedIdenticalToolFailure(steps)?.streak).toBe(2);
  });

  it("different tools / different error classes / trailing success → null", () => {
    expect(
      detectRepeatedIdenticalToolFailure([
        failedObs("web-search", "connection refused"),
        failedObs("http-get", "connection refused"),
      ]),
    ).toBeNull();
    expect(
      detectRepeatedIdenticalToolFailure([
        failedObs("web-search", "connection refused"),
        failedObs("web-search", "invalid query syntax"),
      ]),
    ).toBeNull();
    expect(
      detectRepeatedIdenticalToolFailure([
        failedObs("web-search", "connection refused"),
        failedObs("web-search", "connection refused"),
        successObs("web-search", "ok"),
      ]),
    ).toBeNull();
    expect(
      detectRepeatedIdenticalToolFailure([failedObs("web-search", "connection refused")]),
    ).toBeNull();
  });
});

// ─── Integration: full loop through runPass(reactKernel) ────────────────────

describe("F1 integration — grounded-terminal invariant (react kernel full loop)", () => {
  it("(a)+(b) failed tool → 2 ungrounded terminals → 1 grounding redirect, then abstained", async () => {
    const llm = TestLLMServiceLayer([
      { toolCall: { name: "web-search", args: { query: "answer" } } },
      { text: "FINAL ANSWER: a parametric guess." },
      { text: "FINAL ANSWER: still a parametric guess." },
    ]);
    const pass = await runReactive(
      {
        task: "Look up the current answer using the search tool",
        requiredTools: ["web-search"],
        availableToolSchemas: [WS_SCHEMA],
      },
      llm,
      failingToolLayer,
    );

    // Exactly ONE grounding redirect signal was injected (cap: 1 per run).
    expect(groundingSignals(pass.state.steps).length).toBe(1);
    expect(pass.state.meta.groundingRedirectCount).toBe(1);
    // Second ungrounded terminal → forced abstention, naming the tool.
    expect(pass.state.meta.terminatedBy).toBe("abstained");
    expect(pass.state.meta.abstention?.reason).toContain("web-search");
  });

  it("(a) recovery: redirect steers the model to a successful call → grounded terminal accepted", async () => {
    const llm = TestLLMServiceLayer([
      { text: "FINAL ANSWER: a guess before using any tool." },
      { toolCall: { name: "web-search", args: { query: "answer" } } },
      { text: "FINAL ANSWER: grounded in result-1." },
    ]);
    const pass = await runReactive(
      {
        task: "Look up the current answer using the search tool",
        requiredTools: ["web-search"],
        availableToolSchemas: [WS_SCHEMA],
      },
      llm,
      succeedingToolLayer,
    );

    expect(groundingSignals(pass.state.steps).length).toBe(1);
    expect(pass.state.status).toBe("done");
    expect(pass.state.meta.terminatedBy).not.toBe("abstained");
    expect(pass.output ?? "").toContain("grounded in result-1");
  });

  it("(c) successful required tool call → terminal accepted unchanged, no redirect", async () => {
    const llm = TestLLMServiceLayer([
      { toolCall: { name: "web-search", args: { query: "answer" } } },
      { text: "FINAL ANSWER: grounded in result-1." },
    ]);
    const pass = await runReactive(
      {
        task: "Look up the current answer using the search tool",
        requiredTools: ["web-search"],
        availableToolSchemas: [WS_SCHEMA],
      },
      llm,
      succeedingToolLayer,
    );

    expect(pass.state.status).toBe("done");
    expect(pass.state.meta.terminatedBy).not.toBe("abstained");
    expect(pass.state.meta.groundingRedirectCount).toBeUndefined();
    expect(groundingSignals(pass.state.steps).length).toBe(0);
    expect(pass.output ?? "").toContain("grounded in result-1");
  });

  it("(d) no requiredTools → pure-synthesis terminal untouched (zero new signals)", async () => {
    const llm = TestLLMServiceLayer([
      { text: "FINAL ANSWER: pure synthesis answer." },
    ]);
    const pass = await runReactive(
      { task: "Summarize the tradeoffs of tabs versus spaces" },
      llm,
      succeedingToolLayer,
      3,
    );

    expect(pass.state.status).toBe("done");
    expect(pass.state.meta.terminatedBy).not.toBe("abstained");
    expect(pass.state.meta.groundingRedirectCount).toBeUndefined();
    expect(groundingSignals(pass.state.steps).length).toBe(0);
    expect(pass.output ?? "").toContain("pure synthesis");
  });
});

describe("F3 integration — repeated identical failure escalates immediately", () => {
  it("(e) two consecutive identical tool failures → recovery steering injected before stall/loop guards", async () => {
    const llm = TestLLMServiceLayer([
      { toolCall: { name: "web-search", args: { query: "first" } } },
      { toolCall: { name: "web-search", args: { query: "second" } } },
      { text: "FINAL ANSWER: giving up narration." },
    ]);
    const pass = await runReactive(
      {
        task: "Look up the current answer",
        availableToolSchemas: [WS_SCHEMA],
      },
      llm,
      failingToolLayer,
      6,
    );

    const signals = pass.state.steps.filter(
      (s) => s.type === "harness_signal" && /Recovery required/.test(s.content),
    );
    expect(signals.length).toBeGreaterThanOrEqual(1);
    // The signal lands immediately after the 2nd identical failure — i.e. the
    // failure observations precede it and no 3rd identical attempt was needed.
    const failures = pass.state.steps.filter(
      (s) =>
        s.type === "observation" &&
        s.metadata?.observationResult?.success === false &&
        s.metadata?.observationResult?.toolName === "web-search",
    );
    expect(failures.length).toBe(2);
    const secondFailureIdx = pass.state.steps.findIndex((s) => s === failures[1]);
    const signalIdx = pass.state.steps.findIndex((s) => s === signals[0]);
    expect(signalIdx).toBeGreaterThan(secondFailureIdx);
  });
});
