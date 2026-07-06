import { createHash } from "node:crypto"
import type { TraceEvent } from "@reactive-agents/trace"
import type { RecordedToolResult } from "./types.js"
import { stableStringify } from "./stable-stringify.js"

export function computeArgsHash(args: unknown): string {
    return createHash("sha256").update(stableStringify(args)).digest("hex").slice(0, 16)
}

interface ToolCallEndShape {
    readonly kind: "tool-call-end"
    readonly toolName: string
    readonly args?: unknown
    readonly result?: unknown
    readonly resultTruncated?: boolean
    readonly ok?: boolean
    readonly error?: string
    readonly durationMs?: number
    readonly iter: number
    readonly seq: number
}

export function buildToolTable(events: readonly TraceEvent[]): Map<string, RecordedToolResult[]> {
    const table = new Map<string, RecordedToolResult[]>()
    for (const ev of events) {
        if (ev.kind !== "tool-call-end") continue
        const e = ev as unknown as ToolCallEndShape
        const argsHash = computeArgsHash(e.args)
        const key = `${e.toolName}::${argsHash}`
        const entry: RecordedToolResult = {
            toolName: e.toolName,
            argsHash,
            args: e.args,
            result: e.result,
            ok: e.ok ?? true,
            error: e.error,
            durationMs: e.durationMs ?? 0,
            iter: e.iter,
            seq: e.seq,
            truncated: e.resultTruncated,
        }
        const list = table.get(key) ?? []
        list.push(entry)
        table.set(key, list)
    }
    return table
}
