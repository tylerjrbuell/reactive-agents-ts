// Run: bun test packages/reasoning/tests/receipt-actor-coverage.test.ts
//
// W-Q (task #54) — extend `receipt.interventions[]` coverage to the remaining
// control actors. W-J shipped the derive/aggregate/format path plus the gate-
// redirect + grounding-redirect stamps; this pins the FOUR new actor TYPES that
// W-Q stamps at their existing emission points, each MUTATION-PROVEN:
//
//   1. STRATEGY SWITCH      — actor "strategy-switch"          (model-grade)
//   2. TOOL-SURFACE NARROW  — actor "tool-surface:forbidden-deny" (deterministic)
//   3. GUARD FIRES          — actor "fabrication-guard"        (deterministic)
//   4. NUDGES               — actor "recovery-steering"        (deterministic)
//
// deriveInterventionsFromSteps / computeTrustReceipt need ZERO change — they
// already generalize over `step.metadata.intervention`. Each stamp names its
// class via `authorityOf(...)` (single source: decide/authority.ts).

import { describe, it, expect } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { deriveInterventionsFromSteps } from "@reactive-agents/core";
import { LLMService, TestLLMService, type StreamEvent, type TestTurn } from "@reactive-agents/llm-provider";
import { NativeFCDriver } from "@reactive-agents/tools";
import { applyStrategySwitch } from "../src/kernel/loop/runner-helpers/strategy-switch.js";
import { resolveDetectedLoop } from "../src/kernel/loop/runner-helpers/loop-resolution.js";
import { runStallDeliverableStep } from "../src/kernel/loop/runner-helpers/stall-deliverable.js";
import { defaultVerifier } from "../src/kernel/capabilities/verify/verifier.js";
import { handleThinking } from "../src/kernel/capabilities/reason/think.js";
import { reactKernel } from "../src/kernel/loop/react-kernel.js";
import { runPass } from "../src/kernel/loop/run-pass.js";
import { compileRunContract } from "../src/kernel/contract/run-contract.js";
import { makeStep } from "../src/kernel/capabilities/sense/step-utils.js";
import { CONTEXT_PROFILES } from "../src/context/context-profile.js";
import {
  initialKernelState,
  transitionState,
  noopHooks,
  type KernelContext,
  type KernelHooks,
  type KernelInput,
  type KernelRunOptions,
  type KernelState,
} from "../src/kernel/state/kernel-state.js";

const options = { strategy: "reactive", kernelType: "reactive", maxIterations: 8 } as unknown as KernelRunOptions;

// ── 1. STRATEGY SWITCH (model-grade) ─────────────────────────────────────────

describe("actor coverage — strategy-switch", () => {
  const hooks = { onStrategySwitched: () => Effect.void } as unknown as KernelHooks;
  const input = { task: "t", requiredTools: [] } as unknown as KernelInput;
  const context = { input } as unknown as KernelContext;

  it("applyStrategySwitch records a model-grade strategy-switch intervention — MUTATION PIN", async () => {
    // Mutation tripwire: delete the intervention-carrying step append in
    // strategy-switch.ts → this find() goes undefined → red.
    const result = await Effect.runPromise(
      applyStrategySwitch({
        state: initialKernelState(options),
        currentInput: input,
        context,
        options,
        hooks,
        triedStrategies: ["reactive"],
        switchCount: 0,
        fromStrategy: "reactive",
        toStrategy: "plan-execute",
        failureReason: "loop detected",
      }),
    );
    const iv = deriveInterventionsFromSteps(result.state.steps);
    const sw = iv.find((i) => i.actor === "strategy-switch");
    expect(sw).toBeDefined();
    expect(sw?.authorityClass).toBe("model-grade");
    expect(sw?.evidence).toContain("plan-execute");
  });
});

// ── 4. NUDGES — recovery-steering (deterministic) ────────────────────────────

