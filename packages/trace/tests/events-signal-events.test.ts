// packages/trace/tests/events-signal-events.test.ts
//
// Signal consumption edge (2026-10-25 plan, Task 1) — schema contract tests.
//
// Locks the shapes every later task consumes:
//   - HarnessSignalInjectedEvent gains signalId (required on NEW events),
//     targetTool?, targetPolicy? — while the reader still loads
//     pre-instrumentation events that carry none of them.
//   - SignalRenderedEvent ("signal-rendered")
//   - SignalEffectEvent   ("signal-effect")
//   - RunCompletedEvent.signals — optional consumption tally.
//
// Two halves of the contract:
//   runtime half  — isTraceEvent / loadTrace / recorder round-trip assertions
//   type half     — every literal below is declared as its event interface, so
//                   the shapes are compile-checked wherever tests are
//                   typechecked (the package battery typechecks src only; an
//                   ad-hoc tsc pass over this file covers the type side).

import { describe, it, expect } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isTraceEvent } from "../src/events.js"
import type {
  HarnessSignalInjectedEvent,
  RunCompletedEvent,
  RunSignalTally,
  SignalEffectEvent,
  SignalRenderedEvent,
  TraceEvent,
} from "../src/events.js"
import { toTraceEvent } from "../src/normalize.js"
import type { AgentEvent } from "@reactive-agents/core"
import { TraceRecorderService, TraceRecorderServiceLive } from "../src/recorder.js"
import { loadTrace } from "../src/replay.js"

const baseFields = { runId: "run-signal-edge", timestamp: 100, iter: 3, seq: 7 } as const

const injectedNew: HarnessSignalInjectedEvent = {
  ...baseFields,
  kind: "harness-signal-injected",
  signalKind: "redirect",
  origin: "think-guards.ts:213",
  contentPreview: "The http-get tool was denied; use web-search instead.",
  contentLen: 49,
  signalId: "sig-3-1",
  targetTool: "http-get",
  targetPolicy: "denied-tool-retry",
}

const rendered: SignalRenderedEvent = {
  ...baseFields,
  kind: "signal-rendered",
  signalId: "sig-3-1",
  renderedInIter: 4,
  renderedSection: "guidance",
}

const effect: SignalEffectEvent = {
  ...baseFields,
  kind: "signal-effect",
  signalId: "sig-3-1",
  response: "remediated",
  observedTool: "web-search",
  detail: "next act called the alternate tool with fresh args",
}

const completedWithTally: RunCompletedEvent = {
  ...baseFields,
  kind: "run-completed",
  status: "success",
  totalTokens: 8,
  totalCostUsd: 0,
  durationMs: 4,
  signals: {
    opened: 2,
    rendered: 2,
    remediated: 1,
    ignored: 0,
    contradicted: 0,
    ambiguous: 1,
    unobserved: 0,
  },
}

const completedWithoutTally: RunCompletedEvent = {
  ...baseFields,
  kind: "run-completed",
  status: "failure",
  totalTokens: 8,
  totalCostUsd: 0,
  durationMs: 4,
}

