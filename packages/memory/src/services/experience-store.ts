import { Effect, Context, Layer } from "effect";
import { DatabaseError } from "../errors.js";
import { MemoryDatabase } from "../database.js";

// ─── Types ───

export interface ExperienceRecord {
  agentId: string;
  taskDescription: string;
  taskType: string;
  toolsUsed: readonly string[];
  success: boolean;
  totalSteps: number;
  totalTokens: number;
  errors: readonly { tool: string; error: string; recovery?: string }[];
  modelTier: string;
}

export interface ToolPattern {
  taskType: string;
  pattern: readonly string[];
  avgSteps: number;
  avgTokens: number;
  successRate: number;
  occurrences: number;
  confidence: number;
}

export interface ErrorRecovery {
  tool: string;
  errorPattern: string;
  recovery: string;
  occurrences: number;
}

export interface ExperienceQueryResult {
  toolPatterns: readonly ToolPattern[];
  errorRecoveries: readonly ErrorRecovery[];
  tips: readonly string[];
}

// ─── Service Tag ───

export class ExperienceStore extends Context.Tag("ExperienceStore")<
  ExperienceStore,
  {
    /** Record a completed agent run's experience. */
    readonly record: (
      entry: ExperienceRecord,
    ) => Effect.Effect<void, DatabaseError>;

    /** Query relevant experience for a given task. */
    readonly query: (
      taskDescription: string,
      taskType: string,
      modelTier: string,
    ) => Effect.Effect<ExperienceQueryResult, DatabaseError>;
  }
>() {}

// ─── Table DDL ───

const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS experience_tool_patterns (
    task_type     TEXT NOT NULL,
    pattern_key   TEXT NOT NULL,
    tool_list     TEXT NOT NULL,
    total_count   INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    total_steps   INTEGER NOT NULL DEFAULT 0,
    total_tokens  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (task_type, pattern_key)
  );

  CREATE TABLE IF NOT EXISTS experience_error_recoveries (
    tool          TEXT NOT NULL,
    error_pattern TEXT NOT NULL,
    recovery      TEXT NOT NULL,
    occurrences   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tool, error_pattern)
  );
