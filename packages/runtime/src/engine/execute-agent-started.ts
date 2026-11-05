/**
 * AgentStarted publication.
 *
 * Owns: the display-name resolution (explicit `config.agentDisplayName`
 * wins, else the agentId-derived desk name), the B8-T3b RunContext lift off
 * task metadata, and the GH #236 `AgentStarted` emission with the real
 * (capped) task text. The run's ambient RunContext is the run scope's
 * (opened by the run entry, or `childRunScope` for a delegated child).
 *
 * Moved verbatim from execution-engine.ts (GH #221 W26 decomposition, former
 * `if (eb)` AgentStarted block lines 674-737 + the STARTED_TASK_CAP const
 * with its JSDoc, former lines 141-147).
 */
import { Effect } from "effect";
import type { Task } from "@reactive-agents/core";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { ExecutionContext, ReactiveAgentsConfig } from "../types.js";
import { extractTaskText } from "./util.js";
import type { EbLike } from "./runtime-context.js";
import { readPosture } from "../chat/todo-seed.js";
import { buildRunConfigSnapshot, isLeanHarness, resolveRunOrigin } from "./execute-run-config.js";

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
      | { runId?: string; rootRunId?: string; parentRunId?: string; depth?: number }
      | undefined;
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
      // Plan 8: the same posture the run envelope carries (`rails.posture`),
      // read from the task carrier it is built from. Plan only; absent === execute.
      ...(readPosture(task) === "plan" ? { posture: "plan" as const } : {}),
      // Measurement-only: who started the run + the resolved harness config
      // (`{ mechanisms, builder, env }`), forwarded to `run-started`.
      origin: resolveRunOrigin(task),
      config: buildRunConfigSnapshot({
        config,
        provider: String(ctx.provider ?? "unknown"),
        model: String(ctx.selectedModel ?? "unknown"),
        lean: isLeanHarness(config),
      }),
      ...(rc?.runId ? { runId: rc.runId } : {}),
      ...(rc?.rootRunId ? { rootRunId: rc.rootRunId } : {}),
      ...(rc?.parentRunId ? { parentRunId: rc.parentRunId } : {}),
      ...(typeof rc?.depth === "number" ? { depth: rc.depth } : {}),
    }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/execute-agent-started.ts:108", tag: errorTag(err) })));
  });
};
