// Run: bun test packages/replay/tests/run-started-task.test.ts --timeout 15000
/**
 * GH #236: the trace producer must stamp the REAL task into `run-started`,
 * so `RecordedRun.task` is faithful on fresh recordings and the `replay()`
 * orchestrator (replay.ts:28, `agent.run(recordedRun.task)`) no longer
 * orchestrates a blank task.
 *
 * RED arm (at HEAD, before the fix): a fresh recording via the real
 * recorder loads with `task === ""` (normalize.ts hardcoded the field),
 * failing the equality pin.
 *
 * Back-compat arm (green before AND after): a trace recorded BEFORE the fix
 * carries `run-started.task === ""` (the normalize default) and must still
 * load without throwing: `raw.task ?? ""` keeps the old-format shape valid.
 * The legacy line set below is byte-copied from the pre-regeneration
 * committed golden (`tests/fixtures/ci-lane-run.jsonl` run-started line),
 * the exact old format the brief names.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ReactiveAgents } from "@reactive-agents/runtime"
import { loadRecordedRun, replay } from "../src/index.js"
import type { BuildContext } from "../src/types.js"

const TMP = mkdtempSync(join(tmpdir(), "ra-236-task-"))

afterAll(() => {
    rmSync(TMP, { recursive: true, force: true })
})

describe("run-started.task stamping (GH #236)", () => {
    test("fresh recording: loadRecordedRun(task file).task === the prompt", async () => {
        const prompt = "Name the one requirement for deterministic replay."
        const agent = await ReactiveAgents.create()
            .withTestScenario([{ text: "FINAL ANSWER: a stamped task." }])
            .withReasoning({ defaultStrategy: "reactive" })
            .withMaxIterations(2)
            // Explicit dir (not REACTIVE_AGENTS_TRACE_DIR): the env var is
            // process-global and races under Bun's concurrent test files.
            .withObservability({ tracing: { dir: TMP } })
            .build()
        try {
            const result = await agent.run(prompt)
            const tracePath = result.metadata.tracePath
            expect(tracePath).toBeDefined()

            const run = await loadRecordedRun(tracePath!)
            // THE pin: the data source of replay()'s agent.run(recordedRun.task).
            expect(run.task).toBe(prompt)

            // Orchestrator pin (one assertion, brief step 4): replay() consumes
            // RecordedRun.task at replay.ts:28, so a fresh recording drives the
            // REAL prompt, not "".
            let orchestratedTask = ""
            await replay(run, async (_ctx: BuildContext) => ({
                run: async (task: string) => {
                    orchestratedTask = task
                    return { output: "a stamped task." }
                },
                dispose: async () => {},
            }))
            expect(orchestratedTask).toBe(prompt)
        } finally {
            await agent.dispose()
        }
    }, 15000)

    test("back-compat: pre-fix trace (run-started.task === \"\") still loads", async () => {
        // The exact old-format run-started line as the pre-#236 recorder wrote
        // it (task hardcoded ""), plus a minimal exchange so the loader has a
        // non-empty event stream.
        const legacy = [
            '{"kind":"run-started","runId":"01M4STQ18D3Z3D7Y49PTEZAB2K","rootRunId":"01M4STQ18D3Z3D7Y49PTEZAB2K","depth":0,"timestamp":1791868241166,"iter":-1,"seq":0,"task":"","model":"test-model","provider":"test","config":{}}',
            '{"kind":"run-completed","runId":"01M4STQ18D3Z3D7Y49PTEZAB2K","rootRunId":"01M4STQ18D3Z3D7Y49PTEZAB2K","depth":0,"timestamp":1791868241999,"iter":1,"seq":1,"success":true,"tokensUsed":10,"iterations":1}',
        ].join("\n") + "\n"
        const path = join(TMP, "legacy-run-started.jsonl")
        writeFileSync(path, legacy)

        const run = await loadRecordedRun(path)
        expect(run.task).toBe("")
        expect(run.runId).toBe("01M4STQ18D3Z3D7Y49PTEZAB2K")
    }, 15000)
})
