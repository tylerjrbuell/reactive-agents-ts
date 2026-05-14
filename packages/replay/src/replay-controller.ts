import { computeArgsHash } from "./tool-table.js"
import type { RecordedToolResult } from "./types.js"

export type ReplayHit =
    | { readonly hit: true; readonly result: unknown; readonly ok: boolean; readonly error?: string; readonly truncated?: boolean }
    | { readonly hit: false }

export interface ReplayResultProvider {
    readonly next: (toolName: string, args: unknown) => ReplayHit
}

export function makeReplayController(
    table: ReadonlyMap<string, readonly RecordedToolResult[]>,
): ReplayResultProvider {
    const cursors = new Map<string, number>()
    return {
        next(toolName, args) {
            const key = `${toolName}::${computeArgsHash(args)}`
            const list = table.get(key)
            if (!list) return { hit: false }
            const idx = cursors.get(key) ?? 0
            if (idx >= list.length) return { hit: false }
            cursors.set(key, idx + 1)
            const rec = list[idx]
            return {
                hit: true,
                result: rec.result,
                ok: rec.ok,
                error: rec.error,
                truncated: rec.truncated,
            }
        },
    }
}
