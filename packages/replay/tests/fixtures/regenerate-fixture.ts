// Fixture provenance: packages/replay/tests/fixtures/ci-lane-run.jsonl
//
// The committed golden was recorded with the REAL trace recorder (no
// hand-rolled JSONL): a tool-free scripted run on the `test` provider —
// no keys, no network — through the public builder, exactly the recording
// arm documented in the cookbook's "Deterministic testing" section.
//
// Regenerate (and re-verify) with:
//   bun run packages/replay/tests/fixtures/regenerate-fixture.ts
//
// The ULID runId and timestamps change on every regeneration; nothing in
// replay-ci-lane.test.ts depends on them — the test derives the task and
// the expected output from the fixture's own events.
import { mkdtempSync, rmSync, copyFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ReactiveAgents } from "@reactive-agents/runtime"

export const FIXTURE_TASK = "Explain why deterministic replay matters for CI."
export const FIXTURE_SCENARIO = [{ text: "FINAL ANSWER: deterministic replay works." }]

const dir = mkdtempSync(join(tmpdir(), "ra-ci-lane-fixture-"))
try {
    const agent = await ReactiveAgents.create()
        .withTestScenario(FIXTURE_SCENARIO)
        .withReasoning({ defaultStrategy: "reactive" })
        .withMaxIterations(2)
        // Explicit dir (not REACTIVE_AGENTS_TRACE_DIR): the env var is
        // process-global and races under Bun's concurrent test files.
        .withObservability({ tracing: { dir } })
        .build()
    const result = await agent.run(FIXTURE_TASK)
    await agent.dispose()

    const tracePath = result.metadata.tracePath
    if (!tracePath) {
        throw new Error(
            "regenerate-fixture: no metadata.tracePath — tracing must be on to record the golden",
        )
    }
    const dest = join(import.meta.dir, "ci-lane-run.jsonl")
    copyFileSync(tracePath, dest)
    console.log(`Fixture written to ${dest}`)
    console.log(`  task=${JSON.stringify(FIXTURE_TASK)} output=${JSON.stringify(result.output)}`)
} finally {
    rmSync(dir, { recursive: true, force: true })
}
