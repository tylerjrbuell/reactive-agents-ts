import { Effect } from "effect";

import type { ToolDefinition } from "../types.js";
import { ToolValidationError } from "../errors.js";

export const validateToolInput = (
  definition: ToolDefinition,
  args: Record<string, unknown>,
): Effect.Effect<Record<string, unknown>, ToolValidationError> =>
  Effect.gen(function* () {
    const validated: Record<string, unknown> = {};

    for (const param of definition.parameters) {
      const value = args[param.name];

      // Check required
      if (param.required && (value === undefined || value === null)) {
        return yield* Effect.fail(
          new ToolValidationError({
            message: `Missing required parameter "${param.name}"`,
            toolName: definition.name,
            parameter: param.name,
            expected: param.type,
            received: "undefined",
          }),
        );
      }

      if (value === undefined) {
        if (param.default !== undefined) {
          validated[param.name] = param.default;
        }
        continue;
      }

      // Type check
      const actualType = Array.isArray(value) ? "array" : typeof value;
      if (
        actualType !== param.type &&
        !(param.type === "object" && actualType === "object")
      ) {
        return yield* Effect.fail(
          new ToolValidationError({
            message: `Parameter "${param.name}" expected ${param.type}, got ${actualType}`,
            toolName: definition.name,
            parameter: param.name,
            expected: param.type,
            received: actualType,
          }),
        );
      }

      // Enum check
      if (
        param.enum &&
        typeof value === "string" &&
        !param.enum.includes(value)
      ) {
        return yield* Effect.fail(
          new ToolValidationError({
            message: `Parameter "${param.name}" must be one of: ${param.enum.join(", ")}`,
            toolName: definition.name,
            parameter: param.name,
            expected: param.enum.join(" | "),
            received: String(value),
          }),
        );
      }

      validated[param.name] = value;
    }

    return validated;
  });
