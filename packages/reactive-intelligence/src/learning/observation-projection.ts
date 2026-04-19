import type { Trace } from "@reactive-agents/trace"
import type { ToolCallEvent } from "@reactive-agents/trace"

export interface ObservationSample {
  readonly at: string
  readonly modelId: string
  readonly parallelTurnCount: number
  readonly totalTurnCount: number
  readonly dialect: string
  readonly classifierRequired: readonly string[]
  readonly classifierActuallyCalled: readonly string[]
  readonly subagentInvoked: number
  readonly subagentSucceeded: number
  readonly argValidityRate: number
}

/** Returns null if lifecycle events are missing — callers must guard. */
export function projectObservationFromTrace(trace: Trace): ObservationSample | null {
  const started = trace.events.find((e) => e.kind === "run-started")
  const completed = trace.events.find((e) => e.kind === "run-completed")
  if (!started || started.kind !== "run-started" || !completed) return null

  const iterations = trace.events.filter((e) => e.kind === "iteration-enter").length

  const toolCallEnds = trace.events.filter(
    (e): e is ToolCallEvent & { kind: "tool-call-end" } => e.kind === "tool-call-end",
  )

  const toolNames = [...new Set(toolCallEnds.map((e) => e.toolName))]

  const subagentCalls = toolCallEnds.filter((e) => e.toolName === "spawn-agent")

  const validArgs = toolCallEnds.filter((e) => e.ok === true).length
  const argValidityRate = toolCallEnds.length === 0 ? 0 : validArgs / toolCallEnds.length

  const dialect =
    typeof started.config?.dialect === "string" ? started.config.dialect : "none"

  return {
    at: new Date(started.timestamp).toISOString(),
    modelId: started.model,
    parallelTurnCount: 0,
    totalTurnCount: iterations,
    dialect,
    classifierRequired: [],
    classifierActuallyCalled: toolNames,
    subagentInvoked: subagentCalls.length,
    subagentSucceeded: subagentCalls.filter((e) => e.ok === true).length,
    argValidityRate,
  }
}
