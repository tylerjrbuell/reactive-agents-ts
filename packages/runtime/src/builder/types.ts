/**
 * Public option types for the ReactiveAgentBuilder.
 *
 * These were inlined in builder.ts before W25. The original location
 * is preserved as a re-export so consumer imports keep working
 * (`import { ToolsOptions } from "@reactive-agents/runtime"`).
 *
 * Lifted from builder.ts pre-W25 (6,232-LOC checkpoint).
 */
import type { Effect } from 'effect'
import type {
    ToolDefinition,
    ResultCompressionConfig,
    ShellExecuteConfig,
} from '@reactive-agents/tools'
import type { PromptTemplate } from '@reactive-agents/prompts'
import type { OutputFormat, TerminatedBy, TrustReceipt } from '@reactive-agents/core'
import type { Redactor, TelemetryConfig } from '@reactive-agents/observability'
import type { AgentDebrief } from '../debrief.js'

// ─── DeepPartial ─────────────────────────────────────────────────────────────

/**
 * Recursively makes all properties optional.
 * Used by `streamObject()` to type intermediate partial emissions as tokens arrive.
 */
export type DeepPartial<T> = T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T

// ─── Provider Types ──────────────────────────────────────────────────────────

/**
 * Name of the LLM provider to use.
 *
 * - `"anthropic"` — Claude models via Anthropic API (requires `ANTHROPIC_API_KEY`)
 * - `"openai"` — GPT models via OpenAI API (requires `OPENAI_API_KEY`)
 * - `"ollama"` — Local models via Ollama (no API key needed)
 * - `"gemini"` — Google Gemini models (requires `GOOGLE_API_KEY`)
 * - `"litellm"` — LiteLLM proxy for 40+ provider models
 * - `"test"` — Mock LLM for testing (uses `withTestScenario()`)
 */
export type ProviderName =
    | 'anthropic'
    | 'openai'
    | 'ollama'
    | 'gemini'
    | 'litellm'
    | 'groq'
    | 'xai'
    | 'test'

// ─── Optional Parameter Types ─────────────────────────────────────────────────

/**
 * Agent persona for steering behavior — a structured alternative to raw system prompts.
 *
 * Provides a type-safe way to define agent characteristics (role, background, instructions, tone)
 * that get composed into the system prompt. When both persona and system prompt are provided,
 * the persona is prepended to the system prompt.
 *
 * @example
 * ```typescript
 * const agent = await ReactiveAgents.create()
 *   .withPersona({
 *     role: "Data Analyst",
 *     background: "Expert in statistical analysis and data visualization",
 *     instructions: "Always check data quality before analysis",
 *     tone: "professional and technical"
 *   })
 *   .build();
 * ```
 */
export interface AgentPersona {
    /** Display name of the agent (defaults to builder `.withName()` value). Default: undefined */
    readonly name?: string
    /** What this agent does — injected as "Role:" section of system prompt. Default: undefined */
    readonly role?: string
    /** Background context or expertise description — injected as "Background:" section. Default: undefined */
    readonly background?: string
    /** Explicit behavioral instructions — injected as "Instructions:" section. Default: undefined */
    readonly instructions?: string
    /** Tone/style guidance (e.g., "professional", "concise", "friendly") — injected as "Tone:" section. Default: undefined */
    readonly tone?: string
}

/**
 * Options for `.withTools()` — register custom tools with the agent.
 *
 * Custom tools are registered in addition to built-in tools (file-write, file-read, web-search, etc.).
 * Tools can also be connected via MCP servers.
 *
 * @example
 * ```typescript
 * agent
 *   .withTools({
 *     tools: [
 *       {
 *         definition: { name: "my-tool", description: "...", parameters: [...] },
 *         handler: (args) => Effect.succeed({ result: "done" })
 *       }
 *     ]
 *   })
 * ```
 */
