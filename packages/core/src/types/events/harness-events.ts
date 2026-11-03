import type {
  LlmCallPurpose,
} from "../llm-purpose.js";

/** Strategy switching, streaming, silent-failure and diagnostic/signal events. */
export type HarnessAgentEvent =
  // ─── Strategy switching events (from @reactive-agents/reasoning) ───
  | {
      /**
       * A strategy switch evaluator ran and produced a recommendation.
       * Fired regardless of whether the evaluator decided to switch — allows
       * observing "evaluator ran but decided not to switch" scenarios.
       */
      readonly _tag: "StrategySwitchEvaluated";
      /** Unique task identifier */
      readonly taskId: string;
      /** Whether the evaluator recommends switching */
      readonly shouldSwitch: boolean;
      /** Strategy the evaluator recommends switching to (empty string if shouldSwitch is false) */
      readonly recommendedStrategy: string;
      /** Brief explanation from the evaluator */
      readonly reasoning: string;
      /** Unix timestamp in milliseconds */
      readonly timestamp: number;
    }
  | {
      /**
       * A strategy switch actually occurred.
       * Fired when the kernel transitions from one reasoning strategy to another.
       */
      readonly _tag: "StrategySwitched";
      /** Unique task identifier */
      readonly taskId: string;
      /** Strategy name being switched from */
      readonly from: string;
      /** Strategy name being switched to */
      readonly to: string;
      /** Human-readable reason for the switch */
      readonly reason: string;
      /** Unix timestamp in milliseconds */
      readonly timestamp: number;
      /** Iteration the switch happened at, when the emitter carries it. */
      readonly iteration?: number;
    }
  | {
      /**
       * An intervention handler fired and produced one or more state patches.
       * Fired from reactive-observer after the dispatcher applies a patch.
       */
      readonly _tag: "InterventionDispatched";
      /** Unique task identifier */
      readonly taskId: string;
      /** Kernel iteration at which the intervention fired */
      readonly iteration: number;
      /** The ControllerDecision type that triggered the handler (e.g. "early-stop") */
      readonly decisionType: string;
      /** The KernelStatePatch kind produced by the handler */
      readonly patchKind: string;
      /** Estimated cost of applying the patch */
      readonly cost: {
        readonly tokensEstimated: number;
        readonly latencyMsEstimated: number;
      };
      /** Handler-provided telemetry (e.g. compression ratio, strategy names) */
      readonly telemetry: Record<string, unknown>;
    }
  | {
      /**
       * A decision was suppressed by the dispatcher gating logic.
       * Fired from reactive-observer for each entry in DispatchResult.skipped.
       */
      readonly _tag: "InterventionSuppressed";
      /** Unique task identifier */
      readonly taskId: string;
      /** Kernel iteration at which suppression occurred */
      readonly iteration: number;
      /** The ControllerDecision type that was suppressed */
      readonly decisionType: string;
      /** Why it was suppressed */
      readonly reason:
        | "below-entropy-threshold"
        | "below-iteration-threshold"
        | "over-budget"
        | "max-fires-exceeded"
        | "mode-advisory"
        | "mode-off"
        | "no-handler";
    }
  | {
      /**
       * Published before an LLM call when Intelligent Context Synthesis produced
       * the messages for this iteration (full observability of model input).
       */
      readonly _tag: "ContextSynthesized";
      readonly taskId: string;
      readonly agentId: string;
      readonly iteration: number;
      readonly synthesisPath: "fast" | "deep" | "custom";
      readonly synthesisReason: string;
      readonly taskPhase: string;
      readonly estimatedTokens: number;
      readonly messages: readonly {
        readonly role: string;
        readonly content: string | null;
      }[];
      readonly signalsSnapshot: {
        readonly entropy: number | undefined;
        readonly trajectoryShape: string | undefined;
        readonly tier: string;
        readonly requiredTools: readonly string[];
        readonly toolsUsed: readonly string[];
        readonly iteration: number;
        readonly lastErrors: readonly string[];
      };
    }
  // ─── Streaming events ───
  | {
      /**
       * Agent stream started.
       * Fired at the beginning of agent.runStream() execution.
       */
      readonly _tag: "AgentStreamStarted";
      readonly taskId: string;
      readonly agentId: string;
      readonly density: string;
      readonly timestamp: number;
    }
  | {
      /**
       * Agent stream completed.
       * Fired when the stream reaches StreamCompleted or StreamError.
       */
      readonly _tag: "AgentStreamCompleted";
      readonly taskId: string;
      readonly agentId: string;
      readonly success: boolean;
      readonly durationMs: number;
    }
  // ─── Silent-failure instrumentation (Phase 0 S0.2) ───
  | {
      /**
       * A framework site caught and swallowed an error, preserving the
       * previous `Effect.catchAll(() => Effect.void)` behaviour while making
       * the swallow observable via telemetry.
       *
       * Emitted by the `emitErrorSwallowed` helper; every replacement of a
       * silent `catchAll` in production code publishes one of these.
       */
      readonly _tag: "ErrorSwallowed";
      /**
       * Canonical site identifier, formatted as
       * `<package-name>/<relative-file>:<line>`. Line numbers reflect the
       * pre-migration source position and do not update when adjacent code
       * shifts — treat the string as a stable identifier.
       */
      readonly site: string;
      /**
       * Error discriminator — typically the caught error's `_tag` or, for
       * native `Error` instances, the constructor name. Unknown inputs
       * surface as `"UnknownError"`.
       */
      readonly tag: string;
      /** Task identifier when the swallow occurred inside a task-scoped Effect. */
      readonly taskId?: string;
      /** Short human-readable error message, when known. Not redacted. */
      readonly message?: string;
      /** Unix timestamp in milliseconds when the swallow fired. */
      readonly timestamp: number;
    }
  // ─── Diagnostic events (Sprint 3.6 — harness diagnostic system) ───
  // Together these answer the diagnostic questions a developer asks when an
  // agent run goes wrong: what did the model see, why did the verifier
  // accept/reject, which guard fired and why, what was the kernel state at
  // iteration N, and which steps were harness-injected (not model-produced).
  // Mapped 1:1 by the trace bridge layer to TraceEvent kinds for JSONL
  // recording and Cortex UI consumption.
  | {
      readonly _tag: "KernelStateSnapshotEmitted";
      readonly taskId: string;
      readonly iteration: number;
      // Mirror of KernelStatus (kernel-state.ts:25). "paused" is reserved for
      // future explicit-pause flows; the active runtime emits the other 6.
      readonly status:
        | "thinking"
        | "acting"
        | "observing"
        | "done"
        | "failed"
        | "evaluating"
        | "paused";
      readonly toolsUsed: readonly string[];
      readonly scratchpadKeys: readonly string[];
      readonly stepsCount: number;
      readonly stepsByType: Readonly<Record<string, number>>;
      readonly outputPreview: string | null;
      readonly outputLen: number;
      readonly messagesCount: number;
      readonly tokens: number;
      readonly cost: number;
      readonly llmCalls: number;
      readonly terminatedBy: string | undefined;
      readonly pendingGuidance: Record<string, unknown> | undefined;
      readonly timestamp: number;
      /** Set iff terminatedBy is set; structured rationale (v0.11.x). */
      readonly terminationRationale?: import("../rationale.js").Rationale;
      /**
       * Identifier for the outer-loop site emitting the snapshot (HS-113 / E2).
       * Strategies that delegate to `runKernel(reactKernel)` get snapshots from
       * the inner kernel automatically. Strategies with their own outer loops
       * (plan-execute, tree-of-thought, reflexion) emit at each iteration
       * boundary with a string like `"plan-execute:plan"`, `"plan-execute:reflect"`,
       * `"tree-of-thought:explore"`, `"reflexion:improve"`. Absent => standard
       * inner-kernel snapshot.
       */
      readonly outerLoopName?: string;
      /** Outer-loop iteration counter when `outerLoopName` is set (HS-113 / E2). */
      readonly outerIter?: number;
    }
  | {
      /**
       * Model self-reported an assumption (v0.11.x). Emitted by the think-phase
       * assumption detector when phrases like "I assume X because Y" appear in
       * the model's reasoning.
       */
      readonly _tag: "AssumptionRecordedEmitted";
      readonly taskId: string;
      readonly iteration: number;
      readonly timestamp: number;
      readonly assumption: string;
      readonly rationale: import("../rationale.js").Rationale;
    }
  | {
      /**
       * Curator decided to keep / drop / compress / mark-untrusted an observation
       * or scratchpad entry (v0.11.x). Pairs the curator's trustLevel work with
       * a structured rationale for post-hoc debriefs.
       */
      readonly _tag: "CuratorDecisionEmitted";
      readonly taskId: string;
      readonly iteration: number;
      readonly timestamp: number;
      readonly action: "kept" | "dropped" | "compressed" | "marked-untrusted";
      readonly targetRef: string;
      readonly rationale: import("../rationale.js").Rationale;
    }
  | {
      /**
       * Per-iteration tool-surface resolution (Overhaul Phase 2, 2026-07-07):
       * which tools the model can see/call this turn and WHY each tool in the
       * augmented set is visible, hidden, or gate-narrowed. Turns rw-9-class
       * "why is this tool invisible" diagnoses into one trace line.
       */
      readonly _tag: "ToolSurfaceResolvedEmitted";
      readonly taskId: string;
      readonly iteration: number;
      readonly timestamp: number;
      readonly visible: readonly string[];
      readonly callable: readonly string[];
      readonly reasons: readonly { readonly tool: string; readonly reason: string }[];
    }
  | {
      /**
       * RunContract compiled at run start (meta-loop Phase 4a, 2026-07-08): the
       * typed answer to "what does DONE mean here" — the requirement + deliverable
       * set and the run horizon. Compiled ONCE and frozen; this event makes the
       * goal-compiler node of the meta-loop DAG replayable from one trace, the way
       * tool-surface-resolved made tool resolution replayable.
       */
      readonly _tag: "ContractCompiledEmitted";
      readonly taskId: string;
      readonly iteration: number;
      readonly timestamp: number;
      readonly requirements: readonly { readonly id: string; readonly kind: string }[];
      readonly deliverables: readonly { readonly id: string; readonly kind: string }[];
      readonly horizon: string;
    }
  | {
      /**
       * RunAssessment recomputed at an iteration (meta-loop Phase 5a, 2026-07-08):
       * the perception node of the meta-loop DAG. Surfaces where the run stands —
       * run phase, pace band, the one evidenceDelta progress currency, and the
       * requirement/deliverable tallies — so the contract → assessment → action
       * chain is replayable from one trace, the way contract-compiled made the
       * goal compiler replayable.
       */
      readonly _tag: "AssessmentEmitted";
      readonly taskId: string;
      readonly iteration: number;
      readonly timestamp: number;
      readonly phase: string;
      readonly band: string;
      readonly evidenceDelta: number;
      readonly requirementsSatisfied: number;
      readonly requirementsOutstanding: number;
      readonly deliverablesProduced: number;
      readonly deliverablesMissing: number;
      readonly burnRatio: number;
    }
  | {
      /**
       * The Projector rendered the LLM window (meta-loop Phase 4c, 2026-07-08):
       * the LAST node of the meta-loop DAG. Surfaces the rendered section names,
       * the refs reachable from the window (result_ref pointers / recall hints /
       * handoff seqs / requirement ids), the refs compaction dropped, and the
       * total rendered size — so the contract → assessment → projection chain is
       * replayable from one trace, the way `assessment` made perception replayable.
       */
      readonly _tag: "ProjectionRenderedEmitted";
      readonly taskId: string;
      readonly iteration: number;
      readonly timestamp: number;
      readonly sections: readonly string[];
      readonly refs: readonly string[];
      readonly droppedRefs: readonly string[];
      readonly chars: number;
      /**
       * R4 (2026-07-30) — tool-result compression detail for THIS render, so the
       * "a tool result was crushed from X to Y under budget B at window W" failure
       * class is visible in one trace/console line instead of RA_PROMPT_DUMP
       * archaeology. `window`/`tier` are the resolved capability the budgets came
       * from (the divergence signal: a 2048 window here vs a 32768 wire num_ctx
       * meant the budget/wire split that drove live fabrication, fixed 838935cb).
       * `compressions` lists only results the projector replaced with a
       * preview+ref (the interesting case); a render with none is a full-fidelity
       * turn. Optional — absent on non-assembly paths and pre-R4 replays.
       */
      readonly window?: number;
      readonly tier?: string;
      readonly compressions?: readonly {
        readonly tool: string;
        readonly rawChars: number;
        readonly shownChars: number;
        readonly budget: number;
      }[];
    }
  | {
      /**
       * Control plane resolved competing proposals into ONE action (meta-loop
       * Phase 5b, 2026-07-08, task F1): the action-selection node of the meta-loop
       * DAG. Surfaces the proposals in (source→action), the ONE action out, and
       * why — so the contract → assessment → CONTROL → action chain is replayable
       * from one trace, the way `assessment` made perception replayable.
       */
      readonly _tag: "ControlResolutionEmitted";
      readonly taskId: string;
      readonly iteration: number;
      readonly timestamp: number;
      readonly action: string;
      readonly reason: string;
      readonly proposals: readonly { readonly source: string; readonly action: string }[];
    }
  | {
      readonly _tag: "VerifierVerdictEmitted";
      readonly taskId: string;
      readonly iteration: number;
      /** Who ran the verdict: the kernel loop (default when absent) or the runtime result boundary. */
      readonly source?: "kernel" | "runtime";
      readonly action: string;
      readonly terminal: boolean;
      readonly verified: boolean;
      readonly summary: string;
      readonly checks: readonly {
        readonly name: string;
        readonly passed: boolean;
        readonly reason?: string;
      }[];
      readonly timestamp: number;
    }
  | {
      readonly _tag: "GuardFiredEmitted";
      readonly taskId: string;
      readonly iteration: number;
      readonly guard: string;
      readonly outcome: "pass" | "redirect" | "terminate" | "block" | "warn";
      readonly reason: string;
      readonly metadata?: Record<string, unknown>;
      readonly timestamp: number;
    }
  | {
      /**
       * Budget signal collected at the Arbitrator per-iteration (HS-128 /
       * Audit G-A / North Star v5.0 Pillar 6). Surfaces tokensUsed / costUsd
       * against any declared limits so trace consumers can see warnings
       * before exceedance and confirm budget_exceeded fires for the right
       * reason. `status: 'exceeded'` produces an Arbitrator pre-guard verdict
       * `exit-failure` with terminatedBy='budget_exceeded'.
       */
      readonly _tag: "BudgetSignalCollectedEmitted";
      readonly taskId: string;
      readonly iteration: number;
      readonly tokensUsed: number;
      readonly costUsd: number;
      readonly tokenLimit?: number;
      readonly costLimit?: number;
      readonly status: "ok" | "warning" | "exceeded";
      readonly reason?: string;
      readonly timestamp: number;
    }
  | {
      readonly _tag: "LLMExchangeEmitted";
      readonly taskId: string;
      readonly iteration: number;
      readonly provider: string;
      readonly model: string;
      readonly requestKind: "complete" | "stream" | "completeStructured";
      readonly systemPrompt: string | undefined;
      readonly systemPromptTruncated?: boolean;
      readonly messages: readonly {
        readonly role: "system" | "user" | "assistant" | "tool";
        readonly content: string;
        readonly truncated?: boolean;
      }[];
      readonly toolSchemaNames: readonly string[];
      /**
       * What this call was FOR (see {@link LlmCallPurpose}). Set by the kernel
       * LLM gateway on every mediated call; absent on direct, un-mediated ones.
       * Carrying it here is what makes token spend attributable to a SUBSYSTEM
       * ("synthesize is 40% of spend") rather than only to a run total.
       */
      readonly purpose?: LlmCallPurpose;
      readonly temperature?: number;
      readonly maxTokens?: number;
      /**
       * Stable hash of the cacheable system-prompt prefix (W2, pre-truncation).
       * Optional so call sites that do not compute it (tests, un-mediated
       * calls) stay valid.
       */
      readonly promptPrefixHash?: string;
      /** Stable hash of the ordered wire tool surface (W2). */
      readonly toolSurfaceHash?: string;
      readonly response: {
        readonly content: string;
        readonly truncated?: boolean;
        readonly toolCalls?: readonly { readonly name: string; readonly arguments?: unknown }[];
        readonly stopReason?: string;
        readonly tokensIn?: number;
        readonly tokensOut?: number;
        /** Anthropic prompt-caching: tokens that wrote new cache entries (Lever 1). */
        readonly cacheCreationTokensIn?: number;
        /** Anthropic prompt-caching: tokens served from cache hits. */
        readonly cacheReadTokensIn?: number;
        readonly costUsd?: number;
        readonly durationMs?: number;
        /**
         * Thinking forensics (W1.4): chars of thinking the model produced this
         * exchange (absent = channel produced none). Pair with `thinkingPreview`
         * so rax diagnose shows what the model actually reasoned.
         */
        readonly thinkingChars?: number;
        /** W1.4 forensics: capped preview of the thinking text (same budget as other trace payloads). */
        readonly thinkingPreview?: string;
        /**
         * Set only when the LLM call FAILED: the provider error's class and
         * message. Absent on every success.
         */
        readonly error?: { readonly class: string; readonly message: string };
      };
      readonly timestamp: number;
    }
  | {
      readonly _tag: "HarnessSignalInjectedEmitted";
      readonly taskId: string;
      readonly iteration: number;
      readonly signalKind:
        | "redirect"
        | "nudge"
        | "block"
        | "completion-gap"
        | "rule-violation"
        | "dispatcher-status"
        | "loop-graceful"
        | "other";
      readonly origin: string;
      readonly contentPreview: string;
      readonly contentLen: number;
      readonly metadata?: Record<string, unknown>;
      readonly timestamp: number;
      /** Signal consumption edge (2026-10-25). */
      readonly signalId?: string;
      readonly targetTool?: string;
      readonly targetPolicy?:
        | "denied-tool-retry"
        | "alternate-tool"
        | "synthesize"
        | "required-tool"
        | "other";
    }
  | SignalRenderedEmittedEvent
  | SignalEffectEmittedEvent
  | LedgerEntryAppendedEvent
  | ChecklistInferredEvent
  | EnvironmentChangedEvent;


