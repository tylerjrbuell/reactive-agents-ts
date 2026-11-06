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

import { Effect, Exit, Schema } from "effect";
import type {
  AgentDefinition,
  Task,
} from "@reactive-agents/core";
import {
  generateTaskId,
  AgentId,
  EventBus,
  childContext,
} from "@reactive-agents/core";
import { childRunScope } from "@reactive-agents/core/internal/run-scope";
import { addRunSpend } from "@reactive-agents/reasoning";
import type {
  ParentContext,
  SubAgentResult,
  ToolDefinition,
} from "@reactive-agents/tools";
import { createLightRuntime } from "../../runtime.js";
import type { LightRuntimeOptions } from "../../runtime.js";
import { ExecutionEngine } from "../../execution-engine.js";
import { buildSubAgentSystemPrompt, interpolateTemplate } from "../helpers.js";
import type { AgentToolOptions, ProviderName, ToolsOptions } from "../types.js";
import {
  makeSpawnHandlers,
  type SpawnHandlers,
} from "./spawn-handlers.js";
import type { ParentSafetyRails, SubAgentTaskArgs } from "./sub-agent-executor.js";
import {
  childCompletionEnvelope,
  inheritedSafetyRails,
  resolveSpawningContext,
} from "./sub-agent-executor.js";

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
export interface LocalAgentToolDeps extends ParentSafetyRails {
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
  /**
   * Parent's `.withTools({ maxCallsPerTool })` caps. The sub-agent runs under
   * them; its own `agent.maxCallsPerTool` is merged over them (own wins per name).
   */
  readonly parentMaxCallsPerTool?: ToolsOptions["maxCallsPerTool"];
}

/**
 * The caps a `.withAgentTool` sub-agent runs under: the parent's, with the
 * sub-agent's own merged over them (own wins per tool name). Pure.
 */
export const subAgentMaxCallsPerTool = (
  parent: ToolsOptions["maxCallsPerTool"],
  own: ToolsOptions["maxCallsPerTool"],
): ToolsOptions["maxCallsPerTool"] =>
  parent === undefined && own === undefined ? undefined : { ...parent, ...own };

/** Per-call values the `.withAgentTool` handler resolves before building the child runtime. */
export interface LocalAgentCall {
  /** Uniquified child id (`sub-<name>-<epoch>`). */
  readonly childAgentId: string;
  /** Composed system prompt (persona + directive, params interpolated). */
  readonly systemPrompt?: string;
  /** Per-call `tools` arg (like spawn-agent's). Absent: the static `agent.tools` allowlist applies. */
  readonly perCallTools?: readonly string[];
  /** Parent's EventBus, so child lifecycle events reach the parent (G1). */
  readonly sharedEventBus?: LightRuntimeOptions["sharedEventBus"];
}

/**
 * The `LightRuntimeOptions` a `.withAgentTool` sub-agent runs under: its own
 * config, the parent's `maxCallsPerTool` caps (own merged over them), and the
 * parent's safety rails. Pure.
 */
export const localAgentRuntimeOptions = (
  agentCfg: NonNullable<AgentToolOptions["agent"]>,
  deps: Pick<LocalAgentToolDeps, "parentMaxCallsPerTool" | keyof ParentSafetyRails>,
  call: LocalAgentCall,
): LightRuntimeOptions => {
  const effectiveAllowed = call.perCallTools ?? agentCfg.tools;
  const effectiveRequired =
    effectiveAllowed && effectiveAllowed.length > 0
      ? { tools: [...effectiveAllowed], adaptive: false, maxRetries: 2 }
      : undefined;
  const { parentMaxCallsPerTool } = deps;
  const maxCallsPerTool = subAgentMaxCallsPerTool(parentMaxCallsPerTool, agentCfg.maxCallsPerTool);
  return {
    agentId: call.childAgentId,
    // Same boundary as the dynamic `spawn-agent` path (sub-agent-executor.ts):
    // `childAgentId` is uniquified for correlation, so carry the given name
    // separately for anything that RENDERS the child (status renderer line,
    // run tree). Without it `AgentStarted.agentDisplayName` falls back to
    // "sub-<name>-<epoch>".
    agentDisplayName: agentCfg.name,
    provider: (agentCfg.provider ?? "test") as ProviderName,
    model: agentCfg.model,
    maxIterations: agentCfg.maxIterations,
    systemPrompt: call.systemPrompt,
    enableReasoning: true,
    enableTools: true,
    allowedTools: effectiveAllowed,
    requiredTools: effectiveRequired,
    sharedEventBus: call.sharedEventBus,
    ...(maxCallsPerTool !== undefined ? { maxCallsPerTool } : {}),
    // The parent's approval policy (coerced to block in buildLightRuntimeConfig),
    // task contract, fabrication guard and grounding: the same mapping spawn-agent
    // children get, so a `.withAgentTool` child cannot escape the parent's gate.
    ...inheritedSafetyRails(deps),
  };
};

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

        const spawningCtx = yield* resolveSpawningContext(agentId);
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
        const busOpt = yield* Effect.serviceOption(EventBus);
        const sharedEventBus = busOpt._tag === "Some" ? busOpt.value : undefined;

        const subRuntime = createLightRuntime(
          localAgentRuntimeOptions(agentCfg, deps, {
            childAgentId,
            systemPrompt: composedSystemPrompt,
            ...(perCallTools !== undefined ? { perCallTools } : {}),
            sharedEventBus,
          }),
        );

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
          // Child run scope (carries its RunContext and task id): file root,
          // document store and controller inherited; tool stores, stream sink
          // and resume state fresh.
          childRunScope({ ...childCtx, taskId: String(taskObj.id) }),
        );

        const fiber = yield* Effect.forkScoped(childEffect);
        const exit = yield* fiber.await;

        if (Exit.isSuccess(exit)) {
          const result = exit.value;
          // W5.4 budget inheritance (mirror of sub-agent-executor.ts): the
          // local-agent child runs on a light runtime whose LLM path never
          // feeds the ambient run meter; fold its spend into the parent's
          // meter so `.withBudget()` sees the true run total. No-op when the
          // run carries no budget (meter null). `addRunSpend` goes through the
          // meter's own apply, so a settled parent meter ignores the fold.
          if (typeof result.metadata.tokensUsed === "number") {
            yield* addRunSpend({
              tokens: result.metadata.tokensUsed,
              cost: typeof result.metadata.cost === "number" ? result.metadata.cost : 0,
            });
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