export interface ToolsOptions {
    /** Array of custom tool definitions and handlers to register. Each entry includes the tool definition (name, description, parameters) and an async handler function. Default: [] */
    readonly tools?: ReadonlyArray<{
        readonly definition: ToolDefinition
        readonly handler: (
            args: Record<string, unknown>
        ) => Effect.Effect<unknown, any>
    }>
    /** Tool result compression config — controls preview size, overflow key storage (recall/compression), and pipe transforms. */
    readonly resultCompression?: ResultCompressionConfig
    /**
     * Whitelist of tool names to expose. When set, only these tools are available —
     * all others (built-in, MCP, custom) are filtered out. Useful for creating focused agents.
     *
     * @example
     * ```typescript
     * agent.withTools({ allowedTools: ["web-search", "file-read"] })
     * ```
     *
     * Default: undefined (all tools available)
     */
    readonly allowedTools?: readonly string[]
    /**
     * Tools to show in the LLM prompt — restricts what the model sees but does NOT block execution.
     * Use when you want to guide the model toward specific tools while other tools remain callable.
     * Contrast with `allowedTools` which filters the prompt AND blocks execution of non-listed tools.
     *
     * @example
     * ```typescript
     * agent.withTools({ focusedTools: ["crypto-price"] })
     * ```
     *
     * Default: undefined (prompt visibility follows allowedTools or all tools)
     */
    readonly focusedTools?: readonly string[]
    /**
     * Enable adaptive tool filtering. When true, only task-relevant tools are shown
     * to the agent — reducing context noise and improving small-model accuracy.
     *
     * Uses heuristic keyword + description matching to identify relevant tools,
     * then presents only those plus essential built-ins (e.g. spawn-agent; working memory via recall when meta-tools are on).
     * All tools remain callable by exact name even if not shown.
     *
     * @example
     * ```typescript
     * agent.withTools({ adaptive: true })
     * ```
     *
     * Default: false (all tools shown)
     */
    readonly adaptive?: boolean
    /**
     * Opt in to built-in tools (file-write, file-read, web-search, http-get,
     * code-execute, git-cli, gh-cli, gws-cli, crypto-price).
     *
     * As of 2026-05-06, built-ins are NOT included in the agent's base tool
     * schema by default. They remain registered (callable by name and
     * surfaceable via the `discover-tools` meta-tool at runtime), but are
     * excluded from the prompt-level tool list unless the consumer opts in
     * here. Rationale: built-in descriptions like "write to file" and
     * "search the web" cause the relevance classifier to promote them on
     * unrelated tasks ("write a markdown report" → file-write surfaces),
     * leading to gratuitous tool calls and degraded synthesis quality on
     * local models. See `wiki/Research/Debriefs/2026-05-06-M3-cogito-14b-divergence.md`.
     *
     * Values:
     *   - `false` / unset (default): no built-ins in base schema.
     *   - `true`: all 9 built-ins in base schema (legacy behavior).
     *   - `readonly string[]`: explicit subset by name.
     *
     * @example
     * ```typescript
     * agent.withTools({ tools: [...], builtins: ["file-write", "web-search"] })
     * agent.withTools({ tools: [...], builtins: true })  // legacy
     * ```
     *
     * Default: undefined (treated as `false` — no built-ins in base schema).
     */
    readonly builtins?: boolean | readonly string[]
    /**
     * Enable/configure the shell-execute tool for terminal/CLI command execution.
     *
     * When true, the agent gains access to controlled shell command execution with:
     * - Allowlist of safe commands (git, ls, cat, grep, find, node, bun, npm, python, curl, echo, mkdir, cp, mv, wc, head, tail, sort, jq)
     * - Blocklist patterns for dangerous operations (rm -rf, chmod 777, sudo, eval, etc.)
     * - Working directory locked to project root or sandbox dir
     * - 30s timeout per command, 4000 char output truncation
     *
     * Useful for agents that need to inspect files, run build commands, or execute scripts safely.
     *
     * Use `true` for defaults or pass a config object for custom behavior
     * (for example, `additionalCommands: ["gh"]`).
     *
     * **Opt-in commands** — these are NOT in the default allowlist and must be
     * named explicitly in `additionalCommands` (developer takes liability):
     * `node`, `bun`, `npm`, `npx`, `python`, `python3`, `curl`, `env`, `xargs`, `tar`.
     * Common gotcha: `find ... | xargs wc -l` fails until `xargs` is added.
     *
     * @example
     * ```typescript
     * agent.withTools({ terminal: true })
     *
     * agent.withTools({
     *   terminal: {
     *     // Grant gh CLI + xargs so `find | xargs wc -l` pipelines work
     *     additionalCommands: ["gh", "xargs"],
     *   },
     * })
     * ```
     *
     * Default: false (shell-execute not available)
     */
    readonly terminal?: boolean | ShellExecuteConfig
    /**
     * Tools the agent MUST call before it can declare success (consolidation
     * fold — `.withRequiredTools()` expressed as a tools-config option, per
     * north-star §5 "one concept, one entry point"; both spellings remain
     * first-class and write the same underlying state).
     *
     * Shorthand: a bare `readonly string[]` is equivalent to
     * `{ tools: [...] }` (mirrors the `builtins` / `terminal` union
     * convention in this interface).
     *
     * Semantics (identical to `.withRequiredTools()` — same config path):
     * - A non-empty static `tools` list SUPPRESSES the adaptive tool
     *   classifier: the caller stated their requirements, so no LLM
     *   relevance-inference round-trip runs (see
     *   `engine/phases/agent-loop/setup/classifier.ts` —
     *   `hasStaticRequiredList`).
     * - Enforcement: if the agent attempts to end without calling every
     *   required tool, the kernel redirects it back to "thinking" with
     *   feedback; after `maxRetries` redirects (default: 2) the task fails.
     *
     * Conflict rule when combined with `.withRequiredTools()` (or repeated
     * calls of either spelling): `tools` lists are UNIONED (deduped,
     * first-seen order); scalar fields (`adaptive`, `maxRetries`) are
     * last-call-wins.
     *
     * @example
     * ```typescript
     * agent.withTools({ required: ["web-search"] })
     * agent.withTools({ required: { tools: ["web-search"], maxRetries: 3 } })
     * agent.withTools({ required: { adaptive: false } }) // opt out of classifier
     * ```
     *
     * Default: undefined (no static required tools; adaptive classification
     * follows the reasoning-enabled default).
     */
    readonly required?: readonly string[] | RequiredToolsOptions
}

