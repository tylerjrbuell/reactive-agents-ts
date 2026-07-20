/**
 * Spawn-agent tool handlers — wrap the sub-agent executor (from
 * sub-agent-executor.ts) for the `spawn-agent` (single) and
 * `spawn-agents` (batch) tool calls.
 *
 * Lifted from builder.ts pre-W25 (6,232-LOC checkpoint).
 */

import { Effect, Option } from "effect";
import { EventBus } from "@reactive-agents/core";
import type { SubAgentResult } from "@reactive-agents/tools";
import type {
  SubAgentTaskArgs,
  SubAgentRuntimeShared,
} from "./sub-agent-executor.js";

// Derive a descriptive kebab-case name from a task description.
// Extracts the primary action verb + object from the task text.
const deriveSubAgentName = (task: string): string => {
  const lower = task
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .trim();
  const words = lower.split(/\s+/).filter((w) => w.length > 2);
  // Skip filler words to find meaningful action + object
  const FILLER = new Set([
    "the",
    "and",
    "for",
    "from",
    "with",
    "that",
    "this",
    "via",
    "into",
    "then",
    "also",
    "all",
    "its",
    "are",
    "was",
    "has",
    "have",
    "been",
    "will",
    "can",
    "should",
  ]);
  const meaningful = words.filter((w) => !FILLER.has(w)).slice(0, 3);
  if (meaningful.length === 0) return "sub-agent";
  return meaningful.join("-").slice(0, 30);
};

export interface SpawnHandlerDeps {
  /**
   * Function the spawn handler delegates to. In builder.ts this is
   * the local `buildSingleSubAgentTask` wrapper that captures parent
   * refs — by passing it as a dep we avoid pulling those refs into
   * this module.
   */
  readonly buildSubAgentTask: (
    args: SubAgentTaskArgs,
    runtimeShared?: SubAgentRuntimeShared,
  ) => Promise<SubAgentResult>;
}

export interface SpawnHandlers {
  readonly spawnHandler: (
    args: Record<string, unknown>,
  ) => Effect.Effect<unknown, Error>;
  readonly spawnAgentsHandler: (
    args: Record<string, unknown>,
  ) => Effect.Effect<unknown, Error>;
}

export const makeSpawnHandlers = (deps: SpawnHandlerDeps): SpawnHandlers => {
  const { buildSubAgentTask } = deps;

  const spawnHandler = (args: Record<string, unknown>) =>
    // Resolve the parent's EventBus from ambient context (the tool handler runs
    // inside the parent's runtime) so the child can JOIN it — audit G1. Reading
    // via serviceOption keeps the handler's requirement channel `never` and
    // degrades gracefully (undefined ⇒ today's isolated-bus behavior).
    Effect.gen(function* () {
      const busOpt = yield* Effect.serviceOption(EventBus);
      const runtimeShared: SubAgentRuntimeShared = {
        sharedEventBus: Option.getOrUndefined(busOpt),
      };
      return yield* Effect.tryPromise({
        try: async () => {
          const task =
            typeof args.task === "string"
              ? args.task
              : JSON.stringify(args.task ?? "");
          const subName =
            typeof args.name === "string" && args.name.trim().length > 0
              ? args.name.trim()
              : deriveSubAgentName(task);
          return buildSubAgentTask(
            {
              task,
              name: subName,
              role: typeof args.role === "string" ? args.role : undefined,
              instructions:
                typeof args.instructions === "string"
                  ? args.instructions
                  : undefined,
              tone: typeof args.tone === "string" ? args.tone : undefined,
              tools: Array.isArray(args.tools)
                ? (args.tools as unknown[]).filter(
                    (x): x is string => typeof x === "string",
                  )
                : undefined,
            },
            runtimeShared,
          );
        },
        catch: (e) => new Error(String(e)),
      });
    });

  const spawnAgentsHandler = (args: Record<string, unknown>) =>
    Effect.gen(function* () {
      const busOpt = yield* Effect.serviceOption(EventBus);
      const runtimeShared: SubAgentRuntimeShared = {
        sharedEventBus: Option.getOrUndefined(busOpt),
      };
      return yield* Effect.tryPromise({
      try: async () => {
        const rawTasks = Array.isArray(args.tasks)
          ? (args.tasks as unknown[])
          : [];
        const failFast = args.failFast === true;
        const maxConcurrency =
          typeof args.maxConcurrency === "number"
            ? Math.max(1, args.maxConcurrency)
            : rawTasks.length;

        const taskArgs: SubAgentTaskArgs[] = rawTasks.map((item) => {
          const obj = item as Record<string, unknown>;
          const taskStr = typeof obj.task === "string" ? obj.task : "";
          const rawName =
            typeof obj.name === "string" ? obj.name.trim() : "";
          return {
            task: taskStr,
            name:
              rawName.length > 0 ? rawName : deriveSubAgentName(taskStr),
            role: typeof obj.role === "string" ? obj.role : undefined,
            instructions:
              typeof obj.instructions === "string"
                ? obj.instructions
                : undefined,
            tone: typeof obj.tone === "string" ? obj.tone : undefined,
            tools: Array.isArray(obj.tools)
              ? (obj.tools as unknown[]).filter(
                  (x): x is string => typeof x === "string",
                )
              : undefined,
          };
        });

        if (failFast) {
          const results = await Effect.runPromise(
            Effect.all(
              taskArgs.map((ta) =>
                Effect.tryPromise({
                  try: () => buildSubAgentTask(ta, runtimeShared),
                  catch: (e) => new Error(String(e)),
                }),
              ),
              {
                concurrency: Math.max(1, maxConcurrency),
              },
            ),
          );
          return {
            results,
            summary: {
              total: results.length,
              succeeded: results.filter((r) => r.success).length,
              failed: results.filter((r) => !r.success).length,
            },
          };
        }

        const eithers = await Effect.runPromise(
          Effect.all(
            taskArgs.map((ta) =>
              Effect.tryPromise({
                try: () => buildSubAgentTask(ta),
                catch: (e) => new Error(String(e)),
              }).pipe(Effect.either),
            ),
            {
              concurrency: Math.max(1, maxConcurrency),
            },
          ),
        );

        const results: SubAgentResult[] = eithers.map((either, i) => {
          if (either._tag === "Right") return either.right;
          const err = either.left;
          return {
            subAgentName: taskArgs[i]!.name,
            summary: err instanceof Error ? err.message : String(err),
            success: false,
            tokensUsed: 0,
            stepsCompleted: 0,
          };
        });

        return {
          results,
          summary: {
            total: results.length,
            succeeded: results.filter((r) => r.success).length,
            failed: results.filter((r) => !r.success).length,
          },
        };
      },
      catch: (e) => new Error(String(e)),
      });
    });

  return { spawnHandler, spawnAgentsHandler };
};
