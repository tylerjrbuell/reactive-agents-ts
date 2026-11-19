#!/usr/bin/env bun
// scripts/update-prices.ts
//
// Regenerate or drift-check llm-provider's bundled price snapshot
// (packages/llm-provider/src/price-book/snapshot.generated.ts) from LiteLLM's
// model_prices_and_context_window.json. The filtering and rendering live in
// llm-provider (`buildPriceSnapshot`, `renderPriceSnapshotModule`); this script
// only downloads, writes, and diffs.
//
// Usage:
//   bun run prices:update [--url <u>] [--as-of YYYY-MM-DD] [--fail-on-drift]
//     Download, regenerate the snapshot, print an added/removed/changed summary.
//     --fail-on-drift exits 1 when any row changed (an asOf-only bump does not
//     count); the weekly prices workflow uses it.
//   bun run prices:check  [--url <u>] [--offline]
//     Report rows that differ from the live table and the snapshot's age.
//     Always exits 0: past STALE_AFTER_DAYS it prints a STALE warning. With
//     --offline or PRICES_OFFLINE=1 (and when the fetch fails) the drift part
//     is skipped. The repo gate (scripts/check-prices.sh) runs --offline.
//     Drift is enforced by .github/workflows/prices.yml (weekly), which runs
//     prices:update and fails if the snapshot changed.
//
// The source URL defaults to LITELLM_PRICES_URL; `--url` or the
// LITELLM_PRICES_URL env var override it.

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import {
  buildPriceSnapshot,
  LITELLM_PRICES_URL,
  renderPriceSnapshotModule,
  type PriceRates,
} from "@reactive-agents/llm-provider"

/** Snapshot age (days) past which `--check` fails. */
export const STALE_AFTER_DAYS = 30

/** Download timeout; past it the drift check counts as offline. */
const FETCH_TIMEOUT_MS = 15_000

/** Ids listed per diff category before the output is cut. */
const LIST_CAP = 20

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const SNAPSHOT_PATH = join(ROOT, "packages/llm-provider/src/price-book/snapshot.generated.ts")

/** The committed snapshot as read back from its rendered module text. */
export interface ParsedSnapshot {
  asOf: string
  sourceUrl: string
  rows: Record<string, PriceRates>
}

const ROW_LINE = /^ {4}("(?:[^"\\]|\\.)*"): (\{.*\}),$/
const FIELD_LINE = (name: string) => new RegExp(`^ {2}${name}: ("(?:[^"\\\\]|\\\\.)*"),$`)

/**
 * Parse a module produced by `renderPriceSnapshotModule` back into its data.
 * The renderer writes one JSON row per line, so this needs no TS evaluation.
 * Throws when `asOf` or `sourceUrl` is missing (the file is not a rendered snapshot).
 */
export function parseSnapshotModule(text: string): ParsedSnapshot {
  let asOf: string | undefined
  let sourceUrl: string | undefined
  const rows: Record<string, PriceRates> = {}
  for (const line of text.split("\n")) {
    const row = ROW_LINE.exec(line)
    if (row !== null) {
      rows[JSON.parse(row[1] as string) as string] = JSON.parse(row[2] as string) as PriceRates
      continue
    }
    const a = FIELD_LINE("asOf").exec(line)
    if (a !== null) asOf = JSON.parse(a[1] as string) as string
    const u = FIELD_LINE("sourceUrl").exec(line)
    if (u !== null) sourceUrl = JSON.parse(u[1] as string) as string
  }
  if (asOf === undefined || sourceUrl === undefined)
    throw new Error("not a rendered price snapshot: asOf or sourceUrl line missing")
  return { asOf, sourceUrl, rows }
}

/** One changed row: the top-level fields whose values differ. */
export interface RowChange {
  id: string
  fields: { field: string; from: unknown; to: unknown }[]
}

/** Row-level difference between two snapshots. Ids are sorted. */
export interface SnapshotDiff {
  added: string[]
  removed: string[]
  changed: RowChange[]
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Compare two snapshots' rows by id, then by top-level field. */
export function diffSnapshotRows(
  before: Readonly<Record<string, PriceRates>>,
  after: Readonly<Record<string, PriceRates>>,
): SnapshotDiff {
  const added = Object.keys(after).filter((id) => !(id in before)).sort()
  const removed = Object.keys(before).filter((id) => !(id in after)).sort()
  const changed: RowChange[] = []
  for (const id of Object.keys(after).sort()) {
    const a = before[id] as Record<string, unknown> | undefined
    const b = after[id] as Record<string, unknown>
    if (a === undefined || same(a, b)) continue
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
    changed.push({ id, fields: keys.filter((k) => !same(a[k], b[k])).map((k) => ({ field: k, from: a[k], to: b[k] })) })
  }
  return { added, removed, changed }
}

/** Whole days from `asOf` (YYYY-MM-DD) to `today` (YYYY-MM-DD). Throws on a malformed date. */
export function snapshotAgeDays(asOf: string, today: string): number {
  const parse = (d: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`expected YYYY-MM-DD, got ${JSON.stringify(d)}`)
    return Date.parse(`${d}T00:00:00Z`)
  }
  return Math.round((parse(today) - parse(asOf)) / 86_400_000)
}

