/**
 * AgentStarted publication + ambient RunContext seeding.
 *
 * Owns: the display-name resolution (explicit `config.agentDisplayName`
 * wins, else the agentId-derived desk name), the B8-T3b RunContext lift off
 * task metadata, the `CurrentRunContextRef` FiberRef seed for this run's fiber
 * tree, and the GH #236 `AgentStarted` emission with the real (capped) task
 * text.
 *
 * FiberRef.set runs in the SAME fiber as the original inline block: this
 * function is called via `yield*` at the original site inside executeCore, so
 * the ambient FiberRef write still covers this run and every tool handler it
 * forks.
 *
 * Moved verbatim from execution-engine.ts (GH #221 W26 decomposition, former
 * `if (eb)` AgentStarted block lines 674-737 + the STARTED_TASK_CAP const
 * with its JSDoc, former lines 141-147).
 */
import { Effect, FiberRef } from "effect";
import type { RunContext, Task } from "@reactive-agents/core";
import { CurrentRunContextRef, rootContext, emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { ExecutionContext, ReactiveAgentsConfig } from "../types.js";
import { extractTaskText } from "./util.js";
import type { EbLike } from "./runtime-context.js";

/**
 * GH #236: payload cap for the `task` text stamped into `AgentStarted`.
 * Same 64KB budget convention as the `AgentCompleted.output` cap applied by
 * `engine/finalize/run-finalize.ts` (`RUN_OUTPUT_CAP`); clipped emissions
 * set `taskTruncated: true`.
 */
const STARTED_TASK_CAP = 64 * 1024;

export interface AgentStartedDeps {
  readonly eb: EbLike;
  readonly ctx: ExecutionContext;
  readonly task: Task;
  readonly config: ReactiveAgentsConfig;
  readonly executionStartMs: number;
}

export const publishAgentStarted = (
  deps: AgentStartedDeps,
): Effect.Effect<void, never> => {
  const { eb, ctx, task, config, executionStartMs } = deps;
  return Effect.gen(function* () {
    // An EXPLICIT display name always wins (sub-agents set it to
    // their given name — `agentId` there is the uniquified
    // `sub-<name>-<epoch>`, which is not fit to render). Only when
    // absent do we fall back to the agentId-derived desk name.
    const explicitDisplayName =
      typeof config.agentDisplayName === "string" &&
      config.agentDisplayName.trim().length > 0
        ? config.agentDisplayName.trim()
        : undefined;
    const deskName =
      typeof config.agentId === "string" && config.agentId.trim().length > 0
        ? config.agentId.trim()
        : "";
    const agentDisplayName =
      explicitDisplayName ??
      (deskName.length > 0 && !/^cortex-desk-\d+$/.test(deskName)
        ? deskName
        : undefined);
    // B8-T3b: lift the child's RunContext (rootRunId/parentRunId/
    // depth) off the task metadata so the trace normalizer can
    // correlate this run to its node in the delegation tree.
    const rc = task.metadata?.context?.["runContext"] as
      | { rootRunId?: string; parentRunId?: string; depth?: number }
      | undefined;
    // Seed the ambient RunContext for THIS run's fiber (and every
    // tool handler it forks) so a `spawn-agent` call can derive the
    // child's context from a reliable root. Authority is the
    // explicit metadata value (a delegated child); a top-level run
    // roots at its own taskId/agentId (depth 0).
    const ambientRunContext: RunContext =
      (task.metadata?.context?.["runContext"] as
        | RunContext
        | undefined) ??
      rootContext(ctx.taskId, config.agentId);
    yield* FiberRef.set(CurrentRunContextRef, ambientRunContext);
    // GH #236: stamp the real task text into AgentStarted so
    // normalize's run-started (and RecordedRun.task downstream)
    // carries the prompt instead of "". Payload budget: capped
    // at 64KB here at the publisher, the same convention as
    // AgentCompleted.output (engine/finalize/run-finalize.ts
    // RUN_OUTPUT_CAP); taskTruncated marks a clip.
    const startedTaskText = extractTaskText(task.input);
    const startedTaskClipped = startedTaskText.length > STARTED_TASK_CAP;
    yield* eb.publish({
      _tag: "AgentStarted",
      taskId: ctx.taskId,
      agentId: config.agentId,
      provider: String(ctx.provider ?? "unknown"),
      model: String(ctx.selectedModel ?? "unknown"),
      timestamp: executionStartMs,
      task: startedTaskClipped
        ? startedTaskText.slice(0, STARTED_TASK_CAP)
        : startedTaskText,
      ...(startedTaskClipped ? { taskTruncated: true } : {}),
      ...(task.metadata?.context?.["parentAgentId"]
        ? { parentAgentId: String(task.metadata.context["parentAgentId"]) }
        : {}),
      ...(agentDisplayName ? { agentDisplayName } : {}),
      ...(rc?.rootRunId ? { rootRunId: rc.rootRunId } : {}),
      ...(rc?.parentRunId ? { parentRunId: rc.parentRunId } : {}),
      ...(typeof rc?.depth === "number" ? { depth: rc.depth } : {}),
    }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:792", tag: errorTag(err) })));
  });
};