/**
 * A batch of RunLedger entries was appended at the kernel runner's iteration
 * boundary (Wave C.1 slice 3 — live ledger tap). `KernelHooks.onLedgerAppend`
 * fires this exactly once per entry, in ledger `seq` order, at
 * `packages/reasoning/src/kernel/loop/runner.ts` — never twice (a
 * durable-resumed run tracks how much of the ledger it already published in a
 * prior process and only publishes the delta).
 *
 * `entries` is typed structurally as `Record<string, unknown>` rather than the
 * reasoning package's `LedgerEntry` union — `@reactive-agents/core` does not
 * depend on `@reactive-agents/reasoning`. Every concrete `LedgerEntry` variant
 * (tool-invocation, tool-result, artifact, requirement, claim, verdict,
 * harness-signal, handoff, compaction-marker) structurally satisfies this
 * shape; consumers that need the narrow kinds re-import `LedgerEntry` from the
 * reasoning package and narrow on `entries[i].kind`.
 */
export interface LedgerEntryAppendedEvent {
  readonly _tag: "LedgerEntryAppended";
  readonly agentId: string;
  readonly taskId: string;
  readonly entries: ReadonlyArray<Record<string, unknown>>;
  /** Seed batch republished once at resume; incremental consumers must not re-count it. */
  readonly restored?: true;
  readonly timestamp: number;
}

