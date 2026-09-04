import { Effect, Ref } from "effect";
import {
  ToolService,
  briefTool,
  pulseTool,
  todoTool,
  recallTool,
  makeRecallHandler,
  relateTool,
  makeRelateHandler,
  findTool,
  makeFindHandler,
  checkpointTool,
  makeCheckpointHandler,
  discoverToolsTool,
  makeDiscoverToolsHandler,
  writeResultToFileTool,
  makeWriteResultToFileHandler,
  discoveredToolsStoreRef,
  scratchpadStoreRef,
  checkpointStoreRef,
  ragMemoryStore,
  webSearchHandler,
} from "@reactive-agents/tools";
import type { KernelMetaToolsConfig } from "../../../types/kernel-meta-tools.js";
import type { ToolSchema } from "../attend/tool-formatting.js";
import { emitErrorSwallowed, errorTag, AgentMemory } from "@reactive-agents/core";
import { resolveHarnessConfig, type ResolvedHarness } from "../../../harness-config.js";

type ToolCapabilitySnapshot = {
  readonly availableToolSchemas: readonly ToolSchema[];
  readonly allToolSchemas: readonly ToolSchema[];
};

function toToolSchema(definition: {
  readonly name: string;
  readonly description: string;
  readonly parameters: readonly {
    readonly name: string;
    readonly type: string;
    readonly description?: string;
    readonly required?: boolean;
  }[];
}): ToolSchema {
  return {
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters.map((parameter) => ({
      name: parameter.name,
      type: parameter.type,
      description: parameter.description ?? "",
      required: Boolean(parameter.required),
    })),
    // Every caller of this helper appends a schema ONLY when the caller
    // explicitly opted in (`input.metaTools?.brief` etc.) — these are
    // genuinely user-configured, model-callable tools, not harness-internal
    // protocol tools. Without this, P2's native-FC wire filter
    // (think.ts:746, `ts.scope !== "harness" && !META_TOOL_SET.has(ts.name)`)
    // strips them unconditionally because `META_TOOLS` (kernel-constants.ts)
    // lists brief/pulse/todo/find/recall/checkpoint alongside the TRUE
    // protocol-only tools (final-answer, discover-tools) it was meant to
    // catch — silently dropping an explicitly-configured tool from the wire
    // regardless of `.withMetaTools()`.
    scope: "domain",
  };
}

function dedupeToolSchemas(schemas: readonly ToolSchema[]): readonly ToolSchema[] {
  const deduped = new Map<string, ToolSchema>();
  for (const schema of schemas) {
    deduped.set(schema.name, schema);
  }
  return [...deduped.values()];
}

