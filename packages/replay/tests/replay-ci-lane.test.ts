// Run: bun test packages/replay/tests/replay-ci-lane.test.ts --timeout 15000
/**
 * W0.8 — the "Deterministic testing" CI lane, proven in-repo.
 *
 * The cookbook's Deterministic-testing section teaches: record a scripted
 * run with the trace recorder → commit the JSONL as a fixture → in CI,
 * `loadRecordedRun` + `buildSequentialLLMTable` + `makeReplayLLMLayer` +
 * `.withReplayLLM` reproduce the recorded output with NO keys and NO live
 * provider. This file executes that exact flow:
 *
 *   1. recording arm — a fresh scripted run proves the recorder produces a
 *      loadable golden whose trace carries the model stream (W0.5 linkage:
 *      `result.metadata.tracePath` points at the flushed file);
 *   2. replay arm — the committed fixture is replayed through the full
 *      harness via the public builder seam, asserting byte-identical output.
 *
 * GREEN-on-arrival is honest here: every component (recorder flush, loader,
 * tables, replay LLM layer, builder override) has its own unit tests; this
 * lane exists to pin the COMPOSITION the docs teach, which nothing wired
 * together before (the benchmarks golden rail uses a private helper instead).
 *
 * Known fixture quirk, asserted below rather than hidden: the live recorder
 * normalizes `run-started.task` to "" (packages/trace/src/normalize.ts), so
 * `RecordedRun.task` is empty on fresh recordings — the CI lane passes the
 * task explicitly to `agent.run(...)`, mirroring the recorded task extracted
 * from the golden's first llm-exchange. `replay()` (the orchestrator) is
 * affected by the same quirk; the fix belongs in the trace producer
 * (packages/trace) and is surfaced in the W0.8 task report.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ReactiveAgents } from "@reactive-agents/runtime"
import type { RunCompletedEvent, TraceEvent } from "@reactive-agents/trace"
import { buildSequentialLLMTable, loadRecordedRun, makeReplayLLMLayer } from "../src/index.js"

const FIXTURE = join(import.meta.dir, "fixtures", "ci-lane-run.jsonl")
const TRACE_DIR = mkdtempSync(join(tmpdir(), "ra-ci-lane-"))

afterAll(() => {
    rmSync(TRACE_DIR, { recursive: true, force: true })
})

/** Pull a field off the fixture's own events so the assertions track the golden. */
function eventsOf<K extends TraceEvent["kind"]>(
    events: readonly TraceEvent[],
    kind: K,
): Extract<TraceEvent, { kind: K }>[] {
    return events.filter((e): e is Extract<TraceEvent, { kind: K }> => e.kind === kind)
}

describe("replay-as-CI lane (cookbook: Deterministic testing)", () => {
    test("recording arm: a scripted run's tracePath loads as a replayable golden", async () => {
        const agent = await ReactiveAgents.create()
            .withTestScenario([{ text: "FINAL ANSWER: deterministic replay works." }])
            .withReasoning({ defaultStrategy: "reactive" })
            .withMaxIterations(2)
            // Explicit dir, not REACTIVE_AGENTS_TRACE_DIR (process-global,
            // races under Bun's concurrent test files).
            .withObservability({ tracing: { dir: TRACE_DIR } })
            .build()
        try {
            const result = await agent.run("Explain why deterministic replay matters for CI.")
            // W0.5 linkage: the result points at the flushed, real trace file.
            const tracePath = result.metadata.tracePath
            expect(tracePath).toBeDefined()
            expect(existsSync(tracePath!)).toBe(true)

            const run = await loadRecordedRun(tracePath!)
            expect(eventsOf(run.trace.events, "run-started").length).toBeGreaterThan(0)
            // The golden actually recorded the model stream — without exchanges
            // there would be nothing for the replay layer to dispense.
            expect(run.llmTable.size).toBeGreaterThan(0)
            // And it captured the deliverable, which is the oracle for replays.
            const completed = eventsOf(run.trace.events, "run-completed")[0] as RunCompletedEvent
            expect(completed.output).toBeDefined()
            expect(completed.output).toBe(result.output)
        } finally {
            await agent.dispose()
        }
    }, 15000)

    test("replay arm: committed fixture + makeReplayLLMLayer reproduces the golden, keyless", async () => {
        const run = await loadRecordedRun(FIXTURE)
        const exchanges = eventsOf(run.trace.events, "llm-exchange")
        expect(exchanges.length).toBeGreaterThan(0)

        // The live recorder stamps run-started.task as "" (see module header),
        // so the task the CI lane replays is extracted from the golden's first
        // exchange rather than RecordedRun.task.
        const firstUser = exchanges[0]!.messages.find((m) => m.role === "user")
        expect(firstUser).toBeDefined()
        const task = firstUser!.content

        const table = buildSequentialLLMTable(run.trace.events)
        expect(table.size).toBe(exchanges.length)

        const agent = await ReactiveAgents.create()
            // Provider is functionally irrelevant — `.withReplayLLM` replaces
            // LLMService upstream of every consumer. "test" needs no keys, and
            // with NO scenario configured it could not answer if the replay
            // layer were not serving every call.
            .withProvider("test")
            .withModel(run.model || "replay")
            .withReasoning({ defaultStrategy: "reactive" })
            .withMaxIterations(2)
            // CI lane must not re-record into the trace dir.
            .withObservability({ tracing: false })
            .withReplayLLM(makeReplayLLMLayer(table))
            .build()
        try {
            const result = await agent.run(task)
            const completed = eventsOf(run.trace.events, "run-completed")[0] as RunCompletedEvent
            expect(result.success).toBe(true)
            // THE keystone assertion: byte-identical reproduction of the recorded
            // deliverable, dispensed entirely from the committed fixture.
            expect(completed.output).toBeDefined()
            expect(completed.output).toBe(result.output)
            expect(result.output).toBe("deterministic replay works.")
        } finally {
            await agent.dispose()
        }
    }, 15000)
})
