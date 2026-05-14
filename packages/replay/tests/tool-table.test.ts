import { describe, test, expect } from "bun:test"
import { buildToolTable, computeArgsHash } from "../src/tool-table.js"
import type { TraceEvent } from "@reactive-agents/trace"

function endEvent(toolName: string, args: unknown, opts: Partial<{ ok: boolean; error: string; result: unknown; iter: number; seq: number }> = {}): TraceEvent {
    return {
        kind: "tool-call-end",
        runId: "r1",
        timestamp: 0,
        iter: opts.iter ?? 0,
        seq: opts.seq ?? 0,
        toolName,
        args,
        result: opts.result,
        ok: opts.ok ?? true,
        error: opts.error,
        durationMs: 1,
    } as unknown as TraceEvent
}

describe("buildToolTable", () => {
    test("groups tool-call-end events by name+argsHash and preserves order", () => {
        const events: TraceEvent[] = [
            endEvent("search", { q: "hn" }, { result: "r1", iter: 0, seq: 1 }),
            endEvent("search", { q: "hn" }, { result: "r2", iter: 1, seq: 2 }),
            endEvent("search", { q: "different" }, { ok: false, error: "boom", iter: 1, seq: 3 }),
        ]
        const table = buildToolTable(events)
        const h1 = computeArgsHash({ q: "hn" })
        const h2 = computeArgsHash({ q: "different" })
        expect(table.get(`search::${h1}`)?.length).toBe(2)
        expect(table.get(`search::${h1}`)?.[0].result).toBe("r1")
        expect(table.get(`search::${h1}`)?.[1].result).toBe("r2")
        expect(table.get(`search::${h2}`)?.length).toBe(1)
        expect(table.get(`search::${h2}`)?.[0].ok).toBe(false)
        expect(table.get(`search::${h2}`)?.[0].error).toBe("boom")
    })

    test("computeArgsHash stable across key ordering", () => {
        expect(computeArgsHash({ a: 1, b: 2 })).toBe(computeArgsHash({ b: 2, a: 1 }))
        expect(computeArgsHash({ a: { x: 1, y: 2 } })).toBe(computeArgsHash({ a: { y: 2, x: 1 } }))
    })

    test("skips non-tool-call-end events", () => {
        const events: TraceEvent[] = [
            { kind: "run-started", runId: "r1", timestamp: 0, iter: -1, seq: 0 } as unknown as TraceEvent,
            endEvent("search", { q: "x" }, { result: "ok" }),
        ]
        const table = buildToolTable(events)
        expect(table.size).toBe(1)
    })
})