`;

// ─── Live Implementation ───

export const ExperienceStoreLive = Layer.effect(
  ExperienceStore,
  Effect.gen(function* () {
    const db = yield* MemoryDatabase;

    // Create the experience tables (CREATE TABLE IF NOT EXISTS — safe to run every time)
    yield* db.exec(
      `CREATE TABLE IF NOT EXISTS experience_tool_patterns (
        task_type     TEXT NOT NULL,
        pattern_key   TEXT NOT NULL,
        tool_list     TEXT NOT NULL,
        total_count   INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        total_steps   INTEGER NOT NULL DEFAULT 0,
        total_tokens  INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (task_type, pattern_key)
      )`,
      [],
    );

    yield* db.exec(
      `CREATE TABLE IF NOT EXISTS experience_error_recoveries (
        tool          TEXT NOT NULL,
        error_pattern TEXT NOT NULL,
        recovery      TEXT NOT NULL,
        occurrences   INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (tool, error_pattern)
      )`,
      [],
    );

    const record = (entry: ExperienceRecord): Effect.Effect<void, DatabaseError> =>
      Effect.gen(function* () {
        const patternKey = `${entry.taskType}:${[...entry.toolsUsed].join(",")}`;
        const toolListJson = JSON.stringify([...entry.toolsUsed]);

        // Upsert tool pattern row
        const existingPattern = yield* db.query<{
          total_count: number;
          success_count: number;
          total_steps: number;
          total_tokens: number;
        }>(
          `SELECT total_count, success_count, total_steps, total_tokens
           FROM experience_tool_patterns
           WHERE task_type = ? AND pattern_key = ?`,
          [entry.taskType, patternKey],
        );

        if (existingPattern.length > 0) {
          const row = existingPattern[0]!;
          yield* db.exec(
            `UPDATE experience_tool_patterns
             SET total_count   = ?,
                 success_count = ?,
                 total_steps   = ?,
                 total_tokens  = ?
             WHERE task_type = ? AND pattern_key = ?`,
            [
              row.total_count + 1,
              row.success_count + (entry.success ? 1 : 0),
              row.total_steps + entry.totalSteps,
              row.total_tokens + entry.totalTokens,
              entry.taskType,
              patternKey,
            ],
          );
        } else {
          yield* db.exec(
            `INSERT INTO experience_tool_patterns
               (task_type, pattern_key, tool_list, total_count, success_count, total_steps, total_tokens)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              entry.taskType,
              patternKey,
              toolListJson,
              1,
              entry.success ? 1 : 0,
              entry.totalSteps,
              entry.totalTokens,
            ],
          );
        }

        // Upsert error recoveries for errors that have a recovery hint
        for (const err of entry.errors) {
          if (err.recovery === undefined) continue;

          const existingRecovery = yield* db.query<{ occurrences: number }>(
            `SELECT occurrences FROM experience_error_recoveries
             WHERE tool = ? AND error_pattern = ?`,
            [err.tool, err.error],
          );

          if (existingRecovery.length > 0) {
            yield* db.exec(
              `UPDATE experience_error_recoveries
               SET occurrences = ?, recovery = ?
               WHERE tool = ? AND error_pattern = ?`,
              [existingRecovery[0]!.occurrences + 1, err.recovery, err.tool, err.error],
            );
          } else {
            yield* db.exec(
              `INSERT INTO experience_error_recoveries (tool, error_pattern, recovery, occurrences)
               VALUES (?, ?, ?, 1)`,
              [err.tool, err.error, err.recovery],
            );
          }
        }
      });

    const query = (
      _taskDescription: string,
      taskType: string,
      _modelTier: string,
    ): Effect.Effect<ExperienceQueryResult, DatabaseError> =>
      Effect.gen(function* () {
        // Fetch all patterns for this taskType
        const patternRows = yield* db.query<{
          task_type: string;
          pattern_key: string;
          tool_list: string;
          total_count: number;
          success_count: number;
          total_steps: number;
          total_tokens: number;
        }>(
          `SELECT * FROM experience_tool_patterns WHERE task_type = ?`,
          [taskType],
        );

        // Filter: confidence >= 0.5 AND occurrences >= 2
        const toolPatterns: ToolPattern[] = patternRows
          .map((row) => {
            const confidence = row.total_count > 0 ? row.success_count / row.total_count : 0;
            const pattern: readonly string[] = JSON.parse(row.tool_list) as string[];
            return {
              taskType: row.task_type,
              pattern,
              avgSteps: row.total_count > 0 ? row.total_steps / row.total_count : 0,
              avgTokens: row.total_count > 0 ? row.total_tokens / row.total_count : 0,
              successRate: confidence,
              occurrences: row.total_count,
              confidence,
            };
          })
          .filter((p) => p.confidence >= 0.5 && p.occurrences >= 2);

        // Fetch relevant error recoveries (all, occurrences >= 1)
        const recoveryRows = yield* db.query<{
          tool: string;
          error_pattern: string;
          recovery: string;
          occurrences: number;
        }>(
          `SELECT * FROM experience_error_recoveries WHERE occurrences >= 1`,
          [],
        );

        const errorRecoveries: ErrorRecovery[] = recoveryRows.map((row) => ({
          tool: row.tool,
          errorPattern: row.error_pattern,
          recovery: row.recovery,
          occurrences: row.occurrences,
        }));

        // Generate tips from patterns and errors
        const tips: string[] = [];

        for (const pattern of toolPatterns) {
          tips.push(
            `For ${pattern.taskType} tasks, use [${pattern.pattern.join(", ")}] — ` +
              `${Math.round(pattern.successRate * 100)}% success rate over ${pattern.occurrences} runs ` +
              `(avg ${Math.round(pattern.avgSteps)} steps, ${Math.round(pattern.avgTokens)} tokens)`,
          );
        }

        for (const recovery of errorRecoveries) {
          tips.push(
            `When ${recovery.tool} fails with "${recovery.errorPattern}": ${recovery.recovery}`,
          );
        }

        return { toolPatterns, errorRecoveries, tips };
      });

    return { record, query };
  }),
);
