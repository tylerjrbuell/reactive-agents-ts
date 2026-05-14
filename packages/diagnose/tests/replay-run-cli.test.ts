import { describe, test, expect } from "bun:test"
import { join } from "node:path"
import { replayRunCommand } from "../src/commands/replay-run.js"

const FIXTURE = join(import.meta.dir, "../../replay/tests/fixtures/sample-trace.jsonl")

describe("replay-run CLI", () => {
    test("text output includes runId, task, model, tool count", async () => {
        let captured = ""
        const orig = console.log
        console.log = ((s: string) => {
            captured += s + "\n"
        }) as typeof console.log
        try {
            await replayRunCommand(FIXTURE)
        } finally {
            console.log = orig
        }
        expect(captured).toContain("r-fix-1")
        expect(captured).toContain("echo hello")
        expect(captured).toContain("qwen3:14b")
        expect(captured).toMatch(/tools\s+1 calls/)
    })

    test("--json emits structured payload", async () => {
        let captured = ""
        const orig = console.log
        console.log = ((s: string) => {
            captured += s + "\n"
        }) as typeof console.log
        try {
            await replayRunCommand(FIXTURE, { json: true })
        } finally {
            console.log = orig
        }
        const parsed = JSON.parse(captured)
        expect(parsed.runId).toBe("r-fix-1")
        expect(parsed.toolCalls).toBe(1)
        expect(parsed.uniqueTools).toEqual(["echo"])
    })
})
