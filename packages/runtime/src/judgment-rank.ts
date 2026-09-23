/**
 * judgment-rank.ts — `agent.judgeRank()`'s core primitive: batched Score-based
 * candidate re-ranking over `JudgmentService`.
 *
 * DX gap this closes: the judgment cookbook's re-ranking recipe (Phase E
 * Task 6, wiki/Planning/Implementation-Plans/2026-09-23-judgment-primitive-phase-d-leverage.md)
 * previously required every consumer to hand-roll `Promise.all(candidates.map(c =>
 * agent.judge(...)))` (one round trip PER candidate) plus a manual sort. This
 * file batches every candidate's Score question into as FEW `ask()` calls as
 * possible — one call when the whole candidate set fits under `chunkCap`,
 * chunked calls otherwise — mirroring the batching *concept* (not the exact
 * code) `judgmentComprehendShadow`'s `chunkQuestions()` already uses in
 * `packages/reasoning/src/kernel/capabilities/comprehend/judgment-classification.ts`.
 * That file chunks a base-questions-plus-per-tool-Nouls set; this one chunks
 * one Score question per candidate id — same "don't send one unbounded
 * request" idea, different unit being chunked, so it isn't reused directly.
 *
 * Design choice — how ONE shared `question` becomes N per-candidate
 * questions: `JudgmentService.ask()` takes exactly one `state` shared across
 * every question in a batch. Rather than trying to encode N candidates inside
 * that single shared `state` (which would force the backend to cross-reference
 * a candidate id back into a `state.candidates[id]` bag, adding indirection
 * for no real benefit), each candidate becomes its own Score `QuestionSpec`
 * keyed by `candidate.id`, whose `instructions` field is the shared
 * `question.instructions` text with that one candidate's `state` folded in
 * directly. `ask()`'s own `state` argument is left `null` — nothing is left
 * unsaid, it's just carried in `instructions` instead of `state`.
 */
import { Effect } from "effect";
import type {
  JudgmentEntry,
  JudgmentError,
  JudgmentService,
  QuestionSpecs,
  ScoreCriteria,
  ScoreSpec,
} from "@reactive-agents/judgment";

/**
 * Per-`ask()` candidate ceiling. Mirrors `judgment-classification.ts`'s
 * `CHUNK_CAP` (30) — same order of magnitude, same rationale (no documented
 * hard cap from TypeSafe on question count per request, so this is a
 * pragmatic ceiling rather than a derived one). Kept as its own constant
 * (not imported from that file) since the two chunk what's fundamentally a
 * different unit (candidates vs. tool-derived questions) and living in
 * different packages (`runtime` has no dependency on `reasoning`'s kernel
 * internals for this).
 */
export const DEFAULT_JUDGE_RANK_CHUNK_CAP = 30;

/** One candidate to rank — `id` is the caller's own identifier, returned unchanged in the result. */
export interface JudgeRankCandidate {
  readonly id: string;
  readonly state: JudgmentEntry;
}

/** The single Score question every candidate is judged against. */
export interface JudgeRankQuestion {
  readonly instructions: JudgmentEntry;
  readonly criteria: ScoreCriteria;
}

/** `agent.judgeRank()`'s options. */
export interface JudgeRankOptions {
  /** Max candidates per `ask()` call. Defaults to `DEFAULT_JUDGE_RANK_CHUNK_CAP` (30). */
  readonly chunkCap?: number;
  readonly model?: string;
}

/** One ranked candidate — `score`/`confidence` straight from the backend's Score answer. */
export interface JudgeRankResult {
  readonly id: string;
  readonly score: number;
  readonly confidence: number;
}

const entryToText = (entry: JudgmentEntry): string =>
  typeof entry === "string" ? entry : JSON.stringify(entry);

/** Folds one candidate's `state` into the shared question's instructions text. */
function candidateInstructions(base: JudgmentEntry, candidateState: JudgmentEntry): JudgmentEntry {
  return `${entryToText(base)}\n\nCandidate:\n${entryToText(candidateState)}`;
}

/** Splits `items` into `chunkCap`-sized slices, preserving order. Empty input yields zero chunks. */
function chunkArray<T>(items: readonly T[], chunkCap: number): ReadonlyArray<readonly T[]> {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkCap) {
    chunks.push(items.slice(i, i + chunkCap));
  }
  return chunks;
}

/**
 * Builds one Score `QuestionSpec` per candidate in `chunk`, keyed by candidate id.
 *
 * Uses `Object.create(null)` rather than a plain `{}`/assignment target: a
 * candidate id of exactly `"__proto__"` assigned onto a plain object
 * pollutes the object's prototype instead of being stored as an own key,
 * silently dropping that candidate's question rather than surfacing it in
 * `ask()`'s batch.
 */
