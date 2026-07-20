/**
 * Sub-agent task executor — builds and runs an isolated sub-agent for
 * a delegated task. Used by both spawnHandler (single) and
 * spawnAgentsHandler (batch).
 *
 * Owns: createLightRuntime invocation for the sub-agent runtime, parent MCP
 * tool proxy setup, tool filtering & scoping (META_TOOL_NAMES, allowedTools →
 * required-tools conversion), persona composition, task result unwrapping,
 * tool-usage extraction.
 *
 * B8-T4 (2026-07-20): the child no longer runs on a DETACHED root fiber
 * (`await Effect.runPromise(subEffect)`). `buildSubAgentTask` now returns an
 * Effect that forks the child into the PARENT's fiber tree (`Effect.forkScoped`
 * + `Fiber.await`) on the parent's shared service stack. Interrupting the parent
 * therefore reaches in-flight children (real cancellation), and a FAILED child
 * surfaces as `SubAgentResult{success:false}` — `Fiber.await` returns an `Exit`,
 * so a child failure can never cascade to fail the parent.
 */

import { Context, Effect, Exit, Fiber, FiberRef, Schema } from "effect";
import type { Task, TaskResult, RunContext } from "@reactive-agents/core";
import {
  generateTaskId,
  AgentId,
  EventBus,
  CurrentRunContext,
  CurrentRunContextRef,
  rootContext,
  childContext,
} from "@reactive-agents/core";
import type { TestTurn } from "@reactive-agents/llm-provider";

/** Per-execution shared handles resolved from the parent's ambient context. */
export interface SubAgentRuntimeShared {
  /** Parent's EventBus instance — shared so child events reach the parent bus (G1). */
  readonly sharedEventBus?: Context.Tag.Service<typeof EventBus>;
}
import type {
  ParentContext,
  SubAgentResult,
  SubAgentRawResult,
} from "@reactive-agents/tools";
import { createLightRuntime } from "../../runtime.js";
import type { MCPServerConfig } from "../../runtime.js";
import { ExecutionEngine } from "../../execution-engine.js";
import { buildSubAgentSystemPrompt } from "../helpers.js";
import type {
  ReasoningOptions,
} from "../../types.js";
import type {
  AgentPersona,
  ProviderName,
  ObservabilityOptions,
} from "../types.js";
import type {
  ContextProfile,
} from "@reactive-agents/reasoning";
import { makeSpawnHandlers } from "./spawn-handlers.js";

// ─── Sub-agent meta-tool blacklist for delegated-tools-used computation ───
//
// These tools are filtered out of `delegatedToolsUsed` because they're
// orchestration plumbing (final-answer/task-complete/checkpoint) or
// optional helpers that should not count as the sub-agent's "real work".
const META_TOOL_NAMES: ReadonlySet<string> = new Set([
  "final-answer",
  "task-complete",
  "context-status",
  "brief",
  "pulse",
  "find",
  "recall",
  "checkpoint",
]);

/** Per-task arguments for a single sub-agent dispatch. */
export interface SubAgentTaskArgs {
  task: string;
  name: string;
  role?: string;
  instructions?: string;
  tone?: string;
  tools?: string[];
}

/** MCP tool definition shape proxied from the parent's ToolService. */
interface ParentMcpToolDef {
  readonly name: string;
  readonly source?: string;
  readonly description?: string;
  readonly parameters?: ReadonlyArray<{
    name?: string;
    type?: string;
    description?: string;
    required?: boolean;
  }>;
}

/**
 * Closure-captured state lifted out of buildEffect()'s body.
 * The call site in builder.ts wraps `buildSubAgentTask` with these
 * captured refs so each invocation sees fresh values.
 */
