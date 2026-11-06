// File: src/h3/long-horizon-tasks.ts
//
// H3 long-horizon suite (Plan 9 item 0e,
// wiki/Planning/Implementation-Plans/2026-11-04-architecture-convergence-program.md).
//
// Why it exists: the trace corpus had no run past 9 iterations, so the lift-gated
// Plan 9 items (2c cap handoff, 2f progress-aware guards, 2g switching) had nothing
// to be measured on. Every task here needs many tool steps by construction.
//
// Frozen like H3: `lh-manifest.json` pins a sha256 per task and
// `tests/h3-long-horizon.test.ts` fails when a definition changes. To change a
// task, make a new id and re-freeze deliberately (`bun run src/h3/freeze.ts`).
//
// Grader rule: DETERMINISTIC ONLY (hidden file checks / hidden reference tests).
// The three existing tasks keep their ids and graders (rw-4, rw-7, lh-1) with the
// judge rubrics stripped, exactly as H3 does.
//
// Network: rw-4 needs jsonplaceholder.typicode.com and lh-1 needs a working
// `web-search` provider. The three new tasks are fully offline.
import { gradedCheckHarness } from "../tasks/graded-check.js"
import { REAL_WORLD_TASKS } from "../tasks/real-world.js"
import { LONG_HORIZON_TASKS } from "../tasks/long-horizon.js"
import type { BenchmarkTask } from "../types.js"

/** Deterministic LCG so fixtures are byte-stable across machines and runs. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

const hiddenCheck = (body: string): string =>
  `${gradedCheckHarness()}
import { existsSync, readFileSync } from "node:fs"
const read = (p: string): string => (existsSync(p) ? readFileSync(p, "utf8") : "")
const json = (p: string): unknown => JSON.parse(read(p))
${body}
report()
`

// ── lh-debug-green: six modules, one bug each, a visible failing test per module ──

/** Each module: the buggy source the agent gets, the fixed source (test-only reference), the visible test. */
export interface DebugModule {
  readonly name: string
  readonly buggy: string
  readonly fixed: string
  readonly test: string
}