/**
 * Object form of {@link ToolsOptions.required} — matches the
 * `.withRequiredTools()` parameter shape exactly so the two spellings are
 * interchangeable.
 */
export interface RequiredToolsOptions {
    /** Tool names that must be called during execution */
    readonly tools?: readonly string[]
    /** Enable adaptive LLM inference of required tools */
    readonly adaptive?: boolean
    /** Max redirect attempts before failing (default: 2) */
    readonly maxRetries?: number
}

/**
 * Options for `.withPrompts()` — register custom prompt templates.
 *
 * Custom templates are registered in addition to built-in prompt library templates.
 * Templates can be referenced by name in reasoning strategies and tool descriptions.
 *
 * @example
 * ```typescript
 * agent
 *   .withPrompts({
 *     templates: [
 *       { id: "custom-analysis", content: "Analyze the following...", tier: "frontier" }
 *     ]
 *   })
 * ```
 */
export interface PromptsOptions {
    /** Array of custom prompt templates to register. Each template includes an ID, content, and optionally a tier specification. Default: [] */
    readonly templates?: ReadonlyArray<PromptTemplate>
}

/**
 * Options for `.withMemory()` — configure the 4-layer memory system.
 *
 * Replaces the opaque `"1"`/`"2"` tier strings with named, discoverable fields.
 * Backward-compatible: passing a plain string still works.
 *
 * @example
 * ```typescript
 * agent.withMemory({ tier: "enhanced", dbPath: "./data/memory.db", capacity: 12 })
 * ```
 */
export interface MemoryOptions {
    /** Memory tier: `"standard"` (working only) or `"enhanced"` (full 4-layer + embeddings). Default: "standard" */
    readonly tier?: 'standard' | 'enhanced'
    /** Custom SQLite database path. Default: `.reactive-agents/memory/{agentId}/memory.db` */
    readonly dbPath?: string
    /** Maximum compaction entries before pruning. Default: 1000 */
    readonly maxEntries?: number
    /** Working memory slot capacity. Default: 7 */
    readonly capacity?: number
    /** Working memory eviction policy. Default: "fifo" */
    readonly evictionPolicy?: 'fifo' | 'lru' | 'importance'
    /** Days to retain episodic snapshots. Default: 30 */
    readonly retainDays?: number
    /** Importance threshold for semantic memory inclusion. Default: 0.7 */
    readonly importanceThreshold?: number
}

/**
 * Options for `.withCostTracking()` — configure budget limits for cost enforcement.
 *
 * All values are in USD. Omitted fields use framework defaults.
 *
 * @example
 * ```typescript
 * agent.withCostTracking({ perRequest: 0.50, daily: 10.0, monthly: 100.0 })
 * ```
 */
export interface CostTrackingOptions {
    /** Maximum cost per single LLM request (USD). Default: $1.00 */
    readonly perRequest?: number
    /** Maximum cost per session (USD). Default: $5.00 */
    readonly perSession?: number
    /** Maximum daily spend (USD). Default: $25.00 */
    readonly daily?: number
    /** Maximum monthly spend (USD). Default: $200.00 */
    readonly monthly?: number
}

/**
 * Options for `.withGuardrails()` — toggle individual guardrail detectors.
 *
 * All detectors default to `true` when guardrails are enabled.
 *
 * @example
 * ```typescript
 * agent.withGuardrails({ injection: true, pii: true, toxicity: false })
 * ```
 */
export interface GuardrailsOptions {
    /** Enable prompt injection detection. Default: true */
    readonly injection?: boolean
    /** Enable PII detection and masking. Default: true */
    readonly pii?: boolean
    /** Enable toxicity detection. Default: true */
    readonly toxicity?: boolean
    /**
     * Custom list of words or phrases that will cause the input to be rejected.
     * Checked as case-insensitive substring matches.
     */
    readonly customBlocklist?: readonly string[]
}

/**
 * Options for `.withVerification()` — toggle individual verification strategies and thresholds.
 *
 * All strategies default to their framework defaults when verification is enabled.
 *
 * @remarks
 * By default (`useLLMTier` unset or true), the runtime wires `VerificationService` to the same
 * `LLMService` as the agent so tier-2 checks (semantic entropy, fact decomposition, etc.) can call
 * the model. Set `useLLMTier: false` for heuristic-only verification (faster, weaker signal).
 * Use `verbosity: "normal"` or higher to see `◉ [verify]` lines with score / passed / recommendation.
 *
 * @example
 * ```typescript
 * agent.withVerification({ hallucinationDetection: true, passThreshold: 0.8 })
 * ```
 */
/**
 * Options for `.withGrounding()` — opt-in numeric evidence-grounding.
 *
 * When enabled, figures in the final answer are checked against the FULL tool
 * data with rounding tolerance.
 *
 * @example
 * ```typescript
 * agent.withGrounding({ mode: "warn" })          // advisory
 * agent.withGrounding({ mode: "block", tolerance: 0.02 }) // corrective retry
 * ```
 */
