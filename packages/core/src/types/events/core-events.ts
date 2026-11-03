
import type { RunOrigin, RunAbortCause, RunAbortReason } from "../origin.js";

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
      /** Estimated cost in USD */
      readonly estimatedCost: number;
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
      /** Total steps completed so far */
      readonly totalSteps: number;
      /** Model thought/reasoning text from this step (optional, depends on strategy) */
      readonly thought?: string;
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
      /** Run cost in USD (result.metadata.cost) — optional so older publishers stay valid. */
      readonly totalCostUsd?: number;
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
