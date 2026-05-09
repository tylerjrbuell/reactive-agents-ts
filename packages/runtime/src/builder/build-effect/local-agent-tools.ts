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

import { Effect, Layer, Schema } from "effect";
import type { AgentDefinition, Task, TaskResult } from "@reactive-agents/core";
import { generateTaskId, AgentId } from "@reactive-agents/core";
import type {
  ParentContext,
  SubAgentResult,
  ToolDefinition,
} from "@reactive-agents/tools";
import { createLightRuntime } from "../../runtime.js";
import { ExecutionEngine } from "../../execution-engine.js";
import { composePersonaToSystemPrompt } from "../helpers.js";
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
    readonly createSubAgentExecutor: typeof import(
      "@reactive-agents/tools"
    ).createSubAgentExecutor;
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
  const { createAgentTool, createSubAgentExecutor } = toolsMod;

  // Local agent tool — real sub-agent delegation
  const agentConfig: AgentDefinition = {
    name: agentTool.agent!.name,
    description:
      agentTool.agent!.description ?? `Agent: ${agentTool.agent!.name}`,
    capabilities: [],
  };
  const toolDef = createAgentTool(agentTool.name, agentConfig);

  const subAgentExec = createSubAgentExecutor(
    {
      name: agentTool.agent!.name,
      description: agentTool.agent!.description,
      provider: agentTool.agent!.provider,
      model: agentTool.agent!.model,
      tools: agentTool.agent!.tools,
      maxIterations: agentTool.agent!.maxIterations,
      systemPrompt: agentTool.agent!.systemPrompt,
      persona: agentTool.agent!.persona,
    },
    async (opts) => {
      const _subLabel = agentTool.agent!.name;
      const _taskPreview =
        opts.task.length > 80 ? opts.task.slice(0, 80) + "…" : opts.task;
      process.stdout.write(
        `\n  \x1b[36m┌─ [sub-agent: ${_subLabel}]\x1b[0m → "${_taskPreview}"\n`,
      );
      const _subStart = Date.now();

      // Compose persona with system prompt
      let composedSystemPrompt = opts.systemPrompt;
      if (opts.persona) {
        const personaPrompt = composePersonaToSystemPrompt(
          opts.persona,
          opts.name,
        );
        composedSystemPrompt = composedSystemPrompt
          ? `${personaPrompt}\n\n${composedSystemPrompt}`
          : personaPrompt;
      }

      // When allowedTools is specified, those tools become required
      const staticAllowed = opts.allowedTools;
      const staticRequired =
        staticAllowed && staticAllowed.length > 0
          ? {
              tools: [...staticAllowed],
              adaptive: false,
              maxRetries: 2,
            }
          : undefined;
      const subRuntime = createLightRuntime({
        agentId: opts.agentId,
        provider: (opts.provider ?? "test") as ProviderName,
        model: opts.model,
        maxIterations: opts.maxIterations,
        systemPrompt: composedSystemPrompt,
        enableReasoning: opts.enableReasoning,
        enableTools: opts.enableTools,
        allowedTools: staticAllowed,
        requiredTools: staticRequired,
      });
      const subEngine = await Effect.runPromise(
        ExecutionEngine.pipe(Effect.provide(subRuntime)),
      );
      const taskObj: Task = {
        id: generateTaskId(),
        agentId: Schema.decodeSync(AgentId)(opts.agentId),
        type: "query" as const,
        input: { question: opts.task },
        priority: "medium" as const,
        status: "pending" as const,
        metadata: {
          tags: [],
          context: { parentAgentId: agentId },
        },
        createdAt: new Date(),
      };
      const result: TaskResult = await Effect.runPromise(
        subEngine
          .execute(taskObj)
          .pipe(
            Effect.provide(subRuntime as unknown as Layer.Layer<never>),
          ),
      );
      const _subElapsed = ((Date.now() - _subStart) / 1000).toFixed(1);
      const _subIcon = result.success ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
      process.stdout.write(
        `  \x1b[36m└─ [sub-agent: ${_subLabel}]\x1b[0m ${_subIcon} done | ${result.metadata.tokensUsed} tok | ${_subElapsed}s\n\n`,
      );
      return {
        output: String(result.output ?? ""),
        success: result.success,
        tokensUsed: result.metadata.tokensUsed,
      };
    },
    0,
    getParentContext,
  );

  const handler = (args: Record<string, unknown>) =>
    Effect.tryPromise({
      try: () => {
        const task =
          typeof args.input === "string"
            ? args.input
            : typeof args.message === "string"
            ? args.message
            : JSON.stringify(args);
        return subAgentExec(task);
      },
      catch: (e) => new Error(String(e)),
    });
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
  ) => Promise<SubAgentResult>;
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
