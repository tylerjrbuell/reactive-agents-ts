import { diffTraces } from "./diff.js"
import { snapshotFromAgentResult, snapshotFromRecordedRun, type AgentRunOutcome } from "./snapshot.js"
import type { BuildContext, BuilderFn, RecordedRun, ReplayOverrides, ReplayResult } from "./types.js"

/**
 * Re-run a recorded agent run with optional prompt/model overrides.
 *
 * The builder function is responsible for constructing an agent that uses the
 * replay tool layer ({@link makeReplayToolLayer}) so tool results are dispensed
 * from the recording rather than executed live. Builder must return an object
 * exposing `run(task: string): Promise<AgentRunOutcome>` and an optional
 * `dispose()`. The orchestrator invokes `run(recordedRun.task)`, captures the
 * outcome, and produces a structural diff against the original.
 */
export async function replay(
    recordedRun: RecordedRun,
    builderFn: BuilderFn,
    overrides: ReplayOverrides = {},
): Promise<ReplayResult> {
    const ctx: BuildContext = { overrides, recordedRun }
    const agent = (await (builderFn.length > 0
        ? (builderFn as (c: BuildContext) => Promise<unknown>)(ctx)
        : (builderFn as () => Promise<unknown>)())) as {
            run: (task: string) => Promise<AgentRunOutcome>
            dispose?: () => Promise<void>
        }
    try {
        const result = await agent.run(recordedRun.task)
        const original = snapshotFromRecordedRun(recordedRun)
        const replaySnapshot = snapshotFromAgentResult(result, recordedRun)
        const diff = diffTraces(original, replaySnapshot)
        return { original, replay: replaySnapshot, diff }
    } finally {
        if (typeof agent.dispose === "function") {
            await agent.dispose()
        }
    }
}
