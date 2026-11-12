/**
 * Shared agent builder for Cortex.
 *
 * Both `runner-service` (ad-hoc POST /api/runs) and `gateway-process-manager`
 * (scheduled/gateway runs) go through this single function so the builder chain
 * is never duplicated.
 *
 * Architecture: cortexParamsToAgentConfig() maps every Cortex setting with an
 * AgentConfig path, then agentConfigToBuilder() applies it. A thin overlay applies
 * only what has no AgentConfig form (see cortexAgentBuilder).
 */
import type { TestTurn } from "@reactive-agents/llm-provider";
import type { DefinedTool } from "@reactive-agents/tools";
import {
  agentConfigToBuilder,
  type MCPServerConfig,
  type ReactiveAgentBuilder,
} from "@reactive-agents/runtime";

export type { MCPServerConfig } from "@reactive-agents/runtime";
import type { DocumentSpec } from "@reactive-agents/runtime";
import { ensureParentDirForFile } from "./ensure-log-path.js";
import {
  type CortexAgentToolEntry,
  type CortexShellOptions,
  type CortexDynamicSubAgentsConfig,
  type CortexMetaToolsConfig,
  type CortexObservabilityConfig,
  type CortexSkillsConfig,
} from "./cortex-agent-config.js";
import { cortexParamsToAgentConfig } from "./cortex-to-agent-config.js";
import type { CortexApprovalPolicy } from "./approval-policy.js";
import { providerKeyForAgent } from "./provider-key-store.js";
import type { ChannelAdapter } from "@reactive-agents/channels";
import type { CortexGatewayConfig } from "./channel-config.js";
import {
  judgmentBuilderOptionsOf,
  parseCortexJudgmentConfig,
  TYPESAFE_KEY_ID,
  type CortexJudgmentConfig,
} from "./cortex-judgment.js";

