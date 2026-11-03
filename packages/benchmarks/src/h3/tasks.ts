// File: src/h3/tasks.ts
//
// H3 — the FROZEN real-task eval (Plan 8 task H3,
// wiki/Planning/Implementation-Plans/2026-11-02-harness-convergence.md).
//
// Every default-path change (K2, evidence-reset promotion, T1, L3, L6, L7, C1)
// is gated on a baseline taken from THIS task set, so the set must not drift:
// `h3-manifest.json` pins a sha256 per task and `tests/h3-suite.test.ts` fails
// when any definition changes. To change a task, make a new task id and re-freeze
// deliberately (`bun run src/h3/freeze.ts`) — never edit one in place.
//
// Grader rule: DETERMINISTIC ONLY. Every task is scored by a hidden file check,
// a regex over the final output, or `scoreAbstention`. No LLM judge: the derived
// real-world tasks strip `dimensionRubrics` / `primaryDimensions` so the judge
// is never consulted (and never needs to be reachable).
//
// Shapes covered (census failure shapes + existing real-world tasks):
//   real-world (5, offline subset of rw-*):  rw-2 rw-3 rw-6 rw-7 rw-9 (judge rubrics stripped, ids kept)
//   abstention / honest-failure (2):         ab-trap-4 ab-trap-5
//   plan-only:                               h3-plan-only
//   todo-heavy:                              h3-todo-heavy
//   required-tools:                          h3-required-tools
//   continuation-as-answer:                  h3-continuation
//   exact-value multi-read:                  h3-exact-value
// DEFERRED: MCP-wide (no local MCP server is practical offline in this suite;
//   the 5-task umami/MCP set is H1's remit), rw-1 and rw-4 (need live network),
//   rw-5/rw-8/rw-10 (judge-graded or long; not freezable deterministically here).
import { gradedCheckHarness } from "../tasks/graded-check.js"
import { REAL_WORLD_TASKS, ABSTENTION_TRAP_TASKS } from "../tasks/real-world.js"
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
${body}
report()
`

// ── h3-plan-only: three concrete files from one CSV (plan text is not a deliverable)
const INVENTORY = (() => {
  const r = lcg(1103)
  return Array.from({ length: 24 }, (_, i) => ({
    sku: `SKU-${String(i + 1).padStart(3, "0")}`,
    qty: Math.floor(r() * 40),
  }))
})()
const INVENTORY_CSV = ["sku,qty", ...INVENTORY.map((x) => `${x.sku},${x.qty}`)].join("\n")
const LOW_STOCK = INVENTORY.filter((x) => x.qty < 10).map((x) => x.sku).sort()
const TOTAL_UNITS = INVENTORY.reduce((a, x) => a + x.qty, 0)

// ── h3-todo-heavy: six independent items
const NOTES = [17, 42, 8, 63, 29, 54]

// ── h3-required-tools: mean of a column
const READINGS = (() => {
  const r = lcg(7741)
  return Array.from({ length: 20 }, (_, i) => ({ hour: i, temp: Math.round((15 + r() * 15) * 10) / 10 }))
})()
const READINGS_CSV = ["hour,temp", ...READINGS.map((x) => `${x.hour},${x.temp}`)].join("\n")
const MEAN_TEMP = READINGS.reduce((a, x) => a + x.temp, 0) / READINGS.length

const CONFIG_JSON = JSON.stringify(
  {
    project: "atlas",
    legacy: { releaseCode: "RC-0001-AA", note: "deprecated, do not use" },
    build: { id: "B-1180", channel: "stable", releaseCode: "RC-7392-QZ" },
  },
  null,
  2,
)

const NEW_TASKS: readonly BenchmarkTask[] = [
  {
    id: "h3-plan-only",
    tier: "real-world",
    name: "Plan-only trap: produce three files from a CSV",
    domain: "execution",
    strategy: "plan-execute",
    prompt: `inventory.csv in your working directory lists SKUs and on-hand quantities. Produce these three files in your working directory:
1. low-stock.txt: every SKU whose qty is below 10, one SKU per line, sorted alphabetically.
2. totals.json: a JSON object {"totalUnits": <sum of all qty>, "skuCount": <number of SKUs>}.
3. summary.md: a short note that contains a section headed "## Reorder".
Create the files; a plan alone is not the deliverable.`,
    requiresTools: true,
    tools: [
      { kind: "required", name: "file-read" },
      { kind: "required", name: "file-write" },
    ],
    maxIterations: 12,
    fixtures: [{ path: "inventory.csv", content: INVENTORY_CSV }],
    hiddenFixtures: [
      {
        path: "hidden-check.ts",
        content: hiddenCheck(`check("low-stock.txt exists", () => existsSync("low-stock.txt"))
check("low-stock.txt is exactly the sorted SKUs below 10", () =>
  read("low-stock.txt").split(/\\r?\\n/).map((s) => s.trim()).filter(Boolean).join(",") === ${JSON.stringify(LOW_STOCK.join(","))})