export interface GroundingOptions {
    /** `warn`: advisory check only. `block`: one corrective retry then degrade to warn (never hard-fails). */
    readonly mode: "block" | "warn";
    /** Numeric match tolerance as a fraction (rounding). Default 0.01 (1%). */
    readonly tolerance?: number;
    /** `block` mode: corrective retries before degrading to warn. Default 1. */
    readonly maxRetries?: number;
}

/**
 * Options for `.withReceiptSigning()` — opt-in Ed25519 provenance signature
 * on the trust receipt (Arc 1 Task 9). Absent by default (unsigned receipt,
 * zero overhead).
 *
 * HONEST-CLAIMS SCOPE: the signature certifies "this receipt, this run,
 * untampered" — it never certifies the correctness of the agent's answer.
 * See `TrustReceipt.signature`'s JSDoc in `@reactive-agents/core`.
 *
 * Also settable via the `RA_RECEIPT_KEY` env var (JWK JSON) — this option
 * wins when both are present. Generate a key pair with
 * `generateReceiptKeyPair()` from `@reactive-agents/runtime`.
 *
 * @example
 * ```typescript
 * const { privateKeyJwk } = await generateReceiptKeyPair();
 * agent.withReceiptSigning({ privateKeyJwk });
 * ```
 */
export interface ReceiptSigningOptions {
    /** Ed25519 private key as a JWK — never logged or included in the receipt itself (only the derived public key is embedded). */
    readonly privateKeyJwk: JsonWebKey;
}

/**
 * Options for `.withOutputSchema()` — opt-in typed structured output.
 *
 * When enabled, the runtime routes structured extraction through a
 * capability-selected engine and populates `AgentResult.object`.
 *
 * @example
 * ```typescript
 * agent.withOutputSchema(MySchema)                        // auto mode, lenient
 * agent.withOutputSchema(MySchema, { mode: "grounded" })  // loop-integrated
 * agent.withOutputSchema(MySchema, { onParseFail: "throw" })
 * ```
 */
export interface OutputSchemaOptions {
    /** `auto` (default): capability-routed. `fast`: single-shot. `grounded`: loop-integrated. */
    readonly mode?: "auto" | "fast" | "grounded";
    /** `degrade` (default): object=undefined + objectError. `throw`: StructuredOutputError. */
    readonly onParseFail?: "degrade" | "throw";
    /** Grounded engine only: omit fields whose confidence is below this (opt-in; default off = no abstention). */
    readonly abstainBelow?: number;
}

/**
 * Options for `.withDurableRuns()` — opt-in durable run persistence (Phase B).
 *
 * When enabled, the runtime serializes kernel state to a SQLite RunStore every
 * `checkpointEvery` iterations so a crashed run can be resumed (Phase C
 * `resume()`). Absent ⇒ no RunStore, no run row, no checkpoints, no db file
 * (zero overhead).
 *
 * @example
 * ```typescript
 * agent.withDurableRuns()                                  // default dir, every iteration
 * agent.withDurableRuns({ checkpointEvery: 5 })            // every 5th iteration
 * agent.withDurableRuns({ dir: "./.runs", checkpointEvery: 2 })
 * ```
 */
export interface DurableRunsOptions {
    /**
     * Directory for the `runs.db` SQLite file.
     * Default: `~/.reactive-agents/<agentId>/`.
     */
    readonly dir?: string;
    /** Persist a checkpoint every N iterations. Default 1. */
    readonly checkpointEvery?: number;
}

/**
 * Durable human-in-the-loop approval policy (Phase D). Names the tool calls that
 * must pause for human approval, and/or a predicate. In `mode: "detach"` (default
 * when `.withDurableRuns()` is set) a gated call pauses the run, persists
 * `awaiting-approval`, and returns control so a human can approve/deny from any
 * process via `agent.approveRun`/`denyRun`. Detached pauses ride the `runStream()`
 * path (where durable persistence lives). In `mode: "block"` the in-process
 * approval gate handles it instead.
 *
 * As of the v0.14 security hardening (F2), a registered tool whose definition
 * declares `requiresApproval: true` (built-ins like `code-execute`/`file-write`,
 * the `shell-execute` terminal tool when enabled, and custom tools) is folded
 * into `tools` automatically at config assembly — you no longer have to list
 * those names by hand. `tools` / `requireFor` still add further tools on top.
 * (Auto-feed applies only when an approval policy is configured.)
 */
export interface ApprovalPolicyConfig {
    /** Tool names whose calls must pause for approval. */
    readonly tools?: readonly string[];
    /** Predicate: return true to require approval for this call. */
    readonly requireFor?: (ctx: { toolName: string; iteration: number }) => boolean;
    /** "detach" (durable, default when durable runs are on) or "block" (in-process). */
    readonly mode?: "detach" | "block";
}

/**
 * Options for `.withModelRouting()` — opt-in cost-aware model routing.
 *
 * When enabled, each run is routed to the cheapest capable model for the
 * configured provider, selected by task complexity. Stays within the
 * provider's tiers; degrades to the configured model on any routing error.
 */
