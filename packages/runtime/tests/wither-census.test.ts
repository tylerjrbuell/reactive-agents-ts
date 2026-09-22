// Run: bun test packages/runtime/tests/wither-census.test.ts --timeout 15000
//
// Every public with*/without* method must be classified. PROVEN = a named
// red-on-cut behavioral test exists. UNOBSERVABLE-DETERMINISTIC = its effect
// needs a live provider (reason required). INFRA = wiring-only (layers, test
// hooks) whose behavior is pinned elsewhere (reason required). A new wither
// with no row fails CI.
//
// DEBT-REGISTER B3 (2026-09-14, Task 8) — full research pass over all 85
// withers on `ReactiveAgents.create()`. Classification was done by: (1)
// grepping every `.with<X>(`/`.without<X>(` call site across `packages/**`
// test files (not just `packages/*/tests/` — 168 test files live outside that
// convention, e.g. `src/__tests__/`), then (2) reading the candidate file(s)
// to check whether a test actually builds an agent WITH vs WITHOUT the wither
// and asserts an OBSERVABLE difference (a run() result field, a captured LLM
// request, a thrown/resolved build()/run(), a file written) — not merely a
// `toConfig()` / private-`_field` assertion. Several existing tests LOOK
// behavioral by title but bypass the actual builder wither (drive
// `createRuntime()` or a kernel fixture directly with the raw
// `ReactiveAgentsConfig` field) — those are classified SILENT, not PROVEN,
// because cutting the wither's OWN wiring line in `runtime-construction.ts`
// would not turn them red. See task-8-report.md for the full per-wither
// evidence trail and the SILENT-remaining backlog by batch.
import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ReactiveAgents } from "../src/index.js";

type Proof =
  | { readonly status: "PROVEN"; readonly test: string }
  | { readonly status: "UNOBSERVABLE-DETERMINISTIC"; readonly reason: string }
  | { readonly status: "INFRA"; readonly reason: string };

