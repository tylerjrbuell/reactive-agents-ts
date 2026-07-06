import type { Trace } from "@reactive-agents/trace"
import type { LLMTable } from "./llm-table.js"

export interface RecordedToolResult {
    readonly toolName: string
    readonly argsHash: string
    readonly args: unknown
    readonly result: unknown
    readonly ok: boolean
    readonly error?: string
    readonly durationMs: number
    readonly iter: number
    readonly seq: number
    readonly truncated?: boolean
}

export interface RecordedRun {
    readonly runId: string
    readonly task: string
    readonly model: string
    readonly provider: string
    readonly config: Readonly<Record<string, unknown>>
    readonly trace: Trace
    readonly toolTable: ReadonlyMap<string, readonly RecordedToolResult[]>
    /** Exact-replay LLM dispense table (Task 3) — additive; not populated by older recordings. */
    readonly llmTable: LLMTable
}

export interface ReplayOverrides {
    readonly systemPrompt?: string
    readonly model?: string
    readonly temperature?: number
    /** strict (default): error on unrecorded tool call. lenient: return no-recording marker. */
    readonly onMissingToolResult?: "strict" | "lenient"
}

export type BuilderFn = (() => Promise<unknown>) | ((ctx: BuildContext) => Promise<unknown>)

export interface BuildContext {
    readonly overrides: ReplayOverrides
    readonly recordedRun: RecordedRun
}

export interface TraceSnapshot {
    readonly runId: string
    readonly task: string
    readonly model: string
    readonly iterations: number
    readonly toolCalls: readonly { readonly toolName: string; readonly argsHash: string; readonly ok: boolean }[]
    readonly output: string | undefined
    readonly totalTokens: number
    readonly totalCostUsd: number
    readonly durationMs: number
}

export type ToolSeqEdit =
    | { readonly kind: "added"; readonly toolName: string; readonly argsHash: string; readonly atIndex: number }
    | { readonly kind: "removed"; readonly toolName: string; readonly argsHash: string; readonly atIndex: number }
    | { readonly kind: "reordered"; readonly toolName: string; readonly argsHash: string; readonly from: number; readonly to: number }

export interface ReplayDiff {
    readonly identical: boolean
    readonly iterationsDelta: number
    readonly toolSequenceDiff: readonly ToolSeqEdit[]
    readonly outputDiff: { readonly original: string | undefined; readonly replay: string | undefined; readonly equal: boolean }
    readonly tokensDelta: number
    readonly costDelta: number
    readonly durationDeltaMs: number
}

export interface ReplayResult {
    readonly original: TraceSnapshot
    readonly replay: TraceSnapshot
    readonly diff: ReplayDiff
}
