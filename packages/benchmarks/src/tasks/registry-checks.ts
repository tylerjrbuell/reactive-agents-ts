// File: src/tasks/registry-checks.ts
//
// Scorer-written graded hidden-checks for the BENCHMARK_TASKS registry
// (mission W-K / task #50, 2026-07-11 keyword→graded conversion wave).
//
// THE PROBLEM these fix. 25 of the 45 bench tasks scored accuracy through a
// keyword `expected:` regex — `matched ? 1.0 : 0.0` in judge.ts. That is a
// binary Bernoulli cell (sd 0.50, the worst case for a bounded [0,1] score),
// so the project's 3pp lift rule was not unmet but UNMEASURABLE: resolving it
// took ~556 runs/arm. Worse, keyword presence is not correctness — a
// `fibonacci` that returns `n` still contains the word "fibonacci", and an
// answer that names "Observer" says nothing about whether the reasoning holds.
//
// THE FIX. Convert the tasks whose correctness is DETERMINISTICALLY checkable
// to `verifiable` criteria backed by a scorer-written graded hidden-check.ts
// (see src/tasks/graded-check.ts for the harness + variance math). The score
// moves off the endpoints, and — critically — the assertions test REAL
// behaviour: a code task's function is imported and run against fixed cases; an
// analysis task's deliverable is graded on the actual correct facts, not on
// whether a keyword appears.
//
// Anti-reward-hacking is unchanged from the wave-3 pattern: these scripts are
// scorer fixtures the agent never sees. They are written into the run tmpDir by
// `writeHiddenFixtures` AFTER the agent finishes and immediately before scoring
// (judge.ts), so grading them leaks nothing about which assertions exist.
//
// Tasks left on keyword scoring (single-fact recall, tool-pipeline output
// strings, open-ended design) are honest remainder — a deterministic grader for
// pure taste would be keyword-synonym theatre. The choice is documented per
// task in task-registry.ts and pinned by the ratchet in
// tests/registry-keyword-ratchet.test.ts.

import { gradedCheckHarness } from "./graded-check.js";

/**
 * Build a hidden-check that imports the agent's `solution.ts`, pulls one named
 * export, and grades it against fixed input/output cases.
 *
 * The import is DYNAMIC and trapped: a missing or unparseable solution.ts
 * leaves `fn` undefined, so every case fails on its own (graded 0) instead of
 * crashing the harness before `report()` — the difference between a measured
 * zero and no measurement at all.
 *
 * `body` entries are `{ name, expr }` where `expr` is a JS boolean expression
 * evaluated at check time. `fn` (the export) and `eq` (deep JSON equality) are
 * in scope. Never leak these cases into the task prompt.
 */
