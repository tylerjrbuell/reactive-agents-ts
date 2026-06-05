// apps/meta-agent/src/analysis/github-releases.ts
import type { EvidenceItem } from "./types.js";

const rec = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const bool = (v: unknown): boolean => v === true;

export const normalizeReleases = (repo: string, json: unknown): EvidenceItem[] => {
  const competitor = (repo.split("/")[1] ?? repo).toLowerCase();
  const items = Array.isArray(json) ? json : [];
  return items.flatMap((r): EvidenceItem[] => {
    const o = rec(r);
    if (bool(o.draft)) return [];
    const tag = str(o.tag_name);
    const url = str(o.html_url);
    if (tag === undefined || url === undefined) return [];
    return [
      {
        id: `release:${repo}#${tag}`,
        competitor,
        source: "release",
        summary: str(o.name) ?? tag,
        url,
        capturedAt: str(o.published_at) ?? new Date().toISOString(),
        confidence: "low",
      },
    ];
  });
};
