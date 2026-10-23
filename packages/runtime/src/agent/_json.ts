/**
 * Internal JSON helpers for the `agent/` facade families.
 *
 * INTERNAL MODULE — not re-exported from `src/index.ts`; import it only from
 * within `packages/runtime/src/agent/`. This file is the #261 dedup of the
 * two #217-era carried copies of `safeParseJson` that lived verbatim (same
 * body, same parameter name) in both `agent/durable-facade.ts` and
 * `agent/run-task-effect.ts` after the facade extraction; each original
 * JSDoc pointed at the other as its twin.
 */

/** Parse stored approval args JSON, falling back to the raw string on malformed input. */
export const safeParseJson = (s: string): unknown => {
    try {
        return JSON.parse(s)
    } catch {
        return s
    }
}