export const DEBUG_MODULES: readonly DebugModule[] = [
  {
    name: "clamp",
    buggy: `export function clamp(x: number, lo: number, hi: number): number {\n  return Math.min(lo, Math.max(hi, x))\n}\n`,
    fixed: `export function clamp(x: number, lo: number, hi: number): number {\n  return Math.min(hi, Math.max(lo, x))\n}\n`,
    test: `import { expect, it } from "bun:test"\nimport { clamp } from "../src/clamp"\n\nit("keeps values inside the range", () => expect(clamp(5, 0, 10)).toBe(5))\nit("clamps below", () => expect(clamp(-3, 0, 10)).toBe(0))\nit("clamps above", () => expect(clamp(42, 0, 10)).toBe(10))\n`,
  },
  {
    name: "slugify",
    buggy: `export function slugify(s: string): string {\n  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")\n}\n`,
    fixed: `export function slugify(s: string): string {\n  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")\n}\n`,
    test: `import { expect, it } from "bun:test"\nimport { slugify } from "../src/slugify"\n\nit("joins words with dashes", () => expect(slugify("Hello World")).toBe("hello-world"))\nit("drops leading and trailing punctuation", () => expect(slugify("  Hello, World!  ")).toBe("hello-world"))\n`,
  },
  {
    name: "chunk",
    buggy: `export function chunk<T>(xs: readonly T[], size: number): T[][] {\n  const out: T[][] = []\n  for (let i = 0; i < xs.length - size; i += size) out.push(xs.slice(i, i + size))\n  return out\n}\n`,
    fixed: `export function chunk<T>(xs: readonly T[], size: number): T[][] {\n  const out: T[][] = []\n  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))\n  return out\n}\n`,
    test: `import { expect, it } from "bun:test"\nimport { chunk } from "../src/chunk"\n\nit("splits evenly", () => expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]))\nit("keeps the short tail", () => expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]))\n`,
  },
  {
    name: "median",
    buggy: `export function median(xs: readonly number[]): number {\n  const s = [...xs].sort()\n  const m = Math.floor(s.length / 2)\n  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2\n}\n`,
    fixed: `export function median(xs: readonly number[]): number {\n  const s = [...xs].sort((a, b) => a - b)\n  const m = Math.floor(s.length / 2)\n  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2\n}\n`,
    test: `import { expect, it } from "bun:test"\nimport { median } from "../src/median"\n\nit("odd count", () => expect(median([10, 9, 2])).toBe(9))\nit("even count", () => expect(median([100, 3, 20, 1])).toBe(11.5))\n`,
  },
  {
    name: "duration",
    buggy: `const UNITS: Record<string, number> = { h: 3600, m: 100, s: 1 }\n\n/** "1h30m15s" -> seconds. */\nexport function parseDuration(s: string): number {\n  let total = 0\n  for (const [, n, u] of s.matchAll(/(\\d+)([hms])/g)) total += Number(n) * UNITS[u!]!\n  return total\n}\n`,
    fixed: `const UNITS: Record<string, number> = { h: 3600, m: 60, s: 1 }\n\n/** "1h30m15s" -> seconds. */\nexport function parseDuration(s: string): number {\n  let total = 0\n  for (const [, n, u] of s.matchAll(/(\\d+)([hms])/g)) total += Number(n) * UNITS[u!]!\n  return total\n}\n`,
    test: `import { expect, it } from "bun:test"\nimport { parseDuration } from "../src/duration"\n\nit("seconds only", () => expect(parseDuration("45s")).toBe(45))\nit("mixed units", () => expect(parseDuration("1h30m15s")).toBe(5415))\n`,
  },
  {
    name: "dedupe",
    buggy: `/** Keep the FIRST item for each key, in input order. */\nexport function dedupeBy<T>(xs: readonly T[], key: (x: T) => string): T[] {\n  const seen = new Set<string>()\n  return xs.filter((x) => {\n    const k = key(x)\n    if (seen.has(k)) return true\n    seen.add(k)\n    return false\n  })\n}\n`,
    fixed: `/** Keep the FIRST item for each key, in input order. */\nexport function dedupeBy<T>(xs: readonly T[], key: (x: T) => string): T[] {\n  const seen = new Set<string>()\n  return xs.filter((x) => {\n    const k = key(x)\n    if (seen.has(k)) return false\n    seen.add(k)\n    return true\n  })\n}\n`,
    test: `import { expect, it } from "bun:test"\nimport { dedupeBy } from "../src/dedupe"\n\nit("keeps the first of each key", () =>\n  expect(dedupeBy([{ k: "a", v: 1 }, { k: "b", v: 2 }, { k: "a", v: 3 }], (x) => x.k)).toEqual([{ k: "a", v: 1 }, { k: "b", v: 2 }]))\n`,
  },
]

// The hidden check re-asserts each visible test's behavior plus one case the
// visible test does not show, so editing the visible tests earns nothing.
const DEBUG_HIDDEN = hiddenCheck(`const load = async (p: string): Promise<Record<string, (...a: never[]) => unknown> | null> => {
  try { return (await import(p)) as Record<string, (...a: never[]) => unknown> } catch { return null }
}
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const clampM = (await load("./src/clamp.ts")) as { clamp: (x: number, lo: number, hi: number) => number } | null
const slugM = (await load("./src/slugify.ts")) as { slugify: (s: string) => string } | null
const chunkM = (await load("./src/chunk.ts")) as { chunk: (xs: number[], n: number) => number[][] } | null
const medianM = (await load("./src/median.ts")) as { median: (xs: number[]) => number } | null
const durM = (await load("./src/duration.ts")) as { parseDuration: (s: string) => number } | null
const dedupeM = (await load("./src/dedupe.ts")) as { dedupeBy: (xs: { k: string; v: number }[], f: (x: { k: string; v: number }) => string) => { k: string; v: number }[] } | null
check("clamp: inside, below, above", () => clampM!.clamp(5, 0, 10) === 5 && clampM!.clamp(-3, 0, 10) === 0 && clampM!.clamp(42, 0, 10) === 10)
check("clamp: hidden range", () => clampM!.clamp(12, 8, 9) === 9)
check("slugify: words and trimmed punctuation", () => slugM!.slugify("Hello World") === "hello-world" && slugM!.slugify("  Hello, World!  ") === "hello-world")
check("slugify: hidden case", () => slugM!.slugify("--Rust & Go--") === "rust-go")
check("chunk: even and tail", () => eq(chunkM!.chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]]) && eq(chunkM!.chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]))
check("chunk: hidden short input", () => eq(chunkM!.chunk([1], 3), [[1]]))
check("median: odd and even", () => medianM!.median([10, 9, 2]) === 9 && medianM!.median([100, 3, 20, 1]) === 11.5)
check("median: hidden numeric order", () => medianM!.median([5, 40, 9]) === 9)
check("duration: seconds and mixed", () => durM!.parseDuration("45s") === 45 && durM!.parseDuration("1h30m15s") === 5415)
check("duration: hidden minutes", () => durM!.parseDuration("2m") === 120)
check("dedupe: first of each key", () => eq(dedupeM!.dedupeBy([{ k: "a", v: 1 }, { k: "b", v: 2 }, { k: "a", v: 3 }], (x) => x.k), [{ k: "a", v: 1 }, { k: "b", v: 2 }]))
check("dedupe: hidden no-dup input kept whole", () => dedupeM!.dedupeBy([{ k: "x", v: 1 }, { k: "y", v: 2 }], (x) => x.k).length === 2)`)

