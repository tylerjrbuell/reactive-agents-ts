// apps/advocate/src/ingest/types.ts
import { Schema } from "effect";

/**
 * A normalized discussion thread from any monitored community source.
 * `id` is the stable cross-run dedup key, e.g. "hn:123", "reddit:abc", "devto:456".
 */
export const CommunityThreadSchema = Schema.Struct({
  id: Schema.String,
  source: Schema.Literal("hackernews", "reddit", "devto"),
  title: Schema.String,
  url: Schema.String,
  author: Schema.optional(Schema.String),
  points: Schema.optional(Schema.Number),
  numComments: Schema.optional(Schema.Number),
  createdAt: Schema.String,
  snippet: Schema.optional(Schema.String),
});

export type CommunityThread = Schema.Schema.Type<typeof CommunityThreadSchema>;

/** Inputs that define the monitoring scope for a single gather pass. */
export type GatherConfig = {
  readonly searchTerms: readonly string[];
  readonly subreddits: readonly string[];
  readonly devtoTags: readonly string[];
  readonly sinceHours: number;
  readonly limit: number;
};

/** Injected effects — fetch + dedup store — so gather is unit-testable offline. */
export type GatherDeps = {
  readonly fetchImpl: typeof fetch;
  readonly isSeen: (id: string) => boolean;
  readonly markSeen: (ids: readonly string[]) => void;
};