export interface SubAgentExecutorDeps {
  /** Inherited LLM provider (parent's). */
  readonly parentProvider: ProviderName;
  /** Inherited model id (parent's) — optional, mirrors builder field. */
  readonly parentModel: string | undefined;
  /** Default max iterations for spawned sub-agents. */
  readonly defaultMaxIter: number;
  /**
   * Recursion cap for nested delegation (B8-T5). When a spawning agent's
   * `RunContext.depth` is already `>= maxRecursionDepth`, delegation is refused
   * (a tool-result observation, never a throw). `undefined` ⇒ framework default
   * (`resolveMaxRecursionDepth`).
   */
  readonly maxRecursionDepth?: number;
  /**
   * Live getter for the parent's ToolService — assigned during
   * agentToolInitEffect and read at sub-agent dispatch time. Returning
   * null means parent tools are unavailable.
   */
  readonly getParentToolService: () => unknown | null;
  /** Configured MCP servers (used to gate proxy setup). */
  readonly mcpServers: ReadonlyArray<MCPServerConfig>;
  /** Inherited reasoning options. */
  readonly parentReasoningOptions: ReasoningOptions | undefined;
  /** Inherited guardrails toggle. */
  readonly parentEnableGuardrails: boolean | undefined;
  /** Inherited observability toggle. */
  readonly parentEnableObservability: boolean | undefined;
  /** Inherited observability options (logPrefix overridden for nesting). */
  readonly parentObservabilityOptions: ObservabilityOptions | undefined;
  /** Inherited context profile (Partial — builder field is `Partial<ContextProfile>`). */
  readonly parentContextProfile: Partial<ContextProfile> | undefined;
  /** Inherited cost-tracking toggle. */
  readonly parentEnableCostTracking: boolean | undefined;
  /**
   * Inherited deterministic `test`-provider scenario. Passed through so a
   * sub-agent driven by the `test` provider is scriptable (delays, tool calls)
   * the same way its parent is — undefined for real providers.
   */
  readonly parentTestScenario: TestTurn[] | undefined;
  /** Parent agent id — used as a fallback `RunContext.agentId` and stamped as
   *  `parentAgentId` on the child's task metadata so the child's events
   *  (published on the shared bus) are attributable to this parent (audit G1). */
  readonly parentAgentId: string;
  /** Lazy reader for the parent's execution context (tool results, task description). */
  readonly getParentContext: () => ParentContext | undefined;
  /**
   * Resolver for the @reactive-agents/tools module — the call site
   * already imported it dynamically, so we receive it directly to avoid
   * a redundant dynamic import inside this hot path.
   */
  readonly toolsMod: {
    createSubAgentExecutor: typeof import(
      "@reactive-agents/tools"
    ).createSubAgentExecutor;
    ALWAYS_INCLUDE_TOOLS: typeof import(
      "@reactive-agents/tools"
    ).ALWAYS_INCLUDE_TOOLS;
    composeSubAgentDirectivePrompt: typeof import(
      "@reactive-agents/tools"
    ).composeSubAgentDirectivePrompt;
    computeEffectiveTools: typeof import(
      "@reactive-agents/tools"
    ).computeEffectiveTools;
    subAgentDepthRefusal: typeof import(
      "@reactive-agents/tools"
    ).subAgentDepthRefusal;
    finalizeSubAgentResult: typeof import(
      "@reactive-agents/tools"
    ).finalizeSubAgentResult;
    resolveMaxRecursionDepth: typeof import(
      "@reactive-agents/tools"
    ).resolveMaxRecursionDepth;
  };
}

/**
 * Resolve the RunContext of the agent that is *doing* the spawning.
 *
 * Authority order (mirrors the RunContext doctrine): the explicitly-threaded
 * ambient value (`CurrentRunContextRef`, set by a running child's own overlay
 * so nested spawns derive correctly), then a run-scoped fallback built from the
 * pre-existing `CurrentRunContext.taskId` + the parent's agent id. The fallback
 * yields depth-0 (a top-level parent), never a WRONG attribution.
 */
const resolveSpawningContext = (
  parentAgentId: string,
): Effect.Effect<RunContext, never, never> =>
  Effect.gen(function* () {
    const explicit = yield* FiberRef.get(CurrentRunContextRef);
    if (explicit) return explicit;
    const legacy = yield* FiberRef.get(CurrentRunContext);
    const taskId =
      legacy && typeof legacy.taskId === "string" && legacy.taskId.length > 0
        ? legacy.taskId
        : `run-${crypto.randomUUID().slice(0, 8)}`;
    return rootContext(taskId, parentAgentId);
  });