describe("signal consumption edge schema (Task 1)", () => {
  it("new kinds construct and satisfy the TraceEvent union", () => {
    const unionized: readonly TraceEvent[] = [
      injectedNew,
      rendered,
      effect,
      completedWithTally,
      completedWithoutTally,
    ]
    expect(unionized.every(isTraceEvent)).toBe(true)
    expect(unionized.map((e) => e.kind)).toEqual([
      "harness-signal-injected",
      "signal-rendered",
      "signal-effect",
      "run-completed",
      "run-completed",
    ])
  })

  it("new event payloads keep every field value verbatim", () => {
    expect(injectedNew.signalId).toBe("sig-3-1")
    expect(injectedNew.targetTool).toBe("http-get")
    expect(injectedNew.targetPolicy).toBe("denied-tool-retry")
    expect(rendered.signalId).toBe("sig-3-1")
    expect(rendered.renderedInIter).toBe(4)
    expect(rendered.renderedSection).toBe("guidance")
    expect(effect.signalId).toBe("sig-3-1")
    expect(effect.response).toBe("remediated")
    expect(effect.observedTool).toBe("web-search")
    expect(effect.detail).toBe("next act called the alternate tool with fresh args")
    expect(completedWithTally.signals).toEqual({
      opened: 2,
      rendered: 2,
      remediated: 1,
      ignored: 0,
      contradicted: 0,
      ambiguous: 1,
      unobserved: 0,
    })
  })

  it("targetPolicy accepts exactly the locked vocabulary", () => {
    const policies = ["denied-tool-retry", "alternate-tool", "synthesize", "required-tool", "other"] as const
    for (const targetPolicy of policies) {
      const ev: HarnessSignalInjectedEvent = {
        ...baseFields,
        kind: "harness-signal-injected",
        signalKind: "other",
        origin: "t:1",
        contentPreview: "c",
        contentLen: 1,
        signalId: "sig-p",
        targetPolicy,
      }
      expect(isTraceEvent(ev)).toBe(true)
    }
  })

  it("response accepts exactly the four locked labels", () => {
    for (const response of ["remediated", "ignored", "contradicted", "ambiguous"] as const) {
      const ev: SignalEffectEvent = {
        ...baseFields,
        kind: "signal-effect",
        signalId: "sig-r",
        response,
      }
      expect(isTraceEvent(ev)).toBe(true)
    }
  })

  it("required-field map covers the new kinds (incomplete payloads rejected)", () => {
    const effectMissingResponse: Record<string, unknown> = {
      kind: "signal-effect",
      runId: "run-x",
      timestamp: 1,
      iter: 0,
      seq: 0,
      signalId: "sig-x",
    }
    const renderedMissingIter: Record<string, unknown> = {
      kind: "signal-rendered",
      runId: "run-x",
      timestamp: 1,
      iter: 0,
      seq: 0,
      signalId: "sig-x",
      renderedSection: "guidance",
    }
    expect(isTraceEvent(effectMissingResponse)).toBe(false)
    expect(isTraceEvent(renderedMissingIter)).toBe(false)
  })

  it("reader tolerates a pre-instrumentation injected event with no signalId (REQUIRED_FIELDS_BY_KIND must not grow for it)", () => {
    const historical: Record<string, unknown> = {
      kind: "harness-signal-injected",
      runId: "run-old",
      timestamp: 1,
      iter: 0,
      seq: 0,
      signalKind: "nudge",
      origin: "think.ts:10",
      contentPreview: "hi",
      contentLen: 2,
    }
    expect(isTraceEvent(historical)).toBe(true)
  })
})

describe("run-completed.signals optional/absent tolerated (Task 1 (c))", () => {
  const completedRaw = (extra: Record<string, unknown>): AgentEvent =>
    ({
      _tag: "AgentCompleted",
      taskId: "run-tally",
      agentId: "a",
      success: true,
      totalIterations: 2,
      totalTokens: 10,
      durationMs: 5,
      ...extra,
    }) as AgentEvent

  it("normalize: AgentCompleted without signals leaves run-completed.signals absent", () => {
    const ev = toTraceEvent(completedRaw({}), 0)
    expect(ev?.kind).toBe("run-completed")
    expect((ev as RunCompletedEvent).signals).toBeUndefined()
  })

  it("normalize: AgentCompleted with a signals tally passes it through verbatim", () => {
    const tally: RunSignalTally = {
      opened: 1,
      rendered: 1,
      remediated: 1,
      ignored: 0,
      contradicted: 0,
      ambiguous: 0,
      unobserved: 0,
    }
    const ev = toTraceEvent(completedRaw({ signals: tally }), 0) as RunCompletedEvent
    expect(ev.signals).toEqual(tally)
  })
})

