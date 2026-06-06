// apps/advocate/src/grounding/grade.ts
import { Effect } from "effect";
import type { DraftGrade, GradeDeps } from "./types.js";
import { extractUrls, findDeadLinks } from "./links.js";
import { astroturfIssues } from "./astroturf.js";

const MIN_LEN = 80;

export const gradeDraft = (
  draft: string,
  deps: GradeDeps,
): Effect.Effect<DraftGrade> =>
  Effect.gen(function* () {
    const deadLinks = yield* findDeadLinks(extractUrls(draft), deps.fetchImpl);
    const issues = [
      ...astroturfIssues(draft),
      ...(draft.trim().length < MIN_LEN ? ["draft too short to add real value"] : []),
      ...(deadLinks.length > 0 ? [`${deadLinks.length} dead link(s)`] : []),
    ];
    return { pass: issues.length === 0, issues, deadLinks };
  });