/** Pull the successful, non-meta tools a sub-agent used from its reasoning steps. */
const extractDelegatedToolsUsed = (result: TaskResult): string[] => {
  const subReasoningSteps = ((
    result.metadata as { reasoningSteps?: unknown }
  ).reasoningSteps ?? []) as Array<{
    type?: string;
    content?: string;
    metadata?: {
      toolUsed?: string;
      observationResult?: {
        success?: boolean;
        delegatedToolsUsed?: readonly string[];
      };
    };
  }>;
  return [...subReasoningSteps.entries()]
    .flatMap(([index, step]) => {
      if (step.type !== "action") return [] as string[];
      const toolName =
        step.metadata?.toolUsed ??
        (typeof step.content === "string"
          ? step.content.split("(")[0]?.trim()
          : undefined);
      const observationStep = subReasoningSteps[index + 1];
      const observationResult = observationStep?.metadata?.observationResult;
      const succeeded =
        observationStep?.type === "observation"
          ? observationResult?.success !== false
          : true;
      if (!succeeded) return [] as string[];
      const nestedDelegated = Array.isArray(observationResult?.delegatedToolsUsed)
        ? observationResult.delegatedToolsUsed.filter(
            (name): name is string => typeof name === "string" && name.length > 0,
          )
        : [];
      const directTool =
        toolName &&
        !META_TOOL_NAMES.has(toolName) &&
        toolName !== "spawn-agent" &&
        !toolName.startsWith("agent-")
          ? [toolName]
          : [];
      return [...directTool, ...nestedDelegated];
    })
    .filter((toolName, index, arr) => arr.indexOf(toolName) === index);
};

/**
 * Build and execute a single sub-agent task, forked into the parent's fiber
 * tree. Shared by spawnHandler (singular) and spawnAgentsHandler (batch).
 *
 * Returns an Effect (never fails) that yields a structured `SubAgentResult`.
 * The child runs on the parent's shared EventBus (G1) and, because it is forked
 * with `Effect.forkScoped` inside the caller's scope, is interrupted when the
 * parent is interrupted (real cancellation). Child failures are contained via
 * the `Exit` returned by `Fiber.await` — they never cascade to the parent.
 */