export function codeExecHiddenCheck(
  fnName: string,
  body: ReadonlyArray<{ readonly name: string; readonly expr: string }>,
): string {
  const checks = body
    .map((c) => `check(${JSON.stringify(c.name)}, () => ${c.expr})`)
    .join("\n");
  return `// hidden-check.ts — scorer-written graded check. The agent never sees this file.
${gradedCheckHarness()}import { join } from "node:path"
import { pathToFileURL } from "node:url"

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
let __mod = {}
try {
  __mod = await import(pathToFileURL(join(import.meta.dir, "solution.ts")).href)
} catch {
  // missing / unparseable solution.ts — each assertion below fails on its own,
  // so the run scores 0 rather than crashing the harness before report().
}
const fn = __mod[${JSON.stringify(fnName)}]

check(${JSON.stringify(`solution.ts exports a \`${fnName}\` function`)}, () => typeof fn === "function")
${checks}
report()
`;
}

// ── s1-fibonacci — behavioural correctness of the nth Fibonacci function ──────
// Old regex: "function|const fibonacci|fibonacci" (present in any file that
// merely mentions the name). Now the function is executed against fixed values.
export function generateS1HiddenCheck(): string {
  return codeExecHiddenCheck("fibonacci", [
    { name: "fibonacci(0) === 0", expr: "fn?.(0) === 0" },
    { name: "fibonacci(1) === 1", expr: "fn?.(1) === 1" },
    { name: "fibonacci(2) === 1", expr: "fn?.(2) === 1" },
    { name: "fibonacci(10) === 55", expr: "fn?.(10) === 55" },
    { name: "fibonacci(20) === 6765", expr: "fn?.(20) === 6765" },
  ]);
}

// ── s2-palindrome-bug — the FIXED checker passes the case it used to fail ─────
// Old regex matched any mention of toLowerCase/replace/etc. Now the corrected
// function must actually return the right verdict — including the exact string
// the buggy version fails on.
export function generateS2HiddenCheck(): string {
  return codeExecHiddenCheck("isPalindrome", [
    {
      name: 'the bug case "A man a plan a canal Panama" is a palindrome (true)',
      expr: 'fn?.("A man a plan a canal Panama") === true',
    },
    { name: '"race a car" is not a palindrome (false)', expr: 'fn?.("race a car") === false' },
    { name: "empty string is a palindrome (true)", expr: 'fn?.("") === true' },
    { name: '"RaceCar" is a palindrome ignoring case (true)', expr: 'fn?.("RaceCar") === true' },
    { name: '"hello" is not a palindrome (false)', expr: 'fn?.("hello") === false' },
  ]);
}

// ── m1-merge-intervals — merges the fixed set of interval cases ───────────────
export function generateM1HiddenCheck(): string {
  return codeExecHiddenCheck("mergeIntervals", [
    {
      name: "merges the example set correctly",
      expr: "eq(fn?.([[1,3],[2,6],[8,10],[15,18]]), [[1,6],[8,10],[15,18]])",
    },
    { name: "merges touching intervals [1,4],[4,5] → [1,5]", expr: "eq(fn?.([[1,4],[4,5]]), [[1,5]])" },
    { name: "leaves a single interval unchanged", expr: "eq(fn?.([[1,4]]), [[1,4]])" },
    { name: "returns [] for empty input", expr: "eq(fn?.([]), [])" },
    {
      name: "handles unsorted input [[3,5],[1,2],[2,3]] → [[1,5]]",
      expr: "eq(fn?.([[3,5],[1,2],[2,3]]), [[1,5]])",
    },
  ]);
}

// ── m4-remove-duplicates — keeps ONLY elements that appear exactly once ───────
// The trap: the naive "dedupe" reading returns [1,2,3,4] for [1,2,3,2,4]; the
// task wants [1,3,4]. Case 1 discriminates the two readings deterministically.
export function generateM4HiddenCheck(): string {
  return codeExecHiddenCheck("removeDuplicates", [
    { name: "removeDuplicates([1,2,3,2,4]) → [1,3,4]", expr: "eq(fn?.([1,2,3,2,4]), [1,3,4])" },
    { name: "elements appearing twice are dropped: [1,1,2,2] → []", expr: "eq(fn?.([1,1,2,2]), [])" },
    { name: "all-unique input is unchanged", expr: "eq(fn?.([5,6,7]), [5,6,7])" },
    { name: "empty input → []", expr: "eq(fn?.([]), [])" },
    {
      name: "preserves original order: [4,3,4,2,1,2] → [3,1]",
      expr: "eq(fn?.([4,3,4,2,1,2]), [3,1])",
    },
  ]);
}

// NOTE: e1-lis / m2-word-problem / m3-sql-injection had graded generators here,
// removed 2026-07-11 when those tasks were reverted to keyword scoring — they
// belong to no-tool gate sessions (cluster-a-gate / cross-tier-stress) whose
// isolation a file-write requirement would break. See task-registry.ts notes.

/**
 * c3-test-suite — the parseDate reference impl written as a fixture so the
 * agent's own test file can import it AND the hidden-check can execute the
 * suite against real behaviour.
 */
export function generateC3ParseDateFixture(): string {
  return `// parseDate.ts — the function under test (provided fixture).
export function parseDate(input: string): Date | null {
  try {
    const d = new Date(input)
    return isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
}
`;
}

// ── c3-test-suite — count, coverage, AND real execution of the agent's suite ──
// Old regex "test|expect|null|..." matched any file with the word "test". Now
// the suite must have ≥6 real test blocks, reference parseDate, cover the named
// edge cases, and — the load-bearing check — actually PASS when executed against
// the reference parseDate. A vacuous `expect(true).toBe(true)` suite passes
// execution but fails coverage + reference; a suite asserting wrong behaviour
// fails execution.
export function generateC3HiddenCheck(): string {
  return `// hidden-check.ts — scorer-written graded check. The agent never sees this file.
${gradedCheckHarness()}import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const suitePath = join(import.meta.dir, "parseDate.test.ts")
const suite = existsSync(suitePath) ? readFileSync(suitePath, "utf8") : ""
const testBlocks = (suite.match(/\\b(test|it)\\s*\\(/g) ?? []).length
const expectCount = (suite.match(/\\bexpect\\s*\\(/g) ?? []).length

check("parseDate.test.ts exists and is non-empty", () => suite.trim().length > 0)
check("declares at least 6 test blocks", () => testBlocks >= 6)
check("exercises the parseDate function under test", () => /parseDate/.test(suite))
check("makes at least 6 expect() assertions", () => expectCount >= 6)
check("covers null-return AND invalid-input cases", () =>
  /null/i.test(suite) && /invalid|isNaN|NaN/i.test(suite))
check("the suite actually PASSES against the reference parseDate", () => {
  if (suite.trim().length === 0) return false
  const r = spawnSync("bun", ["test", suitePath], { cwd: import.meta.dir, encoding: "utf8", timeout: 25000 })
  return r.status === 0
})
report()
`;
}