export interface ModelRoutingOptions {
    /** Override the model IDs used for each tier (e.g. pin haiku to a specific version). */
    readonly tierModels?: Partial<Record<'haiku' | 'sonnet' | 'opus', string>>;
    /** Minimum tier to consider — never route below this tier. */
    readonly minTier?: 'haiku' | 'sonnet' | 'opus';
}

export interface VerificationOptions {
    /** Enable semantic entropy estimation. Default: true */
    readonly semanticEntropy?: boolean
    /** Enable fact decomposition. Default: true */
    readonly factDecomposition?: boolean
    /** Enable multi-source verification. Default: false */
    readonly multiSource?: boolean
    /** Enable self-consistency checks. Default: true */
    readonly selfConsistency?: boolean
    /** Enable natural language inference. Default: true */
    readonly nli?: boolean
    /** Enable hallucination detection layer. Default: false */
    readonly hallucinationDetection?: boolean
    /** Hallucination score threshold (0-1). Default: 0.10 */
    readonly hallucinationThreshold?: number
    /** Overall pass threshold for verification (0-1). Default: 0.7 */
    readonly passThreshold?: number
    /** Risk threshold below which outputs are flagged (0-1). Default: 0.5 */
    readonly riskThreshold?: number
    /**
     * When true (default), use the runtime `LLMService` for LLM-backed verification layers.
     * When false, only tier-1 heuristics run (no extra model calls from verification).
     */
    readonly useLLMTier?: boolean
    /**
     * What to do when verification still rejects after retries (F10). Default
     * "proceed" (ship the answer — telemetry only). "block" withholds the answer
     * and fails the run; "annotate" ships with a visible warning prepended. Makes
     * `.withVerification()` an enforcement point instead of pure telemetry.
     */
    readonly onReject?: "block" | "annotate" | "proceed"
}

/**
 * Options for `.withObservability()` — configure observability verbosity, live streaming, and exporters.
 *
 * Controls how much output is displayed during agent execution and whether logs are streamed in real-time
 * or exported to a file. The metrics dashboard automatically shows on completion at "normal" verbosity or higher.
 *
 * @example
 * ```typescript
 * agent
 *   .withObservability({
 *     verbosity: "verbose",
 *     live: true,
 *     file: "./logs/agent.jsonl"
 *   })
 * ```
 */
export interface ObservabilityOptions {
    /**
     * Output verbosity level:
     * - `"minimal"` — no output except final result
     * - `"normal"` — metrics dashboard only (recommended)
     * - `"verbose"` — dashboard + structured phase logs + reasoning steps (truncated)
     * - `"debug"` — everything without truncation, full context dumps
     *
     * Default: `"normal"`
     */
    readonly verbosity?: 'minimal' | 'normal' | 'verbose' | 'debug'
    /**
     * Stream logs in real-time as the agent executes each phase.
     * When enabled, phase logs appear immediately; otherwise they are buffered until the final dashboard.
     *
     * Default: `false`
     */
    readonly live?: boolean
    /**
     * Prefix prepended to all observability log lines.
     * Used internally for sub-agent indentation (e.g., `"  │ "`).
     *
     * Default: `""` (no prefix)
     */
    readonly logPrefix?: string
    /**
     * Path for JSONL file export. Each log entry is written as a JSON object on a separate line.
     * Useful for post-processing or long-term metric archival.
     *
     * Default: undefined (no file export)
     */
    readonly file?: string
    /**
     * Log full model prompts and responses.
     *
     * When `true`, full system/user prompts and untruncated model responses are logged
     * at debug level. When `false`, prompt dumps are suppressed even at `verbosity: "debug"`.
     *
     * Default: `true` when `verbosity` is `"debug"`, `false` otherwise.
     */
    readonly logModelIO?: boolean
    /**
     * Custom secret redactors appended to the OWASP-aligned default set.
     *
     * The framework always applies a default redactor list to log messages
     * and string-valued metadata (anthropic / openai / github / jwt / aws /
     * google API keys). Patterns supplied here run *after* defaults, so user
     * patterns operate on already-redacted output.
     *
     * Use to redact organization-specific secret formats (e.g., internal
     * deployment tokens, request IDs that embed user IDs) without disabling
     * the default protection.
     *
     * @example
     * ```typescript
     * .withObservability({
     *   redactors: [
     *     { name: "internal-deploy-token", pattern: /dpl_\w{32,}/g, replacement: "[redacted-deploy]" },
     *   ],
     * })
     * ```
     */
    readonly redactors?: readonly Redactor[]

    // ── DX wave (v0.12): one canonical observability route ──
    // The sub-options below fan out to the SAME builder state the dedicated
    // convenience methods set (`.withCortex`, `.withTelemetry`, `.withLogging`,
    // `.withTracing`, `.withHealthCheck`, `.withAudit`, `.withCostTracking`), so
    // the whole observability stack can be configured through this one method.
    // The dedicated methods remain (additive). Precedence: last call wins.

