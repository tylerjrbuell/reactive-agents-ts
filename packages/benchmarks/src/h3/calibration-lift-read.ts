// File: src/h3/calibration-lift-read.ts — void check + read for the adaptive (calibration) lift test.
//
//   bun run src/h3/calibration-lift-read.ts --void <results.json> --arm off|on|swap [--partner <modelId>]
//
// Void rule (pre-registered, wiki/Research/Harness-Reports/2026-11-19-adaptive-lift/PREDICTIONS.md):
// a cell is KEPT only when its trace's `run-started.config.calibration` matches the arm:
//   off  -> mode "skip", no fields
//   on   -> mode "auto", fields non-empty, every field has a `source`
//   swap -> mode "custom", modelId == partner (tier cogito:8b <-> qwen3:4b)
import { readFileSync } from "node:fs"
import { parseTrace } from "@reactive-agents/trace"
import type { H3Cell, H3Results } from "./run-h3.js"

export type CalibrationArm = "off" | "on" | "swap"

export interface CalibrationRecord {
  readonly mode?: string
  readonly modelId?: string
  readonly tiers?: readonly string[]
  readonly fields?: Readonly<Record<string, { readonly value: unknown; readonly source?: string }>>
}

export const partnerOf = (tier: string): string | null => (tier === "cogito:8b" ? "qwen3:4b" : tier === "qwen3:4b" ? "cogito:8b" : null)

/** The calibration record + env snapshot stamped in a trace's run-started event (null: no trace / no event). */
export function calibrationOfTrace(traceFile: string | null): { readonly calibration: CalibrationRecord | null; readonly actOrAnswerSource: string | null } | null {
  if (!traceFile) return null
  let text: string
  try { text = readFileSync(traceFile, "utf8") } catch { return null }
  const started = parseTrace(text).events.find((e) => e.kind === "run-started") as Record<string, unknown> | undefined
  if (!started) return null
  const config = (started.config ?? {}) as Record<string, unknown>
  const calibration = (config.calibration ?? null) as CalibrationRecord | null
  // The runtime writes it under config.mechanisms (execute-run-config.ts), not at the config root.
  const mechanisms = (config.mechanisms ?? {}) as Record<string, unknown>
  const aoa = mechanisms.actOrAnswerSource ?? config.actOrAnswerSource
  return { calibration, actOrAnswerSource: typeof aoa === "string" ? aoa : aoa == null ? null : JSON.stringify(aoa) }
}

/** `null` when the cell matches its arm, else the reason it is void. */
export function voidReason(cell: H3Cell, arm: CalibrationArm): string | null {
  const t = calibrationOfTrace(cell.traceFile)
  if (!t) return "no-trace"
  const c = t.calibration
  if (!c || typeof c.mode !== "string") return "no-calibration-record"
  const fields = Object.entries(c.fields ?? {})
  if (arm === "off") return c.mode === "skip" && fields.length === 0 ? null : `mode=${c.mode} fields=${fields.length}`
  if (arm === "on") return c.mode === "auto" && fields.length > 0 && fields.every(([, f]) => typeof f.source === "string") ? null : `mode=${c.mode} fields=${fields.length}`
  const partner = partnerOf(cell.tier)
  return c.mode === "custom" && c.modelId === partner ? null : `mode=${c.mode} modelId=${c.modelId} want custom/${partner}`
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

if (import.meta.main) {
  const file = arg("void")
  const arm = arg("arm") as CalibrationArm | undefined
  if (!file || !arm || !["off", "on", "swap"].includes(arm)) {
    console.error("usage: --void <results.json> --arm off|on|swap")
    process.exit(2)
  }
  const r = JSON.parse(readFileSync(file, "utf8")) as H3Results
  let kept = 0
  const voids: string[] = []
  for (const c of r.cells) {
    const why = voidReason(c, arm)
    if (why === null) kept++
    else voids.push(`${c.cellId}: ${why}`)
  }
  console.log(`arm=${arm} cells=${r.cells.length} kept=${kept} void=${voids.length}`)
  for (const v of voids) console.log(`  VOID ${v}`)
  process.exit(voids.length === 0 ? 0 : 1)
}
