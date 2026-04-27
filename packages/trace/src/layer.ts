// packages/trace/src/layer.ts
import { Effect, Layer } from "effect"
import { EventBus } from "@reactive-agents/core"
import type { AgentEvent } from "@reactive-agents/core"
import { TraceRecorderService } from "./recorder.js"
import type {
  TraceEvent,
  RunStartedEvent,
  RunCompletedEvent,
  EntropyScoredEvent,
  DecisionEvaluatedEvent,
  StrategySwitchedEvent,
  InterventionDispatchedEvent,
  InterventionSuppressedEvent,
  KernelStateSnapshotEvent,
  VerifierVerdictEvent,
  GuardFiredEvent,
  LLMExchangeEvent,
  HarnessSignalInjectedEvent,
} from "./events.js"
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";

// ─── Sequence counter ───

// Global monotonic counter — intentionally cross-run so batch-analysis tooling
// can sort events from multiple runs without per-run clocks. seq is unique within
// a single process lifetime. For per-run monotonicity, use the runId+seq pair.
let globalSeq = 0
function nextSeq(): number {
  return globalSeq++
}

// ─── Event mapping ───

function toTraceEvent(raw: AgentEvent): TraceEvent | null {
  switch (raw._tag) {
    case "AgentStarted": {
      const ev: RunStartedEvent = {
        kind: "run-started",
        runId: raw.taskId,
        timestamp: raw.timestamp,
        iter: -1,
        seq: nextSeq(),
        task: "",
        model: raw.model,
        provider: raw.provider,
        config: {},
      }
      return ev
    }

    case "AgentCompleted": {
      const ev: RunCompletedEvent = {
        kind: "run-completed",
        runId: raw.taskId,
        timestamp: Date.now(),
        iter: -1,
        seq: nextSeq(),
        status: raw.success ? "success" : "failure",
        error: raw.error,
        totalTokens: raw.totalTokens,
        totalCostUsd: 0,
        durationMs: raw.durationMs,
      }
      return ev
    }

    case "EntropyScored": {
      const ev: EntropyScoredEvent = {
        kind: "entropy-scored",
        runId: raw.taskId,
        timestamp: Date.now(),
        iter: raw.iteration,
        seq: nextSeq(),
        composite: raw.composite,
        sources: {
          token: raw.sources.token ?? 0,
          structural: raw.sources.structural,
          semantic: raw.sources.semantic ?? 0,
          behavioral: raw.sources.behavioral,
          contextPressure: raw.sources.contextPressure,
        },
      }
      return ev
    }

    case "ReactiveDecision": {
      const hasImprovement = typeof raw.entropyAfter === "number" && typeof raw.entropyBefore === "number" && raw.entropyAfter < raw.entropyBefore
      const ev: DecisionEvaluatedEvent = {
        kind: "decision-evaluated",
        runId: raw.taskId,
        timestamp: Date.now(),
        iter: raw.iteration,
        seq: nextSeq(),
        decisionType: raw.decision,
        confidence: hasImprovement ? Math.max(0, 1 - (raw.entropyAfter as number) / (raw.entropyBefore as number)) : 0,
        reason: raw.reason,
      }
      return ev
    }

    case "StrategySwitched": {
      const ev: StrategySwitchedEvent = {
        kind: "strategy-switched",
        runId: raw.taskId,
        timestamp: raw.timestamp,
        iter: -1,
        seq: nextSeq(),
        from: raw.from,
        to: raw.to,
        reason: raw.reason,
      }
      return ev
    }

    case "InterventionDispatched": {
      const ev: InterventionDispatchedEvent = {
        kind: "intervention-dispatched",
        runId: raw.taskId,
        timestamp: Date.now(),
        iter: raw.iteration,
        seq: nextSeq(),
        decisionType: raw.decisionType,
        patchKind: raw.patchKind,
        cost: raw.cost,
        telemetry: raw.telemetry,
      }
      return ev
    }

    case "InterventionSuppressed": {
      const ev: InterventionSuppressedEvent = {
        kind: "intervention-suppressed",
        runId: raw.taskId,
        timestamp: Date.now(),
        iter: raw.iteration,
        seq: nextSeq(),
        decisionType: raw.decisionType,
        reason: raw.reason,
      }
      return ev
    }

    // ─── Diagnostic events (Sprint 3.6) ───
    case "KernelStateSnapshotEmitted": {
      const ev: KernelStateSnapshotEvent = {
        kind: "kernel-state-snapshot",
        runId: raw.taskId,
        timestamp: raw.timestamp,
        iter: raw.iteration,
        seq: nextSeq(),
        status: raw.status,
        toolsUsed: raw.toolsUsed,
        scratchpadKeys: raw.scratchpadKeys,
        stepsCount: raw.stepsCount,
        stepsByType: raw.stepsByType,
        outputPreview: raw.outputPreview,
        outputLen: raw.outputLen,
        messagesCount: raw.messagesCount,
        tokens: raw.tokens,
        cost: raw.cost,
        llmCalls: raw.llmCalls,
        terminatedBy: raw.terminatedBy,
        pendingGuidance: raw.pendingGuidance,
      }
      return ev
    }

    case "VerifierVerdictEmitted": {
      const ev: VerifierVerdictEvent = {
        kind: "verifier-verdict",
        runId: raw.taskId,
        timestamp: raw.timestamp,
        iter: raw.iteration,
        seq: nextSeq(),
        action: raw.action,
        terminal: raw.terminal,
        verified: raw.verified,
        summary: raw.summary,
        checks: raw.checks,
      }
      return ev
    }

    case "GuardFiredEmitted": {
      const ev: GuardFiredEvent = {
        kind: "guard-fired",
        runId: raw.taskId,
        timestamp: raw.timestamp,
        iter: raw.iteration,
        seq: nextSeq(),
        guard: raw.guard,
        outcome: raw.outcome,
        reason: raw.reason,
        metadata: raw.metadata,
      }
      return ev
    }

    case "LLMExchangeEmitted": {
      const ev: LLMExchangeEvent = {
        kind: "llm-exchange",
        runId: raw.taskId,
        timestamp: raw.timestamp,
        iter: raw.iteration,
        seq: nextSeq(),
        provider: raw.provider,
        model: raw.model,
        requestKind: raw.requestKind,
        systemPrompt: raw.systemPrompt,
        systemPromptTruncated: raw.systemPromptTruncated,
        messages: raw.messages,
        toolSchemaNames: raw.toolSchemaNames,
        temperature: raw.temperature,
        maxTokens: raw.maxTokens,
        response: raw.response,
      }
      return ev
    }

    case "HarnessSignalInjectedEmitted": {
      const ev: HarnessSignalInjectedEvent = {
        kind: "harness-signal-injected",
        runId: raw.taskId,
        timestamp: raw.timestamp,
        iter: raw.iteration,
        seq: nextSeq(),
        signalKind: raw.signalKind,
        origin: raw.origin,
        contentPreview: raw.contentPreview,
        contentLen: raw.contentLen,
        metadata: raw.metadata,
      }
      return ev
    }

    default:
      return null
  }
}