    /** Cortex event reporting. `true` resolves the URL from CORTEX_URL / default; `{ url }` sets it explicitly. Equivalent to `.withCortex(url?)`. */
    readonly cortex?: boolean | { readonly url?: string }
    /** Anonymous telemetry (differential privacy). Equivalent to `.withTelemetry(config?)`. */
    readonly telemetry?: boolean | TelemetryConfig
    /** Structured logging. Equivalent to `.withLogging(config)`. */
    readonly logging?: {
        readonly level?: 'debug' | 'info' | 'warn' | 'error'
        readonly format?: 'text' | 'json'
        readonly output?: 'console' | 'file' | WritableStream
        readonly filePath?: string
        readonly maxFileSizeBytes?: number
        readonly maxFiles?: number
    }
    /** JSONL trace persistence. `{ dir }` enables (default dir when omitted); `false` disables. Equivalent to `.withTracing()` / `.withoutTracing()`. */
    readonly tracing?: boolean | { readonly dir?: string }
    /** Health checks. Equivalent to `.withHealthCheck()`. */
    readonly health?: boolean
    /** Per-tool-call rationale auditing. Equivalent to `.withAudit()`. */
    readonly audit?: boolean
    /** Cost tracking. `true` enables; an options object also sets budget caps. Equivalent to `.withCostTracking(options?)`. */
    readonly costs?: boolean | CostTrackingOptions
}

/**
 * Options for `.withA2A()` — configure the Agent-to-Agent (A2A) protocol server.
 *
 * When enabled, the agent exposes a JSON-RPC 2.0 HTTP server that allows other agents
 * to invoke it remotely. The agent becomes discoverable via Agent Cards at `/.well-known/agent.json`.
 *
 * @example
 * ```typescript
 * agent
 *   .withA2A({ port: 8000, basePath: "/api/agents" })
 * ```
 */
export interface A2AOptions {
    /**
     * HTTP port for the A2A server.
     *
     * Default: `3000`
     */
    readonly port?: number
    /**
     * Base path for A2A endpoints (e.g., `/api/agents` → `http://localhost:3000/api/agents/rpc`).
     *
     * Default: `/` (root)
     */
    readonly basePath?: string
}

/**
 * Options for `.withGateway()` — configure the persistent autonomous agent harness.
 *
 * Enables heartbeats, crons, webhooks, and a composable policy engine for proactive agent behavior.
 * The gateway operates as deterministic infrastructure — LLM calls only happen when intelligence is needed.
 *
 * @example
 * ```typescript
 * agent.withGateway({
 *   heartbeat: { intervalMs: 1800000, policy: "adaptive" },
 *   crons: [{ schedule: "0 9 * * MON", instruction: "Review PRs" }],
 *   policies: { dailyTokenBudget: 50000, maxActionsPerHour: 20 },
 * })
 * ```
 */
export interface GatewayOptions {
    readonly timezone?: string
    readonly heartbeat?: {
        readonly intervalMs?: number
        readonly policy?: 'always' | 'adaptive' | 'conservative'
        readonly instruction?: string
        readonly maxConsecutiveSkips?: number
    }
    readonly crons?: readonly {
        readonly schedule: string
        readonly instruction: string
        readonly agentId?: string
        readonly priority?: 'low' | 'normal' | 'high' | 'critical'
        readonly timezone?: string
        readonly enabled?: boolean
    }[]
    readonly webhooks?: readonly {
        readonly path: string
        readonly adapter: string
        readonly secret?: string
        readonly events?: readonly string[]
    }[]
    readonly policies?: {
        readonly dailyTokenBudget?: number
        readonly maxActionsPerHour?: number
        readonly heartbeatPolicy?: 'always' | 'adaptive' | 'conservative'
        readonly mergeWindowMs?: number
        readonly requireApprovalFor?: readonly string[]
    }
    /**
     * When true, heartbeat and cron executions use the stable agent id (same as `agent.run()`)
     * so memory layers can span gateway ticks. Default false: each gateway run used a unique id.
     */
    readonly persistMemoryAcrossRuns?: boolean
    readonly port?: number
    /** Channel access control configuration for messaging platforms (allowlist / chat mode). */
    readonly accessControl?: {
        /** Access control policy: "allowlist" (default), "blocklist", or "open". */
        readonly accessPolicy?: 'allowlist' | 'blocklist' | 'open'
        /** Phone numbers / user IDs allowed to message (for allowlist mode). */
        readonly allowedSenders?: string[]
        /** Phone numbers / user IDs blocked (for blocklist mode). */
        readonly blockedSenders?: string[]
        /** Action for unknown senders: "skip" (default) or "escalate". */
        readonly unknownSenderAction?: 'skip' | 'escalate'
        /** Optional auto-reply message for unknown senders. */
        readonly replyToUnknown?: string
        /** How incoming channel messages are handled. Default: 'chat'. */
        readonly mode?: 'chat' | 'task'
        /** Days of inactivity before a persisted chat session is pruned. Default: 30. */
        readonly sessionTtlDays?: number
    }
}

/**
 * Summary returned when a gateway loop stops.
 */
export interface GatewaySummary {
    readonly heartbeatsFired: number
    readonly totalRuns: number
    readonly cronChecks: number
    readonly chatTurns?: number
    readonly error?: string
}

