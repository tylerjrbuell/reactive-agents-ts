import { describe, test, expect } from "bun:test"
import { join } from "node:path"
import { loadRecordedRun } from "../src/load.js"

const FIXTURE_DIR = join(import.meta.dir, "fixtures")

describe("loadRecordedRun", () => {
    test("loads JSONL from path and extracts metadata", async () => {
        const path = join(FIXTURE_DIR, "sample-trace.jsonl")
        const run = await loadRecordedRun(path)
        expect(run.runId).toBe("r-fix-1")
        expect(run.task).toBe("echo hello")
        expect(run.model).toBe("qwen3:14b")
        expect(run.provider).toBe("ollama")
        expect(run.trace.events.length).toBe(4)
        expect(run.toolTable.size).toBe(1)
    })

    test("throws on unresolvable path", async () => {
        await expect(loadRecordedRun("/tmp/replay-nonexistent-xyz.jsonl")).rejects.toThrow(/cannot resolve/)
    })
})