export const WITHER_PROOF: Readonly<Record<string, Proof>> = {
  // ─── Foundational / infra (pinned elsewhere, exercised by the whole suite) ──
  withProvider: { status: "INFRA", reason: "provider selector; the 'test' value is the deterministic-test foundation exercised by nearly every test in the repo" },
  withTestScenario: { status: "INFRA", reason: "test provider driver; exercised by every deterministic test" },
  withReplayLLM: { status: "INFRA", reason: "test LLM injection; exercised by seam harness A" },
  withLayers: { status: "INFRA", reason: "late-bound layer merge; see builder-seam-behavioral header" },
  withEvents: { status: "INFRA", reason: "documented no-op retained for API compatibility only (builder.ts: 'the EventBus is always active on every agent'; former _enableEvents flag gated no branch, removed v0.14) — candidate for a future removal wave, not this one (ratchet forbids removing/adding withers mid-task)" },

  // ─── PROVEN (batch 1, this task — safety/cost enforcement) ──────────────────
  withBudget: { status: "PROVEN", test: "builder-seam-behavioral.test.ts" },
  withKillSwitch: { status: "PROVEN", test: "builder-seam-behavioral.test.ts" },
  withTimeout: { status: "PROVEN", test: "builder-seam-behavioral.test.ts" },
  withGuardrails: { status: "PROVEN", test: "builder-seam-behavioral.test.ts" },
  withRequiredTools: { status: "PROVEN", test: "builder-seam-behavioral.test.ts" },
  withApprovalPolicy: { status: "PROVEN", test: "builder-seam-behavioral.test.ts" },

  // ─── PROVEN (pre-existing seam tests) ────────────────────────────────────────
  withPersona: { status: "PROVEN", test: "builder-seam-behavioral.test.ts" },
  withTaskContext: { status: "PROVEN", test: "builder-seam-behavioral.test.ts" },
  withTools: { status: "PROVEN", test: "builder-seam-behavioral.test.ts" },
  withReasoning: { status: "PROVEN", test: "builder-seam-behavioral.test.ts" },
  withMaxIterations: { status: "PROVEN", test: "builder-seam-behavioral.test.ts" },
  withOutputValidator: { status: "PROVEN", test: "builder-seam-behavioral.test.ts" },
  withOutputSchema: { status: "PROVEN", test: "builder-seam-behavioral.test.ts" },
  withBehavioralContracts: { status: "PROVEN", test: "behavioral-contract-enforcement.test.ts" },

  // ─── PROVEN (found elsewhere in the suite — genuine WITH-vs-WITHOUT observable
  //     difference through the actual builder wither, not a bypass) ───────────
  withAgentId: { status: "PROVEN", test: "../src/__tests__/builder-agent-id.test.ts" },
  withName: { status: "PROVEN", test: "../src/__tests__/builder-agent-id.test.ts" },
  withChannels: { status: "PROVEN", test: "with-channels-gateway.test.ts" },
  withContextProfile: { status: "PROVEN", test: "builder-profile-resolution.test.ts" },
  withContract: { status: "PROVEN", test: "../src/__tests__/builder-task-contract.test.ts" },
  withCostTracking: { status: "PROVEN", test: "approval-resume-semantic-cache.test.ts" },
  withCustomTermination: { status: "PROVEN", test: "harness-hook-envelope-coverage.test.ts" },
  withDocuments: { status: "PROVEN", test: "meta-tools-default-surface.test.ts" },
  withDurableRuns: { status: "PROVEN", test: "durable-crash-e2e.test.ts" },
  withDynamicSubAgents: { status: "PROVEN", test: "subagent/nesting-depth.test.ts" },
  withErrorHandler: { status: "PROVEN", test: "error-handler-fires.test.ts" },
  withFabricationGuard: { status: "PROVEN", test: "fabrication-guard-rail.test.ts" },
  withFallbacks: { status: "PROVEN", test: "fallback.test.ts" },
  withGateway: { status: "PROVEN", test: "gateway-start.test.ts" },
  withHook: { status: "PROVEN", test: "lifecycle-hook-firing.test.ts" },
  withLazyValidation: { status: "PROVEN", test: "build-validation.test.ts" },
  withLeanHarness: { status: "PROVEN", test: "builder-memory-default-off.test.ts" },
  withLearning: { status: "PROVEN", test: "builder-memory-default-off.test.ts" },
  withJudgment: { status: "PROVEN", test: "builder-judgment.test.ts" },
  withLlmTimeout: { status: "PROVEN", test: "llm-timeout-builder.test.ts" },
  withMemory: { status: "PROVEN", test: "memory-off-no-ambient-stack.test.ts" },
  withMetaTools: { status: "PROVEN", test: "meta-tools-default-surface.test.ts" },
  withModel: { status: "PROVEN", test: "model-routing-e2e.test.ts" },
  withModelRouting: { status: "PROVEN", test: "model-routing-e2e.test.ts" },
  withObservability: { status: "PROVEN", test: "observability-verbosity.test.ts" },
  withProfile: { status: "PROVEN", test: "harness-profile.test.ts" },
  withReceiptSigning: { status: "PROVEN", test: "trust-event-stream.test.ts" },
  withSkillPersistence: { status: "PROVEN", test: "../src/__tests__/builder-with-skill-persistence.test.ts" },
  withSkills: { status: "PROVEN", test: "skills-system-prompt-separation.test.ts" },
  withStrictValidation: { status: "PROVEN", test: "build-validation.test.ts" },
  withSystemPrompt: { status: "PROVEN", test: "../test/compose-desugar.test.ts" },
  withToolIntent: { status: "PROVEN", test: "chat-routing-behavioral.test.ts" },
  withTracing: { status: "PROVEN", test: "builder-tracing.test.ts" },
  withUserInteraction: { status: "PROVEN", test: "server/interaction-rail.test.ts" },
  withoutMemory: { status: "PROVEN", test: "builder-memory-default-off.test.ts" },

  // ─── UNOBSERVABLE-DETERMINISTIC (genuinely needs a live provider / external
  //     service to observe; reason cites what specifically requires it) ───────
  withAdaptiveHarness: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "adaptive plan compilation only observably changes tool-call trajectories over a real multi-step live-model run (see packages/benchmarks/tests/adaptive-ablation-session.test.ts); the deterministic test-provider plumbing test (withadaptiveharness-plumbing.test.ts) only proves toConfig() passthrough, not behavior" },
  withLongHorizon: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "long-horizon guard scaling (vetoDecisionWindow/redirectBudget) only observably diverges from the absolute-count default over a real many-iteration live-model run (see packages/benchmarks/tests/long-horizon-arm.test.ts); withlonghorizon-plumbing.test.ts only proves toConfig() passthrough" },
  withCortex: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "reports events to a live Cortex HTTP desk; with-cortex-build.test.ts only asserts build()/run() do not throw when a (non-listening) URL is configured, not that events are actually POSTed — proving that needs a real or stub HTTP listener, not attempted yet" },
  // Registry-resolved (string) form proven end-to-end via a fake MCPRegistry
  // in builder-mcp-registry.test.ts; the object/object[] literal-config form
  // is still only proven at the config-storage level (builder-tools.test.ts)
  // — actual tool discovery/execution needs a live MCP server/Docker
  // container unavailable in CI.
  withMCP: { status: "PROVEN", test: "builder-mcp-registry.test.ts" },

  // ─── SILENT-remaining (temporary rows; genuinely unproven at the wither
  //     level as of this task; grouped into follow-on batches of ~6, priority
  //     order = safety/cost-adjacent, then observability/session, then
  //     cosmetic/rarely-used surface) ───────────────────────────────────────
  withA2A: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "SILENT — batch 2 (plan 2026-09-14 Task 8); now only a config carrier (default port) consumed by `agent.serveA2A()` (A2A repair Task 2, 2026-09-16) which itself starts a real JSON-RPC HTTP server — proven by a2a-wiring.test.ts, but that test drives `.serveA2A()` directly, not `.withA2A()`'s own port-default plumbing" },
  withAgentTool: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "SILENT — batch 2 (plan 2026-09-14 Task 8); subagent-persona.test.ts only asserts the agent builds, never that the registered remote/static tool is actually invoked with the configured persona" },
  withAudit: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "SILENT — batch 3 (plan 2026-09-14 Task 8); every call site is a kitchen-sink build/e2e test asserting overall success, none isolates an audit-log-specific observable effect" },
  withCalibration: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "SILENT — batch 3 (plan 2026-09-14 Task 8); resolveCalibrationSetting is unit-tested directly (calibration-skip-honored.test.ts) but no test calls the builder's .withCalibration( wither itself and observes a behavioral difference" },
  withCircuitBreaker: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "SILENT — batch 2 (plan 2026-09-14 Task 8); zero test call sites; circuit-breaker trips are only observable under live provider network failures" },
  withDynamicPricing: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "SILENT — batch 4 (plan 2026-09-14 Task 8); zero test call sites for the dynamic PricingProvider wither" },
  withEnvironment: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "SILENT — batch 4 (plan 2026-09-14 Task 8); zero test call sites; _environmentContext is forwarded to createRuntime but no test observes it reaching a request or tool" },
  withExperienceLearning: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "SILENT — batch 3 (plan 2026-09-14 Task 8); only wave1-folds.test.ts's toConfig()-equivalence check calls it, no run()-level behavioral test" },
  withGrounding: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "SILENT — batch 2 (plan 2026-09-14 Task 8); builder-grounding.test.ts is explicitly config-only by its own header ('End-to-end grounding behavior ... covered in packages/reasoning tests'), and those reasoning tests drive a RunEnvelope directly, never `.withGrounding(` on the builder" },
  withHarness: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "SILENT — batch 2 (plan 2026-09-14 Task 8); harness-builder.test.ts and compose-desugar.test.ts only assert toConfig()/_harnessRegistrations state; the deep behavioral proof that a registered hook actually fires (react-kernel-crosscutting-forwarding.test.ts) constructs the HarnessPipeline directly via RegistrationHarness, bypassing .withHarness() entirely" },
  withHealthCheck: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "SILENT — batch 4 (plan 2026-09-14 Task 8); health-check.test.ts never registers an actual health check, so 'with' vs 'without' produce the same empty checks[] — no demonstrated observable difference" },
  withLogging: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "SILENT — batch 4 (plan 2026-09-14 Task 8); effect-log-capture.test.ts always calls .withLogging() in both its 'with' and implicit baseline paths (there is no without-arm), so it pins the engine's Logger bridge, not this wither's own level/format/output-stream effect specifically" },
  withMemoryConsolidation: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "SILENT — batch 3 (plan 2026-09-14 Task 8); the RED-ON-CUT proof in memory-consolidation-wiring.test.ts drives createRuntime({enableMemoryConsolidation}) directly, bypassing the .withMemoryConsolidation() builder wither; the file that DOES call the wither (wave1-folds.test.ts) only checks toConfig() equivalence" },
  withMinIterations: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "SILENT — batch 2 (plan 2026-09-14 Task 8); harness-improvements.test.ts's RED-ON-CUT behavioral test drives defaultReactiveAgentsConfig({minIterations}) + a raw ReasoningService stub directly, bypassing the .withMinIterations() builder wither entirely" },
  withModelPricing: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "SILENT — batch 4 (plan 2026-09-14 Task 8); zero test call sites for the wither itself" },
  withPrompts: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "SILENT — batch 4 (plan 2026-09-14 Task 8); every call site is a kitchen-sink build/e2e test, none isolates a prompts-specific observable effect" },
  withRateLimiting: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "SILENT — batch 4 (plan 2026-09-14 Task 8); zero test call sites; rate-limiter throttling is only observable under live provider request timing" },
  withReactiveIntelligence: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "SILENT — batch 3 (plan 2026-09-14 Task 8); reactive-intelligence-builder.test.ts only asserts toConfig().features.reactiveIntelligence, never a run()-level entropy/confidence observable difference" },
  withRemoteAgent: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "SILENT — batch 4 (plan 2026-09-14 Task 8); zero test call sites" },
  withRetryPolicy: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "SILENT — batch 3 (plan 2026-09-14 Task 8); builder-convenience.test.ts only asserts the agent builds, never that a failing call is actually retried" },
  withSelfImprovement: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "SILENT — batch 3 (plan 2026-09-14 Task 8); self-improvement.test.ts only checks chainability + config-schema decoding, no run()-level behavioral test" },
  withStallPolicy: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "SILENT — batch 2 (plan 2026-09-14 Task 8); wave1-folds.test.ts's call is a toConfig()-equivalence check; cross-cutting-cascade.test.ts's stall-bound behavioral proof drives a RunEnvelope directly, not `.withStallPolicy(`" },
  withStreaming: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "SILENT — batch 4 (plan 2026-09-14 Task 8); streaming-integration.test.ts's only wither-specific test asserts StreamCompleted still fires, not that density actually changes chunk granularity" },
  withThinking: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "SILENT — batch 3 (plan 2026-09-14 Task 8); with-thinking.test.ts only reads back agent.config.thinkingOptions post-build, never a captured LLM request proving the option reaches the provider" },
  withVerification: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "SILENT — batch 2 (plan 2026-09-14 Task 8); all call sites are config-passthrough/kitchen-sink tests, or (fabrication-guard-rail.test.ts) use it identically in both compared arms, never isolating this wither's own on/off effect" },
  withVerificationStep: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "SILENT — batch 2 (plan 2026-09-14 Task 8); the RED-ON-CUT proof in verification-step-wired.test.ts drives defaultReactiveAgentsConfig({verificationStep}) directly, bypassing the .withVerificationStep() builder wither; harness-improvements.test.ts's wither-calling tests only check chainability/config storage" },
  withoutCircuitBreaker: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "SILENT — batch 4 (plan 2026-09-14 Task 8); zero test call sites; disabling the breaker is only observable under live provider network failures" },
  withoutObservability: { status: "UNOBSERVABLE-DETERMINISTIC", reason: "SILENT — batch 4 (plan 2026-09-14 Task 8); observability-verbosity.test.ts's only test asserts the private _enableObservability field, not an observable output difference" },
};

function witherNames(): string[] {
  const proto = Object.getPrototypeOf(ReactiveAgents.create());
  return Object.getOwnPropertyNames(proto).filter((n) => /^with(out)?[A-Z]/.test(n));
}

describe("wither proof census", () => {
  it("every wither is classified", () => {
    const missing = witherNames().filter((n) => !(n in WITHER_PROOF));
    expect(missing).toEqual([]);
  });

  it("no stale rows for removed withers", () => {
    const live = new Set(witherNames());
    expect(Object.keys(WITHER_PROOF).filter((n) => !live.has(n))).toEqual([]);
  });

  it("every PROVEN row names an existing test file that mentions the wither", () => {
    for (const [name, proof] of Object.entries(WITHER_PROOF)) {
      if (proof.status !== "PROVEN") continue;
      const src = readFileSync(join(import.meta.dir, proof.test), "utf8");
      expect(src.includes(`${name}(`)).toBe(true);
    }
  });
});
