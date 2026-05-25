/**
 * Tool / MCP / agent-tool registration block for buildEffect (W26-B step 3).
 *
 * Bakes registrations into the runtime layer via Layer.effectDiscard so they
 * run inside the ManagedRuntime scope (not a throwaway scope). Conditional on
 * any of: agentTools / allowDynamicSubAgents / mcpServers / toolsOptions.tools
 * / toolsOptions.terminal.
 *
 * Extracted verbatim from builder.ts:2213-2374.
 */
import { Effect, Layer } from "effect";
import { shellExecuteTool, shellExecuteHandler } from "@reactive-agents/tools";
import type {
  ToolDefinition,
  ParentContext,
} from "@reactive-agents/tools";
import type { ContextProfile } from "@reactive-agents/reasoning";
import type { MCPServerConfig } from "../../runtime.js";
import type { ReasoningOptions } from "../../types.js";
import type {
  AgentToolOptions,
  ToolsOptions,
  ObservabilityOptions,
} from "../types.js";
import type {
  SubAgentTaskArgs as ExtractedSubAgentTaskArgs,
} from "./sub-agent-executor.js";
import { buildSubAgentTask } from "./sub-agent-executor.js";
import { createRemoteAgentToolRegistration } from "./remote-agent-tools.js";
import {
  createLocalAgentToolRegistration,
  createDynamicSpawnRegistrations,
} from "./local-agent-tools.js";
import { buildToolInitLayer } from "./tool-init-layer.js";

type ProviderName = string;

export interface ToolMcpRegistrationsDeps {
  readonly runtimeWithCortex: Layer.Layer<unknown, unknown, unknown>;
  readonly mcpServers: readonly MCPServerConfig[];
  readonly toolsOptions?: ToolsOptions;
  readonly agentTools: readonly AgentToolOptions[];
  readonly allowDynamicSubAgents: boolean;
  readonly dynamicSubAgentOptions?: { maxIterations?: number };
  readonly agentId: string;
  readonly getParentContext: () => ParentContext | undefined;
  readonly parentProvider: ProviderName;
  readonly parentModel?: string;
  readonly parentReasoningOptions?: ReasoningOptions;
  readonly parentEnableGuardrails: boolean;
  readonly parentEnableObservability: boolean;
  readonly parentObservabilityOptions: ObservabilityOptions;
  readonly parentContextProfile?: Partial<ContextProfile>;
  readonly parentEnableCostTracking: boolean;
}

export interface ToolMcpRegistrationsOutput {
  /** The runtime layer after Layer.merge with the tool-init layer (or unchanged when no registrations). */
  readonly fullRuntime: Layer.Layer<unknown, unknown, unknown>;
}

export const buildToolMcpRegistrations = (
  deps: ToolMcpRegistrationsDeps,
): Effect.Effect<ToolMcpRegistrationsOutput, never> =>
  Effect.gen(function* () {
    let fullRuntime: Layer.Layer<unknown, unknown, unknown> = deps.runtimeWithCortex;

    if (
      deps.agentTools.length > 0 ||
      deps.allowDynamicSubAgents ||
      deps.mcpServers.length > 0 ||
      (deps.toolsOptions?.tools?.length ?? 0) > 0 ||
      deps.toolsOptions?.terminal !== undefined
    ) {
      const toolsMod = yield* Effect.promise(
        () => import("@reactive-agents/tools"),
      );

      const {
        createAgentTool,
        createRemoteAgentTool,
        executeRemoteAgentTool,
      } = toolsMod;

      // Collect (definition, handler) pairs — no registration yet.
      type RegEntry = {
        def: ToolDefinition;
        handler: (
          args: Record<string, unknown>,
        ) => Effect.Effect<unknown, Error>;
      };
      const registrations: RegEntry[] = [];

      for (const agentTool of deps.agentTools) {
        if (agentTool.remoteUrl) {
          registrations.push(
            createRemoteAgentToolRegistration(
              {
                name: agentTool.name,
                remoteUrl: agentTool.remoteUrl,
              },
              {
                createRemoteAgentTool,
                executeRemoteAgentTool,
              },
            ),
          );
        } else if (agentTool.agent) {
          registrations.push(
            createLocalAgentToolRegistration(agentTool, {
              toolsMod: {
                createAgentTool,
                createSubAgentExecutor: toolsMod.createSubAgentExecutor,
              },
              agentId: deps.agentId,
              getParentContext: deps.getParentContext,
            }),
          );
        }
      }

      // Mutable ref for the parent's ToolService — set during agentToolInitEffect,
      // read by spawn handler at call time. This avoids duplicate MCP containers
      // by letting sub-agents proxy tool calls through the parent's live connections.
      let parentToolServiceRef: any = null;

      /** Per-task arguments for a single sub-agent dispatch. */
      type SubAgentTaskArgs = {
        task: string;
        name: string;
        role?: string;
        instructions?: string;
        tone?: string;
        tools?: string[];
      };

      // Register the built-in spawn-agent tool when dynamic sub-agents are enabled.
      if (deps.allowDynamicSubAgents) {
        const defaultMaxIter = deps.dynamicSubAgentOptions?.maxIterations ?? 4;

        const buildSingleSubAgentTask = (
          t: SubAgentTaskArgs,
        ): Promise<import("@reactive-agents/tools").SubAgentResult> =>
          buildSubAgentTask(t as ExtractedSubAgentTaskArgs, {
            parentProvider: deps.parentProvider,
            parentModel: deps.parentModel,
            defaultMaxIter,
            getParentToolService: () => parentToolServiceRef,
            mcpServers: deps.mcpServers as MCPServerConfig[],
            parentReasoningOptions: deps.parentReasoningOptions,
            parentEnableGuardrails: deps.parentEnableGuardrails,
            parentEnableObservability: deps.parentEnableObservability,
            parentObservabilityOptions: deps.parentObservabilityOptions,
            parentContextProfile: deps.parentContextProfile,
            parentEnableCostTracking: deps.parentEnableCostTracking,
            getParentContext: deps.getParentContext,
            toolsMod: {
              createSubAgentExecutor: toolsMod.createSubAgentExecutor,
              ALWAYS_INCLUDE_TOOLS: toolsMod.ALWAYS_INCLUDE_TOOLS,
            },
          });

        for (const reg of createDynamicSpawnRegistrations({
          toolsMod: {
            createSpawnAgentTool: toolsMod.createSpawnAgentTool,
            createSpawnAgentsTool: toolsMod.createSpawnAgentsTool,
          },
          buildSubAgentTask: buildSingleSubAgentTask,
        })) {
          registrations.push(reg);
        }
      }

      const toolInitLayer = buildToolInitLayer(deps.runtimeWithCortex, {
        toolsMod: {
          ToolService: toolsMod.ToolService,
        },
        mcpServers: deps.mcpServers as MCPServerConfig[],
        toolsOptions: deps.toolsOptions,
        registrations,
        shellExecuteTool,
        shellExecuteHandler,
        onToolServiceResolved: (ts) => {
          parentToolServiceRef = ts;
        },
      });

      fullRuntime = Layer.merge(deps.runtimeWithCortex, toolInitLayer);
    }

    return { fullRuntime };
  });
