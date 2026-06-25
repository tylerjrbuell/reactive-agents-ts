// File: src/contracts/score-contract.ts
// Canonical quality-dimension + score contract (shared by eval/benchmarks/judge-server).
// Decision 2026-06-25: the agentic 10 are canonical. `safety` is a guardrail concern,
// not a quality dimension; `relevance`/`completeness` fold into the `accuracy` rubric;
// `cost-efficiency` unifies under `efficiency` (token-based). Those are intentionally
// excluded here and migrated in a later phase — see
// wiki/Architecture/Design-Specs/2026-06-24-canonical-evaluation-system.md.

/** The canonical agentic quality dimensions an agent run is scored on. */
export type QualityDimension =
  | "accuracy"
  | "reasoning"
  | "tool-mastery"
  | "memory-fidelity"
  | "loop-intelligence"
  | "resilience"
  | "efficiency"
  | "reliability"
  | "scope-discipline"
  | "honest-uncertainty";

/** A single dimension's score for one run. `evidence` is optional judge rationale. */
export interface DimensionScore {
  readonly dimension: QualityDimension;
  readonly score: number;
  readonly evidence?: string;
}

/** The canonical 10, frozen + ordered. Source of truth for the taxonomy. */
export const CANONICAL_QUALITY_DIMENSIONS: readonly QualityDimension[] = [
  "accuracy",
  "reasoning",
  "tool-mastery",
  "memory-fidelity",
  "loop-intelligence",
  "resilience",
  "efficiency",
  "reliability",
  "scope-discipline",
  "honest-uncertainty",
] as const;