/**
 * Handle returned by `agent.start()` to control the persistent gateway loop.
 */
export interface GatewayHandle {
    /** Stop the gateway loop and return execution summary. */
    stop(): Promise<GatewaySummary>
    /** Promise that resolves when the gateway stops (via stop() or error). */
    done: Promise<GatewaySummary>
}

/**
 * Options for `.withAgentTool()` — register a local or remote agent as a callable tool.
 *
 * Allows this agent to spawn sub-agents (either locally or via remote A2A invocation) that
 * run in isolated contexts and return results. Sub-agents inherit the parent's provider/model by default
 * but can override them. Local sub-agents do NOT inherit the spawn-agent tool unless explicitly given it.
 *
 * @example
 * ```typescript
 * agent
 *   .withAgentTool("researcher", {
 *     name: "Research Agent",
 *     description: "Gathers information and synthesizes findings",
 *     provider: "anthropic",
 *     model: "claude-opus-4-20250514",
 *     tools: ["web-search", "file-write"],
 *     maxIterations: 15
 *   })
 * ```
 */
export interface AgentToolOptions {
    /**
     * Name of the tool as it appears in the agent's tool registry.
     * The LLM can invoke it by name, e.g., `web_search` or `researcher`.
     */
    readonly name: string
    /**
     * Configuration for a local sub-agent (mutually exclusive with `remoteUrl`).
     * If provided, a new agent instance is created and run in this process.
     */
    readonly agent?: {
        /** Name of the sub-agent (displayed in logs). */
        readonly name: string
        /** Description of what this sub-agent does (shown to the parent LLM). Default: auto-generated from name */
        readonly description?: string
        /** LLM provider for the sub-agent (inherits parent's if omitted). Default: parent's provider */
        readonly provider?: string
        /** Model for the sub-agent (inherits parent's if omitted). Default: parent's model */
        readonly model?: string
        /** List of tool names this sub-agent can use (e.g., `["web-search", "file-write"]`). Default: no tools */
        readonly tools?: readonly string[]
        /** Maximum reasoning iterations for the sub-agent. Default: 5 */
        readonly maxIterations?: number
        /** System prompt for the sub-agent. Default: empty */
        readonly systemPrompt?: string
        /** Persona to steer the sub-agent's behavior (composed into system prompt). Default: undefined */
        readonly persona?: AgentPersona
    }
    /**
     * URL of a remote A2A server (mutually exclusive with `agent`).
     * If provided, tool invocations are sent as JSON-RPC calls to the remote agent.
     *
     * Default: undefined (local agent)
     */
    readonly remoteUrl?: string
}

// ─── Result Types ────────────────────────────────────────────────────────────

/**
 * Metadata about an agent execution result.
 *
 * Captures timing, costs, token usage, and execution details for observability and analysis.
 */
export interface AgentResultMetadata {
    /** Total wall-clock duration in milliseconds. */
    readonly duration: number
    /** Estimated cost in USD (calculated from token count). */
    readonly cost: number
    /** Total tokens consumed by the LLM for this execution. */
    readonly tokensUsed: number
    /** Prompt/input tokens (optional — provider may not split; see core ResultMetadataSchema). */
    readonly inputTokens?: number
    /** Completion/output tokens (optional — see inputTokens). */
    readonly outputTokens?: number
    /** Name of the reasoning strategy that was used (e.g., "reactive", "tree-of-thought"). Default: undefined */
    readonly strategyUsed?: string
    /** Number of reasoning iterations/steps taken to complete the task. */
    readonly stepsCount: number
    /** Confidence level of the result. */
    readonly confidence?: 'high' | 'medium' | 'low'
    /**
     * Full reasoning trace — thought / action / observation steps as they
     * were executed. Populated by the execution engine. Useful for
     * post-run analysis, evals, and downstream debriefing. May be omitted
     * when the engine didn't surface a step trace (e.g. direct-LLM path).
     */
    readonly reasoningSteps?: ReadonlyArray<{
        readonly id?: string
        readonly type: string
        readonly content: string
        readonly metadata?: Record<string, unknown>
    }>
    /**
     * Derived array of tool calls extracted from `reasoningSteps`. One entry
     * per `type === "action"` step. Convenient for tests / evals that just
     * want "which tools did the agent use" without filtering steps.
     */
    readonly toolCalls?: ReadonlyArray<{
        readonly name: string
        readonly arguments?: unknown
        readonly id?: string
    }>
    /**
     * When this result was produced by the composition API (`pipe`, `parallel`, or `race`).
     */
    readonly compositionType?: 'pipe' | 'parallel' | 'race'
    /** `pipe()` only — number of chained agent stages. */
    readonly stages?: number
    /** `parallel()` only — per-branch results. */
    readonly results?: ReadonlyArray<{
        readonly name: string
        readonly output: string
        readonly success: boolean
        readonly agentId: string
    }>
    /** `race()` only — how many agents competed. */
    readonly candidates?: number
}

