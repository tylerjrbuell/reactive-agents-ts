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
   *
   * B8-T4: returns an Effect (forked into the parent's fiber tree by the
   * executor) rather than a detached Promise, so parent interruption reaches
   * in-flight children.
   */
  readonly buildSubAgentTask: (
    args: SubAgentTaskArgs,
    runtimeShared?: SubAgentRuntimeShared,
  ) => Effect.Effect<SubAgentResult, never, never>;
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
      const task =
        typeof args.task === "string"
          ? args.task
          : JSON.stringify(args.task ?? "");
      const subName =
        typeof args.name === "string" && args.name.trim().length > 0
          ? args.name.trim()
          : deriveSubAgentName(task);
      // Forked into THIS fiber's tree by the executor — parent interruption
      // reaches the child. No detached runPromise.
      return yield* buildSubAgentTask(
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
    });

  const spawnAgentsHandler = (args: Record<string, unknown>) =>
    Effect.gen(function* () {
      const busOpt = yield* Effect.serviceOption(EventBus);
      const runtimeShared: SubAgentRuntimeShared = {
        sharedEventBus: Option.getOrUndefined(busOpt),
      };
      const rawTasks = Array.isArray(args.tasks)
        ? (args.tasks as unknown[])
        : [];
      const failFast = args.failFast === true;
      const maxConcurrency =
        typeof args.maxConcurrency === "number"
          ? Math.max(1, args.maxConcurrency)
          : Math.max(1, rawTasks.length);

      const taskArgs: SubAgentTaskArgs[] = rawTasks.map((item) => {
        const obj = item as Record<string, unknown>;
        const taskStr = typeof obj.task === "string" ? obj.task : "";
        const rawName = typeof obj.name === "string" ? obj.name.trim() : "";
        return {
          task: taskStr,
          name: rawName.length > 0 ? rawName : deriveSubAgentName(taskStr),
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

      // Each sub-agent forks into this fiber's tree (via the executor) and is
      // run concurrently by Effect.all. buildSubAgentTask never fails, so a
      // child failure is already a `SubAgentResult{success:false}` — no cascade.
      // failFast aborts remaining children on the first FAILED result.
      const results: SubAgentResult[] = yield* Effect.all(
        taskArgs.map((ta) =>
          buildSubAgentTask(ta, runtimeShared).pipe(
            Effect.flatMap((r) =>
              failFast && !r.success
                ? Effect.fail(r)
                : Effect.succeed(r),
            ),
          ),
        ),
        { concurrency: Math.max(1, maxConcurrency) },
      ).pipe(
        // In failFast mode the first failed child short-circuits Effect.all;
        // recover the partial by re-running non-failFast is unnecessary — the
        // failed result itself is the error payload.
        Effect.catchAll((firstFailure) => Effect.succeed([firstFailure])),
      );

      return {
        results,
        summary: {
          total: results.length,
          succeeded: results.filter((r) => r.success).length,
          failed: results.filter((r) => !r.success).length,
        },
      };
    });

  return { spawnHandler, spawnAgentsHandler };
};