describe("actor coverage — recovery-steering (nudge)", () => {
  it("a confirmed loop after an unresolved tool failure records a deterministic recovery-steering intervention — MUTATION PIN", async () => {
    let state = initialKernelState(options);
    const failObs = makeStep("observation", "web-search failed: timeout", {
      observationResult: {
        toolName: "web-search",
        success: false,
        displayText: "web-search failed: timeout",
        category: "error" as const,
        resultKind: "error" as const,
        preserveOnCompaction: false,
        trustLevel: "trusted" as const,
      },
    });
    state = transitionState(state, { steps: [...state.steps, failObs] });
    const currentInput = {
      task: "t",
      availableToolSchemas: [
        { name: "file-read", description: "read a file", parameters: [] },
        { name: "web-search", description: "search the web", parameters: [] },
      ],
    } as unknown as KernelInput;

    // Mutation tripwire: delete the intervention on the recovery redirect step
    // in loop-resolution.ts → this find() goes undefined → red.
    const result = await Effect.runPromise(
      resolveDetectedLoop({
        state,
        currentInput,
        currentOptions: options,
        loopMsg: "loop detected: repeated web-search",
        failureRecoveryRedirects: 0,
        requiredToolNudgeCount: 0,
        maxFailureRecoveryRedirects: 2,
        maxRequiredToolNudges: 2,
        emitLog: () => Effect.void,
      }),
    );
    const iv = deriveInterventionsFromSteps(result.state.steps);
    const rec = iv.find((i) => i.actor === "recovery-steering");
    expect(rec).toBeDefined();
    expect(rec?.authorityClass).toBe("deterministic");
    expect(rec?.evidence).toContain("web-search");
  });
});

// ── 4b. NUDGES / GUARD — required-tool-nudge (deterministic, StallPolicy) ────

describe("actor coverage — required-tool-nudge (stall guard)", () => {
  it("a stall with a missing required tool records a deterministic required-tool-nudge intervention — MUTATION PIN", async () => {
    const state = initialKernelState(options);
    const currentInput = {
      task: "write the report",
      requiredTools: ["file-write"],
      availableToolSchemas: [{ name: "file-write", description: "write a file", parameters: [] }],
    } as unknown as KernelInput;

    // Mutation tripwire: drop the intervention on the required-tool nudge step
    // in stall-deliverable.ts → this find() goes undefined → red.
    const result = await Effect.runPromise(
      runStallDeliverableStep({
        state,
        currentInput,
        currentOptions: options,
        missingRequiredByCount: ["file-write"],
        stallTriggered: true,
        totalArtifacts: 0,
        consecutiveStalled: 3,
        requiredToolNudgeCount: 0,
        failureRecoveryRedirects: 0,
        maxRequiredToolNudges: 3,
        maxFailureRecoveryRedirects: 2,
        verifier: defaultVerifier,
        emitLog: () => Effect.void,
      }),
    );
    const iv = deriveInterventionsFromSteps(result.state.steps);
    const nudge = iv.find((i) => i.actor === "required-tool-nudge");
    expect(nudge).toBeDefined();
    expect(nudge?.authorityClass).toBe("deterministic");
    expect(nudge?.evidence).toContain("file-write");
  });
});

// ── 4c. NUDGES — loop-missing-tools (deterministic) ──────────────────────────

describe("actor coverage — loop-missing-tools (nudge)", () => {
  it("a loop with artifacts but a still-missing required tool records a deterministic loop-missing-tools intervention — MUTATION PIN", async () => {
    let state = initialKernelState(options);
    const okObs = makeStep("observation", "web-search returned 3 results", {
      observationResult: {
        toolName: "web-search",
        success: true,
        displayText: "web-search returned 3 results",
        category: "data" as const,
        resultKind: "success" as const,
        preserveOnCompaction: true,
        trustLevel: "untrusted" as const,
      },
    });
    state = transitionState(state, {
      steps: [...state.steps, okObs],
      toolsUsed: new Set(["web-search"]),
    });
    const currentInput = {
      task: "research then write",
      requiredTools: ["file-write"],
      availableToolSchemas: [
        { name: "web-search", description: "search the web", parameters: [] },
        { name: "file-write", description: "write a file", parameters: [] },
      ],
    } as unknown as KernelInput;

    // Mutation tripwire: drop the intervention on the loop-with-missing-tools
    // nudge step in loop-resolution.ts → this find() goes undefined → red.
    const result = await Effect.runPromise(
      resolveDetectedLoop({
        state,
        currentInput,
        currentOptions: options,
        loopMsg: "loop detected",
        failureRecoveryRedirects: 0,
        requiredToolNudgeCount: 0,
        maxFailureRecoveryRedirects: 2,
        maxRequiredToolNudges: 2,
        emitLog: () => Effect.void,
      }),
    );
    const iv = deriveInterventionsFromSteps(result.state.steps);
    const nudge = iv.find((i) => i.actor === "loop-missing-tools");
    expect(nudge).toBeDefined();
    expect(nudge?.authorityClass).toBe("deterministic");
    expect(nudge?.evidence).toContain("file-write");
  });
});

// ── 2. TOOL-SURFACE NARROWING — forbidden-deny (deterministic) ───────────────

