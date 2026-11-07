/**
 * TypeBox fragments shared by the chat-session config body (`api/chat.ts`) and
 * the run launch body (`api/runs.ts`). Both bodies spread {@link AgentConfigBodyFields},
 * so an agent-config field added here has the same shape on both surfaces
 * (pinned by `chat-runs-config-drift.test.ts` and `build-path-parity.test.ts`).
 */
import { t } from "elysia";

/** Guardrails: real detector switches + custom blocklist; thresholds are the legacy on/off encoding. */
export const GuardrailsBody = t.Object({
  enabled: t.Optional(t.Boolean()),
  injection: t.Optional(t.Boolean()),
  pii: t.Optional(t.Boolean()),
  toxicity: t.Optional(t.Boolean()),
  customBlocklist: t.Optional(t.Array(t.String())),
  injectionThreshold: t.Optional(t.Number()),
  piiThreshold: t.Optional(t.Number()),
  toxicityThreshold: t.Optional(t.Number()),
});

/** Host-shell options (`CortexShellOptions` in services/cortex-agent-config.ts). */
export const TerminalShellOptionsBody = t.Object({
  cwd: t.Optional(t.String()),
  allowUnsafeCwd: t.Optional(t.Boolean()),
  timeoutMs: t.Optional(t.Number()),
  maxOutputChars: t.Optional(t.Number()),
  commandAccess: t.Optional(t.Array(t.String())),
  sandbox: t.Optional(t.Union([t.Literal("host"), t.Literal("docker")])),
});

/** Durable execution + durable HITL approval gate. */
export const DurableRunsBody = t.Object({
  enabled: t.Optional(t.Boolean()),
  checkpointEvery: t.Optional(t.Number()),
  dir: t.Optional(t.String()),
  approvalPolicy: t.Optional(
    t.Object({
      tools: t.Optional(t.Array(t.String())),
      mode: t.Optional(t.Union([t.Literal("detach"), t.Literal("block")])),
    }),
  ),
});

/**
 * Every agent-config field a desk run and a chat session both accept. `RunConfigBody`
 * adds the run-launch inputs (prompt, agentName, variables); `ChatSessionConfigBody`
 * adds the chat-session switches (name, runId, enableTools, ...). Add a new builder
 * field HERE so both surfaces get it.
 */
