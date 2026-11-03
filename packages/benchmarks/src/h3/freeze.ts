// File: src/h3/freeze.ts — content-hash manifest for the frozen H3 task set.
//   bun run src/h3/freeze.ts   # (re)writes h3-manifest.json — a DELIBERATE act
import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { H3_TASKS } from "./tasks.js"

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
export function h3Hashes(): Record<string, string> {
  return Object.fromEntries(H3_TASKS.map((t) => [t.id, createHash("sha256").update(canonical(t)).digest("hex")]))
}

/** One hash over the ordered per-task hashes: the suite fingerprint. */
export function h3SuiteHash(): string {
  return createHash("sha256").update(Object.entries(h3Hashes()).map(([k, v]) => `${k}:${v}`).join("\n")).digest("hex")
}

export const MANIFEST_PATH = join(dirname(new URL(import.meta.url).pathname), "h3-manifest.json")

if (import.meta.main) {
  writeFileSync(MANIFEST_PATH, JSON.stringify({ suiteHash: h3SuiteHash(), tasks: h3Hashes() }, null, 2) + "\n", "utf8")
  console.log(`froze ${H3_TASKS.length} tasks -> ${MANIFEST_PATH}`)
}