// ── lh-enumerate-audit: twelve invoices, each verified against three rules ──

export interface Invoice {
  readonly id: string
  readonly currency: string
  readonly issued: string
  readonly due: string
  readonly lines: ReadonlyArray<{ readonly qty: number; readonly unit: number }>
  readonly amount: number
}

const CURRENCIES = ["USD", "EUR", "GBP"] as const

/** Twelve invoices; records 3, 6, 8, 11 (1-based) violate one rule each, deterministically. */
export const INVOICES: readonly Invoice[] = (() => {
  const r = lcg(4409)
  return Array.from({ length: 12 }, (_, i): Invoice => {
    const lines = Array.from({ length: 2 + Math.floor(r() * 3) }, () => ({
      qty: 1 + Math.floor(r() * 9),
      unit: Math.round((5 + r() * 200) * 100) / 100,
    }))
    const sum = Math.round(lines.reduce((a, l) => a + l.qty * l.unit, 0) * 100) / 100
    const day = 1 + Math.floor(r() * 20)
    const base: Invoice = {
      id: `INV-${1040 + i * 7}`,
      currency: CURRENCIES[i % 3]!,
      issued: `2026-03-${String(day).padStart(2, "0")}`,
      due: `2026-04-${String(day).padStart(2, "0")}`,
      lines,
      amount: sum,
    }
    if (i === 2) return { ...base, amount: Math.round((sum + 13.5) * 100) / 100 } // amount != lines total
    if (i === 5) return { ...base, due: `2026-02-${String(day).padStart(2, "0")}` } // due before issued
    if (i === 7) return { ...base, currency: "JPY" } // currency not allowed
    if (i === 10) return { ...base, amount: Math.round((sum - 0.5) * 100) / 100 } // amount != lines total
    return base
  })
})()

/** The ground-truth rule, written once so the grader and the prompt agree. */
export function invoiceValid(inv: Invoice): boolean {
  const total = inv.lines.reduce((a, l) => a + l.qty * l.unit, 0)
  return (
    Math.abs(total - inv.amount) <= 0.01 &&
    inv.due > inv.issued &&
    (CURRENCIES as readonly string[]).includes(inv.currency)
  )
}

const invoicePath = (i: number): string => `invoices/inv-${String(i + 1).padStart(2, "0")}.json`
const INVALID_IDS = INVOICES.filter((x) => !invoiceValid(x)).map((x) => x.id).sort()