/** True when the snapshot is older than `maxDays`. */
export const isStale = (asOf: string, today: string, maxDays: number = STALE_AFTER_DAYS): boolean =>
  snapshotAgeDays(asOf, today) > maxDays

const show = (v: unknown): string => (v === undefined ? "-" : typeof v === "object" ? JSON.stringify(v) : String(v))

/** Bounded human summary of a diff: counts first, at most `cap` ids per category. */
export function formatDiff(diff: SnapshotDiff, cap: number = LIST_CAP): string[] {
  const out = [`rows: +${diff.added.length} added, -${diff.removed.length} removed, ~${diff.changed.length} changed`]
  const section = (label: string, items: string[]) => {
    if (items.length === 0) return
    out.push(`${label}:`)
    for (const s of items.slice(0, cap)) out.push(`  ${s}`)
    if (items.length > cap) out.push(`  ... and ${items.length - cap} more`)
  }
  section("added", diff.added)
  section("removed", diff.removed)
  section(
    "changed",
    diff.changed.map((c) => `${c.id}: ${c.fields.map((f) => `${f.field} ${show(f.from)} -> ${show(f.to)}`).join(", ")}`),
  )
  return out
}

const today = (): string => new Date().toISOString().slice(0, 10)

function flag(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

async function download(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
  return res.json()
}

async function update(args: readonly string[], url: string): Promise<number> {
  const asOf = flag(args, "--as-of") ?? today()
  snapshotAgeDays(asOf, asOf) // validates the format
  const prev = readFileSync(SNAPSHOT_PATH, "utf8")
  const before = parseSnapshotModule(prev)
  const snapshot = buildPriceSnapshot(await download(url), asOf, url)
  const rendered = renderPriceSnapshotModule(snapshot)
  const rel = relative(ROOT, SNAPSHOT_PATH)
  const diff = diffSnapshotRows(before.rows, snapshot.rows)
  for (const line of formatDiff(diff)) console.log(line)
  if (rendered === prev) {
    console.log(`unchanged: ${rel} (${Object.keys(snapshot.rows).length} rows, asOf ${asOf})`)
  } else {
    writeFileSync(SNAPSHOT_PATH, rendered)
    console.log(`wrote ${rel} (${Object.keys(snapshot.rows).length} rows, asOf ${before.asOf} -> ${asOf})`)
  }
  const drifted = hasDrift(diff)
  if (drifted && args.includes("--fail-on-drift")) {
    console.log(`next: prices drifted; run bun run prices:update locally, review git diff ${rel}, commit`)
    return 1
  }
  console.log(`next: git diff ${rel}; corrections go in price-book/overrides.ts`)
  return 0
}

/** True when any row was added, removed or changed. An asOf-only bump is not drift. */
export const hasDrift = (diff: SnapshotDiff): boolean =>
  diff.added.length + diff.removed.length + diff.changed.length > 0

/**
 * Age lines of the check: a STALE warning past `maxDays`, never a failure.
 * The last line is the `next:` hint.
 */
export function ageReport(asOf: string, today: string, maxDays: number = STALE_AFTER_DAYS): string[] {
  const age = snapshotAgeDays(asOf, today)
  const stale = age > maxDays
  return [
    `age: snapshot asOf ${asOf} is ${age} day(s) old (limit ${maxDays})${stale ? ": STALE (warning only)" : ""}`,
    stale ? "next: bun run prices:update (needs network), review the diff, commit" : "next: none (report-only)",
  ]
}

/**
 * Report drift and age. Always exits 0: staleness is a warning, and drift is
 * caught by the scheduled prices workflow, not by this check. `offline` (the
 * repo gate) skips the download entirely.
 */
async function check(url: string, offline: boolean): Promise<number> {
  const committed = parseSnapshotModule(readFileSync(SNAPSHOT_PATH, "utf8"))
  const now = today()
  if (offline) {
    console.log("drift: skipped (offline gate; run bun run prices:check to download and diff)")
  } else {
    try {
      const live = buildPriceSnapshot(await download(url), now, url)
      for (const line of formatDiff(diffSnapshotRows(committed.rows, live.rows))) console.log(`drift ${line}`)
    } catch (e) {
      console.log(`drift: skipped, source unreachable (${e instanceof Error ? e.message : String(e)})`)
    }
  }
  for (const line of ageReport(committed.asOf, now)) console.log(line)
  return 0
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const url = flag(args, "--url") ?? process.env.LITELLM_PRICES_URL ?? LITELLM_PRICES_URL
  const offline = args.includes("--offline") || process.env.PRICES_OFFLINE === "1"
  return args.includes("--check") ? check(url, offline) : update(args, url)
}

if (import.meta.main) process.exit(await main())
