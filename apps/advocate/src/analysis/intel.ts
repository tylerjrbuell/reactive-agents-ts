// apps/advocate/src/analysis/intel.ts
import { Effect } from "effect";
import type { EvidenceItem, IntelConfig, IntelDeps } from "./types.js";
import { normalizeReleases } from "./github-releases.js";
import { assignConfidence } from "./confidence.js";

const fetchJson = (fetchImpl: typeof fetch, url: string): Effect.Effect<unknown> =>
  Effect.tryPromise(() => fetchImpl(url).then((r) => r.json() as Promise<unknown>)).pipe(
    Effect.catchAll(() => Effect.succeed<unknown>(null)),
  );

export const gatherCompetitiveEvidence = (
  config: IntelConfig,
  deps: IntelDeps,
): Effect.Effect<EvidenceItem[]> =>
  Effect.gen(function* () {
    const raw = yield* Effect.all(
      config.repos.map((repo) =>
        fetchJson(
          deps.fetchImpl,
          `https://api.github.com/repos/${repo}/releases?per_page=${config.perRepo}`,
        ).pipe(Effect.map((json) => normalizeReleases(repo, json))),
      ),
      { concurrency: 4 },
    );
    const items = raw.flat();

    const perCompetitor = new Map<string, number>();
    for (const it of items) {
      perCompetitor.set(it.competitor, (perCompetitor.get(it.competitor) ?? 0) + 1);
    }

    const rank: Record<string, number> = { high: 3, medium: 2, low: 1 };
    return items
      .map((it) => {
        const recencyDays = (Date.now() - Date.parse(it.capturedAt)) / 86_400_000;
        const corroboration = (perCompetitor.get(it.competitor) ?? 1) - 1;
        const confidence = assignConfidence(
          Number.isFinite(recencyDays) ? recencyDays : 999,
          corroboration,
        );
        return { ...it, confidence };
      })
      .sort((a, b) => rank[b.confidence]! - rank[a.confidence]!);
  });
