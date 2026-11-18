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

/** Version of the scorers a result was graded with. */
export const SCORER_VERSION = 2 as const

/** The scorer version of every results file written before this constant existed. */
export const LEGACY_SCORER_VERSION = 1 as const

/** A scorer version a results file can carry. */
export type ScorerVersion = typeof SCORER_VERSION | typeof LEGACY_SCORER_VERSION

/**
 * The scorer version a results file was graded with.
 *
 * @param file A parsed results object; reads `scorerVersion` when present.
 * @returns The recorded version, or {@link LEGACY_SCORER_VERSION} when absent.
 */
export function scorerVersionOf(file: { readonly scorerVersion?: unknown }): ScorerVersion {
  return file.scorerVersion === SCORER_VERSION ? SCORER_VERSION : LEGACY_SCORER_VERSION
}
