// File: src/h3/tasks-v2.ts
//
// H3 suite v2 ADDITIVE tasks (wiki/Planning/Implementation-Plans/2026-11-19-suite-v2-and-headline-measurement.md, section A).
//
// Each v2 task is its frozen source task with ONE change: a `code-execute` tool entry
// of kind "available", so a calculation lever is visible. Prompt, fixtures, hidden
// check, criteria, limits and scorer are inherited unchanged, so `rw-2` vs `rw-2-calc`
// is a free lever A/B. The frozen suite (`tasks.ts`, `h3-manifest.json`) is untouched;
// these tasks are NOT in the default run set and are selectable by id only
// (`--task rw-2-calc`). Own manifest: `h3v2-manifest.json` (`bun run src/h3/freeze.ts`).
//
// `required` stays as it was for the legacy path: `file-read` only for rw-2/rw-3
// (computeGroundingSet feeds only `required` names to the terminal gate), and the two
// existing required entries for h3-plan-only. `available` code-execute is exposed but
// never gates the terminal.
import type { BenchmarkTask } from "../types.js"
import { H3_TASKS } from "./tasks.js"

const CALC = { kind: "available", name: "code-execute" } as const

/** Frozen source id -> derived v2 id. */
export const H3_V2_DERIVATIONS: ReadonlyArray<{ readonly from: string; readonly id: string }> = [
  { from: "rw-2", id: "rw-2-calc" },
  { from: "rw-3", id: "rw-3-calc" },
  { from: "h3-plan-only", id: "h3-plan-only-calc" },
]

/** Pure derivation: same task, new id, `code-execute` offered as an available tool. */
export function deriveCalcTask(source: BenchmarkTask, id: string): BenchmarkTask {
  const base = source.tools ?? [{ kind: "required", name: "file-read" } as const]
  return { ...source, id, tools: [...base, CALC] }
}

/** The v2 additive tasks (derived from the frozen suite; never part of the default run set). */
export const H3_V2_TASKS: readonly BenchmarkTask[] = H3_V2_DERIVATIONS.flatMap(({ from, id }) => {
  const src = H3_TASKS.find((t) => t.id === from)
  return src ? [deriveCalcTask(src, id)] : []
})

/** Ids of the v2 tasks. */
export const H3_V2_IDS: readonly string[] = H3_V2_TASKS.map((t) => t.id)

/** Frozen tasks plus v2 tasks: the pool a `--task` filter resolves against. */
export const H3_SELECTABLE_TASKS: readonly BenchmarkTask[] = [...H3_TASKS, ...H3_V2_TASKS]
