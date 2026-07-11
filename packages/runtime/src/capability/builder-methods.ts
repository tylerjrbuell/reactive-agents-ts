/**
 * Machine-readable descriptor list for every public `with*` builder method.
 *
 * The list is DERIVED by reflecting `ReactiveAgentBuilder.prototype` at call
 * time — so a new builder method appears in the capability manifest with ZERO
 * hand-maintenance and cannot silently drift. The annotation map below enriches
 * every method with its correspondence to `AgentConfigSchema`:
 *   - `kind: "config"` + `configKeys`: the AgentConfig key(s) the wither sets
 *     (an exact leaf like `execution.maxIterations`, or a subtree prefix like
 *     `memory` that covers every `memory.*` leaf). This is the wither↔config
 *     correspondence the drift-gate (`api-correspondence.test.ts`) checks.
 *   - `kind: "overlay"` + `overlayReason`: a code-only method with no config
 *     home (a function/predicate/secret/registry/test-rig/cross-field patch),
 *     with the reason recorded. These are the reviewed "deliberately not data"
 *     seam (see `config-serialization-drift.test.ts`).
 *
 * Anything not annotated defaults to an inferred `overlay` — which will make the
 * drift-gate go RED if it maps to a schema key (forcing an annotation). That is
 * the self-maintenance guarantee: the manifest cannot silently omit a mapping.
 */
import { ReactiveAgentBuilder } from "../builder.js";

export interface BuilderMethodDescriptor {
  /** Method name, e.g. "withModelRouting". */
  readonly name: string;
  /** `config` maps to AgentConfigSchema field(s) (see configKeys); `overlay` is code-only. */
  readonly kind: "config" | "overlay";
  /** Back-compat single path (= configKeys[0]) when kind === "config". */
  readonly configPath?: string;
  /**
   * AgentConfig key(s) this wither sets — an exact leaf path or a subtree
   * prefix (which covers every leaf beneath it). Present iff kind === "config".
   */
  readonly configKeys?: readonly string[];
  /** Why the method has no config home (recorded reason) when kind === "overlay". */
  readonly overlayReason?: string;
  readonly description: string;
  /** True when the method carried no explicit annotation (default overlay). */
  readonly inferred: boolean;
}

interface Annotation {
  kind: "config" | "overlay";
  configKeys?: readonly string[];
  overlayReason?: string;
  description: string;
}

/**
 * Correspondence + enrichment for EVERY public builder method. Config-kind
 * entries carry the `configKeys` the drift-gate joins against the schema;
 * overlay-kind entries carry the recorded `overlayReason`.
 */