describe("pre-instrumentation recorded run loads (Task 1 (b))", () => {
  it("a recorder-written run with historical event shapes loads through loadTrace without error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trace-signal-edge-"))
    const runId = "pre-instrumentation-run"
    try {
      // Post-investigation of the brief: no hand-copied report fixture is used.
      // A minimal recorded-run file is generated through the trace package's
      // own recorder (same byte path real runs take), using token-by-token the
      // PRE-instrumentation shapes: no signalId on the injected event, no
      // signals on run-completed, no rendered/effect events at all.
      const recorded: readonly TraceEvent[] = [
        {
          kind: "run-started",
          runId,
          timestamp: 1,
          iter: -1,
          seq: 0,
          task: "pre-instrumentation run",
          model: "m",
          provider: "p",
          config: {},
        },
        {
          kind: "harness-signal-injected",
          runId,
          timestamp: 2,
          iter: 0,
          seq: 1,
          signalKind: "redirect",
          origin: "arbitrator.ts:100",
          contentPreview: "use the alternate tool",
          contentLen: 22,
        },
        {
          kind: "tool-call-start",
          runId,
          timestamp: 3,
          iter: 1,
          seq: 2,
          toolName: "web-search",
        },
        {
          kind: "run-completed",
          runId,
          timestamp: 4,
          iter: -1,
          seq: 3,
          status: "success",
          totalTokens: 8,
          totalCostUsd: 0,
          durationMs: 4,
        },
      ]
      await Effect.runPromise(
        Effect.gen(function* () {
          const recorder = yield* TraceRecorderService
          for (const ev of recorded) yield* recorder.emit(ev)
          yield* recorder.flush(runId)
        }).pipe(Effect.provide(TraceRecorderServiceLive({ dir }))),
      )
      const trace = await loadTrace(join(dir, `${runId}.jsonl`))
      expect(trace.runId).toBe(runId)
      // Every line survived the reader's required-field gate — in particular
      // the historical harness-signal-injected line (no signalId) was NOT
      // dropped, and the reader takes its absent signalId without error.
      expect(trace.events.map((e) => e.kind)).toEqual([
        "run-started",
        "harness-signal-injected",
        "tool-call-start",
        "run-completed",
      ])
      const injected = trace.events.find((e) => e.kind === "harness-signal-injected") as
        | HarnessSignalInjectedEvent
        | undefined
      expect(injected).toBeDefined()
      expect(injected?.signalId).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("the new signal kinds also round-trip through recorder + loadTrace", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trace-signal-edge-new-"))
    const runId = "instrumented-run"
    try {
      const recorded: readonly TraceEvent[] = [
        {
          kind: "run-started",
          runId,
          timestamp: 1,
          iter: -1,
          seq: 0,
          task: "instrumented run",
          model: "m",
          provider: "p",
          config: {},
        },
        {
          kind: "harness-signal-injected",
          runId,
          timestamp: 2,
          iter: 0,
          seq: 1,
          signalKind: "redirect",
          origin: "arbitrator.ts:100",
          contentPreview: "use the alternate tool",
          contentLen: 22,
          signalId: "sig-0-1",
          targetTool: "web-search",
          targetPolicy: "alternate-tool",
        },
        {
          kind: "signal-rendered",
          runId,
          timestamp: 3,
          iter: 1,
          seq: 2,
          signalId: "sig-0-1",
          renderedInIter: 1,
          renderedSection: "guidance",
        },
        {
          kind: "signal-effect",
          runId,
          timestamp: 4,
          iter: 1,
          seq: 3,
          signalId: "sig-0-1",
          response: "remediated",
          observedTool: "web-search",
        },
        {
          kind: "run-completed",
          runId,
          timestamp: 5,
          iter: -1,
          seq: 4,
          status: "success",
          totalTokens: 8,
          totalCostUsd: 0,
          durationMs: 4,
          signals: {
            opened: 1,
            rendered: 1,
            remediated: 1,
            ignored: 0,
            contradicted: 0,
            ambiguous: 0,
            unobserved: 0,
          },
        },
      ]
      await Effect.runPromise(
        Effect.gen(function* () {
          const recorder = yield* TraceRecorderService
          for (const ev of recorded) yield* recorder.emit(ev)
          yield* recorder.flush(runId)
        }).pipe(Effect.provide(TraceRecorderServiceLive({ dir }))),
      )
      const trace = await loadTrace(join(dir, `${runId}.jsonl`))
      expect(trace.events.map((e) => e.kind)).toEqual([
        "run-started",
        "harness-signal-injected",
        "signal-rendered",
        "signal-effect",
        "run-completed",
      ])
      const rendered = trace.events.find(
        (e): e is SignalRenderedEvent => e.kind === "signal-rendered",
      )
      const effect = trace.events.find(
        (e): e is SignalEffectEvent => e.kind === "signal-effect",
      )
      expect(rendered?.signalId).toBe("sig-0-1")
      expect(rendered?.renderedInIter).toBe(1)
      expect(effect?.response).toBe("remediated")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
