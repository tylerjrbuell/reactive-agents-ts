// Run: bun test packages/benchmarks/tests/graded-checks.test.ts
//
// The METRIC fix (2026-07-09). Per-run `accuracy` was Bernoulli: `scoreVerifiable`
// returns 1.0 on exit-0 and 0.0 otherwise, and the hidden-check scripts were
// fail-fast (`process.exit(1)` on the FIRST failed assertion). Measured on rw-9:
// per-run accuracy `[0,1,0,1,1,0,1,0,1,0]`, p=0.50, sd=0.50.
//
// With sd=0.50 the gate's own `runsNeeded` says a 3pp lift takes ~556 runs/arm —
// 20,016 live-model cells for one verdict. That is why the ImprovementLedger has
// never adopted anything: the lift rule was unmeasurable, not unmet.
//
// A bounded [0,1] score's variance is at most p(1-p), maximized at p=0.5. Grading
// the SAME checks (n assertions → pass/total) moves the score off the endpoints
// and collapses the variance, which is what makes verification affordable.
//
// `parsePartialCreditScore` already parses "N pass / M fail" — the machinery
// existed, only 2 of 11 tasks used it. These tests pin that the graded checks
// actually emit that shape and grade proportionally, by EXECUTING them.

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parsePartialCreditScore } from "../src/judge.js";
import { gradedCheckHarness } from "../src/tasks/graded-check.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "graded-check-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Run a hidden-check script and return the score the bench would record. */
function scoreOf(script: string): { score: number; exit: number; out: string } {
  const path = join(dir, "hidden-check.ts");
  writeFileSync(path, script);
  const r = spawnSync("bun", [path], { cwd: dir, encoding: "utf8", timeout: 20_000 });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  // Mirrors scoreVerifiable: exit 0 → 1.0, else partial credit from the output.
  const score = r.status === 0 ? 1.0 : parsePartialCreditScore(out);
  return { score, exit: r.status ?? -1, out };
}

const scriptWith = (checks: string) => `${gradedCheckHarness()}
${checks}
report()
`;

describe("gradedCheckHarness — assertions are COUNTED, not short-circuited", () => {
  it("all assertions pass → exit 0 → score 1.0", () => {
    const { score, exit } = scoreOf(
      scriptWith(`check("a", () => true); check("b", () => true); check("c", () => true);`),
    );
    expect(exit).toBe(0);
    expect(score).toBe(1.0);
  });

  it("half the assertions pass → PARTIAL credit, not zero", () => {
    // The whole point: a run that got 2 of 4 requirements right must not score
    // the same as a run that got none. Fail-fast made both 0.0.
    const { score, exit, out } = scoreOf(
      scriptWith(
        `check("a", () => true); check("b", () => true); check("c", () => false); check("d", () => false);`,
      ),
    );
    expect(exit).not.toBe(0);
    expect(out).toContain("2 pass");
    expect(out).toContain("2 fail");
    expect(score).toBe(0.5);
  });

  it("one of four passes → 0.25 (graded, off the Bernoulli endpoints)", () => {
    const { score } = scoreOf(
      scriptWith(
        `check("a", () => true); check("b", () => false); check("c", () => false); check("d", () => false);`,
      ),
    );
    expect(score).toBe(0.25);
  });

  it("no assertions pass → 0.0", () => {
    const { score } = scoreOf(scriptWith(`check("a", () => false); check("b", () => false);`));
    expect(score).toBe(0.0);
  });

  it("a THROWN assertion counts as one failure, and later checks still run", () => {
    // Fail-fast lost every downstream signal the moment one check threw.
    const { score, out } = scoreOf(
      scriptWith(
        `check("a", () => { throw new Error("boom") }); check("b", () => true); check("c", () => true);`,
      ),
    );
    expect(out).toContain("2 pass");
    expect(out).toContain("1 fail");
    expect(score).toBeCloseTo(2 / 3, 5);
  });

  it("a totally broken agent artifact (import fails) still scores 0, not a crash", () => {
    const { score, exit } = scoreOf(
      scriptWith(`check("import", () => { throw new Error("Cannot find module ./output.ts") });`),
    );
    expect(exit).not.toBe(0);
    expect(score).toBe(0.0);
  });
});

// ─── The WIRING: the real task fixtures must actually grade ──────────────────
//
// The harness tests above pass even if no task uses it. These execute the ACTUAL
// hidden-check fixtures the bench ships, so they fail if a task reverts to
// fail-fast or drops `partialCredit: true`.

import { REAL_WORLD_TASKS } from "../src/tasks/real-world.js";