const AUDIT_HIDDEN = hiddenCheck(`type Row = { id?: unknown; valid?: unknown }
const rows = (): Row[] => { const v = json("audit.json"); return Array.isArray(v) ? (v as Row[]) : [] }
check("audit.json is an array of 12 rows", () => rows().length === 12)
${INVOICES.map(
  (inv) =>
    `check("${inv.id} marked valid=${invoiceValid(inv)}", () => rows().some((r) => r.id === "${inv.id}" && r.valid === ${invoiceValid(inv)}))`,
).join("\n")}
check("invalid.txt lists exactly the invalid ids, sorted", () =>
  read("invalid.txt").split(/\\r?\\n/).map((s) => s.trim()).filter(Boolean).join(",") === ${JSON.stringify(INVALID_IDS.join(","))})`)

// ── lh-pipeline-stages: manifest -> clean -> aggregate -> report ──

export interface OrderRow {
  readonly orderId: string
  readonly region: string
  readonly amount: number
}

const REGIONS = ["north", "south", "east", "west"] as const
const BATCHES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const
const PIPELINE_EXCLUDE = "orders-e.csv"
const PIPELINE_MIN_AMOUNT = 20

/** Eight batch files; later batches repeat some earlier order ids (first occurrence wins). */
export const ORDER_BATCHES: ReadonlyArray<{ readonly file: string; readonly rows: readonly OrderRow[] }> = (() => {
  const r = lcg(9127)
  let next = 5000
  const all: OrderRow[] = []
  return BATCHES.map((b, bi) => {
    const rows: OrderRow[] = Array.from({ length: 5 }, () => {
      const row: OrderRow = {
        orderId: `O-${next++}`,
        region: REGIONS[Math.floor(r() * REGIONS.length)]!,
        amount: Math.round((5 + r() * 120) * 100) / 100,
      }
      return row
    })
    // Batches after the first re-send one earlier order with a different amount.
    if (bi > 0) {
      const dup = all[Math.floor(r() * all.length)]!
      rows.push({ ...dup, amount: Math.round((dup.amount + 7) * 100) / 100 })
    }
    all.push(...rows)
    return { file: `orders-${b}.csv`, rows }
  })
})()

/** Ground truth for the pipeline: included batches in manifest order, first id wins, then the amount floor. */
export function pipelineClean(): OrderRow[] {
  const seen = new Set<string>()
  const out: OrderRow[] = []
  for (const batch of ORDER_BATCHES) {
    if (batch.file === PIPELINE_EXCLUDE) continue
    for (const row of batch.rows) {
      if (seen.has(row.orderId)) continue
      seen.add(row.orderId)
      if (row.amount >= PIPELINE_MIN_AMOUNT) out.push(row)
    }
  }
  return out
}

const CLEAN = pipelineClean()
const BY_REGION: Record<string, { orders: number; total: number }> = {}
for (const row of CLEAN) {
  const cur = BY_REGION[row.region] ?? { orders: 0, total: 0 }
  BY_REGION[row.region] = { orders: cur.orders + 1, total: Math.round((cur.total + row.amount) * 100) / 100 }
}
const GRAND_TOTAL = Math.round(CLEAN.reduce((a, x) => a + x.amount, 0) * 100) / 100
const TOP_REGION = Object.entries(BY_REGION).sort((a, b) => b[1].total - a[1].total)[0]![0]

const PIPELINE_MANIFEST = JSON.stringify(
  {
    batches: BATCHES.map((b) => `orders-${b}.csv`).filter((f) => f !== PIPELINE_EXCLUDE),
    excluded: [PIPELINE_EXCLUDE],
    minAmount: PIPELINE_MIN_AMOUNT,
    duplicatePolicy: "first-occurrence-wins (in batch order)",
  },
  null,
  2,
)

