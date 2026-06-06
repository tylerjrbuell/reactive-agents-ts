// apps/advocate/src/ingest/normalize.ts
import type { CommunityThread } from "./types.js";

const rec = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const numv = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const idOf = (v: unknown): string | undefined =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;

/** Algolia HN Search API: `{ hits: [{ objectID, title, points, num_comments, ... }] }`. */
export const normalizeHnHits = (json: unknown): CommunityThread[] =>
  arr(rec(json).hits).flatMap((h): CommunityThread[] => {
    const o = rec(h);
    const id = idOf(o.objectID);
    const title = str(o.title);
    if (id === undefined || title === undefined) return [];
    return [
      {
        id: `hn:${id}`,
        source: "hackernews",
        title,
        url: `https://news.ycombinator.com/item?id=${id}`,
        author: str(o.author),
        points: numv(o.points),
        numComments: numv(o.num_comments),
        createdAt: str(o.created_at) ?? new Date().toISOString(),
        snippet: str(o.story_text) ?? str(o.comment_text),
      },
    ];
  });

/** Reddit listing JSON: `{ data: { children: [{ data: { id, title, permalink, ... } }] } }`. */
export const normalizeRedditListing = (json: unknown): CommunityThread[] =>
  arr(rec(rec(json).data).children).flatMap((c): CommunityThread[] => {
    const o = rec(rec(c).data);
    const id = idOf(o.id);
    const title = str(o.title);
    const permalink = str(o.permalink);
    if (id === undefined || title === undefined || permalink === undefined) return [];
    const createdSec = numv(o.created_utc);
    return [
      {
        id: `reddit:${id}`,
        source: "reddit",
        title,
        url: `https://www.reddit.com${permalink}`,
        author: str(o.author),
        points: numv(o.score),
        numComments: numv(o.num_comments),
        createdAt:
          createdSec !== undefined
            ? new Date(createdSec * 1000).toISOString()
            : new Date().toISOString(),
        snippet: str(o.selftext),
      },
    ];
  });

/** dev.to articles API: `[{ id, title, url, user: { username }, ... }]`. */
export const normalizeDevtoArticles = (json: unknown): CommunityThread[] =>
  arr(json).flatMap((a): CommunityThread[] => {
    const o = rec(a);
    const id = idOf(o.id);
    const title = str(o.title);
    const url = str(o.url);
    if (id === undefined || title === undefined || url === undefined) return [];
    return [
      {
        id: `devto:${id}`,
        source: "devto",
        title,
        url,
        author: str(rec(o.user).username),
        points: numv(o.positive_reactions_count),
        numComments: numv(o.comments_count),
        createdAt: str(o.published_at) ?? new Date().toISOString(),
        snippet: str(o.description),
      },
    ];
  });
