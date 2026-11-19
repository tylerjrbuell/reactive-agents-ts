// File: src/scorer-version.ts
//
// Version of the deterministic scorers (judge.ts `scoreTask`, the hidden checks
// under tasks/). Results JSON carries it as `scorerVersion` so two result files
// are only compared as like-for-like when they share a version. A change that
// can move a cell's accuracy for the same raw output bumps this constant.
//
// History:
//   1  (implicit, every file recorded before 2026-11-18): rw-3 groundedness
//      accepted any "40%"; an abstained run on a solvable task scored 0 whatever
//      it produced; an honest decline that ended dispatcher-early-stop scored 0.
//   2  (2026-11-18, measurement overhaul 0.6): rw-3 claims must be about
//      Engineering; abstention is reported apart from accuracy on solvable
//      tasks; a deterministic text+provenance honest-decline credit on trap
//      tasks. Rescore: wiki/Research/Harness-Reports/2026-11-18-rescore/README.md.
//   3  (2026-11-18, zoo-live validation): rw-6 accuracy counts a trace-based
//      fabrication check (src/fabrication-count.ts): a percent figure in the final
//      answer that the task text and the run's real tool results do not contain makes
//      the cell unsolved. COMPARABILITY BREAK: rw-6 solved rates graded at v1/v2 are
//      not comparable with v3 (7 of 15 v2 rw-6 "solves" in the zoo-live run carried
//      invented figures). Other tasks grade identically at v2 and v3. Rescore: run
//      `h3/regrade.ts` on stored rw-6 traces; a regrade that disagrees with the
//      recorded v2 accuracy is refused by design (it reports `mismatch`), so v2 rw-6
//      cells are re-read with `fabricatedFigures` over `runEvidenceOf(trace)`, not
//      appended. Task definitions are untouched, so the frozen H3 suite hash holds.

/** Version of the scorers a result was graded with. */
export const SCORER_VERSION = 3 as const

/** The scorer version of every results file written before this constant existed. */
export const LEGACY_SCORER_VERSION = 1 as const

/** A scorer version a results file can carry. */
export type ScorerVersion = typeof SCORER_VERSION | 2 | typeof LEGACY_SCORER_VERSION

/**
 * The scorer version a results file was graded with.
 *
 * @param file A parsed results object; reads `scorerVersion` when present.
 * @returns The recorded version, or {@link LEGACY_SCORER_VERSION} when absent.
 */
export function scorerVersionOf(file: { readonly scorerVersion?: unknown }): ScorerVersion {
  if (file.scorerVersion === SCORER_VERSION) return SCORER_VERSION
  return file.scorerVersion === 2 ? 2 : LEGACY_SCORER_VERSION
}
