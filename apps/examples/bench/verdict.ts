import type { CohortDelta } from "@reactive-agents/trace";

export interface BenchVerdictInput {
  readonly cohort: CohortDelta;       // honesty/success/tokens verdict (candidate vs baseline)
  readonly faithfulnessDelta: number; // mean section-coverage(candidate) - baseline, -1..1
  readonly passKDelta: number;        // pass^k(candidate) - baseline (allClaimedSuccess as 0/1 averaged), -1..1
}

export interface BenchVerdict {
  readonly pass: boolean;
  readonly inconclusive: boolean;
  readonly reasons: readonly string[];
}

const EPS = 0.02;

/** Equal-or-better invariant: every axis flat-or-better; honesty/blind from compareCohorts. */
export function benchVerdict(input: BenchVerdictInput): BenchVerdict {
  const reasons: string[] = [];
  const inconclusive = input.cohort.verdict === "inconclusive (blind)";
  if (inconclusive) reasons.push("cohort inconclusive (decisive metric blind)");

  const cohortRegressed = input.cohort.verdict === "B regresses";
  if (cohortRegressed) reasons.push(`cohort regressed: ${input.cohort.reasons.join("; ")}`);

  const faithDropped = input.faithfulnessDelta < -EPS;
  if (faithDropped) reasons.push(`faithfulness ↓ ${(-input.faithfulnessDelta * 100).toFixed(0)}pp`);

  const passKDropped = input.passKDelta < -EPS;
  if (passKDropped) reasons.push(`pass^k ↓ ${(-input.passKDelta * 100).toFixed(0)}pp`);

  const pass = !inconclusive && !cohortRegressed && !faithDropped && !passKDropped;
  if (pass && reasons.length === 0) reasons.push("equal-or-better on every axis (honesty held)");
  return { pass, inconclusive, reasons };
}
