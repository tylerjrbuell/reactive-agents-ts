// File: src/feature-matrix.ts
//
// What the bench actually exercises, versus what the framework exposes.
//
// Audited 2026-07-09: `ReactiveAgentBuilder` declares **90** `with*`/`without*`
// methods. The bench runner could toggle **10**. Nothing detected that gap, and
// nothing prevented it from growing: a new builder method could ship with zero
// benchmark coverage forever, and the suite would stay green.
//
// This module is the single declaration of which builder methods are CAPABILITY
// features (they can change a task's outcome, so a benchmark that never enables
// them cannot claim to measure the harness) and which are PLUMBING (naming,
// transport, logging, pricing — no effect on task success).
//
// `tests/feature-coverage.test.ts` enforces three things against real source:
//
//   1. DRIFT: every builder method is classified here. A new `withX()` on the
//      builder fails the suite until someone decides what it is.
//   2. WIRING: every feature marked `covered` is actually toggled by
//      `runner.ts`. Claiming coverage without a call site fails.
//   3. RATCHET: the number of uncovered capability features may only DECREASE.
//      (Same discipline as the `as unknown as` ceiling: design it out, never
//      bump it up.)
//
// The ratchet is deliberate. Wiring 40 features at once would be a lie dressed
// as progress; a monotonically shrinking gap is progress that cannot be faked.

/** Does this builder method change what a task produces? */
export type FeatureClass =
  /** Can change a run's outcome. A bench that never enables it measures less than it claims. */
  | "capability"
  /** Naming, transport, pricing, logging, DI. No effect on task success. */
  | "plumbing";

export interface FeatureEntry {
  readonly featureClass: FeatureClass;
  /** Why a capability feature is not (yet) exercised. Required when uncovered. */
  readonly gapReason?: string;
}

/**
 * Every `with*`/`without*` method on ReactiveAgentBuilder, classified.
 *
 * Keep alphabetical. The drift test reads `packages/runtime/src/builder.ts` and
 * fails if this map and the builder disagree in EITHER direction.
 */
