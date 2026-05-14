import { describe, test, expect } from "bun:test"
import { makeReplayController } from "../src/replay-controller.js"
import { computeArgsHash } from "../src/tool-table.js"
import type { RecordedToolResult } from "../src/types.js"

describe("ReplayController", () => {
    test("returns recorded results in call order", () => {
        const h = computeArgsHash({ q: "hn" })
        const list: RecordedToolResult[] = [
            { toolName: "search", argsHash: h, args: { q: "hn" }, result: "r1", ok: true, durationMs: 1, iter: 0, seq: 1 },
            { toolName: "search", argsHash: h, args: { q: "hn" }, result: "r2", ok: true, durationMs: 1, iter: 1, seq: 2 },
        ]
        const table = new Map([[`search::${h}`, list]])
        const ctrl = makeReplayController(table)
        const a = ctrl.next("search", { q: "hn" })
        expect(a.hit).toBe(true)
        if (a.hit) expect(a.result).toBe("r1")
        const b = ctrl.next("search", { q: "hn" })
        expect(b.hit).toBe(true)
        if (b.hit) expect(b.result).toBe("r2")
        const c = ctrl.next("search", { q: "hn" })
        expect(c.hit).toBe(false)
    })

    test("returns hit=false for unrecorded tool calls", () => {
        const ctrl = makeReplayController(new Map())
        expect(ctrl.next("unknown", {}).hit).toBe(false)
    })

    test("preserves ok=false on recorded errors", () => {
        const h = computeArgsHash({})
        const table = new Map([
            [`flaky::${h}`, [
                { toolName: "flaky", argsHash: h, args: {}, result: undefined, ok: false, error: "boom", durationMs: 0, iter: 0, seq: 0 } as RecordedToolResult,
            ]],
        ])
        const ctrl = makeReplayController(table)
        const r = ctrl.next("flaky", {})
        expect(r.hit).toBe(true)
        if (r.hit) {
            expect(r.ok).toBe(false)
            expect(r.error).toBe("boom")
        }
    })
})
