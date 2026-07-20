/**
 * Local agent-tool + dynamic spawn-agent registration helpers.
 *
 * Two cohesive registrations that both produce sub-agents from the
 * parent's runtime context:
 *
 *  - createLocalAgentToolRegistration: a fixed-config sub-agent
 *    declared via `.withAgentTool(name, agent)`. Wraps
 *    `toolsMod.createSubAgentExecutor` with parent persona composition,
 *    progress logging, and a handler that returns the sub-agent's
 *    final output text.
 *
 *  - createDynamicSpawnRegistrations: the built-in `spawn-agent` and
 *    `spawn-agents` tool defs registered when
 *    `.withDynamicSubAgents()` is enabled. Wraps the extracted
 *    spawn handlers (T5) over a buildSingleSubAgentTask closure that
 *    captures parent refs.
 *
 * Lifted from builder.ts pre-W25 (6,232-LOC checkpoint).
 */

import { Effect, Exit, FiberRef, Schema } from "effect";
import type {
  AgentDefinition,
  Task,
  RunContext,
} from "@reactive-agents/core";
import {
  generateTaskId,
  AgentId,
  EventBus,
  CurrentRunContext,
  CurrentRunContextRef,
  rootContext,
  childContext,
} from "@reactive-agents/core";
import type {
  ParentContext,
  SubAgentResult,
  ToolDefinition,
} from "@reactive-agents/tools";
import { createLightRuntime } from "../../runtime.js";
import { ExecutionEngine } from "../../execution-engine.js";
import { buildSubAgentSystemPrompt } from "../helpers.js";
import type { AgentToolOptions, ProviderName } from "../types.js";
import {
  makeSpawnHandlers,
  type SpawnHandlers,
} from "./spawn-handlers.js";
import type { SubAgentTaskArgs } from "./sub-agent-executor.js";

/** Registration entry produced by both helpers — `(toolDef, handler)` pair. */
export interface LocalAgentToolRegistration {
  readonly def: ToolDefinition;
  readonly handler: (
    args: Record<string, unknown>,
  ) => Effect.Effect<unknown, Error>;
}

// ─── Block 1: Local agent-tool ──────────────────────────────────────────────

/**
 * Subset of `@reactive-agents/tools` consumed by the local agent-tool
 * branch. Passed in as a dep so the call site reuses its already-loaded
 * dynamic import.
 */
export interface LocalAgentToolDeps {
  readonly toolsMod: {
    readonly createAgentTool: (
      name: string,
      agent: AgentDefinition,
    ) => ToolDefinition;
    readonly composeSubAgentDirectivePrompt: typeof import(
      "@reactive-agents/tools"
    ).composeSubAgentDirectivePrompt;
    readonly finalizeSubAgentResult: typeof import(
      "@reactive-agents/tools"
    ).finalizeSubAgentResult;
  };
  /** Parent agent id — propagated as `parentAgentId` in the sub-task metadata. */
  readonly agentId: string;
  /** Lazy reader for the parent's execution context (forwarded to the sub-agent). */
  readonly getParentContext: () => ParentContext | undefined;
}

/**
 * Build a `(toolDef, handler)` registration for a local sub-agent
 * declared via `.withAgentTool(name, agent)`. The handler executes the
 * sub-agent using `createLightRuntime` and returns its final output as
 * a `SubAgentResult`-shaped object.
 */
