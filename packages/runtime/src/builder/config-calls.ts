/**
 * AgentConfig → ordered builder calls.
 *
 * The single mapping from declarative config to builder methods. Two consumers
 * read the same list, so they cannot drift apart:
 *   - `agentConfigToBuilder()` applies each call to a live builder (a reduce).
 *   - `agentConfigToSource()` prints each call as TypeScript.
 *
 * Every call's `args` are plain data (JSON-safe values taken from the config),
 * so the list can also be sent over the wire or rendered in a UI.
 */
import type { AgentConfig } from "../agent-config.js";
import type { ReactiveAgentBuilder } from "../builder.js";
import { HarnessProfile } from "../capabilities/profile.js";

/**
 * Builder methods that an `AgentConfig` can map to. Each name is a method on
 * `ReactiveAgentBuilder`; the compile-time guard below keeps the list honest.
 */
export type BuilderMethod =
  | "withName"
  | "withProvider"
  | "withProfile"
  | "withAgentId"
  | "withModel"
  | "withSystemPrompt"
  | "withPersona"
  | "withReasoning"
  | "withHarness"
  | "withTools"
  | "withGuardrails"
  | "withMemory"
  | "withExperienceLearning"
  | "withMemoryConsolidation"
  | "withObservability"
  | "withCostTracking"
  | "withVerification"
  | "withGrounding"
  | "withFabricationGuard"
  | "withStallPolicy"
  | "withLongHorizon"
  | "withAdaptiveHarness"
  | "withMaxIterations"
  | "withMinIterations"
  | "withTimeout"
  | "withRetryPolicy"
  | "withStrictValidation"
  | "withGateway"
  | "withMCP"
  | "withReactiveIntelligence"
  | "withLogging"
  | "withFallbacks"
  | "withPrompts"
  | "withKillSwitch"
  | "withAudit"
  | "withSelfImprovement"
  | "withHealthCheck"
  | "withStreaming"
  | "withRequiredTools"
  | "withBudget"
  | "withoutCircuitBreaker"
  | "withCircuitBreaker"
  | "withRateLimiting"
  | "withSkillPersistence"
  | "withDurableRuns"
  | "withApprovalPolicy"
  | "withUserInteraction"
  | "withModelPricing"
  | "withTaskContext"
  | "withThinking"
  | "withLlmTimeout"
  | "withSkills"
  | "withMetaTools"
  | "withAgentTool"
  | "withRemoteAgent"
  | "withDynamicSubAgents"
  | "withVerificationStep"
  | "withDocuments"
  | "withModelRouting";

// Compile-time guard: a renamed or removed builder method fails here.
type Assert<T extends true> = T;
type _MethodsExist = Assert<BuilderMethod extends keyof ReactiveAgentBuilder ? true : false>;

/**
 * One builder method call derived from an `AgentConfig`.
 *
 * `args` hold plain data copied from the config (JSON-safe). An empty `args`
 * means the method is called with no arguments.
 */
export interface BuilderCall {
  /** The `ReactiveAgentBuilder` method to call. */
  readonly method: BuilderMethod;
  /** Arguments for the call, in order. */
  readonly args: readonly unknown[];
}

const call = (method: BuilderMethod, ...args: readonly unknown[]): BuilderCall => ({ method, args });

/** Keep only the keys whose value is not `undefined`. */
const defined = (obj: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
};

/** A call that takes an optional options object: no args when it is empty. */
const optionsCall = (method: BuilderMethod, opts: Record<string, unknown>): BuilderCall =>
  Object.keys(opts).length > 0 ? call(method, opts) : call(method);

/**
 * Map an `AgentConfig` to the ordered builder calls that reproduce it.
 *
 * Order matters and is fixed: `withName`/`withProvider` first, then the
 * profile baseline (so explicit fields override it), then each field group.
 * `agentConfigToBuilder()` applies exactly this list, and `agentConfigToSource()`
 * prints exactly this list.
 *
 * `outputSchemaOptions` maps to no call: the schema object is code-only, so it
 * must be re-applied with `.withOutputSchema(schema, options)`.
 *
 * @param config - The agent configuration.
 * @returns The builder calls, in the order they must be applied.
 *
 * @example
 * ```typescript
 * agentConfigToBuilderCalls({ name: "a", provider: "anthropic", execution: { maxIterations: 5 } });
 * // [{ method: "withName", args: ["a"] }, { method: "withProvider", args: ["anthropic"] },
 * //  { method: "withMaxIterations", args: [5] }]
 * ```
 */
