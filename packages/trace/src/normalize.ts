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
  ToolSurfaceResolvedEvent,
  ContractCompiledEvent,
  AssessmentEvent,
  ProjectionRenderedEvent,
  ControlResolutionEvent,
  LedgerEntryTraceEvent,
} from "./events.js";

export function toTraceEvent(raw: AgentEvent, seq: number): TraceEvent | null {
  switch (raw._tag) {
    case "AgentStarted": {
      // B8-T3b: correlate to the delegation tree. Absent ⇒ a root run
      // (rootRunId = its own runId, depth 0).
      const corr = raw as typeof raw & {
        rootRunId?: string
        parentRunId?: string
        depth?: number
      }
      const ev: RunStartedEvent = {
        kind: "run-started",
        runId: raw.taskId,
        rootRunId: corr.rootRunId ?? raw.taskId,
        depth: corr.depth ?? 0,
        ...(corr.parentRunId ? { parentRunId: corr.parentRunId } : {}),
        timestamp: raw.timestamp,
        iter: -1,
        seq,
        // GH #236: the real prompt, stamped by the emitter (capped at 64KB
        // there, `taskTruncated` marks a clip). The "" fallback keeps
        // traces and emit paths predating the fix valid: old hand-rolled
        // AgentStarted events without `task` still normalize cleanly.
        task: raw.task ?? "",
        model: raw.model,
        provider: raw.provider,
        config: {},
      }
      return ev
    }

    case "AgentCompleted": {
      const corr = raw as typeof raw & {
        rootRunId?: string
        parentRunId?: string
        depth?: number
      }
      const ev: RunCompletedEvent = {
        kind: "run-completed",
        runId: raw.taskId,
        rootRunId: corr.rootRunId ?? raw.taskId,
        depth: corr.depth ?? 0,
        ...(corr.parentRunId ? { parentRunId: corr.parentRunId } : {}),
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
        ...(raw.terminationReason !== undefined ? { terminatedBy: raw.terminationReason } : {}),
        totalTokens: raw.totalTokens,
        totalCostUsd: raw.totalCostUsd ?? 0,
        durationMs: raw.durationMs,
      }
      return ev
    }

    case "EntropyScored": {
      const src = raw.sources as {
        token: number | null
        structural: number
        semantic: number | null
        behavioral: number
        contextPressure: number
      }
      const sources = {
        token: src.token,
        structural: src.structural,
        semantic: src.semantic,
        behavioral: src.behavioral,
        contextPressure: src.contextPressure,
      }
      // Matches the sensor's own confidence-driving count (composite.ts) —
      // contextPressure is excluded because it is structurally never null, so
      // including it would make sourcesPresent range 3-5 instead of the real
      // 2-4 the sensor's confidence tiers are keyed off.
      const computedSourcesPresent =
        (sources.token !== null ? 1 : 0) +
        1 + // structural always present
        (sources.semantic !== null ? 1 : 0) +
        1 // behavioral always present
      // Fallback for pre-branch bus events recorded before this was published
      // at the source — derive from `sources` when the raw event doesn't
      // already carry it. `sourcesPresent` is not part of the raw bus-event
      // type (it's a trace-derived field), so it's read defensively via an
      // untyped view of the event.
      const rawSourcesPresent = (raw as unknown as { sourcesPresent?: unknown }).sourcesPresent
      const sourcesPresent =
        typeof rawSourcesPresent === "number" ? rawSourcesPresent : computedSourcesPresent
      const traj = raw.trajectory as { shape?: string } | undefined
      const confidence =
        raw.confidence === "high" || raw.confidence === "medium" || raw.confidence === "low"
          ? raw.confidence
          : "low"
      const modelTier =
        raw.modelTier === "frontier" || raw.modelTier === "local" ? raw.modelTier : "unknown"
      const ev: EntropyScoredEvent = {
        kind: "entropy-scored",
        runId: raw.taskId,
        timestamp: Date.now(),
        iter: raw.iteration,
        seq,
        composite: raw.composite,
        sources,
        sourcesPresent,
        confidence,
        trajectoryShape: traj?.shape ?? "unknown",
        modelTier,
      }
      return ev
    }

    case "ReactiveDecision": {
      const hasImprovement =
        typeof raw.entropyAfter === "number" &&
        typeof raw.entropyBefore === "number" &&
        raw.entropyAfter < raw.entropyBefore
      // An explicit controller-supplied confidence wins: switch-strategy decisions
      // carry no entropyBefore/After pair, so the delta formula always fell to 0.
      const confidence =
        typeof raw.confidence === "number"
          ? Math.max(0, Math.min(1, raw.confidence))
          : hasImprovement
            ? Math.max(0, 1 - (raw.entropyAfter as number) / (raw.entropyBefore as number))
            : 0
      const ev: DecisionEvaluatedEvent = {
        kind: "decision-evaluated",
        runId: raw.taskId,
        timestamp: Date.now(),
        iter: raw.iteration,
        seq,
        decisionType: raw.decision,
        confidence,
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
        // Conditional: absent stays absent, so historical goldens and every
        // trace recorded before 2026-07-28 stay byte-identical.
        ...(raw.purpose ? { purpose: raw.purpose } : {}),
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
        // R4: carry the capability window + per-result compression detail so the
        // budget-inversion class is visible via `rax diagnose replay`, not just
        // the live console line.
        ...(raw.window !== undefined ? { window: raw.window } : {}),
        ...(raw.tier !== undefined ? { tier: raw.tier } : {}),
        ...(raw.compressions !== undefined ? { compressions: raw.compressions } : {}),
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

    case "LedgerEntryAppended": {
      // Wave C.2 slice 3 — the run ledger reaches the trace stream. The batch
      // is published once per kernel iteration boundary; each entry carries its
      // own ledger `seq` + `kind`, so we surface the whole batch and take this
      // event's `iter` from the entries' shared `iteration` (they are appended
      // within one transition). Trace `seq` is the caller's monotonic counter.
      const first = raw.entries[0] as { iteration?: unknown } | undefined
      const iter = typeof first?.iteration === "number" ? first.iteration : -1
      const ev: LedgerEntryTraceEvent = {
        kind: "ledger-entry",
        runId: raw.taskId,
        timestamp: raw.timestamp,
        iter,
        seq,
        entries: raw.entries,
      }
      return ev
    }

    default:
      return null
  }
}
