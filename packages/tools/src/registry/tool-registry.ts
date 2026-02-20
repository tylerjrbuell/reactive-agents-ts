import { Effect, Ref } from "effect";

import type { ToolDefinition, FunctionCallingTool } from "../types.js";
import { ToolNotFoundError, ToolExecutionError } from "../errors.js";

export interface RegisteredTool {
  readonly definition: ToolDefinition;
  readonly handler: (
    args: Record<string, unknown>,
  ) => Effect.Effect<unknown, ToolExecutionError>;
}

export const makeToolRegistry = Effect.gen(function* () {
  const toolsRef = yield* Ref.make<Map<string, RegisteredTool>>(new Map());

  const register = (
    definition: ToolDefinition,
    handler: (
      args: Record<string, unknown>,
    ) => Effect.Effect<unknown, ToolExecutionError>,
  ): Effect.Effect<void, never> =>
    Ref.update(toolsRef, (tools) => {
      const newTools = new Map(tools);
      newTools.set(definition.name, { definition, handler });
      return newTools;
    });

  const get = (
    name: string,
  ): Effect.Effect<RegisteredTool, ToolNotFoundError> =>
    Effect.gen(function* () {
      const tools = yield* Ref.get(toolsRef);
      const tool = tools.get(name);
      if (!tool) {
        const available = [...tools.keys()];
        return yield* Effect.fail(
          new ToolNotFoundError({
            message: `Tool "${name}" not found`,
            toolName: name,
            availableTools: available,
          }),
        );
      }
      return tool;
    });

  const list = (filter?: {
    category?: string;
    source?: string;
    riskLevel?: string;
  }): Effect.Effect<readonly ToolDefinition[], never> =>
    Effect.gen(function* () {
      const tools = yield* Ref.get(toolsRef);
      let definitions = [...tools.values()].map((t) => t.definition);

      if (filter?.category)
        definitions = definitions.filter((d) => d.category === filter.category);
      if (filter?.source)
        definitions = definitions.filter((d) => d.source === filter.source);
      if (filter?.riskLevel)
        definitions = definitions.filter(
          (d) => d.riskLevel === filter.riskLevel,
        );

      return definitions;
    });

  const toFunctionCallingFormat = (): Effect.Effect<
    readonly FunctionCallingTool[],
    never
  > =>
    Effect.gen(function* () {
      const tools = yield* Ref.get(toolsRef);
      return [...tools.values()].map((t) => ({
        name: t.definition.name,
        description: t.definition.description,
        input_schema: {
          type: "object" as unknown,
          properties: Object.fromEntries(
            t.definition.parameters.map((p) => [
              p.name,
              {
                type: p.type,
                description: p.description,
                ...(p.enum ? { enum: p.enum } : {}),
              },
            ]),
          ) as Record<string, unknown>,
          required: t.definition.parameters
            .filter((p) => p.required)
            .map((p) => p.name),
        } as Record<string, unknown>,
      }));
    });

  return { register, get, list, toFunctionCallingFormat };
});
