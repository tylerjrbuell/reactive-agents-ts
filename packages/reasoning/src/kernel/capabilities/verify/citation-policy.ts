/**
 * Deterministic (non-LLM) citation validator — checks that every URL a
 * model's answer cites appears verbatim somewhere in the run's
 * tool-observation evidence corpus (the same corpus
 * `evidence-grounding.ts`'s numeric checks already build from
 * `state.steps`). Pure functions — no LLM calls.
 *
 * NOTE (scope): this module only computes the check. Wiring it into a
 * termination/deliverable-assembly call site (so `.withAnswerPolicy({
 * requireCitations: "block" })` actually redirects a run) is a separate,
 * deliberately deferred task — see the runtime `.withAnswerPolicy()` builder
 * option's docs.
 */
import { buildEvidenceCorpusFromSteps } from "./evidence-grounding.js";
import type { ReasoningStep } from "../../../types/index.js";

export interface CitationValidationResult {
  readonly ok: boolean;
  /** URLs cited in the output that were not found in tool-observation evidence. */
  readonly uncitedUrls: readonly string[];
  /** Total number of URLs cited in the output (deduplication not applied). */
  readonly citedUrlCount: number;
}

const URL_PATTERN = /https?:\/\/[^\s)\]}"'<>]+/g;
// Trailing characters that are almost always sentence punctuation rather
// than part of the URL itself (e.g. "...Chief, he is" or "...Chief.").
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

/** Extracts http(s) URLs from free text, in order of appearance. */
export function extractUrls(text: string): readonly string[] {
  const matches = text.match(URL_PATTERN);
  if (!matches) return [];
  return matches.map((url) => url.replace(TRAILING_PUNCTUATION, ""));
}

/**
 * Every URL the model's output cites must appear verbatim somewhere in the
 * run's tool-observation evidence corpus. An output with zero citations
 * passes vacuously — this validates that citations, when present, are
 * grounded; it does not by itself require a citation exist (that's the
 * `.withAnswerPolicy({ requireCitations })` mode, applied by the caller).
 */
export function validateCitations(
  output: string,
  steps: readonly ReasoningStep[],
): CitationValidationResult {
  const citedUrls = extractUrls(output);
  if (citedUrls.length === 0) {
    return { ok: true, uncitedUrls: [], citedUrlCount: 0 };
  }

  const corpus = buildEvidenceCorpusFromSteps(steps);
  const uncitedUrls = citedUrls.filter((url) => !corpus.includes(url));

  return {
    ok: uncitedUrls.length === 0,
    uncitedUrls,
    citedUrlCount: citedUrls.length,
  };
}
