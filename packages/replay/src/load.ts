import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join, isAbsolute } from "node:path"
import { loadTrace } from "@reactive-agents/trace"
import type { TraceEvent } from "@reactive-agents/trace"
import { buildToolTable } from "./tool-table.js"
import type { RecordedRun } from "./types.js"

const SEARCH_DIRS = [
    join(homedir(), ".reactive-agents", "traces"),
    join(process.cwd(), ".reactive-agents", "traces"),
]

interface RunStartedShape {
    readonly kind: "run-started"
    readonly task: string
    readonly model: string
    readonly provider: string
    readonly config: Record<string, unknown>
}

export async function loadRecordedRun(idOrPath: string): Promise<RecordedRun> {
    const path = resolvePath(idOrPath)
    const trace = await loadTrace(path)
    const runStarted = trace.events.find(
        (e): e is TraceEvent & RunStartedShape => e.kind === "run-started",
    )
    if (!runStarted) {
        throw new Error(`replay: no run-started event in ${path}`)
    }
    const toolTable = buildToolTable(trace.events)
    return {
        runId: trace.runId,
        task: runStarted.task,
        model: runStarted.model,
        provider: runStarted.provider,
        config: runStarted.config,
        trace,
        toolTable,
    }
}

function resolvePath(idOrPath: string): string {
    if (isAbsolute(idOrPath) && existsSync(idOrPath)) return idOrPath
    if (existsSync(idOrPath)) return idOrPath
    for (const dir of SEARCH_DIRS) {
        const candidate = join(dir, `${idOrPath}.jsonl`)
        if (existsSync(candidate)) return candidate
    }
    throw new Error(`replay: cannot resolve ${idOrPath}; searched ${SEARCH_DIRS.join(", ")}`)
}
