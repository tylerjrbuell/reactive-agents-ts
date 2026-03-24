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

    /** Update partial fields on a skill. */
    readonly update: (
      id: string,
      partial: Partial<
        Pick<
          SkillRecord,
          | "instructions"
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

    const rowToVersion = (r: Record<string, unknown>): SkillVersion => ({
      version: r.version as number,
      instructions: r.instructions as string,
      config: JSON.parse(r.config as string) as SkillFragmentConfig,
      refinedAt: new Date(r.refined_at as string),
      successRateAtRefinement: r.success_rate_at_refinement as number,
      status: r.status as "candidate" | "active",
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
      config: JSON.parse(r.config as string) as SkillFragmentConfig,
      evolutionMode: r.evolution_mode as SkillEvolutionMode,
      confidence: r.confidence as SkillConfidence,
      successRate: r.success_rate as number,
      useCount: r.use_count as number,
      refinementCount: r.refinement_count as number,
      taskCategories: JSON.parse(r.task_categories as string) as string[],
      modelAffinities: JSON.parse(r.model_affinities as string) as string[],
      base: (r.base as string | null) ?? null,
      avgPostActivationEntropyDelta: r.avg_post_activation_entropy_delta as number,
      avgConvergenceIteration: r.avg_convergence_iteration as number,
      convergenceSpeedTrend: JSON.parse(r.convergence_speed_trend as string) as number[],
      conflictsWith: JSON.parse(r.conflicts_with as string) as string[],
      lastActivatedAt: r.last_activated_at ? new Date(r.last_activated_at as string) : null,
      lastRefinedAt: r.last_refined_at ? new Date(r.last_refined_at as string) : null,
      createdAt: new Date(r.created_at as string),
      updatedAt: new Date(r.updated_at as string),
      contentVariants: JSON.parse(r.content_variants as string) as {
        full: string;
        summary: string | null;
        condensed: string | null;
      },
    });

    return {
      store: (record: SkillRecord) =>
        Effect.gen(function* () {
          yield* db.exec(
            `INSERT OR REPLACE INTO skills (
              id, name, description, agent_id, source, instructions, version, config,
              evolution_mode, confidence, success_rate, use_count, refinement_count,
              task_categories, model_affinities, base, avg_post_activation_entropy_delta,
              avg_convergence_iteration, convergence_speed_trend, conflicts_with,
              content_variants, last_activated_at, last_refined_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            const skillCategories: string[] = JSON.parse(r.task_categories as string);
            return taskCategories.some((cat) => skillCategories.includes(cat));
          });
          // Sort by score (boost model affinity if modelId provided)
          matched.sort((a, b) => {
            let scoreA = (a.success_rate as number) * (a.use_count as number);
            let scoreB = (b.success_rate as number) * (b.use_count as number);
            if (modelId) {
              const affinitiesA: string[] = JSON.parse(a.model_affinities as string);
              const affinitiesB: string[] = JSON.parse(b.model_affinities as string);
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
        | "instructions" | "version" | "config" | "confidence" | "successRate" | "useCount"
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
            `INSERT OR REPLACE INTO skill_versions (id, skill_id, version, instructions, config, refined_at, success_rate_at_refinement, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              `${skillId}-v${version.version}`,
              skillId,
              version.version,
              version.instructions,
              JSON.stringify(version.config),
              version.refinedAt.toISOString(),
              version.successRateAtRefinement,
              version.status,
            ],
          )
          .pipe(Effect.map(() => undefined)),
    };
  }),
);
