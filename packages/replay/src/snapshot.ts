import { runCost, traceStats } from "@reactive-agents/trace"
import type { RecordedRun, TraceSnapshot } from "./types.js"

interface RunCompletedShape {
    readonly kind: "run-completed"
    readonly output?: string
}

export function snapshotFromRecordedRun(run: RecordedRun): TraceSnapshot {
    const stats = traceStats(run.trace)
    const completed = run.trace.events.find(
        (e): e is typeof e & RunCompletedShape => e.kind === "run-completed",
    )
    // The late `run-cost-finalized` total (debrief included) wins over
    // run-completed's; an unrecorded cost is unknown (0 as the lower bound,
    // costComplete false), never a measured $0.
    const cost = runCost(run.trace.events)
    const toolCalls: { toolName: string; argsHash: string; ok: boolean }[] = []
    for (const [, list] of run.toolTable) {
        for (const r of list) {
            toolCalls.push({ toolName: r.toolName, argsHash: r.argsHash, ok: r.ok })
        }
    }
    return {
        runId: run.runId,
        task: run.task,
        model: run.model,
        iterations: stats.iterations,
        toolCalls,
        output: completed?.output,
        totalTokens: stats.totalTokens,
        totalCostUsd: cost.totalCostUsd ?? 0,
        ...(cost.totalCostUsd === undefined
            ? { costComplete: false }
            : cost.complete !== undefined
              ? { costComplete: cost.complete }
              : {}),
        durationMs: stats.durationMs,
    }
}

export interface AgentRunOutcome {
    readonly output?: string
    readonly totalTokens?: number
    /** Known USD spend. Absent = unknown (recorded as 0 with `costComplete: false`). */
    readonly totalCostUsd?: number
    /** `false` when `totalCostUsd` is a lower bound (some call had no known price). */
    readonly costComplete?: boolean
    readonly durationMs?: number
    readonly toolCalls?: readonly { readonly toolName: string; readonly argsHash: string; readonly ok: boolean }[]
    readonly iterations?: number
}

export function snapshotFromAgentResult(
    result: AgentRunOutcome,
    recordedRun: RecordedRun,
): TraceSnapshot {
    return {
        runId: `${recordedRun.runId}-replay`,
        task: recordedRun.task,
        model: recordedRun.model,
        iterations: result.iterations ?? 0,
        toolCalls: result.toolCalls ?? [],
        output: result.output,
        totalTokens: result.totalTokens ?? 0,
        totalCostUsd: result.totalCostUsd ?? 0,
        ...(result.totalCostUsd === undefined
            ? { costComplete: false }
            : result.costComplete !== undefined
              ? { costComplete: result.costComplete }
              : {}),
        durationMs: result.durationMs ?? 0,
    }
}
