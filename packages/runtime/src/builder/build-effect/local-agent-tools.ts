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
import { CurrentRunBudget } from "@reactive-agents/reasoning";
import type {
  ParentContext,
  SubAgentResult,
  ToolDefinition,
} from "@reactive-agents/tools";
import { createLightRuntime } from "../../runtime.js";
import { ExecutionEngine } from "../../execution-engine.js";
import { buildSubAgentSystemPrompt, interpolateTemplate } from "../helpers.js";
import type { AgentToolOptions, ProviderName } from "../types.js";
import {
  makeSpawnHandlers,
  type SpawnHandlers,
} from "./spawn-handlers.js";
import type { SubAgentTaskArgs } from "./sub-agent-executor.js";
import { childCompletionEnvelope } from "./sub-agent-executor.js";

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
  /**
   * Writer for sub-agent scratchpad entries forwarded to the parent.
   * Called with `sub:<agentName>:<key>` keys during `finalizeSubAgentResult`.
   * Writes into the parent's scratchpad store so the parent can read
   * sub-agent scratchpad entries after the run completes.
   */
  readonly parentScratchpadWriter?: (key: string, value: string) => void;
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
  const { toolsMod, agentId, getParentContext, parentScratchpadWriter } = deps;
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
  const baseDef = createAgentTool(agentTool.name, agentConfig);

  // Merge declared custom parameters into the tool schema so the parent LLM
  // sees them as typed, dynamic arguments per invocation (GH: structured
  // input for withAgentTool). `input` remains as a catch-all free-form arg.
  const customParams = agentTool.agent?.parameters ?? [];
  const toolDef: ToolDefinition = {
    ...baseDef,
    ...(customParams.length > 0
      ? { parameters: [...baseDef.parameters, ...customParams] }
      : {}),
    ...(agentTool.agent?.requiresApproval !== undefined
      ? { requiresApproval: agentTool.agent.requiresApproval }
      : {}),
    ...(agentTool.agent?.timeoutMs !== undefined
      ? { timeoutMs: agentTool.agent.timeoutMs }
      : {}),
  };

  // B8-T4: the fixed `.withAgentTool` sub-agent runs forked into the PARENT's
  // fiber tree (Effect.forkScoped + Fiber.await), never on a detached
  // runPromise root. Parent interruption reaches it; a child failure is
  // contained via the Exit and never cascades.
  const handler = (args: Record<string, unknown>) =>
    Effect.scoped(
      Effect.gen(function* () {
        // Build the task string from the caller's args. `input`/`message` are
        // the catch-all free-form task text; any additional declared parameters
        // (e.g. `repo`, `prNumber`, `focus`) are appended as structured context
        // so the sub-agent receives them — they would otherwise be dropped
        // when `input` takes precedence. Mirrors the input normalization in
        // @reactive-agents/tools `createSubAgentExecutor`.
        const hasExplicitTask = typeof args.input === "string" || typeof args.message === "string";
        const taskText =
          typeof args.input === "string"
            ? args.input
            : typeof args.message === "string"
              ? args.message
              : JSON.stringify(args);
        const customArgs: Record<string, unknown> = { ...args };
        delete customArgs.input;
        delete customArgs.message;
        // Only append structured args when they weren't already serialized
        // into taskText (i.e. when input/message was the primary carrier).
        const extra =
          hasExplicitTask && Object.keys(customArgs).length > 0
            ? `\n\nArguments: ${JSON.stringify(customArgs)}`
            : "";
        const task = taskText + extra;

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

        // Interpolate declared parameters into the sub-agent's system prompt
        // and persona fields so a single `withAgentTool` registration can serve
        // many differently-configured invocations (e.g. review-pr for any repo,
        // any PR number, any focus area). Follows the same `{{key}}`
        // convention as the prompts template engine. Missing keys are left as-is.
        const agentCfg = agentTool.agent!;
        const interpolatedSystemPrompt = interpolateTemplate(
          agentCfg.systemPrompt,
          customArgs,
        );
        const interpolatedPersona = agentCfg.persona
          ? {
              role: interpolateTemplate(agentCfg.persona.role, customArgs),
              background: interpolateTemplate(
                agentCfg.persona.background,
                customArgs,
              ),
              instructions: interpolateTemplate(
                agentCfg.persona.instructions,
                customArgs,
              ),
              tone: agentCfg.persona.tone,
              name: agentCfg.persona.name,
            }
          : undefined;

        const composedSystemPrompt = buildSubAgentSystemPrompt(
          interpolatedPersona,
          composeSubAgentDirectivePrompt(
            interpolatedSystemPrompt,
            getParentContext(),
          ),
          subName,
        );

        // Per-call tools override (like spawn-agent's `tools` param). Falls
        // back to the static `agent.tools` allowlist when not provided.
        const perCallTools =
          Array.isArray(args.tools)
            ? (args.tools as unknown[]).filter(
                (x): x is string => typeof x === "string",
              )
            : undefined;
        const effectiveAllowed = perCallTools ?? agentCfg.tools;
        const effectiveRequired =
          effectiveAllowed && effectiveAllowed.length > 0
            ? { tools: [...effectiveAllowed], adaptive: false, maxRetries: 2 }
            : undefined;

        const busOpt = yield* Effect.serviceOption(EventBus);
        const sharedEventBus = busOpt._tag === "Some" ? busOpt.value : undefined;

        const subRuntime = createLightRuntime({
          agentId: childAgentId,
          // Same boundary as the dynamic `spawn-agent` path (sub-agent-executor.ts):
          // `childAgentId` is uniquified for correlation, so carry the given name
          // separately for anything that RENDERS the child (status renderer line,
          // run tree). Without it `AgentStarted.agentDisplayName` falls back to
          // "sub-<name>-<epoch>".
          agentDisplayName: subName,
          provider: (agentCfg.provider ?? "test") as ProviderName,
          model: agentCfg.model,
          maxIterations: agentCfg.maxIterations,
          systemPrompt: composedSystemPrompt,
          enableReasoning: true,
          enableTools: true,
          allowedTools: effectiveAllowed,
          requiredTools: effectiveRequired,
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
          // W5.4 budget inheritance (mirror of sub-agent-executor.ts): the
          // local-agent child runs on a light runtime whose LLM path never
          // feeds the ambient run meter; fold its spend into the parent's
          // meter so `.withBudget()` sees the true run total. No-op when the
          // run carries no budget (meter null).
          const ambientMeter = yield* FiberRef.get(CurrentRunBudget);
          if (ambientMeter !== null && typeof result.metadata.tokensUsed === "number") {
            ambientMeter.tokens += result.metadata.tokensUsed;
            if (typeof result.metadata.cost === "number") {
              ambientMeter.cost += result.metadata.cost;
            }
          }
          return finalizeSubAgentResult(
            { name: subName },
            {
              output: String(result.output ?? ""),
              success: result.success,
              tokensUsed: result.metadata.tokensUsed,
              completionEnvelope: childCompletionEnvelope(result),
            },
            parentScratchpadWriter,
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
          // Wave 5.3 review fix: stamp the crash (see sub-agent-executor.ts).
          completionStatus: "failed",
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
