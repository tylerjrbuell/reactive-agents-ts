#!/usr/bin/env bun
/**
 * Task 0 gate: prove one captured S1 baseline fixture replays deterministically
 * through the W0.8 cookbook lane (loadRecordedRun + buildSequentialLLMTable +
 * makeReplayLLMLayer + .withReplayLLM), reproducing the recorded run's terminal
 * output and verdict keyless/offline. Run:
 *   bun run scripts/lift/replay-gate.ts [traceFile]
 * Defaults to the s1-qwen34b run-1 fixture.
 */
import { basename } from "node:path"
import { ReactiveAgents } from "@reactive-agents/runtime"
import { buildSequentialLLMTable, loadRecordedRun, makeReplayLLMLayer } from "@reactive-agents/replay"
import { FIXTURES_DIR } from "./bench.ts"

const TARGET = process.argv[2] ?? `${FIXTURES_DIR}/01M4SX78BT4RB543SWFP5F4DXS.jsonl`

const recorded = await loadRecordedRun(TARGET)
const exchanges = recorded.trace.events.filter((e) => e.kind === "llm-exchange")
const completed = recorded.trace.events.find((e) => e.kind === "run-completed")
if (completed === undefined || completed.kind !== "run-completed") {
  console.error("GATE FAIL: fixture has no run-completed event")
  process.exit(1)
}
const table = buildSequentialLLMTable(recorded.trace.events)
if (table.size !== exchanges.length) {
  console.error(`GATE FAIL: table size ${table.size} != exchanges ${exchanges.length}`)
  process.exit(1)
}

const agent = await ReactiveAgents.create()
  .withProvider("test")
  .withModel(recorded.model || "replay")
  .withoutMemory()
  .withReasoning({ strategies: { reactive: { maxIterations: 10 } } })
  .withObservability({ tracing: false })
  .withReplayLLM(makeReplayLLMLayer(table))
  .build()

try {
  const result = await agent.run(recorded.task)
  const recordedOut = String(completed.output ?? "")
  const replayOut = String(result.output ?? "")
  const outMatch = recordedOut === replayOut
  const verdictMatch = completed.status === (result.success ? "success" : "failure")
  console.log(JSON.stringify({
    gate: "s1-replay-determinism",
    fixture: basename(TARGET),
    recordedOutputChars: (completed.output ?? "").length,
    replayOutputChars: result.output.length,
    byteIdentical: outMatch,
    recordedStatus: completed.status,
    replaySuccess: result.success,
    verdictMatch,
    verdict: outMatch && verdictMatch ? "PASS" : "FAIL",
  }))
  process.exitCode = outMatch && verdictMatch ? 0 : 1
} finally {
  await agent.dispose()
}