/**
 * Result of a completed agent execution.
 *
 * Includes the final output, success status, task ID, and execution metadata
 * for full observability of what the agent did and how long it took.
 *
 * @example
 * ```typescript
 * const result = await agent.run("What is 2+2?");
 * console.log(result.output);           // "4"
 * console.log(result.success);          // true
 * console.log(result.metadata.duration); // 1250 (ms)
 * console.log(result.metadata.cost);    // 0.00123 (USD)
 * ```
 */
export interface AgentResult {
    /** The final output/answer produced by the agent. */
    readonly output: string
    /** Whether the execution completed successfully (true) or failed (false). */
    readonly success: boolean
    /** Unique ID for this execution task. */
    readonly taskId: string
    /** ID of the agent that performed the execution. */
    readonly agentId: string
    /** Metadata about the execution (duration, cost, tokens, strategy, steps). */
    readonly metadata: AgentResultMetadata
    /**
     * Deterministic trust receipt (Arc 1 Task 8) — graded evidence about HOW
     * this answer was produced (tool-call outcomes, termination reason,
     * abstention, verifier verdict when present). Computed from in-memory run
     * data at result assembly, so it is present even when tracing is off.
     *
     * NOT a truth certificate: `receipt.verdict` grades the run's evidence
     * trail, not the factual correctness of `output`. See {@link TrustReceipt}.
     */
    readonly receipt?: TrustReceipt
    // New optional fields — backward compatible
    /** Output format detected or declared by the agent. */
    readonly format?: OutputFormat
    /** How the agent loop was terminated. */
    readonly terminatedBy?: TerminatedBy
    /**
     * Whether the agent semantically achieved the task's goal.
     *
     * Distinct from {@link success} — `success` reflects whether the run
     * terminated cleanly (no exception, status === "done"), whereas
     * `goalAchieved` reflects whether the agent actually delivered an answer
     * it considered final.
     *
     * - `true` — agent produced a final answer (`terminatedBy` ∈ `{final_answer_tool, final_answer}`)
     * - `false` — agent exhausted iterations or errored (`terminatedBy` ∈ `{max_iterations, llm_error}`)
     * - `null` — goal achievement is ambiguous (`terminatedBy === "end_turn"` or unknown);
     *   the model finished its turn without explicitly signaling completion. Treat as "maybe".
     */
    readonly goalAchieved?: boolean | null
    /**
     * Run-level abstention surface — present iff `terminatedBy === "abstained"`.
     * The agent honestly declined rather than fabricating: `reason` is why,
     * `missing` lists what was needed (e.g. `"tool:web-search"`, a clarification).
     *
     * Distinct from the per-field structured-output `abstained` map below
     * (`.withOutputSchema({ abstainBelow })`), which is unrelated and may coexist.
     */
    readonly abstention?: { readonly reason: string; readonly missing: readonly string[] }
    /**
     * Structured post-run debrief. This is the INSTANT deterministic fallback —
     * available the moment `run()` returns (no LLM wait). The richer LLM-synthesized
     * debrief is produced off the critical path; await {@link debriefRich} for it.
     */
    readonly debrief?: AgentDebrief
    /**
     * Await the LLM-synthesized rich debrief, which the engine forks off the
     * critical path so it never delays the answer (measured ~4.7s/48% of a run).
     * Resolves to the rich debrief, or the deterministic fallback if no LLM
     * debrief was scheduled (trivial task / memory off / LLM unavailable).
     * Present only when a debrief was produced (reasoning path + `.withMemory()`).
     */
    readonly debriefRich?: () => Promise<AgentDebrief | undefined>
    /** Error message when `success` is false. */
    readonly error?: string
    /** Typed structured output when `.withOutputSchema()` was set; undefined on parse-fail (lenient). */
    readonly object?: unknown
    /** Populated (lenient mode) when structured parse failed after retries. */
    readonly objectError?: string
    /** Grounded engine only: per-field-path evidence source. */
    readonly provenance?: Readonly<Record<string, { readonly source: string; readonly evidence: string }>>
    /** Grounded engine only: per-field-path confidence 0..1. */
    readonly confidence?: Readonly<Record<string, number>>
    /** Grounded engine only: per-field-path abstention reason (field omitted, not hallucinated). */
    readonly abstained?: Readonly<Record<string, string>>
    /**
     * Lifecycle status. Defaults to `"completed"` for the normal path; set to
     * `"awaiting-approval"` when a durable run paused for human approval (durable
     * HITL, Phase D), or `"failed"` on error.
     */
    readonly status?: "completed" | "awaiting-approval" | "awaiting-interaction" | "failed";
    /** Present only when `status === "awaiting-approval"`. The paused gate + the durable runId to approve/deny. */
    readonly pendingApproval?: {
        readonly runId: string;
        readonly gateId: string;
        readonly toolName: string;
        readonly args: unknown;
    };
    /**
     * Agentic-UI interaction rail (Task 10): present only when
     * `status === "awaiting-interaction"`. The paused interaction + the durable
     * runId to `respondToInteraction`.
     */
    readonly pendingInteraction?: {
        readonly runId: string;
        readonly interactionId: string;
        readonly kind: string;
        readonly prompt: string;
        readonly schema: unknown;
    };
}