export interface BuildCortexAgentParams {
  readonly agentName?: string;
  /**
   * Stable agent identity to use for this build.
   * When set, the framework uses this instead of generating a name-timestamp ID.
   * All memory keyed on agentId accumulates across server restarts.
   */
  readonly agentId?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  /** Provider context window size. Honored by local providers (Ollama `num_ctx`); cloud providers without a context knob ignore it. */
  readonly numCtx?: number;
  /** Extended thinking: `true`/`false` forces it, absent leaves the framework's per-model default (auto). */
  readonly thinking?: boolean;
  readonly strategy?: string;
  readonly maxIterations?: number;
  readonly minIterations?: number;
  readonly systemPrompt?: string;
  readonly taskContext?: Record<string, string>;
  readonly healthCheck?: boolean;
  readonly skills?: CortexSkillsConfig;
  /** Resolved MCP server configs (caller resolves IDs → configs before calling). */
  readonly mcpConfigs?: MCPServerConfig[];
  readonly tools?: string[];
  /**
   * Host-supplied function tools registered on the agent (e.g. the chat `session-control` tool,
   * present only when a session opts into `agentControl`). Their names are added to `allowedTools`.
   */
  readonly extraTools?: readonly DefinedTool[];
  /** Comma or newline separated tool IDs merged into {@link tools} for `allowedTools` (e.g. Lab custom tools). */
  readonly additionalToolNames?: string;
  readonly agentTools?: CortexAgentToolEntry[];
  readonly dynamicSubAgents?: CortexDynamicSubAgentsConfig;
  readonly metaTools?: CortexMetaToolsConfig;
  /** Display-only observability toggles (`checklist`). */
  readonly observability?: CortexObservabilityConfig;
  readonly timeout?: number;
  readonly retryPolicy?: { enabled?: boolean; maxRetries: number; backoffMs?: number };
  readonly fallbacks?: { enabled?: boolean; providers?: string[]; errorThreshold?: number };
  readonly verificationStep?: string;
  /** Enables `@reactive-agents/verification` (semantic checks, etc.). Separate from `verificationStep: "reflect"`. */
  readonly runtimeVerification?: boolean;
  /**
   * Registers host `shell-execute` with framework defaults (allowlist/blocklist). Caller assumes risk.
   * When true, `shell-execute` is merged into allowed tools if not already listed.
   */
  readonly terminalTools?: boolean;
  /**
   * First executable token names added to shell-execute via `ShellExecuteConfig.additionalCommands`
   * (e.g. `node`, `bun`, `gh`). Only applied when host shell is active.
   */
  readonly terminalShellAdditionalCommands?: string;
  /**
   * When non-empty, sets `ShellExecuteConfig.allowedCommands` to this list only (replaces framework defaults).
   * Use with care — omit helpers like `echo` if you replace the whole list.
   */
  readonly terminalShellAllowedCommands?: string;
  /** Host-shell cwd / timeout / output cap / command groups / sandbox — see {@link CortexShellOptions}. */
  readonly terminalShellOptions?: CortexShellOptions;
  /**
   * Agent working directory (`.withTools({ workspace })`): file tools resolve and confine to it,
   * `shell-execute` runs in it. Must be an existing directory or the build throws `ToolsOptionError`.
   */
  readonly workspace?: string;
  /** JSONL run-trace persistence: `{ dir }` writes `<runId>.jsonl` there; `false` turns it off; absent keeps the framework default. */
  readonly tracing?: { readonly dir: string } | false;
  readonly observabilityVerbosity?: "off" | "minimal" | "normal" | "verbose";
  /** When true, enables automatic strategy switching on loop detection. */
  readonly strategySwitching?: boolean;
  /**
   * Opt-in: emit per-tool-call decision rationale into the debrief (framework
   * `ReasoningOptions.auditRationale`). Audit feature — can degrade speed/quality
   * on smaller local models (cross-tier ablation: pure token tax, zero quality lift).
   */
  readonly harness?: Record<string, unknown>;
  readonly auditRationale?: boolean;
  readonly memory?: {
    readonly working?: boolean;
    readonly episodic?: boolean;
    readonly semantic?: boolean;
  };
  /**
   * Context synthesis mode.
   * Maps to ReasoningOptions.synthesis:
   *   "auto"     → "auto"
   *   "template" → "fast"
   *   "llm"      → "deep"
   *   "none"     → off (omitted)
   */
  readonly contextSynthesis?: "auto" | "template" | "llm" | "none";
  readonly guardrails?: {
    readonly enabled?: boolean;
    /** Detector switches; absent = on. Win over the legacy thresholds below. */
    readonly injection?: boolean;
    readonly pii?: boolean;
    readonly toxicity?: boolean;
    readonly customBlocklist?: readonly string[];
    /** Legacy: the framework has no thresholds; only `> 0` (on) vs `0` (off) is read. */
    readonly injectionThreshold?: number;
    readonly piiThreshold?: number;
    readonly toxicityThreshold?: number;
  };
  readonly persona?: {
    readonly enabled?: boolean;
    readonly role?: string;
    readonly tone?: string;
    readonly traits?: string;
    readonly responseStyle?: string;
  };
  /** When set (e.g. desk chat with `provider: "test"`), wires `withTestScenario` on the builder. */
  readonly testScenario?: readonly TestTurn[];
  /** When true, enables streaming mode for TextDelta event emission. */
  readonly streaming?: boolean;
  readonly outputSchema?: Record<string, unknown>;
  /** Parse-fail behaviour for {@link outputSchema}: "degrade" (default, lenient) or "throw". */
  readonly outputSchemaOnParseFail?: "degrade" | "throw";
  /** RAG document ingestion — `.withDocuments()`. */
  readonly documents?: readonly DocumentSpec[];
  /** Cost/token budget caps (v0.12) — `.withBudget()`. Arbitrator terminates the run when crossed. */
  readonly budget?: { readonly tokenLimit?: number; readonly costLimit?: number };
  /** Numeric evidence-grounding (v0.12) — `.withGrounding()`. Checks figures in the answer against tool data. */
  readonly grounding?: { readonly mode: "warn" | "block"; readonly tolerance?: number };
  /**
   * Fabrication guard — `.withFabricationGuard()`. Flags invented named
   * entities/measurements not backed by tool evidence; distinct from numeric
   * grounding. Always-on at `block` by default even if this is never set —
   * only pass this to override to `warn` or `off`.
   */
  readonly fabricationGuard?: "off" | "warn" | "block";
  /** Cost-aware model routing (v0.13) — `.withModelRouting()`. Routes cheap/expensive turns by tier. */
  readonly modelRouting?: {
    readonly enabled?: boolean;
    readonly minTier?: "haiku" | "sonnet" | "opus";
    readonly tierModels?: Partial<Record<"haiku" | "sonnet" | "opus", string>>;
  };
  /**
   * Generic framework-config overrides — a partial, nested AgentConfig produced
   * by the type-introspected generic renderer (keyed by the same schema paths
   * `getCapabilityManifest().configFields` reports). Deep-merged UNDER the
   * curated cortex config (curated controls win) and validated at decode, so
   * NEW framework config fields are settable from the UI without per-field
   * plumbing. See cortex-to-agent-config.ts.
   */
  readonly rawConfig?: Record<string, unknown>;
  /**
   * Durable execution (v0.12) — opt-in crash-resume via SQLite RunStore.
   * When `enabled`, wires `.withDurableRuns(...)` so the run checkpoints and can
   * be resumed by id (`agent.resumeRun`) after a process death.
   */
  readonly durableRuns?: {
    readonly enabled?: boolean;
    readonly checkpointEvery?: number;
    readonly dir?: string;
  };
  /**
   * The framework approval policy's data half (`AgentConfig.approvalPolicy`):
   * which tools and which shell commands need approval, and the mode. Sent
   * through the AgentConfig (`cortexParamsToAgentConfig`). `detach` hands the
   * call to a person: without durable runs the run waits live in process, with
   * them it pauses durably. Read from any stored shape by `approvalPolicyOf`.
   */
  readonly approvalPolicy?: CortexApprovalPolicy;
  /**
   * Judgment backend (`.withJudgment()`): present only when a desk user turned it on. An
   * overlay, not an AgentConfig field (the framework has no config form for it).
   */
  readonly judgment?: CortexJudgmentConfig;
  /**
   * Gateway options (`AgentConfig.gateway`): access control, inbound queue, crons. Set only for a
   * gateway agent's long-lived host (`gateway-channel-host.ts`); a desk run or chat turn never starts
   * the gateway loop, so those paths leave it unset (`build-path-parity.test.ts` PATH_SPECIFIC).
   */
  readonly gateway?: CortexGatewayConfig;
  /**
   * Live channel adapters (`.withChannels({ adapters })`), built by `channel-adapters.ts` from the
   * agent's saved channels and credentials. Code, not data (adapters hold open connections and a
   * secret), so an overlay with no AgentConfig form. Needs `gateway` to be set.
   */
  readonly channelAdapters?: readonly ChannelAdapter[];
}