function buildChunkQuestions(
  chunk: readonly JudgeRankCandidate[],
  question: JudgeRankQuestion,
): QuestionSpecs {
  const specs: Record<string, ScoreSpec> = Object.create(null);
  for (const candidate of chunk) {
    specs[candidate.id] = {
      type: "score",
      instructions: candidateInstructions(question.instructions, candidate.state),
      criteria: question.criteria,
    };
  }
  return specs;
}

/**
 * Rejects duplicate candidate ids up front. Without this, two candidates
 * sharing an id would silently overwrite each other in `buildChunkQuestions`'s
 * per-chunk `specs` map — only the last duplicate's state gets judged, but
 * the result could be (mis)read as representing both.
 */
function assertUniqueCandidateIds(candidates: readonly JudgeRankCandidate[]): void {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) {
      throw new Error(`judgeRank(): duplicate candidate id "${candidate.id}" — every candidate.id must be unique.`);
    }
    seen.add(candidate.id);
  }
}

/**
 * Score-rank `candidates` against one `question`, batching every candidate
 * into a single `ask()` call when they fit `opts.chunkCap` candidates
 * (default `DEFAULT_JUDGE_RANK_CHUNK_CAP`), chunking into multiple `ask()`
 * calls — in candidate-list order, never re-shuffled — otherwise.
 *
 * Returns candidates sorted best-first (highest Score `value` first). Ties
 * keep the candidates' original relative order: `Array.prototype.sort` is a
 * stable sort per the ECMAScript spec (guaranteed since ES2019), not an
 * implementation detail being relied on here, and results are accumulated
 * chunk-by-chunk / candidate-by-candidate in input order before that sort
 * ever runs.
 *
 * A candidate whose answer doesn't come back as a Score answer (a
 * mis-implemented custom backend) is dropped from the result rather than
 * throwing — every OTHER candidate in the same batch still gets ranked. This
 * function's own contract (one Score `QuestionSpec` per candidate) makes that
 * case backend-misbehavior, not a caller error to surface as a hard failure.
 *
 * @returns Best-first sorted results. **The returned array may be SHORTER
 *   than `candidates`** — any candidate the backend answered with something
 *   other than a Score answer (`kind !== "score"`, or the id missing
 *   entirely from the batch response) is silently excluded rather than
 *   surfaced as a partial-failure marker. A caller that needs to distinguish
 *   "ranked low" from "dropped by backend misbehavior" must diff the
 *   returned ids against its own `candidates` list — `judgeRank()` does not
 *   report drops itself. This is the framework's own conforming
 *   `JudgmentBackend`s' expected behavior (they always answer every
 *   requested id), so in practice this only fires against a non-conforming
 *   custom backend.
 */
export function judgeRank(
  judgment: JudgmentService["Type"],
  candidates: readonly JudgeRankCandidate[],
  question: JudgeRankQuestion,
  opts: JudgeRankOptions = {},
): Effect.Effect<ReadonlyArray<JudgeRankResult>, JudgmentError> {
  return Effect.gen(function* () {
    const chunkCap = opts.chunkCap ?? DEFAULT_JUDGE_RANK_CHUNK_CAP;
    // `chunkArray`'s loop advances by `chunkCap` each iteration
    // (`i += chunkCap`) — a non-positive or non-finite cap never advances
    // `i`, producing an infinite synchronous loop that pushes empty slices
    // until the process hangs/OOMs. Reject up front instead, same style as
    // the existing `.withJudgment()`-absent throw: a caller mistake
    // surfaced loudly, not silently clamped into a different (and
    // surprising) chunking behavior.
    if (!Number.isFinite(chunkCap) || chunkCap <= 0) {
      return yield* Effect.die(
        new Error(
          `judgeRank(): opts.chunkCap must be a positive finite number, got ${chunkCap}.`,
        ),
      );
    }
    assertUniqueCandidateIds(candidates);
    const chunks = chunkArray(candidates, chunkCap);
    const results: JudgeRankResult[] = [];
    for (const chunk of chunks) {
      const questions = buildChunkQuestions(chunk, question);
      const answers = yield* judgment.ask({ state: null, questions, model: opts.model });
      for (const candidate of chunk) {
        const answer = answers[candidate.id];
        if (!answer || answer.kind !== "score") continue;
        results.push({ id: candidate.id, score: answer.value, confidence: answer.confidence });
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results;
  });
}