export const FEATURE_MATRIX: Readonly<Record<string, FeatureEntry>> = {
  // ── Capability: exercised by the bench today ────────────────────────────────
  withAdaptiveHarness: { featureClass: "capability" },
  withDynamicSubAgents: { featureClass: "capability" },
  withFabricationGuard: { featureClass: "capability" },
  withGrounding: { featureClass: "capability" },
  withGuardrails: { featureClass: "capability" },
  withLeanHarness: { featureClass: "capability" },
  withLongHorizon: { featureClass: "capability" },
  withMemory: { featureClass: "capability" },
  withMetaTools: { featureClass: "capability" },
  withReactiveIntelligence: { featureClass: "capability" },
  withReasoning: { featureClass: "capability" },
  withRequiredTools: { featureClass: "capability" },
  withStallPolicy: { featureClass: "capability" },
  withThinking: { featureClass: "capability" },
  withTools: { featureClass: "capability" },
  withVerification: { featureClass: "capability" },

  // ── Capability: NOT yet exercised. Each needs a reason, and the count only falls.
  withA2A: { featureClass: "capability", gapReason: "multi-agent transport; needs a two-process bench harness" },
  withAgentTool: { featureClass: "capability", gapReason: "agent-as-tool delegation; no task exercises it" },
  withApprovalPolicy: { featureClass: "capability", gapReason: "HITL pause/resume; bench has no approver" },
  withBehavioralContracts: { featureClass: "capability", gapReason: "no task declares behavioral contracts" },
  withBudget: { featureClass: "capability", gapReason: "budget-exceeded terminal path unmeasured" },
  withCalibration: { featureClass: "capability", gapReason: "per-model calibration; needs a multi-run warmup arm" },
  withContract: { featureClass: "capability", gapReason: "RunContract deny-list/requirements; tasks carry no contract" },
  withCustomTermination: { featureClass: "capability", gapReason: "custom terminal oracle unmeasured" },
  withDocuments: { featureClass: "capability", gapReason: "RAG-style document grounding; no corpus task" },
  withDurableRuns: { featureClass: "capability", gapReason: "crash-resume; needs a kill-and-restart harness" },
  withExperienceLearning: { featureClass: "capability", gapReason: "cross-run learning; needs a repeated-task arm" },
  withHarness: { featureClass: "capability", gapReason: "compose-API harness injection" },
  withHook: { featureClass: "capability", gapReason: "user hooks alter control flow; unmeasured" },
  withInteraction: { featureClass: "capability", gapReason: "user-interaction tool; bench has no user" },
  withKillSwitch: { featureClass: "capability", gapReason: "abort path; unmeasured" },
  withLearning: { featureClass: "capability", gapReason: "learning loop; needs a repeated-task arm" },
  withMCP: { featureClass: "capability", gapReason: "MCP tool servers; needs a docker fixture" },
  withMemoryConsolidation: { featureClass: "capability", gapReason: "needs a long/repeated-session arm" },
  withMinIterations: { featureClass: "capability", gapReason: "iteration floor unmeasured" },
  withModelRouting: { featureClass: "capability", gapReason: "structurally inert: bench runs ONE resident model per cell, so there is no pool to route across" },
  withOrchestration: { featureClass: "capability", gapReason: "multi-agent orchestration; no task exercises it" },
  withOutputValidator: { featureClass: "capability", gapReason: "structured-output repair; no schema task" },
  withoutMemory: { featureClass: "capability", gapReason: "negative wither; memory is default-off, so this is a no-op arm" },
  withProgressCheckpoint: { featureClass: "capability", gapReason: "checkpoint cadence unmeasured" },
  withPrompts: { featureClass: "capability", gapReason: "prompt-pack override unmeasured" },
  withRemoteAgent: { featureClass: "capability", gapReason: "remote delegation; needs a second process" },
  withRetryPolicy: { featureClass: "capability", gapReason: "retry/backoff unmeasured" },
  withSelfImprovement: { featureClass: "capability", gapReason: "self-improvement loop; needs a repeated-task arm" },
  withSkillPersistence: { featureClass: "capability", gapReason: "skill reuse across runs; needs a repeated-task arm" },
  withSkills: { featureClass: "capability", gapReason: "skill injection; no task exercises it" },
  withStreaming: { featureClass: "capability", gapReason: "bench consumes run(), not stream()" },
  withStrictValidation: { featureClass: "capability", gapReason: "validation strictness unmeasured" },
  withSystemPrompt: { featureClass: "capability", gapReason: "prompt override would confound the harness comparison" },
  withTaskContext: { featureClass: "capability", gapReason: "task-context injection unmeasured" },
  withTerminalTools: { featureClass: "capability", gapReason: "terminal-tool subset unmeasured" },
  withTestScenario: { featureClass: "capability", gapReason: "deterministic test provider; not a live-model capability" },
  withUserInteraction: { featureClass: "capability", gapReason: "bench has no user" },
  withVerificationStep: { featureClass: "capability", gapReason: "explicit verify step; unmeasured" },

  // ── Plumbing: cannot change a task's outcome ────────────────────────────────
  withAgentId: { featureClass: "plumbing" },
  withAudit: { featureClass: "plumbing" },
  withCacheTimeout: { featureClass: "plumbing" },
  withChannels: { featureClass: "plumbing" },
  withCircuitBreaker: { featureClass: "plumbing" },
  withContextProfile: { featureClass: "plumbing" },
  withCortex: { featureClass: "plumbing" },
  withCostTracking: { featureClass: "plumbing" },
  withDynamicPricing: { featureClass: "plumbing" },
  withEnvironment: { featureClass: "plumbing" },
  withErrorHandler: { featureClass: "plumbing" },
  withEvents: { featureClass: "plumbing" },
  withFallbacks: { featureClass: "plumbing" },
  withGateway: { featureClass: "plumbing" },
  withHealthCheck: { featureClass: "plumbing" },
  withIdentity: { featureClass: "plumbing" },
  withLayers: { featureClass: "plumbing" },
  withReplayLLM: { featureClass: "plumbing" },
  withLazyValidation: { featureClass: "plumbing" },
  withLlmTimeout: { featureClass: "plumbing" },
  withLogging: { featureClass: "plumbing" },
  withMaxIterations: { featureClass: "plumbing" },
  withModel: { featureClass: "plumbing" },
  withModelPricing: { featureClass: "plumbing" },
  withName: { featureClass: "plumbing" },
  withObservability: { featureClass: "plumbing" },
  withoutCircuitBreaker: { featureClass: "plumbing" },
  withoutObservability: { featureClass: "plumbing" },
  withoutTracing: { featureClass: "plumbing" },
  withPersona: { featureClass: "plumbing" },
  withProfile: { featureClass: "plumbing" },
  withProvider: { featureClass: "plumbing" },
  withRateLimiting: { featureClass: "plumbing" },
  withReceiptSigning: { featureClass: "plumbing" },
  withTelemetry: { featureClass: "plumbing" },
  withTimeout: { featureClass: "plumbing" },
  withTracing: { featureClass: "plumbing" },
};

/**
 * The number of capability features the bench does not exercise.
 *
 * MEASURED 2026-07-09 at 38 (of 54 capability features). This may only go DOWN.
 * Raising it means the framework grew a capability the bench cannot see — which
 * is exactly the blindness this file exists to prevent. Wire the feature, or
 * reclassify it as plumbing with a justification in review.
 */
export const UNCOVERED_CAPABILITY_CEILING = 38;

/** Capability features that must have a `builder.<name>(` call in runner.ts. */
export function coveredCapabilityFeatures(): readonly string[] {
  return Object.entries(FEATURE_MATRIX)
    .filter(([, e]) => e.featureClass === "capability" && e.gapReason === undefined)
    .map(([name]) => name);
}

/** Capability features knowingly unexercised (each carries a reason). */
export function uncoveredCapabilityFeatures(): readonly string[] {
  return Object.entries(FEATURE_MATRIX)
    .filter(([, e]) => e.featureClass === "capability" && e.gapReason !== undefined)
    .map(([name]) => name);
}