type Fixture = { path: string; content: string };
const hiddenCheckOf = (taskId: string): string => {
  const task = REAL_WORLD_TASKS.find((t) => t.id === taskId) as unknown as {
    hiddenFixtures?: Fixture[];
    successCriteria?: { partialCredit?: boolean };
  };
  const f = task.hiddenFixtures?.find((x) => x.path === "hidden-check.ts");
  if (!f) throw new Error(`${taskId} has no hidden-check.ts`);
  return f.content;
};
const partialCreditOf = (taskId: string): boolean => {
  const task = REAL_WORLD_TASKS.find((t) => t.id === taskId) as unknown as {
    successCriteria?: { partialCredit?: boolean };
  };
  return task.successCriteria?.partialCredit === true;
};

/** Run a task's real hidden-check against agent artifacts and score it. */
function scoreTaskCheck(taskId: string, artifacts: Record<string, string>): number {
  writeFileSync(join(dir, "hidden-check.ts"), hiddenCheckOf(taskId));
  for (const [name, content] of Object.entries(artifacts)) {
    writeFileSync(join(dir, name), content);
  }
  const r = spawnSync("bun", [join(dir, "hidden-check.ts")], {
    cwd: dir,
    encoding: "utf8",
    timeout: 30_000,
  });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  return r.status === 0 ? 1.0 : parsePartialCreditScore(out);
}

describe("rw-8 — the two scripts are independent requirements", () => {
  it("declares partialCredit (without it, scoreVerifiable ignores the grading)", () => {
    expect(partialCreditOf("rw-8")).toBe(true);
  });

  it("both correct → 1.0", () => {
    expect(
      scoreTaskCheck("rw-8", { "generate.ts": 'console.log("ok")', "validate.ts": 'console.log("ok")' }),
    ).toBe(1.0);
  });

  it("a working generator + a broken validator → 0.5, not 0.0", () => {
    expect(
      scoreTaskCheck("rw-8", { "generate.ts": 'console.log("ok")', "validate.ts": "process.exit(1)" }),
    ).toBe(0.5);
  });

  it("a broken generator still lets the validator earn its half", () => {
    // Fail-fast aborted the run at generate.ts and scored the validator 0.
    expect(
      scoreTaskCheck("rw-8", { "generate.ts": "process.exit(1)", "validate.ts": 'console.log("ok")' }),
    ).toBe(0.5);
  });

  it("both broken → 0.0", () => {
    expect(
      scoreTaskCheck("rw-8", { "generate.ts": "process.exit(1)", "validate.ts": "process.exit(1)" }),
    ).toBe(0.0);
  });
});

describe("rw-4 — five independent requirements", () => {
  const posts = (n: number, o: { userId?: number; comments?: boolean } = {}) =>
    `export const posts = ${JSON.stringify(
      Array.from({ length: n }, (_, i) => ({
        userId: o.userId ?? 3,
        id: i + 1,
        title: `t${i}`,
        ...(o.comments === false ? {} : { commentCount: 2 }),
      })),
    )}`;

  it("declares partialCredit", () => {
    expect(partialCreditOf("rw-4")).toBe(true);
  });

  it("a perfect artifact → 1.0", () => {
    expect(scoreTaskCheck("rw-4", { "output.ts": posts(10) })).toBe(1.0);
  });

  it("correct posts but no comment enrichment → 0.8, not 0.0", () => {
    expect(scoreTaskCheck("rw-4", { "output.ts": posts(10, { comments: false }) })).toBeCloseTo(0.8, 5);
  });

  it("right shape, wrong userId → 0.8 (one requirement missed)", () => {
    expect(scoreTaskCheck("rw-4", { "output.ts": posts(10, { userId: 7 }) })).toBeCloseTo(0.8, 5);
  });

  it("no artifact at all → 0.0 (the scorer never crashes)", () => {
    expect(scoreTaskCheck("rw-4", { "output.ts": "" })).toBe(0.0);
  });
});

describe("variance: why this matters", () => {
  it("graded scores land strictly between the Bernoulli endpoints", () => {
    // sd of a bounded [0,1] score is maximized at the endpoints (p(1-p) at p=.5
    // with mass only on {0,1}). Any interior mass reduces it.
    const scores = [
      scoreOf(scriptWith(`check("a",()=>true);check("b",()=>true);check("c",()=>false);`)).score,
      scoreOf(scriptWith(`check("a",()=>true);check("b",()=>false);check("c",()=>false);`)).score,
    ];
    for (const s of scores) {
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThan(1);
    }
  });
});
