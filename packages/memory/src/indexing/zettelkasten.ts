import { Effect, Context, Layer } from "effect";
import type { MemoryId, ZettelLink, LinkType } from "../types.js";
import { DatabaseError } from "../errors.js";
import { MemoryDatabase } from "../database.js";

// ─── Service Tag ───

export class ZettelkastenService extends Context.Tag("ZettelkastenService")<
  ZettelkastenService,
  {
    /** Add a link between two memory entries. */
    readonly addLink: (link: ZettelLink) => Effect.Effect<void, DatabaseError>;

    /** Get all links for a memory ID (as source or target). */
    readonly getLinks: (
      memoryId: MemoryId,
    ) => Effect.Effect<ZettelLink[], DatabaseError>;

    /** Get IDs of all memories linked to a given ID. */
    readonly getLinked: (
      memoryId: MemoryId,
    ) => Effect.Effect<MemoryId[], DatabaseError>;

    /** Traverse link graph up to `depth` hops from startId. */
    readonly traverse: (
      startId: MemoryId,
      depth: number,
    ) => Effect.Effect<MemoryId[], DatabaseError>;

    /** Delete all links for a memory (when entry is deleted). */
    readonly deleteLinks: (
      memoryId: MemoryId,
    ) => Effect.Effect<void, DatabaseError>;

    /**
     * Auto-link via FTS5 similarity (find semantically similar entries
     * and create "similar" links if above threshold).
     */
    readonly autoLinkText: (
      memoryId: MemoryId,
      content: string,
      agentId: string,
      threshold?: number,
    ) => Effect.Effect<ZettelLink[], DatabaseError>;
  }
>() {}

// ─── Live Implementation ───

export const ZettelkastenServiceLive = Layer.effect(
  ZettelkastenService,
  Effect.gen(function* () {
    const db = yield* MemoryDatabase;

    const rowToLink = (r: Record<string, unknown>): ZettelLink => ({
      source: r.source_id as MemoryId,
      target: r.target_id as MemoryId,
      strength: r.strength as number,
      type: r.type as LinkType,
      createdAt: new Date(r.created_at as string),
    });

    return {
      addLink: (link) =>
        db
          .exec(
            `INSERT OR REPLACE INTO zettel_links (source_id, target_id, strength, type, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [
              link.source,
              link.target,
              link.strength,
              link.type,
              link.createdAt.toISOString(),
            ],
          )
          .pipe(Effect.asVoid),

      getLinks: (memoryId) =>
        db
          .query(
            `SELECT * FROM zettel_links WHERE source_id = ? OR target_id = ? ORDER BY strength DESC`,
            [memoryId, memoryId],
          )
          .pipe(Effect.map((rows) => rows.map(rowToLink))),

      getLinked: (memoryId) =>
        db
          .query(
            `SELECT CASE WHEN source_id = ? THEN target_id ELSE source_id END as linked_id
             FROM zettel_links
             WHERE source_id = ? OR target_id = ?
             ORDER BY strength DESC`,
            [memoryId, memoryId, memoryId],
          )
          .pipe(
            Effect.map((rows) => rows.map((r) => r.linked_id as MemoryId)),
          ),

      traverse: (startId, depth) =>
        Effect.gen(function* () {
          const visited = new Set<string>();
          const result: MemoryId[] = [];
          const queue: Array<{ id: MemoryId; d: number }> = [
            { id: startId, d: 0 },
          ];

          while (queue.length > 0) {
            const item = queue.shift()!;
            if (visited.has(item.id) || item.d > depth) continue;
            visited.add(item.id);
            if (item.id !== startId) result.push(item.id);

            const links = yield* db.query<{ linked_id: string }>(
              `SELECT CASE WHEN source_id = ? THEN target_id ELSE source_id END as linked_id
               FROM zettel_links WHERE source_id = ? OR target_id = ?`,
              [item.id, item.id, item.id],
            );

            for (const link of links) {
              if (!visited.has(link.linked_id)) {
                queue.push({
                  id: link.linked_id as MemoryId,
                  d: item.d + 1,
                });
              }
            }
          }

          return result;
        }),

      deleteLinks: (memoryId) =>
        db
          .exec(
            `DELETE FROM zettel_links WHERE source_id = ? OR target_id = ?`,
            [memoryId, memoryId],
          )
          .pipe(Effect.asVoid),

      // Text-based auto-linking via FTS5 search
      autoLinkText: (memoryId, content, agentId, threshold = 0.85) =>
        Effect.gen(function* () {
          // Use simplified text similarity via FTS5 rank as proxy
          const searchTerms = content
            .split(/\s+/)
            .filter((w) => w.length > 3)
            .slice(0, 10)
            .join(" OR ");

          if (searchTerms.length === 0) return [];

          const similar = yield* db.query<{
            id: string;
            rank: number;
          }>(
            `SELECT sm.id, semantic_fts.rank
             FROM semantic_memory sm
             JOIN semantic_fts ON semantic_fts.id = sm.id
             WHERE semantic_fts MATCH ?
               AND sm.agent_id = ?
               AND sm.id != ?
             ORDER BY rank
             LIMIT 5`,
            [searchTerms, agentId, memoryId],
          );

          const now = new Date();
          const links: ZettelLink[] = [];

          for (const row of similar) {
            // Convert FTS rank to 0-1 strength (rank is negative BM25 score)
            const strength = Math.min(1, Math.max(0, 1 + row.rank / 10));
            if (strength < threshold) continue;

            const link: ZettelLink = {
              source: memoryId,
              target: row.id as MemoryId,
              strength,
              type: "similar",
              createdAt: now,
            };

            yield* db.exec(
              `INSERT OR REPLACE INTO zettel_links (source_id, target_id, strength, type, created_at)
               VALUES (?, ?, ?, ?, ?)`,
              [
                link.source,
                link.target,
                link.strength,
                link.type,
                link.createdAt.toISOString(),
              ],
            );
            links.push(link);
          }

          return links;
        }),
    };
  }),
);
