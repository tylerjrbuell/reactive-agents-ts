// packages/testing/src/harness/expect-trace.ts

import type { Trace } from "@reactive-agents/trace"

export function expectTrace(trace: Trace): TraceAssertions {
  return new TraceAssertions(trace)
}

class TraceAssertions {
  constructor(private readonly trace: Trace) {}

  toHaveEntropySpike(opts: { above: number }): this {
    const entropyScoredEvents = this.trace.events.filter(
      (e) => e.kind === "entropy-scored"
    )
    const found = entropyScoredEvents.some(
      (e) => e.kind === "entropy-scored" && e.composite > opts.above
    )
    if (!found) {
      const max = entropyScoredEvents.reduce(
        (acc, e) => (e.kind === "entropy-scored" ? Math.max(acc, e.composite) : acc),
        0
      )
      throw new Error(
        `Expected entropy spike above ${opts.above} but max was ${max}`
      )
    }
    return this
  }

  toHaveInterventionDispatched(decisionType: string): this {
    const found = this.trace.events.some(
      (e) => e.kind === "intervention-dispatched" && e.decisionType === decisionType
    )
    if (!found) {
      throw new Error(
        `Expected intervention-dispatched for "${decisionType}" but none found`
      )
    }
    return this
  }

  toHaveCompleted(status: "success" | "failure" | "cancelled"): this {
    const ev = this.trace.events.find((e) => e.kind === "run-completed")
    if (!ev) {
      throw new Error("Expected run-completed event but none found")
    }
    if (ev.kind === "run-completed" && ev.status !== status) {
      throw new Error(
        `Expected run status "${status}" but got "${ev.status}"`
      )
    }
    return this
  }

  toHaveToolCall(toolName: string): this {
    const found = this.trace.events.some(
      (e) => e.kind === "tool-call-end" && e.toolName === toolName
    )
    if (!found) {
      throw new Error(`Expected tool call "${toolName}" but none found`)
    }
    return this
  }
}