export const BUILDER_METHOD_ANNOTATIONS: Readonly<Record<string, Annotation>> = {
  // ── Identity / model ──
  withName: { kind: "config", configKeys: ["name"], description: "Agent name." },
  withAgentId: { kind: "config", configKeys: ["agentId"], description: "Stable agent identifier." },
  withProvider: { kind: "config", configKeys: ["provider"], description: "LLM provider." },
  withModel: {
    kind: "config",
    configKeys: ["model", "thinking", "temperature", "maxTokens", "numCtx"],
    description: "Model id + params (thinking/temperature/maxTokens/numCtx).",
  },
  withThinking: { kind: "config", configKeys: ["thinking"], description: "Extended thinking / reasoning effort." },
  withSystemPrompt: { kind: "config", configKeys: ["systemPrompt"], description: "System prompt." },
  withPersona: { kind: "config", configKeys: ["persona"], description: "Role/tone/instructions persona." },
  withTaskContext: { kind: "config", configKeys: ["taskContext"], description: "Background key/value facts for reasoning." },
  withProfile: { kind: "config", configKeys: ["profile"], description: "Preset baseline capability profile." },

  // ── Tools ──
  withTools: { kind: "config", configKeys: ["tools", "features.tools"], description: "Tools layer + allowed/focused/adaptive/terminal/required options." },
  withRequiredTools: { kind: "config", configKeys: ["requiredTools"], description: "Tools that must be called before success." },

  // ── Reasoning ──
  withReasoning: { kind: "config", configKeys: ["reasoning", "features.reasoning"], description: "Reasoning strategy + options." },

  // ── Memory / learning ──
  withMemory: { kind: "config", configKeys: ["memory", "features.memory"], description: "Enable memory layers + tier/dbPath/capacity/experienceLearning/consolidation." },
  withExperienceLearning: { kind: "config", configKeys: ["memory.experienceLearning"], description: "Learn from prior-run experience summaries." },
  withMemoryConsolidation: { kind: "config", configKeys: ["memory.memoryConsolidation"], description: "Background memory consolidation/decay/prune." },
  withSkillPersistence: { kind: "config", configKeys: ["skillPersistence"], description: "Persist evolved skills across runs." },
  withLearning: { kind: "config", configKeys: ["memory", "skillPersistence"], description: "Compounding-intelligence bundle (memory + skill persistence)." },

  // ── Verification / grounding / guardrails ──
  withVerification: { kind: "config", configKeys: ["verification", "features.verification"], description: "Verification package (entropy/nli/thresholds/useLLMTier/onReject)." },
  withGrounding: { kind: "config", configKeys: ["grounding"], description: "Opt-in numeric evidence grounding." },
  withFabricationGuard: { kind: "config", configKeys: ["fabricationGuard"], description: "Fabrication-guard mode (off/warn/block)." },
  withStallPolicy: { kind: "config", configKeys: ["stallPolicy"], description: "Stall/no-progress escalation policy." },
  withGuardrails: { kind: "config", configKeys: ["guardrails", "features.guardrails"], description: "Injection/PII/toxicity guardrails." },
  withStrictValidation: { kind: "config", configKeys: ["execution.strictValidation"], description: "Strict output validation." },

  // ── Observability ──
  withObservability: { kind: "config", configKeys: ["observability", "features.observability"], description: "Observability umbrella (verbosity/live/cortex/tracing/logging/costs/…)." },
  withLogging: { kind: "config", configKeys: ["logging"], description: "Structured logging config." },
  withCostTracking: { kind: "config", configKeys: ["costTracking", "features.costTracking"], description: "Cost budget caps." },
  withModelPricing: { kind: "config", configKeys: ["pricingRegistry"], description: "Custom model pricing registry." },
  withAudit: { kind: "config", configKeys: ["features.audit"], description: "Per-tool-call rationale auditing." },
  withHealthCheck: { kind: "config", configKeys: ["features.healthCheck"], description: "Enable agent.health() probes." },

  // ── Budget / execution ──
  withBudget: { kind: "config", configKeys: ["budget"], description: "Declarative token/cost budget caps." },
  withMaxIterations: { kind: "config", configKeys: ["execution.maxIterations"], description: "Iteration cap." },
  withMinIterations: { kind: "config", configKeys: ["execution.minIterations"], description: "Minimum iterations before termination." },
  withTimeout: { kind: "config", configKeys: ["execution.timeoutMs"], description: "Run timeout (ms)." },
  withCacheTimeout: { kind: "config", configKeys: ["execution.cacheTimeoutMs"], description: "Tool-result cache TTL (ms)." },
  withRetryPolicy: { kind: "config", configKeys: ["execution.retryPolicy"], description: "LLM retry policy (maxRetries/backoff)." },
  withCircuitBreaker: { kind: "config", configKeys: ["circuitBreaker"], description: "Circuit-breaker thresholds (false disables)." },
  withRateLimiting: { kind: "config", configKeys: ["rateLimiting"], description: "Outbound LLM rate limiting." },

  // ── Provider / fallbacks ──
  withFallbacks: { kind: "config", configKeys: ["fallbacks"], description: "Provider/model fallbacks." },

  // ── Durability / gateway ──
  withDurableRuns: { kind: "config", configKeys: ["durableRuns"], description: "Crash-resume durable execution." },
  withGateway: { kind: "config", configKeys: ["gateway"], description: "Gateway (cron/webhook/access-control) config." },
  withMCP: { kind: "config", configKeys: ["mcpServers"], description: "Connect MCP servers." },

  // ── Posture / topology feature flags ──
  withAdaptiveHarness: { kind: "config", configKeys: ["adaptiveHarness"], description: "Adaptive harness / policy compiler." },
  withLongHorizon: { kind: "config", configKeys: ["horizonProfile"], description: "Long-horizon guard profile." },
  withReactiveIntelligence: { kind: "config", configKeys: ["reactiveIntelligence", "features.reactiveIntelligence"], description: "Reactive intelligence posture." },
  withIdentity: { kind: "config", configKeys: ["features.identity"], description: "Enable identity feature." },
  withInteraction: { kind: "config", configKeys: ["features.interaction"], description: "Enable durable interaction." },
  withKillSwitch: { kind: "config", configKeys: ["features.killSwitch"], description: "Emergency stop / terminate control." },
  withOrchestration: { kind: "config", configKeys: ["features.orchestration"], description: "Enable orchestration topology." },
  withPrompts: { kind: "config", configKeys: ["features.prompts"], description: "Register custom prompt templates." },
  withSelfImprovement: { kind: "config", configKeys: ["features.selfImprovement"], description: "Enable self-improvement loop." },
  withStreaming: { kind: "config", configKeys: ["features.streaming"], description: "Enable event streaming." },

  // ── Typed output ──
  withOutputSchema: { kind: "config", configKeys: ["outputSchemaOptions"], description: "Typed structured output (schema object is code-only; options serialize)." },

  // ── Overlays: functions / predicates / cadence ──
  withHook: { kind: "overlay", overlayReason: "carries a lifecycle callback function (not JSON)", description: "Lifecycle hook." },
  withErrorHandler: { kind: "overlay", overlayReason: "carries an error-handler function (not JSON)", description: "Custom error handler." },
  withOutputValidator: { kind: "overlay", overlayReason: "carries a validator function (folds into withVerification)", description: "Custom output validator." },
  withVerificationStep: { kind: "overlay", overlayReason: "carries a verification-step function (folds into withVerification)", description: "Single post-answer reflect pass." },
  withProgressCheckpoint: { kind: "overlay", overlayReason: "carries a checkpoint cadence/function (folds into withReasoning)", description: "Progress checkpoint cadence." },
  withCustomTermination: { kind: "overlay", overlayReason: "carries a termination predicate (folds into withReasoning)", description: "Custom termination predicate." },
  withApprovalPolicy: { kind: "overlay", overlayReason: "carries an approval predicate (HITL durability rail)", description: "Human-in-the-loop tool approval gate." },

  // ── Overlays: harness / DI / test rigs ──
  withHarness: { kind: "overlay", overlayReason: "compose-power-tier harness injection (not data)", description: "Inject a composed harness." },
  withLayers: { kind: "overlay", overlayReason: "Effect Layer DI escape hatch (not data)", description: "Provide custom Effect layers." },
  withReplayLLM: { kind: "overlay", overlayReason: "deterministic replay test rig (not data)", description: "Replay recorded LLM responses." },
  withTestScenario: { kind: "overlay", overlayReason: "test-scenario rig (not data)", description: "Load a test scenario." },
  withCalibration: { kind: "overlay", overlayReason: "runtime-probed calibration (not static data)", description: "Model calibration mode." },
  withContextProfile: { kind: "overlay", overlayReason: "cross-field side-effect profile (not orthogonal data)", description: "Context window profile." },
  withLeanHarness: { kind: "overlay", overlayReason: "cross-field profile patch — use withProfile(lean())", description: "Lean-harness mode." },

  // ── Overlays: secrets / integrations / registries ──
  withEnvironment: { kind: "overlay", overlayReason: "carries secrets/env (never serialized)", description: "Environment secrets." },
  withChannels: { kind: "overlay", overlayReason: "messaging transport wiring (not data)", description: "Messaging channels." },
  withCortex: { kind: "overlay", overlayReason: "Cortex desk integration — observability alias (see withObservability({cortex}))", description: "Emit events to a Cortex desk." },
  withTracing: { kind: "overlay", overlayReason: "trace persistence — observability alias (see withObservability({tracing}))", description: "JSONL trace persistence." },
  withEvents: { kind: "overlay", overlayReason: "carries an event stream/callback (folds into withObservability)", description: "Event stream sink." },
  withReceiptSigning: { kind: "overlay", overlayReason: "carries a private signing key (secret, never serialized)", description: "Ed25519 receipt signing." },
  withDocuments: { kind: "overlay", overlayReason: "ingestion side-effect (folds into withTools({documents}))", description: "RAG document ingestion." },
  withMetaTools: { kind: "overlay", overlayReason: "code-only meta-tool registry", description: "Conductor's-suite meta-tools." },
  withSkills: { kind: "overlay", overlayReason: "code-only SKILL.md directory registry", description: "Living SKILL.md directories." },
  withAgentTool: { kind: "overlay", overlayReason: "code-only sub-agent registry", description: "Register a sub-agent as a tool." },
  withDynamicSubAgents: { kind: "overlay", overlayReason: "code-only dynamic sub-agent registry", description: "Dynamic sub-agent spawning." },
  withRemoteAgent: { kind: "overlay", overlayReason: "code-only remote-agent registry", description: "Register a remote agent." },
  withA2A: { kind: "overlay", overlayReason: "multi-agent transport topology primitive (not data)", description: "Agent-to-Agent server." },
  withModelRouting: { kind: "overlay", overlayReason: "cost-aware routing capability with no config representation (G4)", description: "Cost-aware model routing." },
  withContract: { kind: "overlay", overlayReason: "behavioral-contract overlay (not JSON data)", description: "Behavioral contract." },
  withBehavioralContracts: { kind: "overlay", overlayReason: "behavioral-contract overlay (folds into withContract)", description: "Behavioral contracts." },
  withDynamicPricing: { kind: "overlay", overlayReason: "pricing overlay (folds into withCostTracking)", description: "Dynamic pricing overlay." },
  withUserInteraction: { kind: "overlay", overlayReason: "durable ask overlay (folds into withInteraction)", description: "Durable user interaction." },

  // ── Overlays: timeouts/validation with no schema field (gaps G3) ──
  withLlmTimeout: { kind: "overlay", overlayReason: "sets _ollamaTimeoutMs; no schema field (G3, folds into withBudget)", description: "LLM request timeout (ms)." },
  withLazyValidation: { kind: "overlay", overlayReason: "no schema field (folds into withVerification timing)", description: "Lazy output validation." },
};