check("totals.json parses", () => { JSON.parse(read("totals.json")); return true })
check("totalUnits correct", () => JSON.parse(read("totals.json")).totalUnits === ${TOTAL_UNITS})
check("skuCount correct", () => JSON.parse(read("totals.json")).skuCount === ${INVENTORY.length})
check("summary.md has the Reorder heading", () => /^## Reorder/m.test(read("summary.md")))`),
      },
    ],
    successCriteria: { type: "verifiable", command: "bun hidden-check.ts", partialCredit: true },
    tags: ["h3", "plan-only"],
  },
  {
    id: "h3-todo-heavy",
    tier: "real-world",
    name: "Todo-heavy: six independent items",
    domain: "execution",
    strategy: "react",
    prompt: `Six files in your working directory, notes-1.txt through notes-6.txt, each contain one integer. Track the work as a todo list with one item per file. For each notes-N.txt, write out-N.txt containing exactly double that integer (digits only). Finish all six.`,
    requiresTools: true,
    tools: [
      { kind: "required", name: "file-read" },
      { kind: "required", name: "file-write" },
    ],
    maxIterations: 14,
    fixtures: NOTES.map((n, i) => ({ path: `notes-${i + 1}.txt`, content: String(n) })),
    hiddenFixtures: [
      {
        path: "hidden-check.ts",
        content: hiddenCheck(
          NOTES.map(
            (n, i) =>
              `check("out-${i + 1}.txt is ${n * 2}", () => read("out-${i + 1}.txt").trim() === "${n * 2}")`,
          ).join("\n"),
        ),
      },
    ],
    successCriteria: { type: "verifiable", command: "bun hidden-check.ts", partialCredit: true },
    tags: ["h3", "todo-heavy"],
  },
  {
    id: "h3-required-tools",
    tier: "real-world",
    name: "Required tools: mean of a column, written to a file",
    domain: "analysis",
    strategy: "react",
    prompt: `readings.csv in your working directory has columns hour,temp. Compute the mean of the temp column rounded to 2 decimal places and write only that number to mean.txt in your working directory.`,
    requiresTools: true,
    tools: [
      { kind: "required", name: "file-read" },
      { kind: "required", name: "file-write" },
      { kind: "available", name: "code-execute" },
    ],
    maxIterations: 10,
    fixtures: [{ path: "readings.csv", content: READINGS_CSV }],
    hiddenFixtures: [
      {
        path: "hidden-check.ts",
        content: hiddenCheck(`check("mean.txt exists", () => existsSync("mean.txt"))
check("mean.txt is a number", () => Number.isFinite(parseFloat(read("mean.txt"))))
check("mean within 0.01 of ${MEAN_TEMP.toFixed(4)}", () => Math.abs(parseFloat(read("mean.txt")) - ${MEAN_TEMP}) <= 0.01)`),
      },
    ],
    successCriteria: { type: "verifiable", command: "bun hidden-check.ts", partialCredit: true },
    tags: ["h3", "required-tools"],
  },
  {
    id: "h3-continuation",
    tier: "real-world",
    name: "Continuation-as-answer: read a file, answer with the value",
    domain: "execution",
    strategy: "react",
    prompt: `Read config.json in your working directory and tell me the value of build.releaseCode (the one under "build", not any other releaseCode). Reply with that value.`,
    requiresTools: true,
    tools: [{ kind: "required", name: "file-read" }],
    maxIterations: 8,
    fixtures: [{ path: "config.json", content: CONFIG_JSON }],
    // Answer must carry the right code and must not also surface the decoy.
    successCriteria: { type: "regex", pattern: "^(?![\\s\\S]*RC-0001-AA)[\\s\\S]*RC-7392-QZ" },
    tags: ["h3", "continuation-as-answer"],
  },
  {
    id: "h3-exact-value",
    tier: "real-world",
    name: "Exact value across two files",
    domain: "execution",
    strategy: "react",
    prompt: `a.json and b.json in your working directory each have a numeric "count" field. Add the two counts together and reply with the sum.`,
    requiresTools: true,
    tools: [{ kind: "required", name: "file-read" }],
    maxIterations: 8,
    fixtures: [
      { path: "a.json", content: JSON.stringify({ label: "a", count: 412, items: ["x", "y"] }) },
      { path: "b.json", content: JSON.stringify({ label: "b", count: 931, items: ["z"] }) },
    ],
    // 412 + 931 = 1343
    successCriteria: { type: "regex", pattern: "(?<![\\d.])1,?343(?![\\d])" },
    tags: ["h3", "exact-value"],
  },
]

/**
 * Strip every judge dependency from an existing task. The id is KEPT: the
 * runner dispatches on `task.id === "rw-9"` to start the flaky price server, so
 * a re-id would silently break that fixture. The H3 runner swaps these into the
 * global registry in-process (see `registerH3Tasks` in run-h3.ts).
 */
function deterministic(task: BenchmarkTask): BenchmarkTask {
  const { dimensionRubrics: _r, primaryDimensions: _p, ...rest } = task
  return { ...rest, tags: [...(task.tags ?? []), "h3"] }
}

const byId = (id: string): BenchmarkTask => {
  const t = [...REAL_WORLD_TASKS, ...ABSTENTION_TRAP_TASKS].find((x) => x.id === id)
  if (!t) throw new Error(`H3: source task ${id} not found`)
  return t
}

/** The frozen H3 task list (order is part of the freeze). */
export const H3_TASKS: readonly BenchmarkTask[] = [
  deterministic(byId("rw-2")),
  deterministic(byId("rw-3")),
  deterministic(byId("rw-6")),
  deterministic(byId("rw-7")),
  deterministic(byId("rw-9")),
  deterministic(byId("ab-trap-4")),
  deterministic(byId("ab-trap-5")),
  ...NEW_TASKS,
]

/** Shapes intentionally NOT in the suite, with the reason (printed in the report). */
export const H3_DEFERRED: ReadonlyArray<{ readonly shape: string; readonly reason: string }> = [
  { shape: "mcp-wide", reason: "no local MCP server practical offline; H1 owns the umami/MCP 5-task set" },
  { shape: "rw-1 / rw-4", reason: "need live network (web-search / jsonplaceholder): not freezable" },
  { shape: "rw-5 / rw-8 / rw-10", reason: "judge-graded or compaction-length; no deterministic grader" },
]
