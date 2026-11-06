// File: src/h3/freeze.ts — content-hash manifests for the frozen H3 task sets.
//   bun run src/h3/freeze.ts   # (re)writes h3-manifest.json AND lh-manifest.json — a DELIBERATE act
import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { BenchmarkTask } from "../types.js"
import { H3_TASKS } from "./tasks.js"
import { LH_TASKS } from "./long-horizon-tasks.js"

/** Stable (key-sorted) JSON so the hash does not depend on property order. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`
  }
  return JSON.stringify(v)
}

/** sha256 per task id over the full definition (prompt, fixtures, hidden checks, criteria, tools, limits). */
export function taskHashes(tasks: readonly BenchmarkTask[]): Record<string, string> {
  return Object.fromEntries(tasks.map((t) => [t.id, createHash("sha256").update(canonical(t)).digest("hex")]))
}

/** One hash over the ordered per-task hashes: the suite fingerprint. */
export function suiteHashOf(tasks: readonly BenchmarkTask[]): string {
  return createHash("sha256").update(Object.entries(taskHashes(tasks)).map(([k, v]) => `${k}:${v}`).join("\n")).digest("hex")
}

/** Per-task hashes of the frozen H3 suite. */
export const h3Hashes = (): Record<string, string> => taskHashes(H3_TASKS)
/** Fingerprint of the frozen H3 suite. */
export const h3SuiteHash = (): string => suiteHashOf(H3_TASKS)
/** Per-task hashes of the frozen long-horizon suite (Plan 9 0e). */
export const lhHashes = (): Record<string, string> => taskHashes(LH_TASKS)
/** Fingerprint of the frozen long-horizon suite (Plan 9 0e). */
export const lhSuiteHash = (): string => suiteHashOf(LH_TASKS)

export const MANIFEST_PATH = join(dirname(new URL(import.meta.url).pathname), "h3-manifest.json")
export const LH_MANIFEST_PATH = join(dirname(new URL(import.meta.url).pathname), "lh-manifest.json")

if (import.meta.main) {
  writeFileSync(MANIFEST_PATH, JSON.stringify({ suiteHash: h3SuiteHash(), tasks: h3Hashes() }, null, 2) + "\n", "utf8")
  writeFileSync(LH_MANIFEST_PATH, JSON.stringify({ suiteHash: lhSuiteHash(), tasks: lhHashes() }, null, 2) + "\n", "utf8")
  console.log(`froze ${H3_TASKS.length} tasks -> ${MANIFEST_PATH}`)
  console.log(`froze ${LH_TASKS.length} tasks -> ${LH_MANIFEST_PATH}`)
}