/** Split "withModelRouting" → "model routing" for a default human blurb. */
function humanize(method: string): string {
  return method
    .replace(/^with/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
}

/**
 * Reflect the builder prototype for every public `with*` method and return a
 * sorted descriptor list. Pure + cheap; the manifest memoizes the result.
 */
export function deriveBuilderMethods(): BuilderMethodDescriptor[] {
  const proto = ReactiveAgentBuilder.prototype as unknown as Record<string, unknown>;
  const names = Object.getOwnPropertyNames(proto)
    .filter((n) => /^with[A-Z]/.test(n) && typeof proto[n] === "function")
    .sort();

  return names.map((name) => {
    const ann = BUILDER_METHOD_ANNOTATIONS[name];
    if (ann) {
      const configKeys = ann.kind === "config" ? ann.configKeys ?? [] : undefined;
      return {
        name,
        kind: ann.kind,
        ...(configKeys && configKeys.length > 0
          ? { configPath: configKeys[0], configKeys }
          : {}),
        ...(ann.overlayReason ? { overlayReason: ann.overlayReason } : {}),
        description: ann.description,
        inferred: false,
      };
    }
    return {
      name,
      kind: "overlay" as const,
      description: `Configure ${humanize(name)}.`,
      inferred: true,
    };
  });
}
