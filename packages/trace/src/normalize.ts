// packages/trace/src/normalize.ts
//
// Pure, Effect-free mapper from raw AgentEvents to the shared TraceEvent
// taxonomy. This module imports ONLY types (via `import type`) so it can be
// bundled into a browser context without pulling in `node:fs/promises` (which
// recorder.ts / replay.ts reach for at the package root).
//
// The `seq` is injected by the caller so this module stays free of any process
// global state — the recorder owns the monotonic counter (see layer.ts).

import type { AgentEvent } from "@reactive-agents/core";
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
  ToolCallEvent,
  AssumptionRecordedEvent,
  CuratorDecisionEvent,
  AlternativesConsideredEvent,
  ToolSurfaceResolvedEvent,
  ContractCompiledEvent,
  AssessmentEvent,
  ProjectionRenderedEvent,
  ControlResolutionEvent,
} from "./events.js";

export function toTraceEvent(raw: AgentEvent, seq: number): TraceEvent | null {
  switch (raw._tag) {
    case "AgentStarted": {
      const ev: RunStartedEvent = {
        kind: "run-started",
        runId: raw.taskId,
        timestamp: raw.timestamp,
        iter: -1,
        seq,
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
        seq,
        status: raw.success ? "success" : "failure",
        error: raw.error,
        // Final deliverable (replay-rail W-C): the publisher caps at 64KB and
        // sets outputTruncated. Without this mapping, run-completed carried no
        // output and replay's diffTraces().outputDiff was structurally blind.
        ...(raw.output !== undefined ? { output: raw.output } : {}),
        ...(raw.outputTruncated === true ? { outputTruncated: true } : {}),
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
        seq,
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
        seq,
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
        seq,
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
        seq,
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
        seq,
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
        seq,
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
        ...(raw.terminationRationale ? { terminationRationale: raw.terminationRationale } : {}),
      }
      return ev
    }

    case "VerifierVerdictEmitted": {
      const ev: VerifierVerdictEvent = {
        kind: "verifier-verdict",
        runId: raw.taskId,
        timestamp: raw.timestamp,
        iter: raw.iteration,
        seq,
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
        seq,
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
        seq,
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

    case "ToolCallStarted": {
      const ev: ToolCallEvent = {
        kind: "tool-call-start",
        runId: raw.taskId,
        timestamp: raw.timestamp ?? Date.now(),
        iter: raw.iteration ?? -1,
        seq,
        toolName: raw.toolName,
        ...(raw.rationale ? { rationale: raw.rationale } : {}),
      }
      return ev
    }

    case "ToolCallCompleted": {
      const truncate = (v: unknown): { value: unknown; truncated: boolean } => {
        try {
          const s = JSON.stringify(v)
          if (s === undefined) return { value: { replayUnserializable: true }, truncated: true }
          if (s.length > 8 * 1024) return { value: s.slice(0, 8 * 1024), truncated: true }
          return { value: v, truncated: false }
        } catch {
          return { value: { replayUnserializable: true }, truncated: true }
        }
      }
      const r = raw.result !== undefined ? truncate(raw.result) : undefined
      const ev: ToolCallEvent = {
        kind: "tool-call-end",
        runId: raw.taskId,
        timestamp: Date.now(),
        iter: -1,
        seq,
        toolName: raw.toolName,
        durationMs: raw.durationMs,
        ok: raw.success,
        ...(raw.args !== undefined ? { args: raw.args } : {}),
        ...(r ? { result: r.value, resultTruncated: r.truncated || raw.resultTruncated === true } : {}),
        ...(raw.error ? { error: raw.error } : {}),
      }
      return ev
    }

    case "AssumptionRecordedEmitted": {
      const ev: AssumptionRecordedEvent = {
        kind: "assumption-recorded",
        runId: raw.taskId,
        timestamp: raw.timestamp,
        iter: raw.iteration,
        seq,
        assumption: raw.assumption,
        rationale: raw.rationale,
      }
      return ev
    }

    case "CuratorDecisionEmitted": {
      const ev: CuratorDecisionEvent = {
        kind: "curator-decision",
        runId: raw.taskId,
        timestamp: raw.timestamp,
        iter: raw.iteration,
        seq,
        action: raw.action,
        targetRef: raw.targetRef,
        rationale: raw.rationale,
      }
      return ev
    }

    case "AlternativesConsideredEmitted": {
      const ev: AlternativesConsideredEvent = {
        kind: "alternatives-considered",
        runId: raw.taskId,
        timestamp: raw.timestamp,
        iter: raw.iteration,
        seq,
        chosen: raw.chosen,
        alternatives: raw.alternatives,
      }
      return ev
    }

    case "ToolSurfaceResolvedEmitted": {
      const ev: ToolSurfaceResolvedEvent = {
        kind: "tool-surface-resolved",
        runId: raw.taskId,
        timestamp: raw.timestamp,
        iter: raw.iteration,
        seq,
        visible: raw.visible,
        callable: raw.callable,
        reasons: raw.reasons,
      }
      return ev
    }

    case "ContractCompiledEmitted": {
      const ev: ContractCompiledEvent = {
        kind: "contract-compiled",
        runId: raw.taskId,
        timestamp: raw.timestamp,
        iter: raw.iteration,
        seq,
        requirements: raw.requirements,
        deliverables: raw.deliverables,
        horizon: raw.horizon,
      }
      return ev
    }

    case "AssessmentEmitted": {
      const ev: AssessmentEvent = {
        kind: "assessment",
        runId: raw.taskId,
        timestamp: raw.timestamp,
        iter: raw.iteration,
        seq,
        phase: raw.phase,
        band: raw.band,
        evidenceDelta: raw.evidenceDelta,
        requirementsSatisfied: raw.requirementsSatisfied,
        requirementsOutstanding: raw.requirementsOutstanding,
        deliverablesProduced: raw.deliverablesProduced,
        deliverablesMissing: raw.deliverablesMissing,
        burnRatio: raw.burnRatio,
      }
      return ev
    }

    case "ProjectionRenderedEmitted": {
      const ev: ProjectionRenderedEvent = {
        kind: "projection-rendered",
        runId: raw.taskId,
        timestamp: raw.timestamp,
        iter: raw.iteration,
        seq,
        sections: raw.sections,
        refs: raw.refs,
        droppedRefs: raw.droppedRefs,
        chars: raw.chars,
      }
      return ev
    }

    case "ControlResolutionEmitted": {
      const ev: ControlResolutionEvent = {
        kind: "control-resolution",
        runId: raw.taskId,
        timestamp: raw.timestamp,
        iter: raw.iteration,
        seq,
        action: raw.action,
        reason: raw.reason,
        proposals: raw.proposals,
      }
      return ev
    }

    case "HarnessSignalInjectedEmitted": {
      const ev: HarnessSignalInjectedEvent = {
        kind: "harness-signal-injected",
        runId: raw.taskId,
        timestamp: raw.timestamp,
        iter: raw.iteration,
        seq,
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
