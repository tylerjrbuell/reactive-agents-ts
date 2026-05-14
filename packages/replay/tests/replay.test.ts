import { describe, test, expect } from "bun:test"
import { join } from "node:path"
import { replay } from "../src/replay.js"
import { loadRecordedRun } from "../src/load.js"
import type { BuildContext } from "../src/types.js"

const FIXTURE = join(import.meta.dir, "fixtures/sample-trace.jsonl")

interface StubCapture {
    task?: string
    overrides?: BuildContext["overrides"]
}

function makeStubBuilder(captured: StubCapture) {
    return async (ctx: BuildContext) => {
        captured.overrides = ctx.overrides
        return {
            run: async (task: string) => {
                captured.task = task
                return {
                    output: "hello",
                    totalTokens: 42,
                    totalCostUsd: 0,
                    durationMs: 50,
                    iterations: 1,
                    toolCalls: [{ toolName: "echo", argsHash: "x", ok: true }],
                }
            },
            dispose: async () => {},
        }
    }
}

describe("replay()", () => {
    test("invokes builder with original task and returns ReplayResult", async () => {
        const run = await loadRecordedRun(FIXTURE)
        const captured: StubCapture = {}
        const result = await replay(run, makeStubBuilder(captured))
        expect(captured.task).toBe("echo hello")
        expect(result.original.runId).toBe("r-fix-1")
        expect(result.replay.output).toBe("hello")
        expect(result.diff.outputDiff.equal).toBe(true)
    })

    test("passes overrides into builder context", async () => {
        const run = await loadRecordedRun(FIXTURE)
        const captured: StubCapture = {}
        await replay(run, makeStubBuilder(captured), {
            model: "gpt-4o-mini",
            systemPrompt: "be concise",
        })
        expect(captured.overrides?.model).toBe("gpt-4o-mini")
        expect(captured.overrides?.systemPrompt).toBe("be concise")
    })

    test("calls dispose() after run completes", async () => {
        const run = await loadRecordedRun(FIXTURE)
        let disposed = false
        await replay(run, async () => ({
            run: async () => ({ output: "ok" }),
            dispose: async () => {
                disposed = true
            },
        }))
        expect(disposed).toBe(true)
    })

    test("calls dispose() even when run throws", async () => {
        const run = await loadRecordedRun(FIXTURE)
        let disposed = false
        await expect(
            replay(run, async () => ({
                run: async () => {
                    throw new Error("boom")
                },
                dispose: async () => {
                    disposed = true
                },
            })),
        ).rejects.toThrow("boom")
        expect(disposed).toBe(true)
    })
})
