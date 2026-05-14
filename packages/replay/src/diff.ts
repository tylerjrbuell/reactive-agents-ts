import type { ReplayDiff, TraceSnapshot, ToolSeqEdit } from "./types.js"

export function diffTraces(a: TraceSnapshot, b: TraceSnapshot): ReplayDiff {
    const outputEqual = a.output === b.output
    const toolSequenceDiff = diffToolSequence(a.toolCalls, b.toolCalls)
    const identical =
        outputEqual &&
        a.iterations === b.iterations &&
        toolSequenceDiff.length === 0 &&
        a.totalTokens === b.totalTokens
    return {
        identical,
        iterationsDelta: b.iterations - a.iterations,
        toolSequenceDiff,
        outputDiff: { original: a.output, replay: b.output, equal: outputEqual },
        tokensDelta: b.totalTokens - a.totalTokens,
        costDelta: b.totalCostUsd - a.totalCostUsd,
        durationDeltaMs: b.durationMs - a.durationMs,
    }
}

function diffToolSequence(
    a: readonly { readonly toolName: string; readonly argsHash: string }[],
    b: readonly { readonly toolName: string; readonly argsHash: string }[],
): ToolSeqEdit[] {
    const edits: ToolSeqEdit[] = []
    const len = Math.max(a.length, b.length)
    for (let i = 0; i < len; i++) {
        const x = a[i]
        const y = b[i]
        if (x && !y) {
            edits.push({ kind: "removed", toolName: x.toolName, argsHash: x.argsHash, atIndex: i })
        } else if (!x && y) {
            edits.push({ kind: "added", toolName: y.toolName, argsHash: y.argsHash, atIndex: i })
        } else if (x && y && (x.toolName !== y.toolName || x.argsHash !== y.argsHash)) {
            edits.push({ kind: "removed", toolName: x.toolName, argsHash: x.argsHash, atIndex: i })
            edits.push({ kind: "added", toolName: y.toolName, argsHash: y.argsHash, atIndex: i })
        }
    }
    return edits
}
