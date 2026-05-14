// `rax-diagnose replay-run <runId>` — summary of a recorded run that can be
// fed into the `replay()` API. Full re-execution is API-only in v0.11
// because it requires a builder factory; this command surfaces the metadata
// and tool recording stats needed to construct one.

import { loadRecordedRun } from "@reactive-agents/replay"

export interface ReplayRunOpts {
    readonly json?: boolean
}

export async function replayRunCommand(idOrPath: string, opts: ReplayRunOpts = {}): Promise<void> {
    const run = await loadRecordedRun(idOrPath)
    const toolCount = [...run.toolTable.values()].reduce((acc, l) => acc + l.length, 0)
    const uniqueTools = new Set([...run.toolTable.values()].flat().map((r) => r.toolName))

    if (opts.json) {
        console.log(JSON.stringify({
            runId: run.runId,
            task: run.task,
            model: run.model,
            provider: run.provider,
            config: run.config,
            events: run.trace.events.length,
            toolCalls: toolCount,
            uniqueTools: [...uniqueTools].sort(),
        }, null, 2))
        return
    }

    console.log(`runId    ${run.runId}`)
    console.log(`task     ${run.task}`)
    console.log(`model    ${run.model}`)
    console.log(`provider ${run.provider}`)
    console.log(`events   ${run.trace.events.length}`)
    console.log(`tools    ${toolCount} calls across ${uniqueTools.size} unique tool(s): ${[...uniqueTools].sort().join(", ") || "(none)"}`)
    console.log("")
    console.log("To re-execute: import { replay, makeReplayController, makeReplayToolLayer } from \"@reactive-agents/replay\"")
    console.log("and pass a builder factory that wires the replay tool layer via .withLayers().")
}