export const buildSubAgentTask = (
  t: SubAgentTaskArgs,
  deps: SubAgentExecutorDeps,
  runtimeShared?: SubAgentRuntimeShared,
): Effect.Effect<SubAgentResult, never, never> =>
  Effect.scoped(
    Effect.gen(function* () {
      const {
        parentProvider,
        parentModel,
        defaultMaxIter,
        maxRecursionDepth,
        getParentToolService,
        mcpServers,
        parentReasoningOptions,
        parentEnableGuardrails,
        parentEnableObservability,
        parentObservabilityOptions,
        parentContextProfile,
        parentEnableCostTracking,
        parentTestScenario,
        parentAgentId,
        getParentContext,
        toolsMod,
      } = deps;
      const sharedEventBus = runtimeShared?.sharedEventBus;

      // ── Depth guard (B8-T5) ── the spawning agent's RunContext drives the cap.
      const spawningCtx = yield* resolveSpawningContext(parentAgentId);
      const maxDepth = toolsMod.resolveMaxRecursionDepth(maxRecursionDepth);
      if (spawningCtx.depth >= maxDepth) {
        // Refusal is an observation the model can route around, never a throw.
        return toolsMod.subAgentDepthRefusal(t.name, maxDepth);
      }
      const childCtx = childContext(spawningCtx, t.name);

      const agentId = `sub-${t.name}-${Date.now()}`;
      const persona: AgentPersona | undefined =
        t.role || t.instructions || t.tone
          ? { role: t.role, instructions: t.instructions, tone: t.tone }
          : undefined;

      // Compose the child's system prompt exactly as the Promise executor does:
      // directive + parent-context prefix, then persona composition.
      const directivePrompt = toolsMod.composeSubAgentDirectivePrompt(
        undefined,
        getParentContext(),
      );
      const composedSystemPrompt = buildSubAgentSystemPrompt(
        persona,
        directivePrompt,
        t.name,
      );

      // ── Collect parent's MCP tool definitions for proxy ──
      // List the parent's already-connected tools and register proxy handlers
      // that route calls through the parent's ToolService (no duplicate Docker).
      let parentMcpToolDefs: ParentMcpToolDef[] = [];
      const parentToolServiceRef = getParentToolService();
      if (parentToolServiceRef && mcpServers.length > 0) {
        const listed = yield* Effect.either(
          (
            parentToolServiceRef as {
              listTools: () => Effect.Effect<
                ReadonlyArray<ParentMcpToolDef>,
                Error
              >;
            }
          ).listTools(),
        );
        if (listed._tag === "Right") {
          parentMcpToolDefs = listed.right.filter(
            (m) => m.source === "mcp" || m.name?.includes("/"),
          );
        }
        // Left ⇒ parent tools unavailable — sub-agent gets built-ins only.
      }

      // Auto-scope: when no explicit whitelist was given, filter MCP tools by
      // task relevance so the sub-agent doesn't see all 40+ tools.
      let subAllowed = toolsMod.computeEffectiveTools(t.tools);
      if (
        (!subAllowed || subAllowed.length === 0) &&
        parentMcpToolDefs.length > 0
      ) {
        const { filterToolsByRelevance } = yield* Effect.promise(
          () => import("@reactive-agents/reasoning"),
        );
        const mcpSchemas = parentMcpToolDefs.map((m) => ({
          name: m.name,
          description: m.description ?? "",
          parameters: (m.parameters ?? []).map((p) => ({
            name: p.name as string,
            type: (p.type ?? "string") as string,
            description: p.description as string | undefined,
            required: p.required as boolean | undefined,
          })),
        }));
        const filtered = filterToolsByRelevance(t.task, mcpSchemas);
        if (
          filtered.primary.length > 0 &&
          filtered.primary.length < mcpSchemas.length * 0.7
        ) {
          subAllowed = [...filtered.primary.map((s) => s.name)];
        }
      }

      // subRequiredTools must exclude ALWAYS_INCLUDE_TOOLS (e.g. recall).
      const subRequiredToolNames =
        subAllowed?.filter(
          (tn) => !toolsMod.ALWAYS_INCLUDE_TOOLS.includes(tn as never),
        ) ?? [];
      const subRequiredTools =
        subRequiredToolNames.length > 0
          ? { tools: subRequiredToolNames, adaptive: false, maxRetries: 2 }
          : undefined;

      const subRuntime = createLightRuntime({
        agentId,
        provider: parentProvider ?? "test",
        model: parentModel,
        maxIterations: defaultMaxIter,
        systemPrompt: composedSystemPrompt,
        enableReasoning: true,
        enableTools: true,
        allowedTools: subAllowed,
        requiredTools: subRequiredTools,
        reasoningOptions: parentReasoningOptions,
        enableGuardrails: parentEnableGuardrails,
        enableObservability: parentEnableObservability,
        observabilityOptions: parentObservabilityOptions
          ? { ...parentObservabilityOptions, logPrefix: "  │ " }
          : { logPrefix: "  │ " },
        contextProfile: parentContextProfile,
        enableCostTracking: parentEnableCostTracking,
        // Inherit the deterministic scenario so `test`-provider sub-agents are
        // scriptable (delays for cancellation tests, nested tool calls).
        testScenario: parentTestScenario,
        // G1: join the parent's EventBus so this sub-agent's lifecycle events
        // are observable on the parent's bus + trace bridge.
        sharedEventBus,
      });

      // Register proxied MCP tools + execute in one Effect scope. This whole
      // Effect is forked into the PARENT's fiber tree below.
      // B8-T5: nesting is opt-in. Children get spawn tools (and can therefore
      // sub-delegate) only when the parent EXPLICITLY set maxRecursionDepth and
      // the child is still below the cap. Default configs give children no spawn
      // tools — matching the documented behavior and keeping flat delegations
      // free of any nested-spawn side effects.
      const registerChildSpawn =
        maxRecursionDepth !== undefined && childCtx.depth < maxDepth;
      const needsMcp = parentMcpToolDefs.length > 0 && parentToolServiceRef;

      const childEffect = Effect.gen(function* () {
        const subEngine = yield* ExecutionEngine;

        if (needsMcp || registerChildSpawn) {
          const subToolsMod = yield* Effect.promise(
            () => import("@reactive-agents/tools"),
          );
          const subTs =
            yield* (subToolsMod.ToolService as unknown as Context.Tag<
              unknown,
              {
                register: (
                  def: unknown,
                  handler: (
                    args: Record<string, unknown>,
                  ) => Effect.Effect<unknown, Error>,
                ) => Effect.Effect<unknown>;
              }
            >);

          if (needsMcp) {
            for (const toolDef of parentMcpToolDefs) {
              // Proxy handler routes calls to the parent's live MCP connection,
              // in the child's fiber (no detached runPromise).
              const proxyHandler = (
                args: Record<string, unknown>,
              ): Effect.Effect<unknown> =>
                (
                  parentToolServiceRef as {
                    execute: (p: {
                      toolName: string;
                      arguments: Record<string, unknown>;
                      agentId: string;
                      sessionId: string;
                    }) => Effect.Effect<unknown>;
                  }
                ).execute({
                  toolName: toolDef.name,
                  arguments: args,
                  agentId,
                  sessionId: `sub-${t.name}`,
                });
              yield* subTs.register(toolDef, proxyHandler);
            }
          }

          if (registerChildSpawn) {
            // Give the child its own spawn tools so it can sub-delegate. The
            // recursive buildSubAgentTask runs in the CHILD's fiber, where the
            // ambient CurrentRunContextRef is childCtx — so a grandchild derives
            // at childCtx.depth + 1 and the recursion cap advances honestly.
            const childHandlers = makeSpawnHandlers({
              buildSubAgentTask: (childArgs, childShared) =>
                buildSubAgentTask(childArgs, deps, childShared),
            });
            yield* subTs.register(
              subToolsMod.createSpawnAgentTool(),
              childHandlers.spawnHandler,
            );
            yield* subTs.register(
              subToolsMod.createSpawnAgentsTool(),
              childHandlers.spawnAgentsHandler,
            );
          }
        }

        const taskObj: Task = {
          id: generateTaskId(),
          agentId: Schema.decodeSync(AgentId)(agentId),
          type: "query" as const,
          input: { question: t.task },
          priority: "medium" as const,
          status: "pending" as const,
          // G1/T3b: stamp parentAgentId + the child's RunContext so the child's
          // AgentStarted/AgentCompleted (published on the shared bus) are
          // attributable to this parent and correlated in the trace tree.
          metadata: {
            tags: [],
            context: { parentAgentId, runContext: childCtx },
          },
          createdAt: new Date(),
        };
        return yield* subEngine.execute(taskObj);
      }).pipe(
        Effect.provide(subRuntime),
        // Fallback-only ambient correlation for the child's own fiber, so a
        // nested spawn inside the child derives from the child's RunContext.
        Effect.locally(CurrentRunContextRef, childCtx as RunContext | null),
      );

      // Fork into the PARENT's fiber tree: parent interruption reaches the
      // child. `Fiber.await` returns an Exit, so a child FAILURE is contained
      // here and mapped to a structured result — it never cascades.
      const fiber = yield* Effect.forkScoped(childEffect);
      const exit = yield* fiber.await;

      if (Exit.isSuccess(exit)) {
        const result = exit.value;
        const delegatedToolsUsed = extractDelegatedToolsUsed(result);
        const raw: SubAgentRawResult = {
          output: String(result.output ?? ""),
          success: result.success,
          tokensUsed: result.metadata.tokensUsed,
          stepsCompleted: result.metadata.stepsCount ?? 0,
          delegatedToolsUsed:
            delegatedToolsUsed.length > 0 ? delegatedToolsUsed : undefined,
        };
        return toolsMod.finalizeSubAgentResult({ name: t.name }, raw);
      }

      // Failure or interruption — contained, never rethrown to the parent.
      const cause = exit.cause;
      const summary = Exit.isInterrupted(exit)
        ? "Sub-agent was interrupted before completion"
        : `Sub-agent failed: ${String(cause)}`;
      return {
        subAgentName: t.name,
        success: false,
        summary,
        tokensUsed: 0,
        stepsCompleted: 0,
      } satisfies SubAgentResult;
    }),
  );
