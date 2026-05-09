/**
 * Tool init layer composition.
 *
 * Builds the side-effect-only layer that registers MCP servers,
 * custom tools, terminal tool, and agent-tool registrations into the
 * ToolService instance shared with the execution engine. Uses
 * `Layer.effectDiscard(...).pipe(Layer.provide(baseRuntime))` so
 * Effect's reference-identity memoization guarantees the engine and
 * the init effect see the same ToolService instance.
 *
 * Captures the resolved ToolService back to the caller via a setter
 * callback (`onToolServiceResolved`) so spawn-agent handlers can
 * proxy parent MCP tools without duplicating connections.
 *
 * Lifted from builder.ts pre-W25 (6,232-LOC checkpoint).
 */

import { Effect, Layer } from "effect";
import type { Context } from "effect";
import type {
  ShellExecuteConfig,
  ToolDefinition,
} from "@reactive-agents/tools";
import type { MCPServerConfig } from "../../runtime.js";
import type { ToolsOptions } from "../../types.js";

/** Registration entry — `(definition, handler)` pair for ToolService.register. */
export interface ToolInitRegistration {
  readonly def: ToolDefinition;
  readonly handler: (
    args: Record<string, unknown>,
  ) => Effect.Effect<unknown, Error>;
}

/** Inputs needed to compose the init layer. */
export interface ToolInitLayerDeps {
  /** Dynamically imported `@reactive-agents/tools` module (provides ToolService Tag). */
  readonly toolsMod: {
    readonly ToolService: Context.Tag<unknown, unknown>;
  };
  readonly mcpServers: readonly MCPServerConfig[];
  readonly toolsOptions: ToolsOptions | undefined;
  readonly registrations: readonly ToolInitRegistration[];
  readonly shellExecuteTool: ToolDefinition;
  readonly shellExecuteHandler: (
    config?: ShellExecuteConfig,
  ) => (
    args: Record<string, unknown>,
  ) => Effect.Effect<unknown, Error>;
  /** Called when the ToolService is resolved inside the init effect, so the
   *  caller can capture it for sub-agent MCP proxying. */
  readonly onToolServiceResolved: (ts: unknown) => void;
}

/**
 * Build the side-effect-only ToolService init layer.
 *
 * Runs an `Effect.gen` that yields `ToolService` from the surrounding
 * runtime, then connects MCP servers, registers custom tools, the
 * terminal tool (if enabled), and finally all agent-tool registrations.
 * Captures the resolved instance via `onToolServiceResolved`.
 *
 * Returned layer is `Layer.effectDiscard(initEffect).pipe(Layer.provide(baseRuntime))`
 * — same instance as engine via reference-identity memoization.
 */
export const buildToolInitLayer = (
  baseRuntime: Layer.Layer<unknown>,
  deps: ToolInitLayerDeps,
): Layer.Layer<unknown> => {
  const {
    toolsMod,
    mcpServers,
    toolsOptions,
    registrations,
    shellExecuteTool,
    shellExecuteHandler,
    onToolServiceResolved,
  } = deps;

  const initEffect = Effect.gen(function* () {
    const ts =
      yield* toolsMod.ToolService as unknown as Context.Tag<unknown, unknown>;
    // Connect MCP servers inside the managed runtime scope so the engine's
    // ToolService and the MCP-connected ToolService are the same instance.
    for (const mcp of mcpServers) {
      yield* (ts as any).connectMCPServer(mcp);
    }
    // Register custom tools
    if (toolsOptions?.tools) {
      for (const tool of toolsOptions.tools) {
        yield* (ts as any).register(tool.definition, tool.handler);
      }
    }
    // Register terminal tool if enabled
    const terminalOptions = (toolsOptions as any)?.terminal as
      | boolean
      | ShellExecuteConfig
      | undefined;
    const hasCustomShellExecute = (toolsOptions?.tools ?? []).some(
      (tool) => tool.definition.name === shellExecuteTool.name,
    );
    if (terminalOptions && !hasCustomShellExecute) {
      const terminalConfig =
        terminalOptions === true ? undefined : terminalOptions;
      yield* (ts as any).register(
        shellExecuteTool,
        shellExecuteHandler(terminalConfig),
      );
    }
    // Capture parent ToolService ref so spawn-agent can proxy MCP tools
    onToolServiceResolved(ts);
    // Register agent tools
    for (const { def, handler } of registrations) {
      yield* (ts as any).register(def, handler);
    }
  });

  // Layer.effectDiscard wraps the init as a side-effect layer (no service output).
  // Layer.provide(baseRuntime) satisfies the ToolService requirement.
  // Layer.merge combines baseRuntime + initLayer: Effect memoizes baseRuntime by
  // reference so both the engine and the init effect share the same ToolService.
  return Layer.effectDiscard(
    initEffect as Effect.Effect<unknown, never, never>,
  ).pipe(Layer.provide(baseRuntime as Layer.Layer<any>));
};
