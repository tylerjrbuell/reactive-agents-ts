import { Effect } from "effect";

import type { ToolDefinition } from "../types.js";
import { ToolValidationError } from "../errors.js";

export const validateToolInput = (
  definition: ToolDefinition,
  args: Record<string, unknown>,
): Effect.Effect<Record<string, unknown>, ToolValidationError> =>
  Effect.gen(function* () {
    const validated: Record<string, unknown> = {};

    // Pre-check: detect unknown parameters BEFORE the per-param loop.
    // When a model passes wrong param names (e.g. "queries" instead of "query"),
    // the per-param loop would emit a generic "Missing required parameter" and stop.
    // Checking here lets us emit a much more helpful error with the correct signature.
    const knownNamesPre = new Set(definition.parameters.map((p) => p.name));
    const unknownKeysPre = Object.keys(args).filter((k) => !knownNamesPre.has(k));
    const missingRequiredPre = definition.parameters.filter(
      (p) => p.required && (args[p.name] === undefined || args[p.name] === null),
    );
    if (unknownKeysPre.length > 0 && missingRequiredPre.length > 0) {
      const validSig = definition.parameters
        .map((p) => `${p.name}: ${p.type}${p.required ? "" : "?"}`)
        .join(", ");
      const unknown = unknownKeysPre.join(", ");
      return yield* Effect.fail(
        new ToolValidationError({
          message: `Missing required parameter "${missingRequiredPre[0].name}". Unknown parameter(s) passed: ${unknown}. Valid call: ${definition.name}(${validSig}). To call multiple times in parallel, use one call per item in the same response.`,
          toolName: definition.name,
          parameter: missingRequiredPre[0].name,
          expected: missingRequiredPre[0].type,
          received: "undefined",
        }),
      );
    }

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

      // Treat null the same as undefined for optional params.
      // Many LLMs (especially smaller models) emit "param": null for optional fields.
      if (value === undefined || value === null) {
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
