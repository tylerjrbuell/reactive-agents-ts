import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { CheckEntry } from "./manifest.ts"
import { measures } from "./measures.ts"

/** One ceiling compared with its measured value. */
export interface RatchetRow {
  id: string
  file: string
  /** Ceiling key; `undefined` for a single named constant. */
  key: string | undefined
  constant: string
  old: number
  measured: number
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Ceiling patterns in order: quoted ledger entry, bracketed map entry, `KEY = N` assignment. */
function patterns(key: string): readonly RegExp[] {
  const k = escapeRe(key)
  return [
    new RegExp(`("${k}:)(\\d+)(")`),
    new RegExp(`(\\[${k}\\]=)(\\d+)()`),
    new RegExp(`(^[ \\t]*(?:export )?(?:const )?${k}[ \\t]*=[ \\t]*)(\\d+)()`, "m"),
  ]
}

/** Current ceiling for `key` in `text`, or undefined. */
export function readCeiling(text: string, key: string): number | undefined {
  for (const re of patterns(key)) {
    const m = re.exec(text)
    if (m) return Number(m[2])
  }
  return undefined
}

/** Replace the ceiling for `key` in `text`; returns `text` unchanged if the key is absent. */
export function writeCeiling(text: string, key: string, value: number): string {
  for (const re of patterns(key)) {
    if (re.test(text)) return text.replace(re, (_m, a: string, _n: string, c: string) => `${a}${value}${c}`)
  }
  return text
}

/** Measure every ratchet declared on `checks` and compare with the stored ceilings. */
export function evaluateRatchets(root: string, checks: readonly CheckEntry[]): readonly RatchetRow[] {
  const rows: RatchetRow[] = []
  for (const c of checks) {
    for (const r of c.ratchet ?? []) {
      const measure = measures[r.measure]
      if (!measure) throw new Error(`${c.id}: unknown measurer ${r.measure}`)
      const text = readFileSync(join(root, r.file), "utf8")
      const measured = measure(root, text)
      const all = r.constant === "*"
      const keys = all ? [...new Set([...measured.keys()])].sort() : [r.constant]
      for (const key of keys) {
        const stored = readCeiling(text, key)
        if (stored === undefined && !all) throw new Error(`${c.id}: ceiling ${key} not found in ${r.file}`)
        rows.push({
          id: c.id,
          file: r.file,
          key: all ? key : undefined,
          constant: key,
          old: stored ?? 0,
          measured: measured.get(key) ?? 0,
        })
      }
    }
  }
  return rows
}

/** Write every tightening row (measured < old) back to disk. Never raises a ceiling. */
export function applyTightening(root: string, rows: readonly RatchetRow[]): void {
  const byFile = new Map<string, RatchetRow[]>()
  for (const r of rows) if (r.measured < r.old) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r])
  for (const [file, list] of byFile) {
    const path = join(root, file)
    let text = readFileSync(path, "utf8")
    for (const r of list) text = writeCeiling(text, r.constant, r.measured)
    writeFileSync(path, text)
  }
}