export const AgentConfigBodyFields = {
  provider: t.Optional(t.String()),
  model: t.Optional(t.String()),
  systemPrompt: t.Optional(t.String()),
  temperature: t.Optional(t.Number()),
  maxTokens: t.Optional(t.Number()),
  numCtx: t.Optional(t.Number()),
  /** `null` clears a stored override back to auto (chat PATCH). */
  thinking: t.Optional(t.Union([t.Boolean(), t.Null()])),
  timeout: t.Optional(t.Number()),
  tools: t.Optional(t.Array(t.String())),
  additionalToolNames: t.Optional(t.String()),
  mcpServerIds: t.Optional(t.Array(t.String())),
  agentTools: t.Optional(t.Array(t.Unknown())),
  dynamicSubAgents: t.Optional(t.Object({ enabled: t.Boolean(), maxIterations: t.Optional(t.Number()) })),
  strategy: t.Optional(t.String()),
  maxIterations: t.Optional(t.Number()),
  minIterations: t.Optional(t.Number()),
  strategySwitching: t.Optional(t.Boolean()),
  verificationStep: t.Optional(t.Union([t.Literal("none"), t.Literal("reflect")])),
  runtimeVerification: t.Optional(t.Boolean()),
  auditRationale: t.Optional(t.Boolean()),
  retryPolicy: t.Optional(
    t.Object({ enabled: t.Optional(t.Boolean()), maxRetries: t.Number(), backoffMs: t.Optional(t.Number()) }),
  ),
  fallbacks: t.Optional(
    t.Object({
      enabled: t.Optional(t.Boolean()),
      providers: t.Optional(t.Array(t.String())),
      errorThreshold: t.Optional(t.Number()),
    }),
  ),
  metaTools: t.Optional(
    t.Object({
      enabled: t.Optional(t.Boolean()),
      brief: t.Optional(t.Boolean()),
      find: t.Optional(t.Boolean()),
      pulse: t.Optional(t.Boolean()),
      recall: t.Optional(t.Boolean()),
      harnessSkill: t.Optional(t.Boolean()),
      todo: t.Optional(t.Boolean()),
      todoGuidance: t.Optional(t.Object({ reminder: t.Optional(t.Boolean()), systemLine: t.Optional(t.Boolean()) })),
    }),
  ),
  observability: t.Optional(t.Object({ checklist: t.Optional(t.Boolean()) })),
  observabilityVerbosity: t.Optional(
    t.Union([t.Literal("off"), t.Literal("minimal"), t.Literal("normal"), t.Literal("verbose")]),
  ),
  terminalTools: t.Optional(t.Boolean()),
  terminalShellAdditionalCommands: t.Optional(t.String()),
  terminalShellAllowedCommands: t.Optional(t.String()),
  terminalShellOptions: t.Optional(TerminalShellOptionsBody),
  /** Absolute existing directory for file tools + shell (`.withTools({ workspace })`); "" clears it (chat PATCH). */
  workspace: t.Optional(t.String()),
  taskContext: t.Optional(t.Record(t.String(), t.String())),
  healthCheck: t.Optional(t.Boolean()),
  memory: t.Optional(
    t.Object({ working: t.Optional(t.Boolean()), episodic: t.Optional(t.Boolean()), semantic: t.Optional(t.Boolean()) }),
  ),
  contextSynthesis: t.Optional(
    t.Union([t.Literal("auto"), t.Literal("template"), t.Literal("llm"), t.Literal("none")]),
  ),
  guardrails: t.Optional(GuardrailsBody),
  persona: t.Optional(
    t.Object({
      enabled: t.Optional(t.Boolean()),
      role: t.Optional(t.String()),
      tone: t.Optional(t.String()),
      traits: t.Optional(t.String()),
      responseStyle: t.Optional(t.String()),
    }),
  ),
  skills: t.Optional(t.Object({ paths: t.Array(t.String()), activate: t.Optional(t.Array(t.String())) })),
  /** Typed structured output (`.withOutputSchema`): a JSON Schema object. */
  outputSchema: t.Optional(t.Record(t.String(), t.Unknown())),
  /** `.withOutputSchema(schema, { onParseFail })`: "degrade" (framework default) or "throw". */
  outputSchemaOnParseFail: t.Optional(t.Union([t.Literal("degrade"), t.Literal("throw")])),
  harness: t.Optional(t.Record(t.String(), t.Unknown())),
  documents: t.Optional(
    t.Array(
      t.Object({
        source: t.Optional(t.String()),
        content: t.Optional(t.String()),
        format: t.Optional(t.String()),
        chunkStrategy: t.Optional(t.String()),
        maxChunkSize: t.Optional(t.Number()),
      }),
    ),
  ),
  budget: t.Optional(t.Object({ tokenLimit: t.Optional(t.Number()), costLimit: t.Optional(t.Number()) })),
  grounding: t.Optional(
    t.Object({ mode: t.Union([t.Literal("warn"), t.Literal("block")]), tolerance: t.Optional(t.Number()) }),
  ),
  fabricationGuard: t.Optional(t.Union([t.Literal("off"), t.Literal("warn"), t.Literal("block")])),
  modelRouting: t.Optional(
    t.Object({
      enabled: t.Optional(t.Boolean()),
      minTier: t.Optional(t.Union([t.Literal("haiku"), t.Literal("sonnet"), t.Literal("opus")])),
      tierModels: t.Optional(t.Record(t.String(), t.String())),
    }),
  ),
  /** Generic framework-config overrides (nested partial AgentConfig), deep-merged under curated fields. */
  rawConfig: t.Optional(t.Record(t.String(), t.Unknown())),
  durableRuns: t.Optional(DurableRunsBody),
};