export {
  shellExecuteRequested,
  shellTerminalOption,
  todoGuidanceOption,
} from "./cortex-to-agent-config.js";

/**
 * Build a configured ReactiveAgent from Cortex params.
 *
 * Step 1: cortexParamsToAgentConfig() → AgentConfig (every data-like setting)
 * Step 2: agentConfigToBuilder() → ReactiveAgentBuilder
 * Step 3: the true overlays (see {@link cortexAgentBuilder})
 */
export async function buildCortexAgent(
  params: BuildCortexAgentParams,
  agentNameFallback?: string,
): ReturnType<ReactiveAgentBuilder["build"]> {
  return (await cortexAgentBuilder(params, agentNameFallback)).build();
}

/**
 * The configured builder `buildCortexAgent` builds: `agentConfigToBuilder` over
 * `cortexParamsToAgentConfig(params)`, then the overlay calls. Exported so tests
 * can read `toConfig()` of exactly what Cortex runs.
 *
 * Only true overlays remain here, each with no AgentConfig form: a saved provider
 * key (a secret, never in config), the scripted test scenario, host tool code
 * (`extraTools`) and Cortex's trace dir. `CORTEX_OVERLAY_CALLS` (cortex-agent-source.ts) lists them.
 */
export async function cortexAgentBuilder(
  params: BuildCortexAgentParams,
  agentNameFallback?: string,
): Promise<ReactiveAgentBuilder> {
  const agentConfig = cortexParamsToAgentConfig(params, agentNameFallback);

  let b = await agentConfigToBuilder(agentConfig);

  // A key saved in Settings · Providers, when it wins over the env key (none in env, or
  // "use stored key"). Passed as the provider config; process.env is never written. One
  // funnel, so chat, desk runs and gateway agents all get it.
  const storedKey = providerKeyForAgent(agentConfig.provider);
  if (storedKey) b = b.withProvider(agentConfig.provider, { apiKey: storedKey });

  if (params.testScenario && params.testScenario.length > 0) {
    b = b.withTestScenario([...params.testScenario]);
  }

  if (params.observabilityVerbosity && params.observabilityVerbosity !== "off") {
    const agentLogFile = process.env.CORTEX_AGENT_LOG_FILE ?? ".cortex/logs/agent-debug.log";
    ensureParentDirForFile(agentLogFile);
  }

  // Host tool code (e.g. the chat `session-control` tool). Their names are already in
  // the AgentConfig allow-list (cortexParamsToAgentConfig); the functions are code-only.
  const extraTools = params.extraTools ?? [];
  if (extraTools.length > 0) b = b.withTools({ tools: extraTools });

  // Cortex's trace dir. Kept out of the AgentConfig: its only config form,
  // `observability.tracing: { dir }`, also turns the observability layer on, which a
  // bare `.withTracing()` does not (framework gap, reported).
  if (params.tracing) b = b.withTracing({ dir: params.tracing.dir });

  // Judgment (Lab · Judgment): `AgentConfig` has no `judgment` field (framework gap), so
  // `.withJudgment()` is an overlay. The saved TypeSafe key (Settings · Providers) is a secret,
  // so it rides here and not in a config; without one the framework reads TYPESAFE_API_KEY.
  const judgment = parseCortexJudgmentConfig(params.judgment);
  if (judgment) b = b.withJudgment(judgmentBuilderOptionsOf(judgment, providerKeyForAgent(TYPESAFE_KEY_ID)));

  // Messaging channels: live adapters, so an overlay. `.withChannels` needs the gateway, which
  // the AgentConfig carries (`gateway`, set by the host even when only defaults apply).
  const channelAdapters = params.channelAdapters ?? [];
  if (channelAdapters.length > 0) b = b.withChannels({ adapters: [...channelAdapters] });

  // The output schema (JSON Schema, `outputSchemaOptions`) and the agentic-UI
  // interaction rail (`userInteraction`) ride the AgentConfig
  // (cortexParamsToAgentConfig); they are not overlays.

  return b;
}
