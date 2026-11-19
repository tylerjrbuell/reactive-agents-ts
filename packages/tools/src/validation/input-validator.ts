import { Effect } from "effect";

import type { ToolDefinition, ToolParameter } from "../types.js";
import { ToolValidationError } from "../errors.js";
import { healEnumArg } from "../skills/arg-healing.js";

/** Placeholder value for a parameter in an example call, by declared type. */
const exampleValue = (param: ToolParameter): unknown => {
  if (param.enum && param.enum.length > 0) return param.enum[0];
  if (param.default !== undefined) return param.default;
  if (param.type === "string") {
    // A description that carries a literal example ("Examples: 'ls -la'") is the
    // best sample value; otherwise show the parameter name as a placeholder.
    const quoted = /Examples?:\s*'([^']+)'/.exec(param.description);
    return quoted?.[1] ?? `<${param.name}>`;
  }
  if (param.type === "number") return 1;
  if (param.type === "boolean") return true;
  if (param.type === "array") return exampleArray(param);
  return {};
};

/**
 * Sample array for an example call. A literal JSON array in the description
 * ("e.g. [\"BTC\", \"ETH\"]") is the best sample; otherwise one placeholder
 * element of the declared item type. Never `[]`: an empty array teaches nothing.
 */
const exampleArray = (param: ToolParameter): unknown[] => {
  const literal = /e\.g\.\s*(\[[^\]]*\])/.exec(param.description);
  if (literal?.[1] !== undefined) {
    try {
      const parsed: unknown = JSON.parse(literal[1]);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed.slice(0, 2);
    } catch {
      // not valid JSON: fall through to the placeholder
    }
  }
  return param.items?.type === "string" ? [`<${param.name}>`] : [];
};

/**
 * One-line valid example call built from a tool's REQUIRED parameters, e.g.
 * `shell-execute({"command":"git log --oneline -5"})`. Appended to the
 * missing-parameter error so a model that sent `{}` sees the exact shape.
 */
export const exampleCall = (definition: ToolDefinition): string => {
  const args: Record<string, unknown> = {};
  for (const p of definition.parameters) {
    if (p.required) args[p.name] = exampleValue(p);
  }
  return `${definition.name}(${JSON.stringify(args)})`;
};

/**
 * Normalizes a tool call's raw `arguments` to an object at the execute
 * boundary. Missing or null arguments mean a zero-argument call and become
 * `{}` (a model calling `list_websites()` is legitimate). A non-object
 * (array, string, number, boolean) fails with a typed validation error that
 * names the tool and shows the expected object shape.
 */
export const normalizeToolArguments = (
  definition: ToolDefinition,
  raw: unknown,
): Effect.Effect<Record<string, unknown>, ToolValidationError> => {
  if (raw === undefined || raw === null) return Effect.succeed({});
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return Effect.succeed(raw as Record<string, unknown>);
  }
  const received = Array.isArray(raw) ? "array" : typeof raw;
  return Effect.fail(
    new ToolValidationError({
      message: `Tool "${definition.name}" expects its arguments as a JSON object keyed by parameter name, got ${received}. Valid call: ${exampleCall(definition)}`,
      toolName: definition.name,
      parameter: "arguments",
      expected: "object",
      received,
    }),
  );
};

/**
 * Validates and coerces a tool call's arguments against its definition.
 * Raw arguments go through {@link normalizeToolArguments} first, so missing
 * or null arguments validate as `{}`.
 */
export const validateToolInput = (
  definition: ToolDefinition,
  rawArgs: unknown,
): Effect.Effect<Record<string, unknown>, ToolValidationError> =>
  Effect.gen(function* () {
    const args = yield* normalizeToolArguments(definition, rawArgs);
    const validated: Record<string, unknown> = {};

    // Pre-check: detect unknown parameters BEFORE the per-param loop.
    // When a model passes wrong param names (e.g. "queries" instead of "query"),
    // the per-param loop would emit a generic "Missing required parameter" and stop.
    // Checking here lets us emit a much more helpful error with the correct signature.
    const knownNamesPre = new Set(definition.parameters.map((p) => p.name));
    const unknownKeysPre = Object.keys(args).filter((k) => !knownNamesPre.has(k));
    // A required param with a `default` is NOT missing — the default will be applied
    // in the per-param loop below. Excluding here keeps the "unknown + missing" error
    // consistent with the per-param behavior.
    const missingRequiredPre = definition.parameters.filter(
      (p) =>
        p.required &&
        p.default === undefined &&
        (args[p.name] === undefined || args[p.name] === null),
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

      // Treat null the same as undefined — many LLMs (especially smaller models)
      // emit "param": null for fields they intended to omit.
      if (value === undefined || value === null) {
        // Defaults win over "required": if a default is defined, apply it and
        // continue. A `required` param that also carries a default is effectively
        // "has a value" — the caller chose to provide one if the model didn't.
        if (param.default !== undefined) {
          validated[param.name] = param.default;
          continue;
        }

        if (param.required) {
          return yield* Effect.fail(
            new ToolValidationError({
              message: `Missing required parameter "${param.name}". Valid call: ${exampleCall(definition)}`,
              toolName: definition.name,
              parameter: param.name,
              expected: param.type,
              received: "undefined",
            }),
          );
        }

        continue;
      }

      // Coerce string → array: models (especially small ones) often pass "a,b" instead of ["a","b"]
      if (param.type === "array" && typeof value === "string") {
        validated[param.name] = value.split(",").map((s) => s.trim()).filter(Boolean);
        continue;
      }

      // Coerce stringified boolean: small models (qwen3.5, cogito) emit
      // `"full": "true"` instead of `"full": true`. Only accept canonical forms.
      if (param.type === "boolean" && typeof value === "string") {
        const lowered = value.trim().toLowerCase();
        if (lowered === "true" || lowered === "false") {
          validated[param.name] = lowered === "true";
          continue;
        }
      }

      // Coerce stringified number: same models often emit `"limit": "5"`.
      // Only accept clean numeric literals so non-numeric strings still fail
      // the type check below (preserves typo-detection behavior).
      if (param.type === "number" && typeof value === "string") {
        const trimmed = value.trim();
        if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
          validated[param.name] = Number(trimmed);
          continue;
        }
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

      // Enum check. A case/whitespace variant, or a word in the parameter's
      // closed `aliases` table, is rewritten to its canonical value first, so
      // declaring a value set as `enum` never costs a near-miss call that a
      // tool's own healing used to accept. Anything else still fails.
      if (param.enum && typeof value === "string" && !param.enum.includes(value)) {
        const healed = healEnumArg(value, param.enum, param.aliases);
        if (param.enum.includes(healed.value)) {
          validated[param.name] = healed.value;
          continue;
        }
      }
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