export const createLocalAgentToolRegistration = (
  agentTool: AgentToolOptions,
  deps: LocalAgentToolDeps,
): LocalAgentToolRegistration => {
  const { toolsMod, agentId, getParentContext } = deps;
  const {
    createAgentTool,
    composeSubAgentDirectivePrompt,
    finalizeSubAgentResult,
  } = toolsMod;
  const subName = agentTool.agent!.name;

  // Local agent tool — real sub-agent delegation
  const agentConfig: AgentDefinition = {
    name: subName,
    description: agentTool.agent!.description ?? `Agent: ${subName}`,
    capabilities: [],
  };
  const toolDef = createAgentTool(agentTool.name, agentConfig);

  // B8-T4: the fixed `.withAgentTool` sub-agent runs forked into the PARENT's
  // fiber tree (Effect.forkScoped + Fiber.await), never on a detached
  // runPromise root. Parent interruption reaches it; a child failure is
  // contained via the Exit and never cascades.
  const handler = (args: Record<string, unknown>) =>
    Effect.scoped(
      Effect.gen(function* () {
        const task =
          typeof args.input === "string"
            ? args.input
            : typeof args.message === "string"
              ? args.message
              : JSON.stringify(args);

        // Resolve the spawning agent's RunContext (ambient → run-scoped fallback).
        const explicit = yield* FiberRef.get(CurrentRunContextRef);
        const spawningCtx =
          explicit ??
          (yield* Effect.gen(function* () {
            const legacy = yield* FiberRef.get(CurrentRunContext);
            const taskId =
              legacy &&
              typeof legacy.taskId === "string" &&
              legacy.taskId.length > 0
                ? legacy.taskId
                : `run-${crypto.randomUUID().slice(0, 8)}`;
            return rootContext(taskId, agentId);
          }));
        const childCtx = childContext(spawningCtx, subName);
        const childAgentId = `sub-${subName}-${Date.now()}`;

        const composedSystemPrompt = buildSubAgentSystemPrompt(
          agentTool.agent!.persona,
          composeSubAgentDirectivePrompt(
            agentTool.agent!.systemPrompt,
            getParentContext(),
          ),
          subName,
        );

        const staticAllowed = agentTool.agent!.tools;
        const staticRequired =
          staticAllowed && staticAllowed.length > 0
            ? { tools: [...staticAllowed], adaptive: false, maxRetries: 2 }
            : undefined;

        const busOpt = yield* Effect.serviceOption(EventBus);
        const sharedEventBus = busOpt._tag === "Some" ? busOpt.value : undefined;

        const subRuntime = createLightRuntime({
          agentId: childAgentId,
          provider: (agentTool.agent!.provider ?? "test") as ProviderName,
          model: agentTool.agent!.model,
          maxIterations: agentTool.agent!.maxIterations,
          systemPrompt: composedSystemPrompt,
          enableReasoning: true,
          enableTools: true,
          allowedTools: staticAllowed,
          requiredTools: staticRequired,
          sharedEventBus,
        });

        const taskObj: Task = {
          id: generateTaskId(),
          agentId: Schema.decodeSync(AgentId)(childAgentId),
          type: "query" as const,
          input: { question: task },
          priority: "medium" as const,
          status: "pending" as const,
          metadata: {
            tags: [],
            context: { parentAgentId: agentId, runContext: childCtx },
          },
          createdAt: new Date(),
        };

        const childEffect = Effect.gen(function* () {
          const subEngine = yield* ExecutionEngine;
          return yield* subEngine.execute(taskObj);
        }).pipe(
          Effect.provide(subRuntime),
          Effect.locally(CurrentRunContextRef, childCtx as RunContext | null),
        );

        const fiber = yield* Effect.forkScoped(childEffect);
        const exit = yield* fiber.await;

        if (Exit.isSuccess(exit)) {
          const result = exit.value;
          return finalizeSubAgentResult(
            { name: subName },
            {
              output: String(result.output ?? ""),
              success: result.success,
              tokensUsed: result.metadata.tokensUsed,
            },
          );
        }
        const summary = Exit.isInterrupted(exit)
          ? "Sub-agent was interrupted before completion"
          : `Sub-agent failed: ${String(exit.cause)}`;
        return {
          subAgentName: subName,
          success: false,
          summary,
          tokensUsed: 0,
        } satisfies SubAgentResult;
      }),
    );
  return { def: toolDef, handler };
};

// ─── Block 2: Dynamic spawn-agent registrations ─────────────────────────────

/**
 * Subset of `@reactive-agents/tools` consumed by the dynamic spawn-agent
 * registration. Only the two tool-def factories are required — the
 * handler implementations live in `./spawn-handlers.ts` (T5) and the
 * sub-agent execution itself in `./sub-agent-executor.ts` (T4).
 */
export interface DynamicSpawnDeps {
  readonly toolsMod: {
    readonly createSpawnAgentTool: () => ToolDefinition;
    readonly createSpawnAgentsTool: () => ToolDefinition;
  };
  /**
   * Pre-bound sub-agent task executor — the call site wraps
   * `buildSubAgentTask` (T4) with parent closure refs and passes the
   * resulting closure here. Keeping that wiring at the call site avoids
   * pulling parent refs through this module.
   */
  readonly buildSubAgentTask: (
    args: SubAgentTaskArgs,
  ) => Effect.Effect<SubAgentResult, never, never>;
}

/**
 * Build the `[spawn-agent, spawn-agents]` registration pair for the
 * built-in dynamic sub-agent tools (registered when
 * `.withDynamicSubAgents()` is on).
 */
export const createDynamicSpawnRegistrations = (
  deps: DynamicSpawnDeps,
): readonly LocalAgentToolRegistration[] => {
  const { toolsMod, buildSubAgentTask } = deps;
  const spawnToolDef = toolsMod.createSpawnAgentTool();

  const handlers: SpawnHandlers = makeSpawnHandlers({ buildSubAgentTask });

  const spawnAgentsToolDef = toolsMod.createSpawnAgentsTool();
  return [
    { def: spawnToolDef, handler: handlers.spawnHandler },
    { def: spawnAgentsToolDef, handler: handlers.spawnAgentsHandler },
  ];
};