// ─── Layer ───

/**
 * TraceBridgeLayer — subscribes to the EventBus and converts reactive events
 * into TraceEvents recorded by the TraceRecorderService.
 *
 * Requires: EventBus, TraceRecorderService
 *
 * Lifecycle: subscription is registered when the layer scope opens and
 * automatically unregistered when the scope closes.
 */
export const TraceBridgeLayer: Layer.Layer<
  never,
  never,
  EventBus | TraceRecorderService
> = Layer.scopedDiscard(
  Effect.gen(function* () {
    const bus = yield* EventBus
    const recorder = yield* TraceRecorderService

    const handler = (event: AgentEvent): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        const traced = toTraceEvent(event)
        if (traced !== null) {
          yield* recorder.emit(traced)
        }
        // Flush pending events to disk when a run ends
        if (event._tag === "AgentCompleted" || event._tag === "TaskFailed") {
          yield* recorder.flush(event.taskId)
        }
      })

    const unsubscribe = yield* bus.subscribe(handler)

    yield* Effect.addFinalizer(() =>
      recorder.flushAll().pipe(
        Effect.catchAll((err) => emitErrorSwallowed({ site: "trace/src/layer.ts:179", tag: errorTag(err) })),
        Effect.andThen(Effect.sync(() => unsubscribe())),
      )
    )
  })
)