export const resolveExecutableToolCapabilities = (input: {
  readonly availableToolSchemas?: readonly ToolSchema[];
  readonly allToolSchemas?: readonly ToolSchema[];
  readonly metaTools?: KernelMetaToolsConfig;
  /** Resolved harness config for this pass (`KernelInput.harness`, Task 3). */
  readonly harness?: ResolvedHarness;
}): Effect.Effect<ToolCapabilitySnapshot, never> =>
  Effect.gen(function* () {
    const h = input.harness ?? resolveHarnessConfig();
    const available = [...(input.availableToolSchemas ?? [])];
    const all = [...(input.allToolSchemas ?? input.availableToolSchemas ?? [])];

    const append = (schema: ToolSchema): void => {
      available.push(schema);
      all.push(schema);
    };

    if (input.metaTools?.brief) append(toToolSchema(briefTool));
    if (input.metaTools?.pulse) append(toToolSchema(pulseTool));
    if (input.metaTools?.todo) append(toToolSchema(todoTool));

    const toolServiceOpt = yield* Effect.serviceOption(ToolService);
    if (toolServiceOpt._tag === "Some") {
      const toolService = toolServiceOpt.value;

      // Reset discovered-set at the start of each run (idempotent across
      // re-resolutions; the kernel calls resolveExecutableToolCapabilities
      // once per run). Fixed 2026-08-19: this used to live inside the
      // `h.toolDiscovery` branch below, so a run with
      // RA_TOOL_DISCOVERY=0 never reset it — a PRIOR run's discovered set
      // (in the same process) leaked forward and widened tool-surface.ts's
      // visibility floor for every later discovery-off run. `discovered` is
      // consumed unconditionally by tool-surface.ts regardless of whether
      // discover-tools itself is registered (it also backs the lightweight
      // tool-index, RA_TOOL_INDEX), so the reset must be unconditional too.
      yield* Ref.set(discoveredToolsStoreRef, new Set<string>());

      if (input.metaTools?.recall) {
        yield* toolService
          .register(recallTool, makeRecallHandler(scratchpadStoreRef, input.metaTools.recallConfig))
          .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/kernel/capabilities/act/tool-capabilities.ts:79", tag: errorTag(err) })));
        append(toToolSchema(recallTool));
      }

      // `relate` — only registered when BOTH the caller opted in AND a
      // memory adapter implementing `getRelated` is actually present (e.g.
      // `.withMemory()`'s Zettelkasten-backed adapter). Requesting it with
      // no such adapter is silently a no-op (matches find's webFallback
      // precedent) — not an error, since the caller may share a builder
      // config across agents where memory is optional.
      if (input.metaTools?.relate) {
        const agentMemoryOpt = yield* Effect.serviceOption(AgentMemory);
        if (agentMemoryOpt._tag === "Some" && agentMemoryOpt.value.getRelated) {
          const getRelated = agentMemoryOpt.value.getRelated;
          yield* toolService
            .register(relateTool, makeRelateHandler({ getRelated }))
            .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/kernel/capabilities/act/tool-capabilities.ts:relate", tag: errorTag(err) })));
          append(toToolSchema(relateTool));
        }
      }

      if (input.metaTools?.writeResultToFile) {
        yield* toolService
          .register(writeResultToFileTool, makeWriteResultToFileHandler(scratchpadStoreRef))
          .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/kernel/capabilities/act/tool-capabilities.ts:92", tag: errorTag(err) })));
        append(toToolSchema(writeResultToFileTool));
      }

      if (input.metaTools?.find) {
        yield* toolService
          .register(
            findTool,
            makeFindHandler({
              ragStore: ragMemoryStore,
              webSearchHandler,
              recallStoreRef: scratchpadStoreRef,
              config: {},
            }),
          )
          .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/kernel/capabilities/act/tool-capabilities.ts:94", tag: errorTag(err) })));
        append(toToolSchema(findTool));
      }

      if (input.metaTools?.checkpoint) {
        yield* toolService
          .register(checkpointTool, makeCheckpointHandler(checkpointStoreRef))
          .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/kernel/capabilities/act/tool-capabilities.ts:101", tag: errorTag(err) })));
        append(toToolSchema(checkpointTool));
      }

      // Lazy-tool-disclosure escape hatch. When the agent's visible schema is
      // pruned (required + relevant + meta-tools), `discover-tools` lets the
      // model surface anything else it needs at runtime. Schemas already carry
      // name/description/parameters — pass them straight through.
      // Default-on as of 2026-04-26 (curator empirical validation —
      // wiki/Research/Harness-Reports/bare-vs-harness-curation-2026-04-26.md). Opt out via
      // RA_LAZY_TOOLS=0 for backward compatibility while downstream agents
      // adapt.
      if (h.toolDiscovery) {
        const catalog = input.allToolSchemas ?? [];
        yield* toolService
          .register(
            discoverToolsTool,
            makeDiscoverToolsHandler({
              getAllToolDefinitions: () => catalog,
              discoveredRef: discoveredToolsStoreRef,
            }),
          )
          .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/kernel/capabilities/act/tool-capabilities.ts:discover-tools", tag: errorTag(err) })));
        append(toToolSchema(discoverToolsTool));
      }
    }

    return {
      availableToolSchemas: dedupeToolSchemas(available),
      allToolSchemas: dedupeToolSchemas(all),
    };
  });