const PIPELINE_HIDDEN = hiddenCheck(`const cleanRows = (): Array<{ id: string; amount: number }> =>
  read("clean.csv").split(/\\r?\\n/).slice(1).map((l) => l.split(",").map((c) => c.trim())).filter((c) => c.length >= 3 && c[0])
    .map((c) => ({ id: c[0]!, amount: Number(c[2]) }))
const expected: Record<string, number> = ${JSON.stringify(Object.fromEntries(CLEAN.map((x) => [x.orderId, x.amount])))}
check("clean.csv has the header order_id,region,amount", () => read("clean.csv").split(/\\r?\\n/)[0]!.trim() === "order_id,region,amount")
check("clean.csv has exactly the expected order ids", () => cleanRows().map((r) => r.id).sort().join(",") === Object.keys(expected).sort().join(","))
check("clean.csv has no duplicate ids", () => cleanRows().length > 0 && new Set(cleanRows().map((r) => r.id)).size === cleanRows().length)
check("clean.csv keeps the first-occurrence amount for every id", () => cleanRows().length > 0 && cleanRows().every((r) => Math.abs(r.amount - (expected[r.id] ?? -1e9)) <= 0.01))
const regions = (): Record<string, { orders?: unknown; total?: unknown }> => json("by-region.json") as Record<string, { orders?: unknown; total?: unknown }>
${Object.entries(BY_REGION)
  .map(
    ([reg, v]) =>
      `check("by-region.json ${reg}: ${v.orders} orders, total ${v.total}", () => regions()["${reg}"]?.orders === ${v.orders} && Math.abs(Number(regions()["${reg}"]?.total) - ${v.total}) <= 0.01)`,
  )
  .join("\n")}
check("report.md states the total revenue", () => { const m = /^Total revenue:\\s*([\\d.,]+)/m.exec(read("report.md")); return m !== null && Math.abs(Number(m[1]!.replace(/,/g, "")) - ${GRAND_TOTAL}) <= 0.01 })
check("report.md names the top region", () => new RegExp("^Top region:\\\\s*${TOP_REGION}\\\\b", "mi").test(read("report.md")))`)

const NEW_LH_TASKS: readonly BenchmarkTask[] = [
  {
    id: "lh-debug-green",
    tier: "real-world",
    name: "Debug to green: six failing test files, one bug per module",
    domain: "execution",
    strategy: "react",
    prompt: `The TypeScript package in your working directory has six modules, each with one bug, and one failing test file per module:
${DEBUG_MODULES.map((m) => `- src/${m.name}.ts (tested by tests/${m.name}.test.ts)`).join("\n")}
Fix the bug in each module in place. Do not edit the tests and keep every exported function name and signature unchanged. Work through all six modules; you are done only when every test file passes.`,
    requiresTools: true,
    tools: [
      { kind: "required", name: "file-read" },
      { kind: "required", name: "file-write" },
      { kind: "available", name: "code-execute" },
    ],
    maxIterations: 24,
    fixtures: [
      ...DEBUG_MODULES.map((m) => ({ path: `src/${m.name}.ts`, content: m.buggy })),
      ...DEBUG_MODULES.map((m) => ({ path: `tests/${m.name}.test.ts`, content: m.test })),
      { path: "package.json", content: JSON.stringify({ name: "debug-green", type: "module" }, null, 2) },
    ],
    hiddenFixtures: [{ path: "hidden-check.ts", content: DEBUG_HIDDEN }],
    successCriteria: { type: "verifiable", command: "bun hidden-check.ts", partialCredit: true },
    tags: ["h3-lh", "debug-to-green"],
  },
  {
    id: "lh-enumerate-audit",
    tier: "real-world",
    name: "Enumerated verification: audit twelve invoices",
    domain: "analysis",
    strategy: "react",
    prompt: `Twelve invoice files are in your working directory:
${INVOICES.map((_, i) => `- ${invoicePath(i)}`).join("\n")}
Read every one. An invoice is VALID only if all three rules hold:
1. "amount" equals the sum of qty * unit over its "lines" (within 0.01).
2. "due" is a later date than "issued".
3. "currency" is one of USD, EUR, GBP.
Write two files in your working directory:
- audit.json: a JSON array with one object per invoice, {"id": "<invoice id>", "valid": true|false}.
- invalid.txt: the ids of the invalid invoices, one per line, sorted alphabetically.
Check all twelve invoices; do not guess any of them.`,
    requiresTools: true,
    tools: [
      { kind: "required", name: "file-read" },
      { kind: "required", name: "file-write" },
    ],
    maxIterations: 24,
    fixtures: INVOICES.map((inv, i) => ({ path: invoicePath(i), content: JSON.stringify(inv, null, 2) })),
    hiddenFixtures: [{ path: "hidden-check.ts", content: AUDIT_HIDDEN }],
    successCriteria: { type: "verifiable", command: "bun hidden-check.ts", partialCredit: true },
    tags: ["h3-lh", "enumerated-research"],
  },
  {
    id: "lh-pipeline-stages",
    tier: "real-world",
    name: "Multi-stage pipeline: manifest, clean, aggregate, report",
    domain: "execution",
    strategy: "react",
    prompt: `Run a three-stage data pipeline in your working directory. pipeline.json says which order batches to use, the minimum amount, and the duplicate policy. The batches are:
${ORDER_BATCHES.map((b) => `- batches/${b.file}`).join("\n")}
Each batch is a CSV with columns order_id,region,amount.
Stage 1: write clean.csv with header order_id,region,amount: every row from the batches pipeline.json lists, in that order, keeping only the FIRST row for each order_id, then dropping rows whose amount is below the minimum.
Stage 2: write by-region.json from clean.csv: {"<region>": {"orders": <row count>, "total": <sum of amount>}}.
Stage 3: write report.md containing a line "Total revenue: <sum of all amounts in clean.csv, 2 decimals>" and a line "Top region: <region with the largest total>".
Each stage reads the previous stage's output; finish all three.`,
    requiresTools: true,
    tools: [
      { kind: "required", name: "file-read" },
      { kind: "required", name: "file-write" },
    ],
    maxIterations: 22,
    fixtures: [
      { path: "pipeline.json", content: PIPELINE_MANIFEST },
      ...ORDER_BATCHES.map((b) => ({
        path: `batches/${b.file}`,
        content: ["order_id,region,amount", ...b.rows.map((x) => `${x.orderId},${x.region},${x.amount.toFixed(2)}`)].join("\n"),
      })),
    ],
    hiddenFixtures: [{ path: "hidden-check.ts", content: PIPELINE_HIDDEN }],
    successCriteria: { type: "verifiable", command: "bun hidden-check.ts", partialCredit: true },
    tags: ["h3-lh", "pipeline"],
  },
]

