import { Effect, Context, Layer } from "effect";
import type {
  SkillRecord,
  SkillVersion,
  SkillFragmentConfig,
  SkillSource,
  SkillConfidence,
  SkillEvolutionMode,
} from "@reactive-agents/core";
import { DatabaseError, MemoryNotFoundError } from "../errors.js";
import { MemoryDatabase } from "../database.js";
import { safeJsonParse } from "../json-utils.js";

// ─── Stored version shape ───

/**
 * A skill version as the store reads it back: the core `SkillVersion` plus the
 * skill's `useCount` when the version was recorded. `null` means unknown (a row
 * written before the column existed).
 */
export type StoredSkillVersion = SkillVersion & { readonly useCountAtRefinement: number | null };

/**
 * The use count recorded with a version, or `null` when the version carries
 * none (a hand-built `SkillVersion`, or a legacy row).
 */
export const useCountAtRefinementOf = (version: SkillVersion): number | null =>
  "useCountAtRefinement" in version && typeof version.useCountAtRefinement === "number"
    ? version.useCountAtRefinement
    : null;

// ─── Service Tag ───

export class SkillStoreService extends Context.Tag("SkillStoreService")<
  SkillStoreService,
  {
    /** Store a new SkillRecord. */
    readonly store: (record: SkillRecord) => Effect.Effect<string, DatabaseError>;

    /** Get a skill by ID. */
    readonly get: (id: string) => Effect.Effect<SkillRecord | null, DatabaseError>;

    /** Get a skill by name and agentId. */
    readonly getByName: (agentId: string, name: string) => Effect.Effect<SkillRecord | null, DatabaseError>;

    /** Find skills matching task categories for an agent, ranked by successRate * useCount. */
    readonly findByTask: (agentId: string, taskCategories: readonly string[], modelId?: string) => Effect.Effect<SkillRecord[], DatabaseError>;

    /**
     * Update partial fields on a skill. An in-place UPDATE: version history is
     * never touched, so this is how to lock/unlock a skill (`evolutionMode`).
     */
    readonly update: (
      id: string,
      partial: Partial<
        Pick<
          SkillRecord,
          | "instructions"
          | "evolutionMode"
          | "version"
          | "config"
          | "confidence"
          | "successRate"
          | "useCount"
          | "refinementCount"
          | "lastActivatedAt"
          | "lastRefinedAt"
          | "contentVariants"
          | "avgPostActivationEntropyDelta"
          | "avgConvergenceIteration"
          | "convergenceSpeedTrend"
          | "conflictsWith"
        >
      >,
    ) => Effect.Effect<void, DatabaseError>;

    /** Promote skill confidence tier. */
    readonly promote: (id: string, newConfidence: SkillConfidence) => Effect.Effect<void, DatabaseError>;

    /** Rollback to previous version (atomic: restores instructions + config). */
    readonly rollback: (id: string) => Effect.Effect<void, DatabaseError | MemoryNotFoundError>;

    /** List all skills for an agent. */
    readonly listAll: (agentId: string) => Effect.Effect<SkillRecord[], DatabaseError>;

    /** Delete a skill and its version history. */
    readonly delete: (id: string) => Effect.Effect<void, DatabaseError>;

    /** Add a version entry to skill_versions. */
    readonly addVersion: (skillId: string, version: SkillVersion) => Effect.Effect<void, DatabaseError>;
  }
>() {}

// ─── Live Implementation ───