/**
 * An advisory checklist item was inferred done from ledger evidence (display-side;
 * never model-visible). One event per (item, evidence) pair, emitted when it first
 * appears in a projected snapshot.
 */
export interface ChecklistInferredEvent {
  readonly _tag: "ChecklistInferred";
  readonly taskId: string;
  readonly itemId: string;
  /** Checklist group key the item lives in (`"root"` or a sub-agent path). */
  readonly groupKey: string;
  readonly evidence: {
    readonly seq: number;
    readonly kind: "tool-result" | "artifact" | "requirement";
    readonly detail: string;
  };
  readonly iteration: number;
  readonly timestamp: number;
}

/** Kinds of between-turn environment change the chat engine can detect. */
export type EnvironmentChangeKind =
  | "tools"
  | "model"
  | "thinking"
  | "skills"
  | "docs"
  | "goal"
  | "agent-control"
  | "todo-user-edit";

/**
 * The chat environment (tools, model, skills, docs, goal, to-do edits...) differs
 * from the end of the previous turn. Emitted once per turn START with a non-empty
 * diff; the rendered notice rides the run envelope to the model. Deterministic:
 * computed by snapshot diff, never by a model call.
 */
export interface EnvironmentChangedEvent {
  readonly _tag: "EnvironmentChanged";
  readonly sessionId: string;
  /** One entry per change, in stable order; `summary` is a one-line model-neutral fact. */
  readonly changes: ReadonlyArray<{
    readonly kind: EnvironmentChangeKind;
    readonly summary: string;
  }>;
  readonly timestamp: number;
}

export interface SignalRenderedEmittedEvent {
  readonly _tag: "SignalRenderedEmitted";
  readonly taskId: string;
  readonly iteration: number;
  readonly signalId: string;
  readonly renderedInIter: number;
  readonly renderedSection: "guidance";
  readonly timestamp: number;
}

export interface SignalEffectEmittedEvent {
  readonly _tag: "SignalEffectEmitted";
  readonly taskId: string;
  readonly iteration: number;
  readonly signalId: string;
  readonly response: "remediated" | "ignored" | "contradicted" | "ambiguous";
  readonly observedTool?: string;
  readonly observedSubject?: string;
  readonly detail?: string;
  readonly timestamp: number;
}