/** Same stripping as H3's `deterministic()`: ids are KEPT (the runner dispatches on some). */
function deterministic(task: BenchmarkTask): BenchmarkTask {
  const { dimensionRubrics: _r, primaryDimensions: _p, ...rest } = task
  return { ...rest, tags: [...(task.tags ?? []), "h3-lh"] }
}

const byId = (id: string): readonly BenchmarkTask[] =>
  [...REAL_WORLD_TASKS, ...LONG_HORIZON_TASKS].filter((x) => x.id === id)

/** The frozen long-horizon task list (order is part of the freeze). */
export const LH_TASKS: readonly BenchmarkTask[] = [
  ...["rw-4", "rw-7", "lh-1"].flatMap(byId).map(deterministic),
  ...NEW_LH_TASKS,
]

/**
 * Minimum tool calls an honest solve needs, by design (reads of required inputs
 * plus deliverable writes; no retries). Iterations >= tool calls only when the
 * model issues one call per turn: a model that batches parallel calls can finish
 * in fewer iterations, so this is a design floor, not a guarantee.
 *
 * rw-4 and rw-7 are inherited unchanged and are SHORTER by this measure; they
 * are in the suite because Plan 9 0e names them and their recorded runs hit
 * stall guards early (rw-7 `stall_deliverable` at iter 5).
 */
export const LH_MIN_TOOL_CALLS: Readonly<Record<string, number>> = {
  // 1 posts fetch + 10 per-post comment fetches + 1 write (3 if comments are bulk-fetched).
  "rw-4": 12,
  // 3 reads + 3 fixes; tests and a run are extra.
  "rw-7": 6,
  // >= 2 searches per question x 6 + 3 writes.
  "lh-1": 15,
  // 6 source reads + 6 fixes.
  "lh-debug-green": DEBUG_MODULES.length * 2,
  // 12 reads + 2 writes.
  "lh-enumerate-audit": INVOICES.length + 2,
  // manifest + 7 included batches + 3 stage writes.
  "lh-pipeline-stages": 1 + (ORDER_BATCHES.length - 1) + 3,
}

/** Task ids needing live network; a run without it measures the network, not the harness. */
export const LH_NETWORK_TASKS: readonly string[] = ["rw-4", "lh-1"]
