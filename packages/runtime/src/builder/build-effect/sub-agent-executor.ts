/**
 * Sub-agent task executor — builds and runs an isolated sub-agent for
 * a delegated task. Used by both spawnHandler (single) and
 * spawnAgentsHandler (batch).
 *
 * Owns: createLightRuntime invocation for isolated sub-agent runtime,
 * parent MCP tool proxy setup, tool filtering & scoping (META_TOOL_NAMES,
 * allowedTools → required-tools conversion), persona composition,
 * task result unwrapping, tool-usage extraction.
 *
 * Lifted from builder.ts pre-W25 (5,478-LOC checkpoint).
 */

import { Effect, Layer, Schema } from "effect";
import type { Task, TaskResult } from "@reactive-agents/core";
import { generateTaskId, AgentId } from "@reactive-agents/core";
import type {
  ParentContext,
  SubAgentResult,
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
  };
}

/**
 * Build and execute a single sub-agent task.
 * Shared by spawnHandler (singular) and spawnAgentsHandler (batch).
 *
 * Verbatim port of the closure previously declared inline at builder.ts
 * line 2762 (pre-W25-T4 checkpoint). Closure captures lifted into
 * `deps`. Behavior unchanged.
 */
export const buildSubAgentTask = async (
  t: SubAgentTaskArgs,
  deps: SubAgentExecutorDeps,
): Promise<SubAgentResult> => {
  const {
    parentProvider,
    parentModel,
    defaultMaxIter,
    getParentToolService,
    mcpServers,
    parentReasoningOptions,
    parentEnableGuardrails,
    parentEnableObservability,
    parentObservabilityOptions,
    parentContextProfile,
    parentEnableCostTracking,
    getParentContext,
    toolsMod,
  } = deps;

  const executor = toolsMod.createSubAgentExecutor(
    {
      name: t.name,
      provider: parentProvider,
      model: parentModel,
      maxIterations: defaultMaxIter,
      tools: t.tools && t.tools.length > 0 ? t.tools : undefined,
      persona:
        t.role || t.instructions || t.tone
          ? {
              role: t.role,
              instructions: t.instructions,
              tone: t.tone,
            }
          : undefined,
    },
    async (opts) => {
      const _taskPreview =
        opts.task.length > 80 ? opts.task.slice(0, 80) + "…" : opts.task;
      process.stdout.write(
        `\n  \x1b[36m┌── sub-agent: \x1b[1m${t.name}\x1b[22m ──────────────────────────────\x1b[0m\n  \x1b[36m│\x1b[0m  task: "${_taskPreview}"\n`,
      );
      const _subStart = Date.now();

      // Compose persona with system prompt
      const composedSystemPrompt = buildSubAgentSystemPrompt(
        opts.persona as AgentPersona | undefined,
        opts.systemPrompt,
        opts.name,
      );

      // ── Collect parent's MCP tool definitions for proxy ──
      // Instead of spawning duplicate Docker containers, we list
      // the parent's already-connected tools and register proxy
      // handlers that route calls through the parent's ToolService.
      let parentMcpToolDefs: any[] = [];
      const parentToolServiceRef = getParentToolService();
      if (parentToolServiceRef && mcpServers.length > 0) {
        try {
          const allTools = await Effect.runPromise(
            (parentToolServiceRef as {
              listTools: () => Effect.Effect<ReadonlyArray<{ source?: string; name?: string }>>;
            }).listTools(),
          );
          parentMcpToolDefs = allTools.filter(
            (m) => m.source === "mcp" || m.name?.includes("/"),
          );
        } catch {
          // Parent tools unavailable — sub-agent gets built-ins only
        }
      }

      // Sub-agent inherits parent's reasoning, guardrails,
      // observability, and context profile. MCP tools are proxied
      // from the parent (no duplicate containers).
      // When allowedTools is specified, those tools become required —
      // if you're constrained to specific tools, you must use them.
      //
      // Auto-scope: when no explicit tool whitelist was given,
      // auto-filter MCP tools by task relevance so the sub-agent
      // doesn't see all 40+ tools (reduces context noise + confusion).
      let subAllowed = opts.allowedTools;
      if (
        (!subAllowed || subAllowed.length === 0) &&
        parentMcpToolDefs.length > 0
      ) {
        const { filterToolsByRelevance } = await import(
          "@reactive-agents/reasoning"
        );
        const mcpSchemas = parentMcpToolDefs.map((m: any) => ({
          name: m.name as string,
          description: (m.description ?? "") as string,
          parameters: ((m.parameters ?? []) as ReadonlyArray<{ name?: string; type?: string; description?: string; required?: boolean }>).map((p) => ({
            name: p.name as string,
            type: (p.type ?? "string") as string,
            description: p.description as string | undefined,
            required: p.required as boolean | undefined,
          })),
        }));
        const filtered = filterToolsByRelevance(opts.task, mcpSchemas);
        // Only scope if filtering actually reduces the set meaningfully
        if (
          filtered.primary.length > 0 &&
          filtered.primary.length < mcpSchemas.length * 0.7
        ) {
          subAllowed = [...filtered.primary.map((s) => s.name)];
        }
      }
      // subRequiredTools must exclude ALWAYS_INCLUDE_TOOLS (e.g., recall).
      // These are optional meta-tools; requiring them causes kernel-pre-loop guard to fail
      // because they're not registered in builtin tools. Only require what the caller asked for.
      const subRequiredToolNames =
        subAllowed?.filter(
          (tn) =>
            !toolsMod.ALWAYS_INCLUDE_TOOLS.includes(tn as never),
        ) ?? [];
      const subRequiredTools =
        subRequiredToolNames.length > 0
          ? {
              tools: subRequiredToolNames,
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
        allowedTools: subAllowed,
        requiredTools: subRequiredTools,
        reasoningOptions: parentReasoningOptions,
        enableGuardrails: parentEnableGuardrails,
        enableObservability: parentEnableObservability,
        observabilityOptions: parentObservabilityOptions
          ? {
              ...parentObservabilityOptions,
              logPrefix: "  │ ",
            }
          : { logPrefix: "  │ " },
        contextProfile: parentContextProfile,
        enableCostTracking: parentEnableCostTracking,
      });

      // Register proxied MCP tools + execute in one Effect scope
      const subEffect = Effect.gen(function* () {
        const subEngine = yield* ExecutionEngine;

        // Register parent's MCP tools as proxy handlers
        if (parentMcpToolDefs.length > 0) {
          const subToolsMod = yield* Effect.promise(
            () => import("@reactive-agents/tools"),
          );
          const subTs =
            yield* subToolsMod.ToolService as unknown as import("effect").Context.Tag<
              any,
              any
            >;
          for (const toolDef of parentMcpToolDefs) {
            // Proxy handler routes calls to parent's live MCP connection
            const proxyHandler = (args: Record<string, unknown>) =>
              Effect.promise(async () => {
                return Effect.runPromise(
                  (parentToolServiceRef as {
                    execute: (p: {
                      toolName: string;
                      arguments: Record<string, unknown>;
                      agentId: string;
                      sessionId: string;
                    }) => Effect.Effect<unknown>;
                  }).execute({
                    toolName: toolDef.name,
                    arguments: args,
                    agentId: opts.agentId,
                    sessionId: `sub-${t.name}`,
                  }),
                );
              });
            yield* subTs.register(toolDef, proxyHandler);
          }
        }

        const taskObj: Task = {
          id: generateTaskId(),
          agentId: Schema.decodeSync(AgentId)(opts.agentId),
          type: "query" as const,
          input: { question: opts.task },
          priority: "medium" as const,
          status: "pending" as const,
          metadata: { tags: [] },
          createdAt: new Date(),
        };
        return yield* subEngine.execute(taskObj);
      }) as Effect.Effect<TaskResult, any, never>;
      const result: TaskResult = await Effect.runPromise(
        subEffect.pipe(
          Effect.provide(subRuntime as unknown as Layer.Layer<never>),
        ),
      );
      const subReasoningSteps = ((
        result.metadata as {
          reasoningSteps?: unknown;
        }
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
      const delegatedToolsUsed = [...subReasoningSteps.entries()]
        .flatMap(([index, step]) => {
          if (step.type !== "action") return [] as string[];
          const toolName =
            step.metadata?.toolUsed ??
            (typeof step.content === "string"
              ? step.content.split("(")[0]?.trim()
              : undefined);
          const observationStep = subReasoningSteps[index + 1];
          const observationResult =
            observationStep?.metadata?.observationResult;
          const succeeded =
            observationStep?.type === "observation"
              ? observationResult?.success !== false
              : true;
          if (!succeeded) return [] as string[];
          const nestedDelegated = Array.isArray(
            observationResult?.delegatedToolsUsed,
          )
            ? observationResult.delegatedToolsUsed.filter(
                (name): name is string =>
                  typeof name === "string" && name.length > 0,
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
      const _subElapsed = ((Date.now() - _subStart) / 1000).toFixed(1);
      const _subIcon = result.success ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
      const _subSteps = result.metadata.stepsCount ?? 0;
      const _subTok = result.metadata.tokensUsed;
      process.stdout.write(
        `  \x1b[36m└── ${_subIcon} \x1b[1m${t.name}\x1b[22m\x1b[0m  ${_subSteps} steps | ${_subTok} tok | ${_subElapsed}s\n\n`,
      );
      return {
        output: String(result.output ?? ""),
        success: result.success,
        tokensUsed: result.metadata.tokensUsed,
        stepsCompleted: _subSteps,
        delegatedToolsUsed:
          delegatedToolsUsed.length > 0 ? delegatedToolsUsed : undefined,
      };
    },
    0,
    getParentContext,
  );

  return executor(t.task);
};