export const SkillStoreServiceLive = Layer.effect(
  SkillStoreService,
  Effect.gen(function* () {
    const db = yield* MemoryDatabase;

    // ─── Row → Version ───

    const rowToVersion = (r: Record<string, unknown>): StoredSkillVersion => ({
      version: r.version as number,
      instructions: r.instructions as string,
      config: safeJsonParse<SkillFragmentConfig>(
        r.config as string | null,
        {} as SkillFragmentConfig,
      ),
      refinedAt: new Date(r.refined_at as string),
      successRateAtRefinement: r.success_rate_at_refinement as number,
      status: r.status as "candidate" | "active",
      useCountAtRefinement:
        typeof r.use_count_at_refinement === "number" ? r.use_count_at_refinement : null,
    });

    // ─── Load version history for a skill ───

    const loadVersionHistory = (skillId: string): Effect.Effect<readonly SkillVersion[], DatabaseError> =>
      db
        .query<Record<string, unknown>>(
          `SELECT * FROM skill_versions WHERE skill_id = ? ORDER BY version ASC`,
          [skillId],
        )
        .pipe(Effect.map((rows) => rows.map(rowToVersion)));

    // ─── Row → SkillRecord ───

    const rowToRecord = (r: Record<string, unknown>, versions: readonly SkillVersion[]): SkillRecord => ({
      id: r.id as string,
      name: r.name as string,
      description: r.description as string,
      agentId: r.agent_id as string,
      source: r.source as SkillSource,
      instructions: r.instructions as string,
      version: r.version as number,
      versionHistory: versions,
      config: safeJsonParse<SkillFragmentConfig>(
        r.config as string | null,
        {} as SkillFragmentConfig,
      ),
      evolutionMode: r.evolution_mode as SkillEvolutionMode,
      confidence: r.confidence as SkillConfidence,
      successRate: r.success_rate as number,
      useCount: r.use_count as number,
      refinementCount: r.refinement_count as number,
      taskCategories: safeJsonParse<string[]>(
        r.task_categories as string | null,
        [],
      ),
      modelAffinities: safeJsonParse<string[]>(
        r.model_affinities as string | null,
        [],
      ),
      base: (r.base as string | null) ?? null,
      avgPostActivationEntropyDelta: r.avg_post_activation_entropy_delta as number,
      avgConvergenceIteration: r.avg_convergence_iteration as number,
      convergenceSpeedTrend: safeJsonParse<number[]>(
        r.convergence_speed_trend as string | null,
        [],
      ),
      conflictsWith: safeJsonParse<string[]>(
        r.conflicts_with as string | null,
        [],
      ),
      lastActivatedAt: r.last_activated_at ? new Date(r.last_activated_at as string) : null,
      lastRefinedAt: r.last_refined_at ? new Date(r.last_refined_at as string) : null,
      createdAt: new Date(r.created_at as string),
      updatedAt: new Date(r.updated_at as string),
      contentVariants: safeJsonParse<{
        full: string;
        summary: string | null;
        condensed: string | null;
      }>(r.content_variants as string | null, {
        full: "",
        summary: null,
        condensed: null,
      }),
    });

    return {
      // A real upsert, not INSERT OR REPLACE: REPLACE deletes the old row
      // first, and the ON DELETE CASCADE on skill_versions then wiped the
      // skill's whole version history on every re-store. The original
      // created_at is kept on update.
      store: (record: SkillRecord) =>
        Effect.gen(function* () {
          yield* db.exec(
            `INSERT INTO skills (
              id, name, description, agent_id, source, instructions, version, config,
              evolution_mode, confidence, success_rate, use_count, refinement_count,
              task_categories, model_affinities, base, avg_post_activation_entropy_delta,
              avg_convergence_iteration, convergence_speed_trend, conflicts_with,
              content_variants, last_activated_at, last_refined_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              description = excluded.description,
              agent_id = excluded.agent_id,
              source = excluded.source,
              instructions = excluded.instructions,
              version = excluded.version,
              config = excluded.config,
              evolution_mode = excluded.evolution_mode,
              confidence = excluded.confidence,
              success_rate = excluded.success_rate,
              use_count = excluded.use_count,
              refinement_count = excluded.refinement_count,
              task_categories = excluded.task_categories,
              model_affinities = excluded.model_affinities,
              base = excluded.base,
              avg_post_activation_entropy_delta = excluded.avg_post_activation_entropy_delta,
              avg_convergence_iteration = excluded.avg_convergence_iteration,
              convergence_speed_trend = excluded.convergence_speed_trend,
              conflicts_with = excluded.conflicts_with,
              content_variants = excluded.content_variants,
              last_activated_at = excluded.last_activated_at,
              last_refined_at = excluded.last_refined_at,
              updated_at = excluded.updated_at`,
            [
              record.id,
              record.name,
              record.description,
              record.agentId,
              record.source,
              record.instructions,
              record.version,
              JSON.stringify(record.config),
              record.evolutionMode,
              record.confidence,
              record.successRate,
              record.useCount,
              record.refinementCount,
              JSON.stringify(record.taskCategories),
              JSON.stringify(record.modelAffinities),
              record.base ?? null,
              record.avgPostActivationEntropyDelta,
              record.avgConvergenceIteration,
              JSON.stringify(record.convergenceSpeedTrend),
              JSON.stringify(record.conflictsWith),
              JSON.stringify(record.contentVariants),
              record.lastActivatedAt?.toISOString() ?? null,
              record.lastRefinedAt?.toISOString() ?? null,
              record.createdAt.toISOString(),
              record.updatedAt.toISOString(),
            ],
          );
          return record.id;
        }),

      get: (id: string) =>
        Effect.gen(function* () {
          const rows = yield* db.query<Record<string, unknown>>(
            `SELECT * FROM skills WHERE id = ?`,
            [id],
          );
          if (rows.length === 0) return null;
          const versions = yield* loadVersionHistory(id);
          return rowToRecord(rows[0]!, versions);
        }),

      getByName: (agentId: string, name: string) =>
        Effect.gen(function* () {
          const rows = yield* db.query<Record<string, unknown>>(
            `SELECT * FROM skills WHERE agent_id = ? AND name = ?`,
            [agentId, name],
          );
          if (rows.length === 0) return null;
          const versions = yield* loadVersionHistory(rows[0]!.id as string);
          return rowToRecord(rows[0]!, versions);
        }),

      findByTask: (agentId: string, taskCategories: readonly string[], modelId?: string) =>
        Effect.gen(function* () {
          const allRows = yield* db.query<Record<string, unknown>>(
            `SELECT * FROM skills WHERE agent_id = ?`,
            [agentId],
          );
          // Filter by task category overlap (JSON array intersection)
          const matched = allRows.filter((r) => {
            const skillCategories = safeJsonParse<string[]>(
              r.task_categories as string | null,
              [],
            );
            return taskCategories.some((cat) => skillCategories.includes(cat));
          });
          // Sort by score (boost model affinity if modelId provided)
          matched.sort((a, b) => {
            let scoreA = (a.success_rate as number) * (a.use_count as number);
            let scoreB = (b.success_rate as number) * (b.use_count as number);
            if (modelId) {
              const affinitiesA = safeJsonParse<string[]>(
                a.model_affinities as string | null,
                [],
              );
              const affinitiesB = safeJsonParse<string[]>(
                b.model_affinities as string | null,
                [],
              );
              if (affinitiesA.includes(modelId)) scoreA += 1;
              if (affinitiesB.includes(modelId)) scoreB += 1;
            }
            return scoreB - scoreA;
          });
          // Load version histories
          const records: SkillRecord[] = [];
          for (const row of matched) {
            const versions = yield* loadVersionHistory(row.id as string);
            records.push(rowToRecord(row, versions));
          }
          return records;
        }),

      update: (id: string, partial: Partial<Pick<SkillRecord,
        | "instructions" | "evolutionMode" | "version" | "config" | "confidence" | "successRate" | "useCount"
        | "refinementCount" | "lastActivatedAt" | "lastRefinedAt" | "contentVariants"
        | "avgPostActivationEntropyDelta" | "avgConvergenceIteration"
        | "convergenceSpeedTrend" | "conflictsWith"
      >>) =>
        Effect.gen(function* () {
          const setClauses: string[] = [];
          const params: unknown[] = [];

          if (partial.instructions !== undefined) {
            setClauses.push("instructions = ?");
            params.push(partial.instructions);
          }
          if (partial.evolutionMode !== undefined) {
            setClauses.push("evolution_mode = ?");
            params.push(partial.evolutionMode);
          }
          if (partial.version !== undefined) {
            setClauses.push("version = ?");
            params.push(partial.version);
          }
          if (partial.config !== undefined) {
            setClauses.push("config = ?");
            params.push(JSON.stringify(partial.config));
          }
          if (partial.confidence !== undefined) {
            setClauses.push("confidence = ?");
            params.push(partial.confidence);
          }
          if (partial.successRate !== undefined) {
            setClauses.push("success_rate = ?");
            params.push(partial.successRate);
          }
          if (partial.useCount !== undefined) {
            setClauses.push("use_count = ?");
            params.push(partial.useCount);
          }
          if (partial.refinementCount !== undefined) {
            setClauses.push("refinement_count = ?");
            params.push(partial.refinementCount);
          }
          if (partial.lastActivatedAt !== undefined) {
            setClauses.push("last_activated_at = ?");
            params.push(partial.lastActivatedAt?.toISOString() ?? null);
          }
          if (partial.lastRefinedAt !== undefined) {
            setClauses.push("last_refined_at = ?");
            params.push(partial.lastRefinedAt?.toISOString() ?? null);
          }
          if (partial.contentVariants !== undefined) {
            setClauses.push("content_variants = ?");
            params.push(JSON.stringify(partial.contentVariants));
          }
          if (partial.avgPostActivationEntropyDelta !== undefined) {
            setClauses.push("avg_post_activation_entropy_delta = ?");
            params.push(partial.avgPostActivationEntropyDelta);
          }
          if (partial.avgConvergenceIteration !== undefined) {
            setClauses.push("avg_convergence_iteration = ?");
            params.push(partial.avgConvergenceIteration);
          }
          if (partial.convergenceSpeedTrend !== undefined) {
            setClauses.push("convergence_speed_trend = ?");
            params.push(JSON.stringify(partial.convergenceSpeedTrend));
          }
          if (partial.conflictsWith !== undefined) {
            setClauses.push("conflicts_with = ?");
            params.push(JSON.stringify(partial.conflictsWith));
          }

          if (setClauses.length === 0) return;

          setClauses.push("updated_at = ?");
          params.push(new Date().toISOString());
          params.push(id);

          yield* db.exec(
            `UPDATE skills SET ${setClauses.join(", ")} WHERE id = ?`,
            params,
          );
        }),

      promote: (id: string, newConfidence: SkillConfidence) =>
        db.exec(
          `UPDATE skills SET confidence = ?, updated_at = ? WHERE id = ?`,
          [newConfidence, new Date().toISOString(), id],
        ).pipe(Effect.map(() => undefined)),

      rollback: (id: string) =>
        Effect.gen(function* () {
          // Get current skill version
          const skillRows = yield* db.query<Record<string, unknown>>(
            `SELECT version FROM skills WHERE id = ?`,
            [id],
          );
          if (skillRows.length === 0) {
            return yield* Effect.fail(
              new MemoryNotFoundError({ memoryId: id, message: `Skill ${id} not found` }),
            );
          }
          const currentVersion = skillRows[0]!.version as number;
          const prevVersion = currentVersion - 1;

          // Find the previous version in skill_versions
          const prevRows = yield* db.query<Record<string, unknown>>(
            `SELECT * FROM skill_versions WHERE skill_id = ? AND version = ?`,
            [id, prevVersion],
          );
          if (prevRows.length === 0) {
            return yield* Effect.fail(
              new MemoryNotFoundError({
                memoryId: id,
                message: `No previous version (v${prevVersion}) found for skill ${id}`,
              }),
            );
          }
          const prev = prevRows[0]!;

          // Atomically restore previous version
          yield* db.transaction((txDb) =>
            Effect.gen(function* () {
              yield* txDb.exec(
                `UPDATE skills SET instructions = ?, config = ?, version = ?, updated_at = ? WHERE id = ?`,
                [
                  prev.instructions as string,
                  prev.config as string,
                  prevVersion,
                  new Date().toISOString(),
                  id,
                ],
              );
              yield* txDb.exec(
                `DELETE FROM skill_versions WHERE skill_id = ? AND version = ?`,
                [id, currentVersion],
              );
            }),
          );
        }),

      listAll: (agentId: string) =>
        Effect.gen(function* () {
          const rows = yield* db.query<Record<string, unknown>>(
            `SELECT * FROM skills WHERE agent_id = ? ORDER BY confidence DESC, success_rate * use_count DESC`,
            [agentId],
          );
          const records: SkillRecord[] = [];
          for (const row of rows) {
            const versions = yield* loadVersionHistory(row.id as string);
            records.push(rowToRecord(row, versions));
          }
          return records;
        }),

      delete: (id: string) =>
        db.exec(`DELETE FROM skills WHERE id = ?`, [id]).pipe(Effect.map(() => undefined)),

      addVersion: (skillId: string, version: SkillVersion) =>
        db
          .exec(
            // use_count_at_refinement: the version's own value when it carries
            // one, else the skill's current use_count (refine calls this before
            // it updates the skill row, so that is the count at refinement).
            `INSERT OR REPLACE INTO skill_versions (id, skill_id, version, instructions, config, refined_at, success_rate_at_refinement, status, use_count_at_refinement)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, (SELECT use_count FROM skills WHERE id = ?)))`,
            [
              `${skillId}-v${version.version}`,
              skillId,
              version.version,
              version.instructions,
              JSON.stringify(version.config),
              version.refinedAt.toISOString(),
              version.successRateAtRefinement,
              version.status,
              useCountAtRefinementOf(version),
              skillId,
            ],
          )
          .pipe(Effect.map(() => undefined)),
    };
  }),
);
