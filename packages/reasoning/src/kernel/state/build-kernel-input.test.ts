/**
 * build-kernel-input.test.ts — Behaviour-preservation guard for FM-I (#195).
 *
 * Pins that `buildKernelInput(crossCutting, perPass)` reconstructs the exact
 * `KernelInput` literal that `strategies/reactive.ts` (lines ~177-219) hand-
 * builds today, field-for-field, INCLUDING the `REACTIVE_AGENTS_NOOP_VERIFIER`
 * env branch. If a field is dropped from the builder bundles or the merge, the
 * deep-equal fails — that is the structural fix's safety net before the
 * main-thread migrates the 6 strategy call sites onto the builder.
 */
import { describe, it, expect, afterEach } from "bun:test";
import {
  buildKernelInput,
  type CrossCuttingInput,
  type PerPassInput,
} from "./build-kernel-input.js";
import type { KernelInput } from "./kernel-state.js";
import { noopVerifier } from "../capabilities/verify/noop-verifier.js";
import type { Verifier } from "../capabilities/verify/verifier.js";

// ── Representative non-trivial values for every field reactive sets ──────────
const customVerifier: Verifier = {
  verify: () => ({ accepted: true }),
} as unknown as Verifier;

const crossCutting: CrossCuttingInput = {
  resultCompression: { previewLines: 5 } as never,
  providerName: "ollama",
  agentId: "agent-1",
  sessionId: "session-1",
  requiredTools: ["http-get"],
  requiredToolQuantities: { "http-get": 4 },
  relevantTools: ["web-search"],
  maxCallsPerTool: { "web-search": 3 },
  maxRequiredToolRetries: 2,
  environmentContext: { region: "us" },
  allowedTools: ["http-get", "web-search"],
  metaTools: { enabled: true } as never,
  toolElaboration: { enabled: true } as never,
  nextMovesPlanning: { enabled: false } as never,
  briefResolvedSkills: [{ name: "skill-a", purpose: "do a" }],
  synthesisConfig: { mode: "auto" } as never,
  observationSummary: "auto",
  auditRationale: false,
  modelId: "qwen3:14b",
  calibration: { steeringCompliance: 0.8 } as never,
  harnessPipeline: { transform: () => undefined } as never,
  budgetLimits: { tokenLimit: 100_000, warningRatio: 0.9 },
};

const basePerPass: Omit<PerPassInput, "verifier"> = {
  task: "do the thing",
  systemPrompt: "you are helpful",
  availableToolSchemas: [{ name: "http-get", description: "", parameters: [] }],
  allToolSchemas: [{ name: "http-get", description: "", parameters: [] }],
  priorContext: "Relevant Memory:\nfoo",
  contextProfile: { tier: "local" } as never,
  temperature: 0.3,
  initialMessages: [{ role: "user", content: "hi" }],
};

/**
 * Reconstruct reactive.ts's hand-built literal EXACTLY (same field order /
 * verifier env branch) so the test fails the moment the builder diverges.
 */
function reactiveHandBuilt(verifier: Verifier | undefined): KernelInput {
  return {
    task: basePerPass.task,
    systemPrompt: basePerPass.systemPrompt,
    availableToolSchemas: basePerPass.availableToolSchemas,
    allToolSchemas: basePerPass.allToolSchemas,
    priorContext: basePerPass.priorContext,
    contextProfile: basePerPass.contextProfile,
    providerName: crossCutting.providerName,
    resultCompression: crossCutting.resultCompression,
    temperature: basePerPass.temperature,
    agentId: crossCutting.agentId,
    sessionId: crossCutting.sessionId,
    requiredTools: crossCutting.requiredTools,
    requiredToolQuantities: crossCutting.requiredToolQuantities,
    relevantTools: crossCutting.relevantTools,
    maxCallsPerTool: crossCutting.maxCallsPerTool,
    maxRequiredToolRetries: crossCutting.maxRequiredToolRetries,
    environmentContext: crossCutting.environmentContext,
    allowedTools: crossCutting.allowedTools,
    metaTools: crossCutting.metaTools,
    toolElaboration: crossCutting.toolElaboration,
    nextMovesPlanning: crossCutting.nextMovesPlanning,
    briefResolvedSkills: crossCutting.briefResolvedSkills,
    initialMessages: basePerPass.initialMessages,
    synthesisConfig: crossCutting.synthesisConfig,
    observationSummary: crossCutting.observationSummary,
    auditRationale: crossCutting.auditRationale,
    modelId: crossCutting.modelId,
    calibration: crossCutting.calibration,
    verifier,
    harnessPipeline: crossCutting.harnessPipeline,
    budgetLimits: crossCutting.budgetLimits,
  };
}

/** Mirror reactive's verifier resolution: explicit ?? (noop-on-env) ?? undefined. */
function resolveVerifier(explicit: Verifier | undefined): Verifier | undefined {
  return (
    explicit ??
    (process.env.REACTIVE_AGENTS_NOOP_VERIFIER === "1" ? noopVerifier : undefined)
  );
}

describe("buildKernelInput — reactive.ts equivalence (FM-I #195)", () => {
  const prevEnv = process.env.REACTIVE_AGENTS_NOOP_VERIFIER;
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.REACTIVE_AGENTS_NOOP_VERIFIER;
    else process.env.REACTIVE_AGENTS_NOOP_VERIFIER = prevEnv;
  });

  it("reconstructs the hand-built literal field-for-field (no explicit verifier, env off)", () => {
    delete process.env.REACTIVE_AGENTS_NOOP_VERIFIER;
    const verifier = resolveVerifier(undefined);
    const built = buildKernelInput(crossCutting, { ...basePerPass, verifier });
    expect(built).toEqual(reactiveHandBuilt(verifier));
    expect(built.verifier).toBeUndefined();
  });

  it("substitutes noopVerifier when REACTIVE_AGENTS_NOOP_VERIFIER=1 and no explicit verifier", () => {
    process.env.REACTIVE_AGENTS_NOOP_VERIFIER = "1";
    const verifier = resolveVerifier(undefined);
    const built = buildKernelInput(crossCutting, { ...basePerPass, verifier });
    expect(built).toEqual(reactiveHandBuilt(verifier));
    expect(built.verifier).toBe(noopVerifier);
  });

  it("an explicit verifier wins over the noop env branch", () => {
    process.env.REACTIVE_AGENTS_NOOP_VERIFIER = "1";
    const verifier = resolveVerifier(customVerifier);
    const built = buildKernelInput(crossCutting, { ...basePerPass, verifier });
    expect(built).toEqual(reactiveHandBuilt(verifier));
    expect(built.verifier).toBe(customVerifier);
  });

  it("pins the exact KernelInput key set reactive sets (drop-guard)", () => {
    const verifier = resolveVerifier(undefined);
    const built = buildKernelInput(crossCutting, { ...basePerPass, verifier });
    expect(new Set(Object.keys(built))).toEqual(
      new Set(Object.keys(reactiveHandBuilt(verifier))),
    );
  });
});
