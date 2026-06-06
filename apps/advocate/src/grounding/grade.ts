// apps/advocate/src/grounding/grade.ts
import { Effect } from "effect";
import type { DraftGrade, GradeDeps } from "./types.js";
import { extractUrls, findDeadLinks } from "./links.js";
import { astroturfIssues } from "./astroturf.js";

const MIN_LEN = 120;

/**
 * Patterns that betray a placeholder / unfinished / templated draft — the
 * failure mode weak local models reach for when they didn't actually read the
 * thread (they emit scaffolding like `URL_OF_FIRST_THREAD` or "placeholder
 * content based on..." instead of real, grounded prose). Saving these would
 * make the agent a toy; rejecting them forces the reflect loop to produce real
 * content or honestly save nothing.
 */
const PLACEHOLDER_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/<!--/, "contains HTML-comment scaffolding"],
  [/\bplaceholder\b/i, 'contains the word "placeholder"'],
  [/\b[A-Z][A-Z0-9]{2,}(?:_[A-Z0-9]+){1,}\b/, "contains an unsubstituted template token (SCREAMING_SNAKE)"],
  [/\b(?:URL_OF|_FROM_S\d|FIRST_THREAD|THREAD_\d)\b/i, "contains a template placeholder token"],
  [/\b(?:insert|your)\s+(?:url|link|content|text)\s+here\b/i, "contains fill-in-the-blank scaffolding"],
  [/\be\.g\.,\s*"/i, "contains example scaffolding instead of real content"],
];

function placeholderIssues(text: string): string[] {
  return PLACEHOLDER_PATTERNS.filter(([re]) => re.test(text)).map(
    ([, msg]) => `placeholder/unfinished draft: ${msg}`,
  );
}

export const gradeDraft = (
  draft: string,
  deps: GradeDeps,
): Effect.Effect<DraftGrade> =>
  Effect.gen(function* () {
    const deadLinks = yield* findDeadLinks(extractUrls(draft), deps.fetchImpl);
    const issues = [
      ...astroturfIssues(draft),
      ...placeholderIssues(draft),
      ...(draft.trim().length < MIN_LEN ? ["draft too short to add real value (needs substantive content)"] : []),
      ...(deadLinks.length > 0 ? [`${deadLinks.length} dead link(s)`] : []),
    ];
    return { pass: issues.length === 0, issues, deadLinks };
  });