const cannedStreamEvents: readonly StreamEvent[] = [
  { type: "text_delta", text: "Thinking." },
  { type: "content_complete", content: "Thinking." },
  { type: "usage", usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12, estimatedCost: 0 } },
];

const stubLLM = Layer.succeed(LLMService, {
  complete: () =>
    Effect.succeed({
      content: "ok",
      stopReason: "end_turn",
      usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12, estimatedCost: 0 },
      model: "test-model",
    }) as never,
  stream: () => Effect.succeed(Stream.fromIterable(cannedStreamEvents) as never),
  completeStructured: () => Effect.succeed({ ok: true }) as never,
  embed: () => Effect.succeed([]),
  countTokens: () => Effect.succeed(0),
  getModelConfig: () => Effect.succeed({} as never),
  getStructuredOutputCapabilities: () => Effect.succeed({} as never),
  capabilities: () => Effect.succeed({} as never),
} as never);

describe("actor coverage — tool-surface:forbidden-deny", () => {
  it("a contract-declared forbidden tool that was in the surface records a deterministic tool-surface intervention — MUTATION PIN", async () => {
    const runContract = compileRunContract("Delete the logs.", {
      taskContract: { tools: [{ kind: "forbidden", name: "shell-execute" }] },
    } as never);
    const state: KernelState = {
      ...initialKernelState({ strategy: "reactive", kernelType: "reactive", maxIterations: 8 }),
      messages: [{ role: "user" as const, content: "Delete the logs." }],
      meta: {
        ...initialKernelState({ strategy: "reactive", kernelType: "reactive", maxIterations: 8 }).meta,
        runContract,
      },
    };
    const input: KernelInput = {
      task: "Delete the logs.",
      availableToolSchemas: [
        { name: "shell-execute", description: "Run a shell command.", parameters: [] },
        { name: "file-read", description: "Read a file.", parameters: [] },
      ],
    };
    const context: KernelContext = {
      input,
      profile: CONTEXT_PROFILES.local,
      compression: { budget: 800, previewItems: 5, autoStore: true, codeTransform: true },
      toolService: { _tag: "None" },
      hooks: noopHooks,
      toolCallingDriver: new NativeFCDriver(),
      memoryService: { _tag: "None" },
    } as unknown as KernelContext;

    // Mutation tripwire: drop the `intervention:` from the thoughtStep metadata
    // (or the surfaceDeniedTool detection) in think.ts → this find() → undefined.
    const next = await Effect.runPromise(
      handleThinking(state, context).pipe(Effect.provide(stubLLM)),
    );
    const iv = deriveInterventionsFromSteps(next.steps);
    const deny = iv.find((i) => i.actor === "tool-surface:forbidden-deny");
    expect(deny).toBeDefined();
    expect(deny?.authorityClass).toBe("deterministic");
    expect(deny?.evidence).toContain("shell-execute");
  });
});

// ── 3. GUARD FIRES — fabrication-guard (deterministic) ───────────────────────

const contractlessTextLayer = (scenario: TestTurn[]) => {
  const svc = TestLLMService(scenario);
  return Layer.succeed(
    LLMService,
    LLMService.of({
      ...svc,
      capabilities: () =>
        svc.capabilities().pipe(Effect.map((c) => ({ ...c, supportsToolCalling: false }))),
    }),
  );
};

describe("actor coverage — fabrication-guard (guard fire)", () => {
  it("a terminal answer inventing an unmeasured perf figure records a deterministic fabrication-guard intervention — MUTATION PIN", async () => {
    const fabricated =
      "FINAL ANSWER: The refactor cut request latency from 150ms to 90ms, a 40% speedup, " +
      "and raised throughput from 1200 to 2000 requests per second.";
    const pass = await Effect.runPromise(
      runPass(
        reactKernel,
        { task: "Summarize the performance impact of the refactor." },
        {
          maxIterations: 4,
          strategy: "reactive",
          kernelType: "react",
          taskId: "wq-fabrication",
        },
      ).pipe(Effect.provide(contractlessTextLayer([{ text: fabricated }]))),
    );

    // Mutation tripwire: delete the fabCheck intervention append in runner.ts →
    // this find() goes undefined → red. (The fabricated-measurement guard is
    // ALWAYS-ON default block, so the terminal verifier rejects the output.)
    const iv = deriveInterventionsFromSteps(pass.state.steps);
    const fab = iv.find((i) => i.actor === "fabrication-guard");
    expect(fab).toBeDefined();
    expect(fab?.authorityClass).toBe("deterministic");
  });
});
