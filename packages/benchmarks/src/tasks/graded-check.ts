// File: src/tasks/graded-check.ts
//
// The graded-assertion harness that scorer-written `hidden-check.ts` scripts
// embed. It exists to make the bench's `accuracy` metric MEASURABLE.
//
// THE PROBLEM. `scoreVerifiable` returns 1.0 on exit-0 and 0.0 otherwise, and the
// hidden checks were fail-fast — `process.exit(1)` on the first failed assertion.
// So a run that satisfied four of five requirements scored identically to one
// that satisfied none: per-run `accuracy` was Bernoulli. Measured on rw-9:
// `[0,1,0,1,1,0,1,0,1,0]`, p=0.50, sd=0.50.
//
// A standard deviation of 0.50 is the WORST case for a bounded [0,1] score, and
// it feeds straight into the lift gate's `runsNeeded`: resolving the project's
// 3pp lift rule takes ~556 runs/arm — 20,016 live-model cells per verdict. The
// rule was not unmet, it was unmeasurable, and the ImprovementLedger's zero
// `adopted` entries are the receipt.
//
// THE FIX. Count the assertions instead of short-circuiting on the first one.
// `scoreVerifiable(partialCredit: true)` then parses `N pass / M fail` via
// `parsePartialCreditScore` and records `pass/total`. The score moves off the
// endpoints, the variance collapses, and a real lift becomes detectable at an n
// this project can actually afford.
//
// Anti-reward-hacking is unchanged: these scripts are scorer-written fixtures the
// agent never sees, and grading them does not tell the agent which assertions
// exist. Partial credit rewards partial WORK, not partial guessing.

/**
 * The preamble a generated `hidden-check.ts` embeds. Defines `check(name, fn)`
 * and `report()`.
 *
 * - `check` never throws: a thrown assertion is ONE failure, and the checks after
 *   it still run. Fail-fast discarded every downstream signal the moment one
 *   assertion threw — including the ones the agent got right.
 * - `report()` prints `N pass` / `M fail` (the shape `parsePartialCreditScore`
 *   reads) and exits non-zero iff anything failed, so `scoreVerifiable`'s exit-0
 *   fast path still means "everything passed".
 */
export function gradedCheckHarness(): string {
  return `// ── graded assertion harness (scorer-written; agent never sees this) ──
const __results: { name: string; ok: boolean; msg?: string }[] = []
function check(name: string, fn: () => boolean): void {
  try {
    __results.push({ name, ok: fn() === true })
  } catch (e) {
    __results.push({ name, ok: false, msg: e instanceof Error ? e.message : String(e) })
  }
}
function report(): void {
  const pass = __results.filter((r) => r.ok).length
  const fail = __results.length - pass
  for (const r of __results) {
    if (!r.ok) console.error(\`FAIL: \${r.name}\${r.msg ? " — " + r.msg : ""}\`)
  }
  // The exact shape parsePartialCreditScore() reads.
  console.log(\`\${pass} pass\`)
  console.log(\`\${fail} fail\`)
  if (fail > 0) process.exit(1)
}
`;
}
