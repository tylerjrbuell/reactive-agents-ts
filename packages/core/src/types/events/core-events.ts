
import type { RunOrigin, RunAbortCause, RunAbortReason } from "../origin.js";
import type { DeliverableReceipt } from "../receipt.js";
import type { ReasoningStepData } from "../reasoning-step-data.js";

/**
 * Provenance of an LLM call's USD cost (`LLMRequestCompleted.priceSource`).
 * - `"provider-reported"`: the provider or proxy returned the cost itself
 *   (e.g. LiteLLM's `x-litellm-response-cost` header).
 * - `"price-book"`: computed from the framework's price table for the model.
 * - `"user"`: computed from user-supplied pricing (`withModelPricing`).
 * - `"unknown"`: no price is known for the model; `estimatedCost` is absent.
 */
export type PriceSource = "provider-reported" | "price-book" | "user" | "unknown";

/** Task/agent lifecycle, execution, memory, LLM, tool, reasoning, guardrail and safety events. */
export type CoreAgentEvent =
  // ─── Core task/agent events ───
  | {
      /**
       * Task was created but not yet started.
       * Fired when a new task ID is generated before execution begins.
       */
      readonly _tag: "TaskCreated";
      /** Unique task identifier correlating all events for a single execution */
      readonly taskId: string;
    }
  | {
      /**
       * Task execution completed successfully or with failure.
       * Fired after the agent finishes its execution loop.
       */
      readonly _tag: "TaskCompleted";
      /** Unique task identifier */
      readonly taskId: string;
      /** True if execution succeeded, false if error occurred */
      readonly success: boolean;
      /** Model identifier used for this task's execution, when known */
      readonly modelId?: string;
    }
  | {
      /**
       * Task execution failed with an error.
       * Fired when an exception is raised during execution and not caught.
       */
      readonly _tag: "TaskFailed";
      /** Unique task identifier */
      readonly taskId: string;
      /** Error message describing the failure */
      readonly error: string;
    }
  | {
      /**
       * Agent instance was created.
       * Fired when ReactiveAgent.create() completes or ReactiveAgentBuilder.build() finishes.
       */
      readonly _tag: "AgentCreated";
      /** Agent identifier assigned during creation */
      readonly agentId: string;
    }
  // ─── Execution Engine events (from @reactive-agents/runtime) ───
  | {
      /**
       * Execution entered a specific phase (bootstrap, strategy, think, act, observe, etc).
       * Fired at the start of each phase in the ExecutionEngine loop.
       */
      readonly _tag: "ExecutionPhaseEntered";
      /** Unique task identifier */
      readonly taskId: string;
      /** Phase name: "bootstrap", "guardrail", "strategy", "think", "act", "observe", "memory-flush", "verify", "audit", "complete" */
      readonly phase: string;
    }
  | {
      /**
       * An execution hook (before/after) was fired.
       * Fired when ExecutionHook lifecycle callbacks execute.
       */
      readonly _tag: "ExecutionHookFired";
      /** Unique task identifier */
      readonly taskId: string;
      /** Phase in which hook fired */
      readonly phase: string;
      /** Timing information: "before" or "after" */
      readonly timing: string;
    }
  | {
      /**
       * The reasoning loop iteration counter incremented.
       * Fired after each complete ReAct/Plan-Execute/ToT loop cycle.
       */
      readonly _tag: "ExecutionLoopIteration";
      /** Unique task identifier */
      readonly taskId: string;
      /** Current iteration number (1-indexed) */
      readonly iteration: number;
    }
  | {
      /**
       * Execution was cancelled externally.
       * Fired when ReactiveAgent.stop() is called during execution.
       */
      readonly _tag: "ExecutionCancelled";
      /** Unique task identifier */
      readonly taskId: string;
    }
  // ─── Memory events (from @reactive-agents/memory) ───
  | {
      /**
       * Memory service initialized and loaded prior state.
       * Fired when MemoryService.bootstrap() completes successfully.
       */
      readonly _tag: "MemoryBootstrapped";
      /** Agent identifier */
      readonly agentId: string;
      /** Memory tier that was bootstrapped: "working", "semantic", "episodic", "procedural" */
      readonly tier: string;
    }
  | {
      /**
       * Memory was flushed to persistent storage.
       * Fired after MemoryService.flush() writes all pending updates to disk.
       */
      readonly _tag: "MemoryFlushed";
      /** Agent identifier */
      readonly agentId: string;
    }
  | {
      /**
       * Memories were recalled into a run's context.
       * Fired when a run retrieves memory items (bootstrap, search, or tool recall).
       */
      readonly _tag: "MemoryRecalled";
      /** Unique task identifier of the run that recalled the items */
      readonly taskId: string;
      /** Agent identifier; absent when the recall is not attributable to one agent */
      readonly agentId?: string;
      /** Memory tier recalled from: "working", "semantic", "episodic", "procedural" */
      readonly tier: string;
      /** Recalled items, in rank order. Empty when the recall matched nothing. */
      readonly items: readonly {
        /** Stable identifier of the memory item */
        readonly id: string;
        /** Tier the item lives in */
        readonly tier: string;
        /** Short human-readable summary (truncated by the producer, not the full content) */
        readonly summary: string;
        /** Relevance score from the recall query; absent when the tier does not rank */
        readonly score?: number;
        /** Stored importance of the item; absent when the tier does not track it */
        readonly importance?: number;
      }[];
      /** The recall query as text; absent for non-query recalls such as bootstrap */
      readonly query?: string;
    }
  // ─── LLM events (from @reactive-agents/llm-provider) ───
  | {
      /**
       * An LLM request completed (succeeded or failed).
       * Fired after LLMService.complete() returns (in think phase).
       */
      readonly _tag: "LLMRequestCompleted";
      /** Unique task identifier */
      readonly taskId: string;
      /** Request ID for correlating request/response pairs */
      readonly requestId: string;
      /** LLM model used (e.g., "claude-opus-4-20250514", "gpt-4o") */
      readonly model: string;
      /** LLM provider (e.g., "anthropic", "openai", "ollama", "gemini") */
      readonly provider: string;
      /** Request round-trip time in milliseconds */
      readonly durationMs: number;
      /** Total tokens used in request + response */
      readonly tokensUsed: number;
      /** Input tokens (prompt) when the provider reports them; falls back to 70% estimate of tokensUsed at consumers when absent. */
      readonly tokensIn?: number;
      /** Output tokens (completion) when the provider reports them; falls back to 30% estimate of tokensUsed at consumers when absent. */
      readonly tokensOut?: number;
      /** True when the response was served from prompt cache (Anthropic ephemeral cache, OpenAI cached input, etc.). */
      readonly cached?: boolean;
      /**
       * Input tokens served from a prompt-cache hit, when the provider reports
       * them (Anthropic `cache_read_input_tokens`, OpenAI cached input).
       * Absent means "provider did not report", NOT "zero" — a consumer that
       * needs a number treats absent as 0 via `billedInputTokens`.
       */
      readonly cacheReadTokensIn?: number;
      /**
       * `(inputTokens - cacheReadTokensIn) + outputTokens`, clamped at zero on
       * the input half. The figure the lift gate's token leg scores
       * (2026-08-24 amendment §4). `tokensUsed` above stays RAW and is retained
       * on every receipt so historical reports stay readable.
       */
      readonly billedTokens?: number;
      /**
       * Stable hash of the cacheable prompt prefix (system block). When two
       * consecutive calls in one run disagree on this, the cache could not have
       * hit and the system block is the reason.
       */
      readonly promptPrefixHash?: string;
      /**
       * Stable hash of the ordered tool-schema surface sent on the wire. Tools
       * occupy position zero of the Anthropic cache prefix, so a change here
       * invalidates every downstream breakpoint (failure mode F10).
       */
      readonly toolSurfaceHash?: string;
      /**
       * Reasoning iteration that issued this call. Absent on older publishers.
       */
      readonly iteration?: number;
      /**
       * Tokens that wrote NEW entries to the provider's prompt cache on this
       * call (Anthropic `cache_creation_input_tokens`). Absent means "provider
       * did not report", NOT "zero".
       */
      readonly cacheCreationTokensIn?: number;
      /**
       * Hidden-reasoning tokens when the provider breaks them out
       * (OpenAI `completion_tokens_details.reasoning_tokens`). A SUBSET of
       * `tokensOut`, never additive — the provider already counts reasoning
       * inside the completion total. Absent means "provider did not report".
       */
      readonly reasoningTokens?: number;
      /**
       * Milliseconds from request start to the first streamed output token
       * (text, tool-call delta or any other output modality). Absent for
       * non-streamed calls and for streams that produced no output. Splits
       * `durationMs` into queue/prefill time (`firstTokenMs`) and generation
       * time (`durationMs - firstTokenMs`), so output tokens/sec is
       * `tokensOut / ((durationMs - firstTokenMs) / 1000)`. Use
       * `outputTokensPerSecond` rather than computing it inline.
       */
      readonly firstTokenMs?: number;
      /**
       * Cost of this call in USD. Absent means the price is unknown (the model
       * has no price entry and the provider reported no cost), NOT "free".
       * Never sum an absent value as 0 without marking the total as partial;
       * `priceSource` says where a present value came from.
       */
      readonly estimatedCost?: number;
      /**
       * Where `estimatedCost` came from. Absent on publishers that predate
       * this field (treat as unknown provenance). See `PriceSource`.
       */
      readonly priceSource?: PriceSource;
    }
  // ─── Tool execution events (from @reactive-agents/runtime) ───
  | {
      /**
       * A tool call was initiated.
       * Fired when ExecutionEngine enters the act phase and begins tool invocation.
       */
      readonly _tag: "ToolCallStarted";
      /** Unique task identifier */
      readonly taskId: string;
      /** Tool name (e.g., "file-read", "web-search", "code-execute") */
      readonly toolName: string;
      /** Unique tool call identifier for correlating start/completed pair */
      readonly callId: string;
      /** Iteration index (-1 before first iteration). Defaults to -1 when omitted. */
      readonly iteration?: number;
      /** Wall-clock timestamp (ms). Defaults to Date.now() when omitted. */
      readonly timestamp?: number;
      /** Optional rationale (v0.11.x) — model's "why" for choosing this tool. */
      readonly rationale?: import("../rationale.js").Rationale;
      /**
       * Arguments the tool is being called with (post-heal), when the emitter
       * has them. Lets UIs show long-running calls before they complete.
       * Absent when the emitter does not have the arguments.
       */
      readonly args?: unknown;
    }
  | {
      /**
       * A tool call completed.
       * Fired after tool handler returns, whether success or error.
       */
      readonly _tag: "ToolCallCompleted";
      /** Unique task identifier */
      readonly taskId: string;
      /** Tool name */
      readonly toolName: string;
      /** Unique tool call identifier matching ToolCallStarted */
      readonly callId: string;
      /** Tool execution duration in milliseconds */
      readonly durationMs: number;
      /** True if tool executed successfully, false if error */
      readonly success: boolean;
      /** Which kernel pass produced this call (e.g. "reflexion:generate", "plan-execute:step-2") */
      readonly kernelPass?: string;
      /** Iteration the call ran in. Absent on emitters that do not carry it. */
      readonly iteration?: number;
      /** Optional tool arguments (used by replay; may be omitted by emitters that don't carry args). */
      readonly args?: unknown;
      /** Optional tool result payload (used by replay; serialized form, may be truncated). */
      readonly result?: unknown;
      /** Optional error string when success=false. */
      readonly error?: string;
      /** True iff `result` was truncated by the emitter (size guard for trace bloat). */
      readonly resultTruncated?: boolean;
    }
  // ─── Phase completion events (from @reactive-agents/runtime) ───
  | {
      /**
       * A phase completed.
       * Fired when any of the 10 ExecutionEngine phases finishes.
       */
      readonly _tag: "ExecutionPhaseCompleted";
      /** Unique task identifier */
      readonly taskId: string;
      /** Phase name: "bootstrap", "guardrail", "strategy", "think", "act", "observe", "memory-flush", "verify", "audit", "complete" */
      readonly phase: string;
      /** Phase execution duration in milliseconds */
      readonly durationMs: number;
    }
  // ─── Reasoning step events (from @reactive-agents/reasoning) ───
  | {
      /**
       * A reasoning step completed.
       * Fired after each step in a reasoning strategy (ReAct iteration, ToT node, plan step, etc).
       * Emitted by the strategy via EventBus within the think phase.
       */
      readonly _tag: "ReasoningStepCompleted";
      /** Unique task identifier */
      readonly taskId: string;
      /** Reasoning strategy name: "reactive", "plan-execute", "tree-of-thought", "reflexion", "adaptive" */
      readonly strategy: string;
      /** Current step number within this execution */
      readonly step: number;
      /**
       * Kernel iteration (model turn, 0-based) that produced this step. Not the
       * same as `step`: one iteration can record several steps (thought, action,
       * observation). Absent for strategy control steps and older emitters;
       * consumers that group by turn should prefer it over `step`.
       */
      readonly iteration?: number;
      /** Total steps completed so far */
      readonly totalSteps: number;
      /** Model thought/reasoning text from this step (optional, depends on strategy) */
      readonly thought?: string;
      /**
       * `"kernel"` when the reasoning kernel produced this step (its `thought` is
       * the model's own reasoning for a turn). Absent = a strategy's own step
       * record (control narration such as plan / reflect markers): consumers that
       * show model thinking (the public stream, chat UIs) skip it; plans, goal
       * checks and switches reach them through their shared events instead.
       */
      readonly producedBy?: "kernel";
      /** Action/tool call text from this step (optional) */
      readonly action?: string;
      /** Tool result/observation from this step (optional) */
      readonly observation?: string;
      /** Which kernel pass produced this step (e.g. "reflexion:improve-1", "tree-of-thought:execute") */
      readonly kernelPass?: string;
      /** Full LLM prompt trace for debug observability (system + user message) */
      readonly prompt?: { readonly system: string; readonly user: string };
      /** Full FC conversation thread sent to the LLM — logged when logModelIO is enabled */
      readonly messages?: readonly { readonly role: string; readonly content: string }[];
      /** Raw LLM response content before any parsing — logged when logModelIO is enabled */
      readonly rawResponse?: string;
      /**
       * Strategy-specific structured payload (ToT node/path, code-action code and
       * result, reflexion critique) for live visuals. Absent for steps that carry
       * only text and for older emitters; consumers must tolerate unknown `kind`s.
       */
      readonly structured?: ReasoningStepData;
    }
  // ─── Iteration progress (from @reactive-agents/reasoning) ───
  | {
      /**
       * A reasoning iteration completed within the kernel loop.
       * Fired after each Think→Act→Observe cycle, enabling real-time progress reporting.
       */
      readonly _tag: "ReasoningIterationProgress";
      /** Unique task identifier */
      readonly taskId: string;
      /** Current iteration number (1-based) */
      readonly iteration: number;
      /** Max iterations allowed for this execution */
      readonly maxIterations: number;
      /** Active reasoning strategy */
      readonly strategy: string;
      /** Tool names called in this iteration (may be empty if pure thinking step) */
      readonly toolsThisStep: readonly string[];
    }
  // ─── Agent lifecycle events (from @reactive-agents/guardrails) ───
  | {
      /**
       * Agent execution was paused.
       * Fired when ReactiveAgent.pause() completes successfully.
       */
      readonly _tag: "AgentPaused";
      /** Agent identifier */
      readonly agentId: string;
      /** Unique task identifier for correlation */
      readonly taskId: string;
    }
  | {
      /**
       * Agent execution was resumed.
       * Fired when ReactiveAgent.resume() completes successfully.
       */
      readonly _tag: "AgentResumed";
      /** Agent identifier */
      readonly agentId: string;
      /** Unique task identifier for correlation */
      readonly taskId: string;
    }
  | {
      /**
       * Agent stopping was initiated.
       * Fired when ReactiveAgent.stop() is called (before actual termination).
       */
      readonly _tag: "AgentStopping";
      /** Agent identifier */
      readonly agentId: string;
      /** Unique task identifier for correlation */
      readonly taskId: string;
      /** Reason for stopping (e.g., "user_requested", "timeout") */
      readonly reason: string;
    }
  | {
      /**
       * Agent execution stopped cleanly.
       * Fired when ReactiveAgent.stop() completes (graceful shutdown).
       */
      readonly _tag: "AgentStopped";
      /** Agent identifier */
      readonly agentId: string;
      /** Unique task identifier for correlation */
      readonly taskId: string;
      /** Reason for stopping */
      readonly reason: string;
    }
  | {
      /**
       * Agent was forcibly terminated.
       * Fired when ReactiveAgent.terminate() completes (force kill).
       */
      readonly _tag: "AgentTerminated";
      /** Agent identifier */
      readonly agentId: string;
      /** Unique task identifier for correlation */
      readonly taskId: string;
      /** Reason for termination */
      readonly reason: string;
    }
  // ─── Execution lifecycle (bookends) ───
  | {
      /**
       * Agent execution started.
       * Fired at the very beginning of ReactiveAgent.run() or agent.execute().
       * Bookend pair with AgentCompleted.
       */
      readonly _tag: "AgentStarted";
      /** Unique task identifier correlating all events for this execution */
      readonly taskId: string;
      /** Agent identifier */
      readonly agentId: string;
      /** LLM provider name */
      readonly provider: string;
      /** LLM model name (may be updated after first LLM response) */
      readonly model: string;
      /** Unix timestamp in milliseconds when execution started */
      readonly timestamp: number;
      /** Agent ID of the parent that spawned this sub-agent (undefined for top-level agents) */
      readonly parentAgentId?: string;
      /** Human label for UI (e.g. Cortex desk name); omitted for auto-generated desk placeholders */
      readonly agentDisplayName?: string;
      /** D-2026-10-28-RUNID-STAMP: this run's OWN `RunContext.runId` (a delegated
       *  child's minted id). Lets `makeRunTree` link grandchildren exactly instead
       *  of inferring from the `<parent.runId>.<name>-<8hex>` shape. Absent at the
       *  root (where runId === taskId) and on legacy emitters. */
      readonly runId?: string;
      /** B8-T3b: the top-most run in this delegation tree (RunContext.rootRunId).
       *  Undefined for legacy/hand-rolled events; the trace normalizer falls back
       *  to the run's own id. Lets a JSONL filter group a run with all it spawned. */
      readonly rootRunId?: string;
      /** B8-T3b: the run that spawned this one (RunContext.parentRunId). */
      readonly parentRunId?: string;
      /** B8-T3b: delegation depth (RunContext.depth). 0 at the root, 1 for a
       *  directly-delegated sub-agent, etc. */
      readonly depth?: number;
      /**
       * GH #236: the run's prompt/task text, stamped at the emission site
       * so `run-started` trace events (and therefore `RecordedRun.task`)
       * carry the real task instead of "". Optional for backward-compat
       * with older emitters and hand-rolled test events; consumers fall
       * back to "" when absent. Capped at 64KB by the publisher
       * (execution-engine.ts) under the same payload budget convention as
       * `AgentCompleted.output` (see run-finalize.ts `RUN_OUTPUT_CAP`);
       * `taskTruncated` marks a clip.
       */
      readonly task?: string;
      /** True iff `task` was clipped to the 64KB publisher cap. */
      readonly taskTruncated?: boolean;
      /**
       * Plan 8: the run posture. Stamped ONLY for `"plan"` (the envelope's
       * `rails.posture`); absent === `"execute"`, so execute-run events stay
       * byte-identical. Forwarded to the `run-started` trace `config.posture`.
       */
      readonly posture?: "plan";
      /**
       * Who started this run (see `RunOrigin`). Absent on legacy emitters;
       * consumers treat absent as `"user"`. Forwarded to the `run-started`
       * trace event's `origin`.
       */
      readonly origin?: RunOrigin;
      /**
       * Resolved harness configuration for this run, shaped
       * `{ mechanisms, builder, env }` (deterministic key order, secret-free,
       * size-bounded). Forwarded to `run-started.config`. Absent on legacy
       * emitters.
       */
      readonly config?: Readonly<Record<string, unknown>>;
    }
  | {
      /**
       * Agent execution ended abnormally: the run's effect failed, crashed or
       * was interrupted without reaching `AgentCompleted`. A sentinel so a
       * trace never silently lacks a terminal event. Forwarded to the
       * `run-aborted` trace event.
       */
      readonly _tag: "AgentAborted";
      /** Unique task identifier matching AgentStarted */
      readonly taskId: string;
      /** Agent identifier */
      readonly agentId: string;
      /** Cause class of the abnormal end. */
      readonly causeClass: RunAbortCause;
      /** Why the runtime knows the run ended (timeout / user-stop / terminate / abort); absent when unknown. */
      readonly reason?: RunAbortReason;
      /** Short error description (tag/message; never stack or payload). */
      readonly error?: string;
      /** Milliseconds from run start to abort. */
      readonly durationMs: number;
      /** Unix timestamp in milliseconds. */
      readonly timestamp: number;
      /** Delegation-tree correlation, mirroring `AgentStarted`. */
      readonly rootRunId?: string;
      readonly parentRunId?: string;
      readonly depth?: number;
    }
  | {
      /**
       * Agent execution completed.
       * Fired at the very end of ReactiveAgent.run() or agent.execute(), after all cleanup.
       * Bookend pair with AgentStarted.
       */
      readonly _tag: "AgentCompleted";
      /** Unique task identifier matching AgentStarted */
      readonly taskId: string;
      /** Agent identifier */
      readonly agentId: string;
      /** True if execution succeeded without fatal errors, false otherwise */
      readonly success: boolean;
      /** Total reasoning loop iterations completed */
      readonly totalIterations: number;
      /** Total tokens used across all LLM calls */
      readonly totalTokens: number;
      /** Total execution duration in milliseconds */
      readonly durationMs: number;
      /** Error message when `success` is false. */
      readonly error?: string;
      /**
       * Final deliverable output of the run (replay-rail W-C, 2026-07-11).
       * Capped at 64KB by the publisher (run-finalize.ts) with
       * `outputTruncated: true` when clipped. Optional so older publishers
       * and hand-rolled test events stay valid. Consumed by the trace bridge
       * so `run-completed` trace events carry the deliverable — without it,
       * replay `diffTraces().outputDiff` was structurally blind.
       */
      readonly output?: string;
      /** True iff `output` was clipped to the 64KB cap. */
      readonly outputTruncated?: boolean;
      /**
       * Public run outcome, the same value as `AgentResult.outcome`: `"success"`,
       * `"partial"` (a model draft with unmet items), `"failed"` (cause on
       * `error`, output empty) or `"abstained"` (the agent declined honestly;
       * reason on `error`). Absent on a paused run and from older publishers.
       * Unlike `outcome.status` (the kernel's minted status), this reflects any
       * runtime veto applied after the kernel finished.
       */
      readonly runOutcome?: "success" | "partial" | "failed" | "abstained";
      /**
       * Files and other deliverables the run produced (verified receipts).
       * Read these when `output` is empty because the deliverable is a file.
       */
      readonly deliverables?: readonly DeliverableReceipt[];
      /**
       * Plan 8 K1: the ONE reconciled terminal outcome (status, termination,
       * deliverable provenance, gate verdict, answer-satisfied, success claim),
       * lifted from the strategy result's `metadata.extensions.terminalOutcome`.
       * Structural twin of the trace `RunOutcome` (core is the foundation and
       * cannot import trace). Absent when the strategy minted no outcome.
       */
      readonly outcome?: {
        readonly status: "completed" | "partial" | "abstained" | "failed";
        readonly terminatedBy: string | null;
        readonly provenance: "model-final" | "synthesized" | "tool-artifact" | "sentinel" | "none";
        readonly verdict: { readonly accepted: boolean; readonly summary: string } | null;
        readonly answerSatisfied: boolean | null;
        readonly success: boolean;
        /**
         * The ONE recorded authority that owns the final status. The kernel's
         * authority, or a `runtime-verifier-gate` / `runtime-success-veto:<which>`
         * value when the runtime flipped the status after the kernel finished.
         */
        readonly authority?: string;
        /** The kernel's own authority, present only when a runtime authority replaced it. */
        readonly kernelAuthority?: string;
        /** The terminal gate's DECISION on the deliverable (separate from the verifier verdict). */
        readonly deliverable?: { readonly outcome: "pass" | "block"; readonly reason: string; readonly accepted: boolean } | null;
        /** The verifier's own verdict (`verified` + failed check names). */
        readonly verifierVerdict?: { readonly verified: boolean; readonly failedChecks: readonly string[] } | null;
        /** Requirement/check ids that kept the status from `completed`. */
        readonly outstanding?: readonly string[];
        /** Class of the provider error that ended the run (authority `error`). */
        readonly errorClass?: string;
        /** Reconciled status the kernel supported at terminal-decision time. */
        readonly finalStatus?: string;
        /** Deterministic reason the runtime shipped its final status (agrees / vetoed-by / tolerated). */
        readonly statusReason?: string;
        /** True exactly when the runtime tolerance lane shipped success over a kernel `partial`. */
        readonly tolerated?: boolean;
        /** Which tolerance lane fired (e.g. `partial-substantive-output`); present iff `tolerated`. */
        readonly toleratedBy?: string;
      };
      /**
       * Raw termination reason from `state.meta.terminatedBy`. Carries the
       * full dynamic reason string for killswitch aborts (e.g.
       * `"budget-limit:tokens:1000/512"`, `"max-iterations:5"`,
       * `"timeout-after:10ms"`) AND the enumerable `TerminateReason` values
       * for kernel-driven termination paths. Distinct from
       * `TaskResult.metadata.terminatedBy` which is normalized to the
       * closed `TerminatedBy` schema (5 values).
       */
      readonly terminationReason?: string;
      /**
       * Run cost in USD (`result.metadata.cost`): the spend known when the
       * result was built. It excludes the background debrief LLM call, which
       * runs after this event; the billed run total (debrief included) is on
       * the run's `RunCostFinalized` event. A lower bound when `costComplete`
       * is `false`. Absent from older publishers and when no cost was metered.
       */
      readonly totalCostUsd?: number;
      /**
       * `false` when at least one LLM call in `totalCostUsd` had an unknown
       * price, so `totalCostUsd` understates the spend. Absent means complete
       * (every call was priced) or a publisher that predates this field.
       */
      readonly costComplete?: boolean;
      /** Signal-consumption tally (2026-10-25). Optional so older publishers stay valid. */
      readonly signals?: {
        readonly opened: number
        readonly rendered: number
        readonly remediated: number
        readonly ignored: number
        readonly contradicted: number
        readonly ambiguous: number
        readonly unobserved: number
      };
      /** D-2026-10-28-RUNID-STAMP: this run's OWN `RunContext.runId` (a delegated
       *  child's minted id). Lets `makeRunTree` link grandchildren exactly instead
       *  of inferring from the `<parent.runId>.<name>-<8hex>` shape. Absent at the
       *  root (where runId === taskId) and on legacy emitters. */
      readonly runId?: string;
      /** B8-T3b: the top-most run in this delegation tree (RunContext.rootRunId). */
      readonly rootRunId?: string;
      /** B8-T3b: the run that spawned this one (RunContext.parentRunId). */
      readonly parentRunId?: string;
      /** B8-T3b: delegation depth (RunContext.depth). */
      readonly depth?: number;
    }
  | {
      /**
       * The run's final billed cost, published exactly once per run, with or
       * without a debrief. Read the run's total from this event, not from
       * `AgentCompleted.totalCostUsd` (which excludes the background debrief
       * call). On a run with a debrief LLM call it fires after that call
       * settles, so it can arrive after `AgentCompleted` and
       * `DebriefCompleted`; on a run without one it may fire right after
       * `AgentCompleted`.
       */
      readonly _tag: "RunCostFinalized";
      /** Task identifier matching the run's `AgentStarted` / `AgentCompleted`. */
      readonly taskId: string;
      /** Agent identifier. */
      readonly agentId: string;
      /**
       * This run's own `RunContext.runId` when it differs from `taskId` (a
       * delegated child). Absent at the root, where `runId === taskId`.
       */
      readonly runId?: string;
      /**
       * Total billed USD for the run: the answer's spend plus the debrief
       * synthesis call when one ran. A lower bound when `costComplete` is
       * `false`; never read it as the full spend without checking that flag.
       */
      readonly totalCostUsd: number;
      /**
       * `true` when every LLM call in the run (debrief included) had a known
       * price. `false` when any call's price was unknown, so `totalCostUsd`
       * counts that call as nothing and understates the spend.
       */
      readonly costComplete: boolean;
    }
  // ─── LLM request lifecycle ───
  | {
      /**
       * An LLM request was initiated.
       * Fired when LLMService.complete() is called (before the request is sent).
       * Bookend pair with LLMRequestCompleted.
       */
      readonly _tag: "LLMRequestStarted";
      /** Unique task identifier */
      readonly taskId: string;
      /** Request ID for correlating start/completed pair */
      readonly requestId: string;
      /** LLM model being called */
      readonly model: string;
      /** LLM provider */
      readonly provider: string;
      /**
       * Context window size (tokens) being sent to the LLM. Optional: the
       * pre-call chokepoint (observable-llm.ts) has no honest way to measure
       * this before the provider call runs (no char/4 heuristic — that would
       * be a fabricated estimate presented as a measurement), so it omits the
       * field rather than invent one. Consumers (the OTel tracer) must guard
       * for absence.
       */
      readonly contextSize?: number;
    }
  // ─── Final answer milestone ───
  | {
      /**
       * The reasoning strategy produced a final answer.
       * Fired when the reasoning loop terminates with a conclusion (not early exit or max iterations).
       */
      readonly _tag: "FinalAnswerProduced";
      /** Unique task identifier */
      readonly taskId: string;
      /** Reasoning strategy that produced the answer */
      readonly strategy: string;
      /** The final answer text */
      readonly answer: string;
      /** Iteration number at which final answer was produced */
      readonly iteration: number;
      /** Total tokens used up to this point */
      readonly totalTokens: number;
      /** Which kernel pass produced this answer (e.g. "reflexion:generate", "plan-execute:step-2") */
      readonly kernelPass?: string;
    }
  // ─── Reasoning failure event ───
  | {
      /**
       * The reasoning kernel terminated with a failure status.
       * Fired by the kernel runner when status === "failed" (not "done").
       * Enables observability of reasoning failures distinct from task-level failures.
       */
      readonly _tag: "ReasoningFailed";
      /** Unique task identifier */
      readonly taskId: string;
      /** Active reasoning strategy at time of failure */
      readonly strategy: string;
      /** Error message describing the failure */
      readonly error: string;
      /** Iteration number at which the failure occurred */
      readonly iteration: number;
    }
  // ─── Safety / guardrail events ───
  | {
      /**
       * A guardrail check detected policy violations.
       * Fired by GuardrailService after running injection/PII/toxicity/jailbreak checks.
       */
      readonly _tag: "GuardrailViolationDetected";
      /** Unique task identifier */
      readonly taskId: string;
      /** Array of violation types detected (e.g., ["injection", "pii"]) */
      readonly violations: readonly string[];
      /** Aggregate violation score (0-1) */
      readonly score: number;
      /** True if violations were severe enough to block execution */
      readonly blocked: boolean;
    }
  | {
      /**
       * The judgment battery (Task 11) saw a probability in the review band
       * (above `judgmentReviewThreshold`, below `judgmentActionThreshold`) —
       * flagged for human/downstream review without blocking. Fired by
       * `GuardrailService.check()` when `enableJudgmentBattery` is set.
       */
      readonly _tag: "GuardrailReviewFlagged";
      readonly side: "input" | "output";
      /** Which battery question triggered the review band, e.g. "injection", "pii_exposure", "toxicity", "jailbreak_roleplay". */
      readonly dimension: string;
      /** That dimension's Noul probability. */
      readonly probability: number;
      readonly severity: "low" | "medium" | "high" | "critical";
    }
  | {
      /**
       * Observability-only output-side judgment screening (Task 11 Step 3) —
       * fired by `GuardrailService.checkOutput()` when `screenOutputs` is
       * set. Never blocks or alters the returned `GuardrailResult`;
       * enforcement is a follow-up task.
       */
      readonly _tag: "GuardrailOutputFlagged";
      readonly injection: number;
      readonly piiExposure: number;
      readonly toxicity: number;
      readonly jailbreakRoleplay: number;
      readonly severity: "low" | "medium" | "high" | "critical";
    };
