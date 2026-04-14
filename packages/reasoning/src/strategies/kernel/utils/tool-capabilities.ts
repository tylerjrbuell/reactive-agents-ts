import { Effect } from "effect";
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
  scratchpadStoreRef,
  checkpointStoreRef,
  ragMemoryStore,
  webSearchHandler,
} from "@reactive-agents/tools";
import type { KernelMetaToolsConfig } from "../../../types/kernel-meta-tools.js";
import type { ToolSchema } from "./tool-formatting.js";

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
          .pipe(Effect.catchAll(() => Effect.void));
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
          .pipe(Effect.catchAll(() => Effect.void));
        append(toToolSchema(findTool));
      }

      if (input.metaTools?.checkpoint) {
        yield* toolService
          .register(checkpointTool, makeCheckpointHandler(checkpointStoreRef))
          .pipe(Effect.catchAll(() => Effect.void));
        append(toToolSchema(checkpointTool));
      }
    }

    return {
      availableToolSchemas: dedupeToolSchemas(available),
      allToolSchemas: dedupeToolSchemas(all),
    };
  });