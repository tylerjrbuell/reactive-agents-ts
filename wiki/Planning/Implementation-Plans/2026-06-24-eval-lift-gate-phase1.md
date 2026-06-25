# Eval Lift-Gate — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Also follow the project's `agent-tdd` skill (Bun test, mandatory `--timeout`).

**Goal:** Ship `evaluateLiftGate()` — a pure, deterministic function that turns an existing benchmark `SessionReport` (baseline variant vs candidate variant) into a promotion verdict (`default-on | opt-in | reject`) by codifying the project lift rule (≥3pp lift ∧ ≤15% token overhead ∧ ≥2 tiers ∧ significant ∧ not partial).

**Architecture:** A new `src/gate/` module in `@reactive-agents/benchmarks`. It *reads* fields the matrix engine already produces (`SessionReport.taskReports[]` → `TaskVariantReport.meanScores/meanTokens/variance/inconclusive`) and applies the decision rule. No model runs, no I/O, no LLM — pure functions over in-memory data, TDD'd against hand-built fixture reports. This is layer **Lg (verdict)** of the canonical evaluation system and the validator that unblocks **B (verifiable self-improvement)**.

**Tech Stack:** TypeScript, Bun test runner. No Effect needed (pure sync). Plain interfaces matching `packages/benchmarks/src/types.ts` style.

## Global Constraints

