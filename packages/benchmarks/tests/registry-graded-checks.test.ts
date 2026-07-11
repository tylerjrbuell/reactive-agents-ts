// Run: bun test packages/benchmarks/tests/registry-graded-checks.test.ts
//
// The 2026-07-11 keyword→graded conversion wave (mission W-K / task #50).
//
// 8 BENCHMARK_TASKS registry tasks scored accuracy through a binary `expected:`
// keyword regex (`matched ? 1.0 : 0.0` — Bernoulli, sd 0.50, the 3pp lift rule
// unmeasurable; see src/tasks/graded-check.ts for the variance math). Worse,
// keyword presence is not correctness: a `fibonacci` returning `n` still
// contains "fibonacci". Each is now a `verifiable` criterion running a
// scorer-written graded hidden-check.ts with ≥4 counted assertions on REAL
// behaviour — code tasks import and RUN the agent's function; analysis tasks
// grade the actual correct facts.
//
// These tests EXECUTE the real shipped hidden checks against constructed
// artifacts and pin three properties per task:
//   1. FAIRNESS       — a fully correct deliverable scores 1.0 (exit 0).
//   2. DISCRIMINATION — a wrong deliverable scores < 1.
//   3. GRADING        — a partially-right deliverable scores strictly in (0,1).

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { parsePartialCreditScore } from "../src/judge.js";
import { BENCHMARK_TASKS } from "../src/task-registry.js";
import type { BenchmarkTask } from "../src/types.js";

/** The ids converted off `expected:` keyword scoring in this wave. */
// m2/m3/e1 have graded generators too, but were REVERTED to keyword scoring
// (Warden 2026-07-11) because they belong to no-tool gate sessions; see
// task-registry notes. Only the 5 free conversions are exercised here.
const CONVERTED_IDS = [
  "s1-fibonacci",
  "s2-palindrome-bug",
  "m1-merge-intervals",
  "m4-remove-duplicates",
  "c3-test-suite",
] as const;

function taskOf(id: string): BenchmarkTask {
  const t = BENCHMARK_TASKS.find((x) => x.id === id);
  if (!t) throw new Error(`no task ${id}`);
  return t;
}

function hiddenCheckOf(task: BenchmarkTask): string {
  const f = task.hiddenFixtures?.find((x) => x.path === "hidden-check.ts");
  if (!f) throw new Error(`${task.id} has no hidden-check.ts`);
  return f.content;
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "registry-graded-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Run a task's REAL hidden check against artifacts; return the bench score.
 * Also materializes the task's INPUT fixtures (e.g. c3's parseDate.ts) so the
 * check runs against exactly what the runner would provide.
 */
function scoreCheck(taskId: string, artifacts: Record<string, string>): number {
  const task = taskOf(taskId);
  writeFileSync(join(dir, "hidden-check.ts"), hiddenCheckOf(task));
  for (const fx of task.fixtures ?? []) {
    const dest = join(dir, fx.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, fx.content);
  }
  for (const [name, content] of Object.entries(artifacts)) {
    const dest = join(dir, name);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
  }
  const r = spawnSync("bun", [join(dir, "hidden-check.ts")], {
    cwd: dir,
    encoding: "utf8",
    timeout: 30_000,
  });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  // Mirrors scoreVerifiable: exit 0 → 1.0, else partial credit from the output.
  return r.status === 0 ? 1.0 : parsePartialCreditScore(out);
}

