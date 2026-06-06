// apps/advocate/src/ingest/gather.ts
import { Effect } from "effect";
import type { CommunityThread, GatherConfig, GatherDeps } from "./types.js";
import {
  normalizeHnHits,
  normalizeRedditListing,
  normalizeDevtoArticles,
} from "./normalize.js";
import { scoreThread } from "./score.js";

/** Fetch + parse JSON; any failure (network, non-JSON) degrades to `null` so one
 *  dead source never aborts the whole gather. */
const fetchJson = (fetchImpl: typeof fetch, url: string): Effect.Effect<unknown> =>
  Effect.tryPromise(() =>
    fetchImpl(url).then((r) => r.json() as Promise<unknown>),
  ).pipe(Effect.catchAll(() => Effect.succeed<unknown>(null)));

/**
 * Gather relevant community threads across Hacker News, Reddit, and dev.to:
 * fetch → normalize → drop already-seen → rank by relevance → take top-N →
 * mark returned ids as seen for the next run.
 */
export const gatherThreads = (
  config: GatherConfig,
  deps: GatherDeps,
): Effect.Effect<CommunityThread[]> =>
  Effect.gen(function* () {
    const cutoff = Math.floor(Date.now() / 1000) - config.sinceHours * 3600;
    const query = config.searchTerms.join(" ");

    const hnUrls = config.searchTerms.map(
      (term) =>
        `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(term)}` +
        `&tags=story&numericFilters=created_at_i>${cutoff}`,
    );
    const redditUrls = config.subreddits.map(
      (sub) =>
        `https://www.reddit.com/r/${encodeURIComponent(sub)}/search.json` +
        `?q=${encodeURIComponent(query)}&restrict_sr=1&sort=new&limit=25&t=week`,
    );
    const devtoUrls = config.devtoTags.map(
      (tag) => `https://dev.to/api/articles?tag=${encodeURIComponent(tag)}&per_page=25&top=7`,
    );

    const fetchAll = (urls: readonly string[]) =>
      Effect.all(
        urls.map((u) => fetchJson(deps.fetchImpl, u)),
        { concurrency: 4 },
      );

    const hnRaw = yield* fetchAll(hnUrls);
    const redditRaw = yield* fetchAll(redditUrls);
    const devtoRaw = yield* fetchAll(devtoUrls);

    const all: CommunityThread[] = [
      ...hnRaw.flatMap(normalizeHnHits),
      ...redditRaw.flatMap(normalizeRedditListing),
      ...devtoRaw.flatMap(normalizeDevtoArticles),
    ];

    // Dedup by id (duplicate term queries return overlapping items) and drop
    // threads already handled in a previous run.
    const byId = new Map<string, CommunityThread>();
    for (const t of all) {
      if (!byId.has(t.id) && !deps.isSeen(t.id)) byId.set(t.id, t);
    }

    const ranked = [...byId.values()]
      .map((t) => ({ t, score: scoreThread(t, config.searchTerms) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, config.limit)
      .map((x) => x.t);

    deps.markSeen(ranked.map((t) => t.id));
    return ranked;
  });
