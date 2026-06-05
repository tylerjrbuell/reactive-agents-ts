// apps/meta-agent/src/grounding/links.ts
import { Effect } from "effect";

const URL_RE = /https?:\/\/[^\s)\]>"']+/g;

export const extractUrls = (text: string): string[] => {
  const matches = text.match(URL_RE);
  return matches === null ? [] : [...new Set(matches)];
};

/** Returns the subset of urls that do NOT resolve (network error or status >= 400). */
export const findDeadLinks = (
  urls: readonly string[],
  fetchImpl: typeof fetch,
): Effect.Effect<string[]> =>
  Effect.all(
    urls.map((u) =>
      Effect.tryPromise(() => fetchImpl(u).then((r) => r.status < 400))
        .pipe(Effect.catchAll(() => Effect.succeed(false)))
        .pipe(Effect.map((ok) => ({ u, ok }))),
    ),
    { concurrency: 4 },
  ).pipe(Effect.map((rs) => rs.filter((r) => !r.ok).map((r) => r.u)));
