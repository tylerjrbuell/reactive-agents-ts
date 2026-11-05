import { Layer, Effect } from "effect";
import type { EventBus } from "@reactive-agents/core";
import { META_TOOLS } from "@reactive-agents/reasoning";
import { createToolsLayer, ToolService, ToolNotFoundError } from "@reactive-agents/tools";
import { withRiskLevelOverrides, type ToolRiskLevelOverrides } from "./tool-risk-levels.js";

// Extracted verbatim from runtime.ts (GH #267).
/**
 * Build the optional ToolService layer for a runtime factory.
 *
 * Encapsulates the gate (`enableTools || mcpServers.length > 0`) and the
 * optional `allowedTools` filtering wrap that both `createRuntime` and
 * `createLightRuntime` previously open-coded as ~70-LOC duplicate blocks.
 *
 * Returns a typed `Layer.Layer<ToolService>` (or `null` when tools are
 * disabled) — no `as ComposableLayer` cast inside. The single widening cast
 * happens once in `finalizeComposition()`, through which both factories route
 * their terminal `Layer.mergeAll(...)` result — the WS-5d / §8.1 invariant
 * pinned by `packages/runtime/test/composable-layer-ceiling.test.ts`.
 *
 * Note: `createLightRuntime` does not honor `mcpServers` (its tools gate
 * is `options.enableTools` only). To preserve that behavior, the caller
 * passes `mcpServers: undefined` (or simply omits it via Pick) when
 * invoking from the light runtime path.
 */
export function buildToolsLayer(
  options: {
    readonly enableTools?: boolean;
    // We only inspect `.length`; the element shape is irrelevant here. Using
    // `unknown` avoids importing MCPServerConfig solely for arity checking
    // and keeps the helper compatible with LightRuntimeOptions (no mcpServers).
    readonly mcpServers?: readonly unknown[] | undefined;
    readonly allowedTools?: readonly string[];
    /** `.withTools({ riskLevels })` — applied to every definition the service hands out. */
    readonly riskLevels?: ToolRiskLevelOverrides;
  },
  eventBusLayer: Layer.Layer<EventBus>,
): Layer.Layer<ToolService> | null {
  const shouldEnableTools =
    options.enableTools ||
    (options.mcpServers && options.mcpServers.length > 0);
  if (!shouldEnableTools) return null;

  // ToolService requires EventBus; over-provide the runtime's shared
  // EventBus instance so the tool layer joins the runtime's singleton bus.
  // User risk-level overrides are the single application point for
  // `.withTools({ riskLevels })`: every reader of tool definitions in a run
  // (engine listTools → kernel ToolSchema) goes through this service.
  const riskLevels = options.riskLevels;
  const baseToolsLayer =
    riskLevels && Object.keys(riskLevels).length > 0
      ? Layer.effect(
          ToolService,
          ToolService.pipe(Effect.map((ts) => withRiskLevelOverrides(ts, riskLevels))),
        ).pipe(Layer.provide(createToolsLayer()), Layer.provide(eventBusLayer))
      : createToolsLayer().pipe(Layer.provide(eventBusLayer));

  if (!options.allowedTools || options.allowedTools.length === 0) {
    return baseToolsLayer;
  }

  // Normalize entries: trim whitespace so typos like `" recall"` don't silently
  // reject the legitimate `recall` tool. Keeping the comparison lenient here is
  // safer than making users debug invisible whitespace; `checkAllowedToolsMismatch`
  // at bootstrap surfaces the normalized→registered match for visibility.
  // Meta-tools (recall, write_result_to_file, brief, pulse, …) bypass the user
  // allowlist at EXECUTION, mirroring the kernel guard's unconditional META_TOOLS
  // bypass (guard.ts:84). Without this, setting an explicit allowedTools silently
  // blocks every meta-tool at ToolService.execute even though it is offered to the
  // model — the bug that hid write_result_to_file behind "not in the allowed tools list".
  const allowed = new Set([
    ...options.allowedTools.map((name) => name.trim()).filter((name) => name.length > 0),
    ...META_TOOLS,
  ]);

  return Layer.effect(
    ToolService,
    Effect.gen(function* () {
      // Get the underlying ToolService from the base layer
      const base = yield* ToolService.pipe(Effect.provide(baseToolsLayer));

      return {
        execute: (input: import("@reactive-agents/tools").ToolInput) => {
          if (!allowed.has(input.toolName)) {
            return Effect.fail(
              new ToolNotFoundError({
                message: `Tool "${input.toolName}" is not in the allowed tools list`,
                toolName: input.toolName,
              }),
            );
          }
          return base.execute(input);
        },
        register: base.register,
        connectMCPServer: base.connectMCPServer,
        disconnectMCPServer: base.disconnectMCPServer,
        listTools: (filter?: { category?: string; source?: string; riskLevel?: string }) =>
          base.listTools(filter).pipe(
            Effect.map((tools) => tools.filter((t) => allowed.has(t.name))),
          ),
        getTool: (name: string) => {
          if (!allowed.has(name)) {
            return Effect.fail(
              new ToolNotFoundError({
                message: `Tool "${name}" is not in the allowed tools list`,
                toolName: name,
              }),
            );
          }
          return base.getTool(name);
        },
        toFunctionCallingFormat: () =>
          base.toFunctionCallingFormat().pipe(
            Effect.map((tools) => tools.filter((t) => allowed.has(t.name))),
          ),
        listMCPServers: base.listMCPServers,
        unregisterTool: base.unregisterTool,
      };
    }),
  ).pipe(Layer.provide(baseToolsLayer));
}