- **Host package:** `packages/benchmarks` (private, `@unstable`). Do NOT add a dependency from a published package to benchmarks in this phase.
- **Purity:** every function in `src/gate/` is pure + synchronous. No LLM, no filesystem, no Effect, no `Date.now()`/`Math.random()`. The verdict must be reproducible from the input `SessionReport` alone.
- **No LLM re-verify:** the verdict is computed by arithmetic on the report — never by calling a model (mirrors the kernel's `ownFailure` FSM constraint).
- **Clean types:** strict TS, no `any`. Fixtures build complete objects (no `as any` / `as unknown as`).
- **lift = percentage POINTS:** `liftPp` is points (0.62 → 0.665 = 4.5pp), computed as `(candidate − baseline) × 100`.
- **Import extensions:** match sibling files in `packages/benchmarks/src` — grep one existing relative import first (e.g. `grep -rn "from \"\.\./" packages/benchmarks/src/index.ts`). Code below uses `.ts`; switch to `.js` if siblings do.
- **Commit style:** Conventional Commits. NO `Co-Authored-By` trailer.
- **Test command:** `bun test packages/benchmarks/tests/gate.test.ts --timeout 10000` (run from repo root).

---

## File Structure

- Create `packages/benchmarks/src/gate/types.ts` — `LiftPolicy`, `DEFAULT_LIFT_POLICY`, `GateDecision`, `TierEvidence`, `GateVerdict`.
- Create `packages/benchmarks/src/gate/gate.ts` — `projectTierEvidence()`, `evaluateLiftGate()`, internal helpers.
- Create `packages/benchmarks/src/gate/receipt.ts` — `formatGateReceipt()`.
- Create `packages/benchmarks/src/gate/index.ts` — barrel re-export of the module.
- Modify `packages/benchmarks/src/index.ts` — re-export the gate module on the v2 (`@unstable`) surface.
- Create `packages/benchmarks/tests/gate.test.ts` — all fixtures + tests.

---

## Task 1: Gate types + per-tier projection

**Files:**
- Create: `packages/benchmarks/src/gate/types.ts`
- Create: `packages/benchmarks/src/gate/gate.ts`
- Test: `packages/benchmarks/tests/gate.test.ts`

**Interfaces:**
- Consumes (from `packages/benchmarks/src/types.ts`): `SessionReport`, `TaskVariantReport`, `QualityDimension`, `DimensionScore`.
- Produces:
  - `LiftPolicy { metric: QualityDimension; minLiftPp: number; maxTokenOverheadPct: number; minTiers: number; significanceK: number }`
  - `DEFAULT_LIFT_POLICY: LiftPolicy`
  - `GateDecision = "default-on" | "opt-in" | "reject"`
  - `TierEvidence { tier: string; baselineMetric: number; candidateMetric: number; liftPp: number; tokenOverheadPct: number; variance: number; significant: boolean; inconclusive: boolean; passes: boolean; regresses: boolean }`
  - `GateVerdict { decision: GateDecision; perTier: readonly TierEvidence[]; aggregate: { liftPp: number; tokenOverheadPct: number; tiersCovered: number }; partial: boolean; rationale: string; baselineVariantId: string; candidateVariantId: string }`
  - `projectTierEvidence(report: SessionReport, baselineVariantId: string, candidateVariantId: string, policy?: LiftPolicy): readonly TierEvidence[]`

- [ ] **Step 1: Write the gate types**

Create `packages/benchmarks/src/gate/types.ts`:

```ts
// File: src/gate/types.ts
// Lift-gate verdict types (canonical evaluation system, layer Lg).
import type { QualityDimension } from "../types.ts";

export type GateDecision = "default-on" | "opt-in" | "reject";

/** The codified project lift rule. */
export interface LiftPolicy {
  /** The success metric dimension (must be present in each variant's meanScores). */
  readonly metric: QualityDimension;
  /** Minimum aggregate lift in percentage POINTS to promote. */
  readonly minLiftPp: number;
  /** Maximum tolerated token overhead, percent. */
  readonly maxTokenOverheadPct: number;
  /** Minimum distinct model tiers that must be covered by both variants. */
  readonly minTiers: number;
  /** Significance multiplier: |liftPp| must exceed significanceK × stddev(×100) to count. */
  readonly significanceK: number;
}

export const DEFAULT_LIFT_POLICY: LiftPolicy = {
  metric: "accuracy",
  minLiftPp: 3,
  maxTokenOverheadPct: 15,
  minTiers: 2,
  significanceK: 1,
};

/** Per-model-tier evidence: baseline vs candidate on the success metric. */
export interface TierEvidence {
  /** The model variant id this evidence is for (a measurement tier). */
  readonly tier: string;
  /** Baseline variant mean score on `metric`, 0..1. */
  readonly baselineMetric: number;
  /** Candidate variant mean score on `metric`, 0..1. */
  readonly candidateMetric: number;
  /** (candidate − baseline) × 100, in points. */
  readonly liftPp: number;
  /** (candidateTokens − baselineTokens) / baselineTokens × 100. */
  readonly tokenOverheadPct: number;
  /** Max stddev (0..1 score units) across the cells for this tier — the noise floor. */
  readonly variance: number;
  /** |liftPp| exceeds the noise floor. */
  readonly significant: boolean;
  /** A cell was preflight-violated or the metric was missing → cannot judge this tier. */
  readonly inconclusive: boolean;
  /** This tier meets the bar (lift ≥ min, overhead ≤ max, significant, not inconclusive). */
  readonly passes: boolean;
  /** This tier significantly regresses (significant negative lift). */
  readonly regresses: boolean;
}

export interface GateVerdict {
  readonly decision: GateDecision;
  readonly perTier: readonly TierEvidence[];
  readonly aggregate: {
    readonly liftPp: number;
    readonly tokenOverheadPct: number;
    readonly tiersCovered: number;
  };
  /** True if any covered tier is inconclusive — blocks `default-on`. */
  readonly partial: boolean;
  /** Human-readable one-line receipt summary. */
  readonly rationale: string;
  readonly baselineVariantId: string;
  readonly candidateVariantId: string;
}
```

- [ ] **Step 2: Write the failing test for `projectTierEvidence`**

Create `packages/benchmarks/tests/gate.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type {
  DimensionScore,
  SessionReport,
  TaskVariantReport,
} from "../src/types.ts";
import { projectTierEvidence } from "../src/gate/gate.ts";
import { DEFAULT_LIFT_POLICY } from "../src/gate/types.ts";

// ── fixture builders ─────────────────────────────────────────────
function scores(accuracy: number): DimensionScore[] {
  return [{ dimension: "accuracy", score: accuracy }];
}

function tvr(p: {
  taskId?: string;
  modelVariantId: string;
  variantId: string;
  accuracy?: number;
  meanTokens?: number;
  variance?: number;
  inconclusive?: boolean;
  noMetric?: boolean;
}): TaskVariantReport {
  return {
    taskId: p.taskId ?? "t1",
    modelVariantId: p.modelVariantId,
    variantId: p.variantId,
    variantLabel: p.variantId,
    runs: [],
    meanScores: p.noMetric ? [] : scores(p.accuracy ?? 0.5),
    variance: p.variance ?? 0,
    meanTokens: p.meanTokens ?? 1000,
    meanDurationMs: 100,
    passRate: 1,
    inconclusive: p.inconclusive
      ? { kind: "capability-fallback", detail: "test" as string }
      : undefined,
  } as TaskVariantReport;
}

function makeReport(taskReports: TaskVariantReport[]): SessionReport {
  return {
    generatedAt: "2026-06-24T00:00:00Z",
    runs: [],
    sessionId: "test",
    sessionVersion: "1",
    gitSha: "testsha",
    taskReports,
    reproducibility: {
      judgeModelSha: "judge-x",
      judgeCodeSha: "code-y",
      runId: "run-test",
      replayCommand: "bun run bench --session test",
    },
  };
}

describe("projectTierEvidence", () => {
  it("computes liftPp and tokenOverheadPct per model tier", () => {
    const report = makeReport([
      tvr({ modelVariantId: "local", variantId: "base", accuracy: 0.6, meanTokens: 1000 }),
      tvr({ modelVariantId: "local", variantId: "cand", accuracy: 0.665, meanTokens: 1010 }),
    ]);
    const ev = projectTierEvidence(report, "base", "cand", DEFAULT_LIFT_POLICY);
    expect(ev.length).toBe(1);
    expect(ev[0]!.tier).toBe("local");
    expect(ev[0]!.liftPp).toBeCloseTo(6.5, 5);
    expect(ev[0]!.tokenOverheadPct).toBeCloseTo(1.0, 5);
    expect(ev[0]!.passes).toBe(true);
    expect(ev[0]!.regresses).toBe(false);
  });

  it("skips a model not covered by both variants", () => {
    const report = makeReport([
      tvr({ modelVariantId: "local", variantId: "base", accuracy: 0.6 }),
      tvr({ modelVariantId: "frontier", variantId: "cand", accuracy: 0.9 }),
    ]);
    const ev = projectTierEvidence(report, "base", "cand", DEFAULT_LIFT_POLICY);
    expect(ev.length).toBe(0);
  });

  it("marks a tier inconclusive when a cell is preflight-violated", () => {
    const report = makeReport([
      tvr({ modelVariantId: "local", variantId: "base", accuracy: 0.6 }),
      tvr({ modelVariantId: "local", variantId: "cand", accuracy: 0.7, inconclusive: true }),
    ]);
    const ev = projectTierEvidence(report, "base", "cand", DEFAULT_LIFT_POLICY);
    expect(ev[0]!.inconclusive).toBe(true);
    expect(ev[0]!.passes).toBe(false);
  });

  it("marks a tier inconclusive when the metric is missing", () => {
    const report = makeReport([
      tvr({ modelVariantId: "local", variantId: "base", noMetric: true }),
      tvr({ modelVariantId: "local", variantId: "cand", accuracy: 0.7 }),
    ]);
    const ev = projectTierEvidence(report, "base", "cand", DEFAULT_LIFT_POLICY);
    expect(ev[0]!.inconclusive).toBe(true);
  });

  it("treats lift within the noise floor as not significant", () => {
    const report = makeReport([
      tvr({ modelVariantId: "local", variantId: "base", accuracy: 0.60, variance: 0.10 }),
      tvr({ modelVariantId: "local", variantId: "cand", accuracy: 0.64, variance: 0.10 }),
    ]);
    // liftPp = 4.0; noise = significanceK(1) × variance(0.10) × 100 = 10pp → not significant.
    const ev = projectTierEvidence(report, "base", "cand", DEFAULT_LIFT_POLICY);
    expect(ev[0]!.significant).toBe(false);
    expect(ev[0]!.passes).toBe(false);
  });
});
```

Note: the `inconclusive` fixture casts a minimal `PreFlightViolation`-shaped object; the `as TaskVariantReport` on the builder return absorbs that since the gate only reads `inconclusive !== undefined`. If `PreFlightViolation` has required fields the compiler rejects, set `inconclusive` to the smallest value the type accepts (check `@reactive-agents/core`'s `PreFlightViolation`).

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test packages/benchmarks/tests/gate.test.ts --timeout 10000`
Expected: FAIL — `Cannot find module "../src/gate/gate.ts"` (and `gate/types.ts` may resolve from Step 1).

- [ ] **Step 4: Implement `projectTierEvidence`**

Create `packages/benchmarks/src/gate/gate.ts`:

```ts
// File: src/gate/gate.ts
import type { SessionReport, TaskVariantReport } from "../types.ts";
import {
  DEFAULT_LIFT_POLICY,
  type LiftPolicy,
  type TierEvidence,
} from "./types.ts";

function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function metricScore(r: TaskVariantReport, metric: string): number | undefined {
  return r.meanScores.find((s) => s.dimension === metric)?.score;
}

export function projectTierEvidence(
  report: SessionReport,
  baselineVariantId: string,
  candidateVariantId: string,
  policy: LiftPolicy = DEFAULT_LIFT_POLICY,
): readonly TierEvidence[] {
  const reports = report.taskReports ?? [];
  const models = Array.from(new Set(reports.map((r) => r.modelVariantId)));
  const evidence: TierEvidence[] = [];

  for (const model of models) {
    const base = reports.filter(
      (r) => r.modelVariantId === model && r.variantId === baselineVariantId,
    );
    const cand = reports.filter(
      (r) => r.modelVariantId === model && r.variantId === candidateVariantId,
    );
    if (base.length === 0 || cand.length === 0) continue;

    const inconclusive =
      base.some((r) => r.inconclusive !== undefined) ||
      cand.some((r) => r.inconclusive !== undefined) ||
      base.some((r) => metricScore(r, policy.metric) === undefined) ||
      cand.some((r) => metricScore(r, policy.metric) === undefined);

    const baselineMetric = mean(base.map((r) => metricScore(r, policy.metric) ?? 0));
    const candidateMetric = mean(cand.map((r) => metricScore(r, policy.metric) ?? 0));
    const liftPp = (candidateMetric - baselineMetric) * 100;

    const baseTokens = mean(base.map((r) => r.meanTokens));
    const candTokens = mean(cand.map((r) => r.meanTokens));
    const tokenOverheadPct =
      baseTokens === 0 ? 0 : ((candTokens - baseTokens) / baseTokens) * 100;

    const variance = Math.max(
      0,
      ...base.map((r) => r.variance),
      ...cand.map((r) => r.variance),
    );
    const noisePp = policy.significanceK * variance * 100;
    const significant = Math.abs(liftPp) > noisePp;

    const passes =
      !inconclusive &&
      significant &&
      liftPp >= policy.minLiftPp &&
      tokenOverheadPct <= policy.maxTokenOverheadPct;
    const regresses = !inconclusive && significant && liftPp < 0;

    evidence.push({
      tier: model,
      baselineMetric,
      candidateMetric,
      liftPp,
      tokenOverheadPct,
      variance,
      significant,
      inconclusive,
      passes,
      regresses,
    });
  }

  return evidence;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test packages/benchmarks/tests/gate.test.ts --timeout 10000`
Expected: PASS (5 tests in the `projectTierEvidence` describe block).

- [ ] **Step 6: Commit**

```bash
git add packages/benchmarks/src/gate/types.ts packages/benchmarks/src/gate/gate.ts packages/benchmarks/tests/gate.test.ts
git commit -m "feat(benchmarks): per-tier lift evidence projection (gate Lg)"
```

---

## Task 2: The verdict decision rule

**Files:**
- Modify: `packages/benchmarks/src/gate/gate.ts`
- Test: `packages/benchmarks/tests/gate.test.ts`

**Interfaces:**
- Consumes: `projectTierEvidence` (Task 1), `LiftPolicy`, `DEFAULT_LIFT_POLICY`, `GateVerdict`, `GateDecision`, `TierEvidence`.
- Produces: `evaluateLiftGate(report: SessionReport, baselineVariantId: string, candidateVariantId: string, policy?: LiftPolicy): GateVerdict`.

- [ ] **Step 1: Write the failing tests for `evaluateLiftGate`**

Append to `packages/benchmarks/tests/gate.test.ts` (add `evaluateLiftGate` to the existing import from `../src/gate/gate.ts`):

```ts
import { evaluateLiftGate, projectTierEvidence } from "../src/gate/gate.ts";

describe("evaluateLiftGate", () => {
  function twoTier(
    baseAcc: number,
    candAcc: number,
    candTokens = 1000,
    variance = 0,
  ): SessionReport {
    return makeReport([
      tvr({ modelVariantId: "local", variantId: "base", accuracy: baseAcc, meanTokens: 1000, variance }),
      tvr({ modelVariantId: "local", variantId: "cand", accuracy: candAcc, meanTokens: candTokens, variance }),
      tvr({ modelVariantId: "frontier", variantId: "base", accuracy: baseAcc, meanTokens: 1000, variance }),
      tvr({ modelVariantId: "frontier", variantId: "cand", accuracy: candAcc, meanTokens: candTokens, variance }),
    ]);
  }

  it("promotes default-on on a clear two-tier win", () => {
    const v = evaluateLiftGate(twoTier(0.6, 0.66), "base", "cand");
    expect(v.decision).toBe("default-on");
    expect(v.aggregate.tiersCovered).toBe(2);
    expect(v.partial).toBe(false);
  });

  it("returns opt-in when lift is positive but below the threshold", () => {
    const v = evaluateLiftGate(twoTier(0.6, 0.615), "base", "cand"); // 1.5pp
    expect(v.decision).toBe("opt-in");
  });

  it("rejects when a tier significantly regresses", () => {
    const report = makeReport([
      tvr({ modelVariantId: "local", variantId: "base", accuracy: 0.6 }),
      tvr({ modelVariantId: "local", variantId: "cand", accuracy: 0.66 }),
      tvr({ modelVariantId: "frontier", variantId: "base", accuracy: 0.9 }),
      tvr({ modelVariantId: "frontier", variantId: "cand", accuracy: 0.8 }), // -10pp
    ]);
    const v = evaluateLiftGate(report, "base", "cand");
    expect(v.decision).toBe("reject");
  });

  it("blocks default-on when any tier is inconclusive (partial)", () => {
    const report = makeReport([
      tvr({ modelVariantId: "local", variantId: "base", accuracy: 0.6 }),
      tvr({ modelVariantId: "local", variantId: "cand", accuracy: 0.66 }),
      tvr({ modelVariantId: "frontier", variantId: "base", accuracy: 0.6 }),
      tvr({ modelVariantId: "frontier", variantId: "cand", accuracy: 0.66, inconclusive: true }),
    ]);
    const v = evaluateLiftGate(report, "base", "cand");
    expect(v.partial).toBe(true);
    expect(v.decision).toBe("opt-in");
  });

  it("returns opt-in when only one tier is covered (below minTiers)", () => {
    const report = makeReport([
      tvr({ modelVariantId: "local", variantId: "base", accuracy: 0.6 }),
      tvr({ modelVariantId: "local", variantId: "cand", accuracy: 0.66 }),
    ]);
    const v = evaluateLiftGate(report, "base", "cand");
    expect(v.decision).toBe("opt-in");
    expect(v.aggregate.tiersCovered).toBe(1);
  });

  it("returns opt-in when lift clears the threshold but token overhead exceeds the cap", () => {
    const v = evaluateLiftGate(twoTier(0.6, 0.66, 1200), "base", "cand"); // +6pp, +20% tokens
    expect(v.decision).toBe("opt-in");
  });

  it("returns opt-in when lift is real but within the noise floor", () => {
    const v = evaluateLiftGate(twoTier(0.6, 0.66, 1000, 0.10), "base", "cand"); // 6pp < 10pp noise
    expect(v.decision).toBe("opt-in");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/benchmarks/tests/gate.test.ts --timeout 10000`
Expected: FAIL — `evaluateLiftGate is not a function` / not exported.

- [ ] **Step 3: Implement `evaluateLiftGate`**

Append to `packages/benchmarks/src/gate/gate.ts` (and add `GateDecision`, `GateVerdict` to the import from `./types.ts`):

```ts
import {
  DEFAULT_LIFT_POLICY,
  type GateDecision,
  type GateVerdict,
  type LiftPolicy,
  type TierEvidence,
} from "./types.ts";

function buildRationale(
  decision: GateDecision,
  aggregate: GateVerdict["aggregate"],
  partial: boolean,
  policy: LiftPolicy,
): string {
  const lift = aggregate.liftPp.toFixed(1);
  const tok = aggregate.tokenOverheadPct.toFixed(1);
  const base = `${decision.toUpperCase()} · ${aggregate.tiersCovered} tier(s) · ${lift}pp lift · ${tok}% tok`;
  if (decision === "reject") return `${base} — a tier significantly regresses`;
  if (decision === "default-on") return `${base} — clears ≥${policy.minLiftPp}pp ∧ ≤${policy.maxTokenOverheadPct}% on all tiers`;
  if (partial) return `${base} — inconclusive tier blocks promotion`;
  return `${base} — below the promotion bar`;
}

export function evaluateLiftGate(
  report: SessionReport,
  baselineVariantId: string,
  candidateVariantId: string,
  policy: LiftPolicy = DEFAULT_LIFT_POLICY,
): GateVerdict {
  const perTier = projectTierEvidence(
    report,
    baselineVariantId,
    candidateVariantId,
    policy,
  );
  const partial = perTier.some((t) => t.inconclusive);
  const tiersCovered = perTier.length;
  const aggregate = {
    liftPp: mean(perTier.map((t) => t.liftPp)),
    tokenOverheadPct: mean(perTier.map((t) => t.tokenOverheadPct)),
    tiersCovered,
  };

  let decision: GateDecision;
  if (perTier.some((t) => t.regresses)) {
    decision = "reject";
  } else if (
    !partial &&
    tiersCovered >= policy.minTiers &&
    perTier.length > 0 &&
    perTier.every((t) => t.passes)
  ) {
    decision = "default-on";
  } else {
    decision = "opt-in";
  }

  return {
    decision,
    perTier,
    aggregate,
    partial,
    rationale: buildRationale(decision, aggregate, partial, policy),
    baselineVariantId,
    candidateVariantId,
  };
}
```

Note: `mean` and `projectTierEvidence` already exist in this file from Task 1 — do not redefine them. Merge the `./types.ts` import into the single existing import statement rather than adding a second one.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test packages/benchmarks/tests/gate.test.ts --timeout 10000`
Expected: PASS (all `projectTierEvidence` + `evaluateLiftGate` tests).

- [ ] **Step 5: Commit**

```bash
git add packages/benchmarks/src/gate/gate.ts packages/benchmarks/tests/gate.test.ts
git commit -m "feat(benchmarks): evaluateLiftGate verdict rule (default-on|opt-in|reject)"
```

---

## Task 3: Receipt formatter

**Files:**
- Create: `packages/benchmarks/src/gate/receipt.ts`
- Test: `packages/benchmarks/tests/gate.test.ts`

**Interfaces:**
- Consumes: `GateVerdict`, `TierEvidence`.
- Produces: `formatGateReceipt(verdict: GateVerdict): string` — a multi-line, human-readable receipt (the artifact that makes "no headline without a receipt" mechanical).

- [ ] **Step 1: Write the failing test**

Append to `packages/benchmarks/tests/gate.test.ts`:

```ts
import { formatGateReceipt } from "../src/gate/receipt.ts";

describe("formatGateReceipt", () => {
  it("renders the decision, a per-tier row, and the variant ids", () => {
    const v = evaluateLiftGate(
      makeReport([
        tvr({ modelVariantId: "local", variantId: "base", accuracy: 0.6, meanTokens: 1000 }),
        tvr({ modelVariantId: "local", variantId: "cand", accuracy: 0.66, meanTokens: 1010 }),
        tvr({ modelVariantId: "frontier", variantId: "base", accuracy: 0.6, meanTokens: 1000 }),
        tvr({ modelVariantId: "frontier", variantId: "cand", accuracy: 0.66, meanTokens: 1010 }),
      ]),
      "base",
      "cand",
    );
    const out = formatGateReceipt(v);
    expect(out).toContain("LIFT GATE");
    expect(out).toContain("DEFAULT-ON");
    expect(out).toContain("local");
    expect(out).toContain("frontier");
    expect(out).toContain("base");
    expect(out).toContain("cand");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/benchmarks/tests/gate.test.ts --timeout 10000`
Expected: FAIL — `Cannot find module "../src/gate/receipt.ts"`.

- [ ] **Step 3: Implement `formatGateReceipt`**

Create `packages/benchmarks/src/gate/receipt.ts`:

```ts
// File: src/gate/receipt.ts
import type { GateVerdict, TierEvidence } from "./types.ts";

function tierRow(t: TierEvidence): string {
  const verdict = t.inconclusive
    ? "INCONCLUSIVE"
    : t.regresses
      ? "REGRESS"
      : t.passes
        ? "PASS"
        : "BELOW";
  const base = (t.baselineMetric * 100).toFixed(1);
  const cand = (t.candidateMetric * 100).toFixed(1);
  const lift = `${t.liftPp >= 0 ? "+" : ""}${t.liftPp.toFixed(1)}pp`;
  const tok = `${t.tokenOverheadPct >= 0 ? "+" : ""}${t.tokenOverheadPct.toFixed(1)}%`;
  return `  ${t.tier.padEnd(18)} ${base.padStart(6)}  ${cand.padStart(6)}  ${lift.padStart(8)}  ${tok.padStart(8)}  ${verdict}`;
}

export function formatGateReceipt(verdict: GateVerdict): string {
  const header = `LIFT GATE · ${verdict.candidateVariantId} vs ${verdict.baselineVariantId}`;
  const cols = `  ${"tier".padEnd(18)} ${"base".padStart(6)}  ${"cand".padStart(6)}  ${"lift".padStart(8)}  ${"tok".padStart(8)}  verdict`;
  const rows = verdict.perTier.map(tierRow).join("\n");
  const agg =
    `  AGGREGATE  ${verdict.aggregate.liftPp.toFixed(1)}pp · ` +
    `${verdict.aggregate.tokenOverheadPct.toFixed(1)}% tok · ` +
    `tiers=${verdict.aggregate.tiersCovered}` +
    (verdict.partial ? " · PARTIAL" : "");
  const decision = `  DECISION: ${verdict.decision.toUpperCase()} — ${verdict.rationale}`;
  return [header, cols, rows, agg, decision].join("\n");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/benchmarks/tests/gate.test.ts --timeout 10000`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/benchmarks/src/gate/receipt.ts packages/benchmarks/tests/gate.test.ts
git commit -m "feat(benchmarks): gate receipt formatter"
```

---

## Task 4: Module barrel + package export

**Files:**
- Create: `packages/benchmarks/src/gate/index.ts`
- Modify: `packages/benchmarks/src/index.ts`
- Test: `packages/benchmarks/tests/gate.test.ts`

**Interfaces:**
- Consumes: everything in `src/gate/`.
- Produces: the gate module re-exported from `@reactive-agents/benchmarks` (v2 `@unstable` surface).

- [ ] **Step 1: Create the module barrel**

Create `packages/benchmarks/src/gate/index.ts`:

```ts
// File: src/gate/index.ts
// Lift gate (canonical evaluation system, layer Lg). @unstable.
export {
  DEFAULT_LIFT_POLICY,
  type GateDecision,
  type GateVerdict,
  type LiftPolicy,
  type TierEvidence,
} from "./types.ts";
export { evaluateLiftGate, projectTierEvidence } from "./gate.ts";
export { formatGateReceipt } from "./receipt.ts";
```

- [ ] **Step 2: Write the failing export test**

Append to `packages/benchmarks/tests/gate.test.ts`:

```ts
import * as benchmarks from "../src/index.ts";

describe("package export", () => {
  it("exposes evaluateLiftGate from the package entrypoint", () => {
    expect(typeof (benchmarks as { evaluateLiftGate?: unknown }).evaluateLiftGate).toBe(
      "function",
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test packages/benchmarks/tests/gate.test.ts --timeout 10000`
Expected: FAIL — `evaluateLiftGate` is `undefined` on the package namespace.

- [ ] **Step 4: Re-export from the package entrypoint**

In `packages/benchmarks/src/index.ts`, add the following line in the v2 / `@unstable` export region (after the existing `runSession`/session exports — match the surrounding `export ... from "./..."` style and extension convention):

```ts
// ── v2 @unstable: lift gate (Lg) ─────────────────────────────────
export * from "./gate/index.ts";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test packages/benchmarks/tests/gate.test.ts --timeout 10000`
Expected: PASS (all tasks' tests).

- [ ] **Step 6: Typecheck the package**

Run: `bunx turbo run build --filter=@reactive-agents/benchmarks`
Expected: build succeeds (DTS + typecheck green for the gate module).

If `turbo`/build is unavailable or slow, fall back to: `bunx tsc --noEmit -p packages/benchmarks/tsconfig.json` — but note (per project memory) the build is authoritative over `tsc --noEmit` for `ignoreDeprecations`; prefer the turbo build.

- [ ] **Step 7: Commit**

```bash
git add packages/benchmarks/src/gate/index.ts packages/benchmarks/src/index.ts packages/benchmarks/tests/gate.test.ts
git commit -m "feat(benchmarks): export lift gate on the v2 surface"
```

---

## Done Criteria

- `evaluateLiftGate(report, baselineVariantId, candidateVariantId, policy?)` returns a `GateVerdict` with a `default-on | opt-in | reject` decision, pure and deterministic, over an existing `SessionReport`.
- Decision rule enforced + tested: clear win → `default-on`; below-threshold/over-budget/insignificant/single-tier → `opt-in`; significant regression → `reject`; inconclusive tier → `partial` blocks `default-on`.
- `formatGateReceipt(verdict)` renders a human-readable receipt.
- Exported on the `@reactive-agents/benchmarks` v2 surface; package builds green.
- **No model runs, no LLM, no I/O** — the whole phase is fixture-tested pure logic.

## What this unblocks (next phases — NOT in this plan)
- **Phase 2:** one judge / one taxonomy reconciliation; the `eval` published facade + Effect-Schema canonical `Run`; the `rax eval gate` CLI + CI regression job (consumes `evaluateLiftGate` + `formatGateReceipt`).
- **B (verifiable self-improvement):** the loop's proposed `.compose()` mutation becomes the candidate `HarnessVariant`; `evaluateLiftGate` is its validator. Built here, free there.

## Self-Review notes
- **Spec coverage:** implements the Lg (verdict) layer of `2026-06-24-canonical-evaluation-system.md` + the gate primitive of `2026-06-24-eval-lift-gate-harness.md` (`evaluateLiftGate`, `LiftPolicy`, `TierEvidence`, `GateVerdict`, receipt, partial/inconclusive short-circuit, significance via `variance`, per-tier token overhead). Canonical `Run` spine + Effect-Schema + frozen-judge are explicitly **deferred** to Phase 2 (noted above) to keep Phase 1 pure and zero-risk.
- **Type consistency:** `evaluateLiftGate`/`projectTierEvidence`/`formatGateReceipt` and all field names (`liftPp`, `tokenOverheadPct`, `tiers`, `partial`, `passes`, `regresses`) are identical across tasks.
- **Placeholder scan:** every code step carries complete code; no TBD/TODO.
- **Risk note:** the only external-shape assumptions are (a) `TaskVariantReport` fields `meanScores/meanTokens/variance/inconclusive/modelVariantId/variantId` and (b) `SessionReport.taskReports` + required `reproducibility`/`sessionId`/`sessionVersion`/`gitSha`/`generatedAt`/`runs` — all verified present in `packages/benchmarks/src/types.ts` as of 2026-06-24. If `PreFlightViolation` requires specific fields, adjust the `inconclusive` fixture in Task 1 Step 2 accordingly.
