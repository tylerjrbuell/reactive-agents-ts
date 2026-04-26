import { Effect, Ref } from "effect";
import {
  ToolService,
  briefTool,
  pulseTool,
  recallTool,
  makeRecallHandler,
  findTool,
  makeFindHandler,
  checkpointTool,
  makeCheckpointHandler,
  discoverToolsTool,
  makeDiscoverToolsHandler,
  discoveredToolsStoreRef,
  scratchpadStoreRef,
  checkpointStoreRef,
  ragMemoryStore,
  webSearchHandler,
} from "@reactive-agents/tools";
import type { KernelMetaToolsConfig } from "../../../types/kernel-meta-tools.js";
import type { ToolSchema } from "../attend/tool-formatting.js";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";

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
}): Effect.Effect<ToolCapabilitySnapshot, never> =>
  Effect.gen(function* () {
    const available = [...(input.availableToolSchemas ?? [])];
    const all = [...(input.allToolSchemas ?? input.availableToolSchemas ?? [])];

    const append = (schema: ToolSchema): void => {
      available.push(schema);
      all.push(schema);
    };

    if (input.metaTools?.brief) append(toToolSchema(briefTool));
    if (input.metaTools?.pulse) append(toToolSchema(pulseTool));

    const toolServiceOpt = yield* Effect.serviceOption(ToolService);
    if (toolServiceOpt._tag === "Some") {
      const toolService = toolServiceOpt.value;

      if (input.metaTools?.recall) {
        yield* toolService
          .register(recallTool, makeRecallHandler(scratchpadStoreRef))
          .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/kernel/capabilities/act/tool-capabilities.ts:79", tag: errorTag(err) })));
        append(toToolSchema(recallTool));
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
      // harness-reports/bare-vs-harness-curation-2026-04-26.md). Opt out via
      // RA_LAZY_TOOLS=0 for backward compatibility while downstream agents
      // adapt.
      if (process.env.RA_LAZY_TOOLS !== "0") {
        // Reset discovered-set at the start of each run (idempotent across
        // re-resolutions). The kernel calls resolveExecutableToolCapabilities
        // once per run, so this fires on initial wiring.
        yield* Ref.set(discoveredToolsStoreRef, new Set<string>());

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