describe("conversion wiring — every converted registry task declares graded verifiable scoring", () => {
  for (const id of CONVERTED_IDS) {
    it(`${id}: verifiable + partialCredit + hidden-check.ts, and NO legacy expected regex`, () => {
      const task = taskOf(id);
      const sc = task.successCriteria;
      if (sc?.type !== "verifiable") throw new Error(`${id} successCriteria is ${sc?.type}`);
      expect(sc.command).toBe("bun hidden-check.ts");
      expect(sc.partialCredit).toBe(true);
      // The `expected` field must be gone, or scoreTask's successCriteria branch
      // would win but the ratchet count would not decrease.
      expect(task.expected).toBeUndefined();
      // ≥4 graded assertions: count check( call sites in the shipped script.
      const calls = hiddenCheckOf(task).match(/^check\(/gm) ?? [];
      expect(calls.length).toBeGreaterThanOrEqual(4);
    });
  }
});

// ── s1-fibonacci — behavioural code execution ────────────────────────────────
describe("s1-fibonacci — runs the imported function", () => {
  const CORRECT = "export function fibonacci(n){return n<2?n:fibonacci(n-1)+fibonacci(n-2)}";
  it("FAIRNESS: a correct fibonacci scores 1.0", () => {
    expect(scoreCheck("s1-fibonacci", { "solution.ts": CORRECT })).toBe(1.0);
  });
  it("DISCRIMINATION: a keyword-only stub (returns n) scores < 1", () => {
    const s = scoreCheck("s1-fibonacci", { "solution.ts": "export function fibonacci(n){return n}" });
    expect(s).toBeLessThan(1);
  });
  it("GRADING: an off-by-one base case scores strictly in (0,1)", () => {
    const s = scoreCheck("s1-fibonacci", {
      "solution.ts": "export function fibonacci(n){return n<2?1:fibonacci(n-1)+fibonacci(n-2)}",
    });
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
  it("a missing solution.ts scores 0 (graded, not a harness crash)", () => {
    expect(scoreCheck("s1-fibonacci", {})).toBe(0);
  });
});

// ── s2-palindrome-bug — the fixed checker passes the bug case ─────────────────
describe("s2-palindrome-bug — grades the fix behaviourally", () => {
  it("FAIRNESS: a correct case-insensitive, punctuation-stripping fix scores 1.0", () => {
    expect(
      scoreCheck("s2-palindrome-bug", {
        "solution.ts":
          'export function isPalindrome(s){const t=s.toLowerCase().replace(/[^a-z0-9]/g,"");return t===t.split("").reverse().join("")}',
      }),
    ).toBe(1.0);
  });
  it("DISCRIMINATION: the ORIGINAL buggy function scores < 1", () => {
    const s = scoreCheck("s2-palindrome-bug", {
      "solution.ts": 'export function isPalindrome(s){return s===s.split("").reverse().join("")}',
    });
    expect(s).toBeLessThan(1);
  });
  it("GRADING: a lowercase-only partial fix scores strictly in (0,1)", () => {
    const s = scoreCheck("s2-palindrome-bug", {
      "solution.ts":
        'export function isPalindrome(s){const t=s.toLowerCase();return t===t.split("").reverse().join("")}',
    });
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
});

// ── m1-merge-intervals — runs the imported function ──────────────────────────
describe("m1-merge-intervals — runs the imported function", () => {
  const CORRECT =
    "export function mergeIntervals(iv){if(!iv.length)return[];const s=[...iv].sort((a,b)=>a[0]-b[0]);const r=[s[0].slice()];for(const [a,b] of s.slice(1)){const l=r[r.length-1];if(a<=l[1])l[1]=Math.max(l[1],b);else r.push([a,b])}return r}";
  it("FAIRNESS: a correct merge scores 1.0", () => {
    expect(scoreCheck("m1-merge-intervals", { "solution.ts": CORRECT })).toBe(1.0);
  });
  it("DISCRIMINATION: an identity (no-merge) function scores < 1", () => {
    const s = scoreCheck("m1-merge-intervals", { "solution.ts": "export function mergeIntervals(iv){return iv}" });
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
});

// ── m4-remove-duplicates — the exactly-once semantics, not naive dedupe ───────
describe("m4-remove-duplicates — grades the exactly-once semantics", () => {
  it("FAIRNESS: keeping only exactly-once elements scores 1.0", () => {
    expect(
      scoreCheck("m4-remove-duplicates", {
        "solution.ts":
          "export function removeDuplicates(n){const c=new Map();for(const x of n)c.set(x,(c.get(x)||0)+1);return n.filter(x=>c.get(x)===1)}",
      }),
    ).toBe(1.0);
  });
  it("DISCRIMINATION: the naive Set-dedupe (wrong reading) scores strictly in (0,1)", () => {
    const s = scoreCheck("m4-remove-duplicates", {
      "solution.ts": "export function removeDuplicates(n){return [...new Set(n)]}",
    });
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
});

// m2/m3/e1 graded blocks removed with their revert to keyword scoring
// (Warden 2026-07-11 — no-tool gate-session isolation, see task-registry notes).

// ── c3-test-suite — count, coverage, AND real execution ──────────────────────
describe("c3-test-suite — grades a real, passing suite", () => {
  const GOOD = `import { test, expect } from "bun:test";
import { parseDate } from "./parseDate.ts";
test("valid date", () => expect(parseDate("2020-01-01") instanceof Date).toBe(true));
test("invalid input returns null", () => expect(parseDate("not a date")).toBe(null));
test("null return on garbage", () => expect(parseDate("zzz")).toBeNull());
test("ISO string", () => expect(parseDate("2020-01-01T00:00:00Z") instanceof Date).toBe(true));
test("timezone offset", () => expect(parseDate("2020-01-01T00:00:00+05:00") instanceof Date).toBe(true));
test("unix timestamp string", () => expect(typeof parseDate(String(Date.now()))).toBe("object"));
`;
  it("FAIRNESS: a complete, covering, passing suite scores 1.0", () => {
    expect(scoreCheck("c3-test-suite", { "parseDate.test.ts": GOOD })).toBe(1.0);
  });
  it("DISCRIMINATION: a vacuous expect(true) suite scores strictly in (0,1)", () => {
    const s = scoreCheck("c3-test-suite", {
      "parseDate.test.ts": 'import { test, expect } from "bun:test";\ntest("a", () => expect(true).toBe(true));',
    });
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
  it("a missing suite scores 0", () => {
    expect(scoreCheck("c3-test-suite", {})).toBe(0);
  });
});