export function agentConfigToBuilderCalls(config: AgentConfig): readonly BuilderCall[] {
  const calls: BuilderCall[] = [call("withName", config.name), call("withProvider", config.provider)];
  const push = (c: BuilderCall): void => {
    calls.push(c);
  };

  // Profile baseline (Q6): apply FIRST so every explicit key below overrides it.
  // `.withProfile()` is a cross-field patch (memory/RI/verifier/strategy-switching/
  // skill-persistence toggles); the subsequent field application wins on conflict,
  // mirroring `profile.ts` "later calls override earlier patches".
  if (config.profile) push(call("withProfile", HarnessProfile[config.profile]()));

  if (config.agentId) push(call("withAgentId", config.agentId));

  // Model / model params — params apply independently of `model` so a config
  // that sets temperature/maxTokens/thinking/numCtx without an explicit model
  // (or with the legacy `model: ""` sentinel) still threads them through; the
  // provider supplies the default model. (Fixes silent param-drop, audit C1.)
  // A boolean `thinking` rides withModel; the object form is `.withThinking()`.
  const thinkingFlag = typeof config.thinking === "boolean" ? config.thinking : undefined;
  const hasParams =
    thinkingFlag !== undefined ||
    config.temperature !== undefined ||
    config.maxTokens !== undefined ||
    config.numCtx !== undefined;
  if (config.model && !hasParams) {
    push(call("withModel", config.model));
  } else if (config.model || hasParams) {
    push(
      call(
        "withModel",
        defined({
          model: config.model ? config.model : undefined,
          thinking: thinkingFlag,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          numCtx: config.numCtx,
        }),
      ),
    );
  }
  if (typeof config.thinking === "object") push(call("withThinking", { ...config.thinking }));

  if (config.systemPrompt) push(call("withSystemPrompt", config.systemPrompt));
  if (config.persona) push(call("withPersona", config.persona));

  // Reasoning
  if (config.features?.reasoning || config.reasoning) {
    const r = config.reasoning;
    push(
      optionsCall(
        "withReasoning",
        defined({
          defaultStrategy: r?.defaultStrategy ? r.defaultStrategy : undefined,
          enableStrategySwitching: r?.enableStrategySwitching,
          maxStrategySwitches: r?.maxStrategySwitches,
          fallbackStrategy: r?.fallbackStrategy ? r.fallbackStrategy : undefined,
          auditRationale: r?.auditRationale,
          synthesis: r?.synthesis,
          synthesisModel: r?.synthesisModel,
          synthesisProvider: r?.synthesisProvider,
          synthesisTemperature: r?.synthesisTemperature,
          strategies: r?.strategies,
          adaptive: r?.adaptive,
          parallelToolCalls: r?.parallelToolCalls,
          observationSummary: r?.observationSummary,
        }),
      ),
    );
  }

  // Harness mechanism switches — AFTER withReasoning(), since .withHarness()
  // merges into the existing _reasoningOptions.harness while withReasoning()
  // replaces _reasoningOptions wholesale; reversing the order would silently
  // drop the harness config.
  if (config.reasoning?.harness) push(call("withHarness", config.reasoning.harness));

  // Tools
  if (config.features?.tools || config.tools) {
    const t = config.tools;
    push(
      optionsCall(
        "withTools",
        defined({
          allowedTools: t?.allowedTools,
          focusedTools: t?.focusedTools,
          adaptive: t?.adaptive,
          terminal: t?.terminal,
          builtins: t?.builtins,
          riskLevels: t?.riskLevels,
          maxCallsPerTool: t?.maxCallsPerTool,
          workspace: t?.workspace,
          disclosure: t?.disclosure,
        }),
      ),
    );
  }

  // Guardrails
  if (config.features?.guardrails || config.guardrails) {
    const g = config.guardrails;
    push(
      optionsCall(
        "withGuardrails",
        defined({
          injection: g?.injection,
          pii: g?.pii,
          toxicity: g?.toxicity,
          customBlocklist: g?.customBlocklist,
        }),
      ),
    );
  }

  // Memory
  if (config.features?.memory || config.memory) {
    const m = config.memory;
    push(
      optionsCall(
        "withMemory",
        defined({
          tier: m?.tier ? m.tier : undefined,
          dbPath: m?.dbPath ? m.dbPath : undefined,
          maxEntries: m?.maxEntries,
          capacity: m?.capacity,
          evictionPolicy: m?.evictionPolicy ? m.evictionPolicy : undefined,
          retainDays: m?.retainDays,
          importanceThreshold: m?.importanceThreshold,
        }),
      ),
    );
    if (m?.experienceLearning) push(call("withExperienceLearning"));
    if (m?.memoryConsolidation) push(call("withMemoryConsolidation"));
  }

  // Observability
  if (config.features?.observability || config.observability) {
    const obs = config.observability;
    push(
      optionsCall(
        "withObservability",
        defined({
          verbosity: obs?.verbosity ? obs.verbosity : undefined,
          live: obs?.live,
          file: obs?.file ? obs.file : undefined,
          logModelIO: obs?.logModelIO,
          checklist: obs?.checklist,
          cortex: obs?.cortex,
          telemetry: obs?.telemetry,
          logging: obs?.logging,
          tracing: obs?.tracing,
          health: obs?.health,
          audit: obs?.audit,
          costs: obs?.costs,
        }),
      ),
    );
  }

  // Cost tracking
  if (config.features?.costTracking || config.costTracking) {
    const ct = config.costTracking;
    push(
      optionsCall(
        "withCostTracking",
        defined({
          perRequest: ct?.perRequest,
          perSession: ct?.perSession,
          daily: ct?.daily,
          monthly: ct?.monthly,
        }),
      ),
    );
  }

  // Verification
  if (config.features?.verification || config.verification) {
    const v = config.verification;
    push(
      optionsCall(
        "withVerification",
        defined({
          semanticEntropy: v?.semanticEntropy,
          factDecomposition: v?.factDecomposition,
          multiSource: v?.multiSource,
          selfConsistency: v?.selfConsistency,
          nli: v?.nli,
          hallucinationDetection: v?.hallucinationDetection,
          hallucinationThreshold: v?.hallucinationThreshold,
          passThreshold: v?.passThreshold,
          riskThreshold: v?.riskThreshold,
          useLLMTier: v?.useLLMTier,
          onReject: v?.onReject,
        }),
      ),
    );
  }

  if (config.grounding) push(call("withGrounding", config.grounding));
  if (config.fabricationGuard) push(call("withFabricationGuard", config.fabricationGuard));
  if (config.stallPolicy) push(call("withStallPolicy", config.stallPolicy));
  if (config.horizonProfile === "long") push(call("withLongHorizon"));
  if (config.adaptiveHarness) push(call("withAdaptiveHarness"));

  // Execution
  const exec = config.execution;
  if (exec?.maxIterations !== undefined) push(call("withMaxIterations", exec.maxIterations));
  if (exec?.minIterations !== undefined) push(call("withMinIterations", exec.minIterations));
  if (exec?.timeoutMs !== undefined) push(call("withTimeout", exec.timeoutMs));
  if (exec?.retryPolicy) push(call("withRetryPolicy", exec.retryPolicy));
  if (exec?.strictValidation) push(call("withStrictValidation"));
  if (exec?.llmTimeoutMs !== undefined) push(call("withLlmTimeout", exec.llmTimeoutMs));

  if (config.gateway) push(call("withGateway", config.gateway));
  if (config.mcpServers && config.mcpServers.length > 0) push(call("withMCP", config.mcpServers));
  // Reactive intelligence is on by default, so an explicit `false` must call
  // withReactiveIntelligence(false); leaving it out would turn RI back on.
  // The options besides `enabled` go into the call's options object; options
  // without an explicit `enabled` still apply them (RI is on by default).
  const { enabled: riEnabled, ...riRest } = config.reactiveIntelligence ?? {};
  const riOptions = defined(riRest);
  const riOff = config.features?.reactiveIntelligence === false || riEnabled === false;
  const riOn = config.features?.reactiveIntelligence === true || riEnabled === true;
  if (riOn || (!riOff && Object.keys(riOptions).length > 0)) {
    push(optionsCall("withReactiveIntelligence", riOptions));
  } else if (riOff) {
    push(call("withReactiveIntelligence", false));
  }
  if (config.logging) push(call("withLogging", config.logging));
  if (config.fallbacks) push(call("withFallbacks", config.fallbacks));

  // Feature flags (remaining ones not handled above)
  if (config.features?.prompts) push(call("withPrompts"));
  if (config.features?.killSwitch) push(call("withKillSwitch"));
  if (config.features?.audit) push(call("withAudit"));
  if (config.features?.selfImprovement) push(call("withSelfImprovement"));
  if (config.features?.healthCheck) push(call("withHealthCheck"));
  if (config.features?.streaming) push(call("withStreaming"));

  if (config.requiredTools) {
    const rt = config.requiredTools;
    push(
      call(
        "withRequiredTools",
        defined({ tools: rt.tools ? rt.tools : undefined, adaptive: rt.adaptive, maxRetries: rt.maxRetries }),
      ),
    );
  }

  if (config.budget) push(call("withBudget", config.budget));

  // Circuit breaker (default-on; `false` disables, object pins thresholds)
  if (config.circuitBreaker === false) push(call("withoutCircuitBreaker"));
  else if (config.circuitBreaker) push(call("withCircuitBreaker", config.circuitBreaker));

  if (config.rateLimiting) push(call("withRateLimiting", config.rateLimiting));
  if (config.skillPersistence !== undefined) push(call("withSkillPersistence", config.skillPersistence));
  if (config.durableRuns) push(call("withDurableRuns", config.durableRuns));

  // Approval policy (data half; requireFor / onApprove are code-only)
  if (config.approvalPolicy) {
    const a = config.approvalPolicy;
    push(
      call(
        "withApprovalPolicy",
        defined({
          mode: a.mode,
          tools: a.tools !== undefined ? [...a.tools] : undefined,
          commands: a.commands !== undefined ? [...a.commands] : undefined,
        }),
      ),
    );
  }

  if (config.userInteraction === true) push(call("withUserInteraction"));

  if (config.pricingRegistry) push(call("withModelPricing", config.pricingRegistry));
  if (config.taskContext && Object.keys(config.taskContext).length > 0) {
    push(call("withTaskContext", config.taskContext));
  }

  if (config.skills) {
    const s = config.skills;
    push(optionsCall("withSkills", defined({ paths: s.paths, activate: s.activate, global: s.global })));
  }
  // `{}` and no argument differ here: no argument enables the default suite.
  if (config.metaTools !== undefined) push(call("withMetaTools", config.metaTools));
  for (const t of config.agentTools ?? []) {
    if (t.remoteUrl !== undefined) push(call("withRemoteAgent", t.name, t.remoteUrl));
    else if (t.agent) push(call("withAgentTool", t.name, t.agent));
  }
  if (config.dynamicSubAgents) push(optionsCall("withDynamicSubAgents", defined({ ...config.dynamicSubAgents })));
  if (config.verificationStep) push(optionsCall("withVerificationStep", defined({ ...config.verificationStep })));
  if (config.documents && config.documents.length > 0) push(call("withDocuments", config.documents));
  if (config.modelRouting) push(optionsCall("withModelRouting", defined({ ...config.modelRouting })));

  return calls;
}

/**
 * Apply one builder call to a builder. Builder methods mutate and return
 * `this`, so the same builder is returned.
 *
 * @param builder - The builder to configure.
 * @param builderCall - The call to apply.
 * @returns The same builder, for use as a reducer.
 */
export function applyBuilderCall(
  builder: ReactiveAgentBuilder,
  builderCall: BuilderCall,
): ReactiveAgentBuilder {
  Reflect.apply(builder[builderCall.method], builder, builderCall.args);
  return builder;
}
