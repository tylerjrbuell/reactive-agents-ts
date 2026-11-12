/**
 * Typed input parameters for a `.withAgentTool()` sub-agent.
 *
 * `agent.parameters` is either a `ToolParameter` list (code) or a JSON Schema
 * object (plain data, so it survives `AgentConfig`). Both end up in two places:
 *
 *  - the tool definition's `parameters`, which the parent model sees; and
 *  - for a JSON Schema, a call-time check of the arguments, so an invalid call
 *    fails with a `SubAgentInputError` before any sub-agent runs.
 *
 * The check uses the JSON Schema validator behind `.withOutputSchema()`
 * (`engine/finalize/json-schema-contract.ts`); the schema is compiled once, when
 * the tool is declared.
 */
import { Effect, Predicate } from "effect";
import type { ToolParameter } from "@reactive-agents/tools";
import {
  jsonSchemaIssues,
  type JsonSchemaObject,
} from "../../engine/finalize/json-schema-contract.js";
import { SubAgentInputError, SubAgentParametersError } from "../../errors/sub-agent-parameters-error.js";

/** What `agent.parameters` accepts: a `ToolParameter` list or a JSON Schema object. */
export type SubAgentParameters = ReadonlyArray<ToolParameter> | JsonSchemaObject;

/** Arguments every sub-agent tool takes that a declared schema does not have to list. */
const CATCH_ALL_ARGS = ["input", "message", "tools"] as const;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const PARAM_TYPES: ReadonlySet<string> = new Set(["string", "number", "boolean", "object", "array"]);

/** The `ToolParameter` type for a JSON Schema `type` (integer is a number; a type list takes its first non-null member). */
const toolParamType = (type: unknown): ToolParameter["type"] => {
  const first = (Array.isArray(type) ? type : [type]).find((t) => t !== "null");
  if (first === "integer") return "number";
  return typeof first === "string" && PARAM_TYPES.has(first) ? (first as ToolParameter["type"]) : "string";
};

/**
 * The `ToolParameter` list the parent model sees for `parameters`. A list passes
 * through; a JSON Schema contributes one entry per top-level property (nested
 * constraints stay in the schema and are enforced when the tool is called).
 */
export const toToolParameters = (parameters: SubAgentParameters | undefined): ReadonlyArray<ToolParameter> => {
  if (parameters === undefined) return [];
  if (Array.isArray(parameters)) return parameters;
  const schema = parameters as JsonSchemaObject;
  const props = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((r): r is string => typeof r === "string") : []);
  return Object.entries(props).map(([name, raw]): ToolParameter => {
    const prop = isRecord(raw) ? raw : {};
    const type = toolParamType(prop.type);
    const enumValues = Array.isArray(prop.enum) && prop.enum.every((e) => typeof e === "string") ? (prop.enum as string[]) : undefined;
    const itemType = isRecord(prop.items) && typeof prop.items.type === "string" ? prop.items.type : undefined;
    return {
      name,
      type,
      description: typeof prop.description === "string" ? prop.description : typeof prop.title === "string" ? prop.title : name,
      required: required.has(name),
      ...(prop.default !== undefined ? { default: prop.default } : {}),
      ...(enumValues ? { enum: enumValues } : {}),
      ...(type === "array" && itemType ? { items: { type: itemType } } : {}),
    };
  });
};

/**
 * `parameters` as a JSON Schema object (what `AgentConfig` stores). A JSON Schema
 * passes through; a `ToolParameter` list becomes an object schema.
 */
export const parametersToJsonSchema = (parameters: SubAgentParameters): JsonSchemaObject => {
  if (!Array.isArray(parameters)) return parameters as JsonSchemaObject;
  const list = parameters as ReadonlyArray<ToolParameter>;
  return {
    type: "object",
    properties: Object.fromEntries(
      list.map((p) => [
        p.name,
        {
          type: p.type,
          description: p.description,
          ...(p.enum ? { enum: [...p.enum] } : {}),
          ...(p.default !== undefined ? { default: p.default } : {}),
          ...(p.type === "array" ? { items: p.items ?? { type: "string" } } : {}),
        },
      ]),
    ),
    required: list.filter((p) => p.required).map((p) => p.name),
  };
};

/**
 * Compile a JSON Schema `parameters` into a call-time checker. Called when the
 * tool is declared, so a bad schema is refused there.
 *
 * @throws SubAgentParametersError for a schema that is not an object schema or
 *   that uses a keyword the validator cannot check faithfully.
 */
export const compileSubAgentInputCheck = (
  toolName: string,
  schema: JsonSchemaObject,
): ((args: Record<string, unknown>) => ReadonlyArray<string>) => {
  if (schema.type !== undefined && schema.type !== "object") {
    throw new SubAgentParametersError({
      toolName,
      message: `withAgentTool("${toolName}", { parameters }): the JSON Schema must describe an object (type: "object"), got type ${JSON.stringify(schema.type)}.`,
    });
  }
  let check: (value: unknown) => ReadonlyArray<string>;
  try {
    check = jsonSchemaIssues(schema);
  } catch (e) {
    // The validator names `withOutputSchema()` in its refusal; restate it for this wither.
    if (Predicate.isTagged(e, "OutputSchemaError") && Predicate.hasProperty(e, "message") && typeof e.message === "string") {
      throw new SubAgentParametersError({
        toolName,
        message: `withAgentTool("${toolName}", { parameters }): ${e.message.replace(/^Unsupported JSON Schema for withOutputSchema\(\): /, "unsupported JSON Schema: ")}`,
      });
    }
    throw e;
  }
  const declared = isRecord(schema.properties) ? schema.properties : {};
  return (args) => {
    // `input`, `message` and `tools` are the tool's own catch-all arguments; a
    // schema with `additionalProperties: false` must not reject them.
    const own = Object.fromEntries(
      Object.entries(args).filter(([k]) => !(CATCH_ALL_ARGS as readonly string[]).includes(k) || k in declared),
    );
    return check(own);
  };
};

/**
 * Check a call's arguments with a compiled checker: succeeds with nothing, or
 * fails with a `SubAgentInputError` naming every violation.
 */
export const validateSubAgentInput = (
  toolName: string,
  check: (args: Record<string, unknown>) => ReadonlyArray<string>,
  args: Record<string, unknown>,
): Effect.Effect<void, SubAgentInputError> => {
  const issues = check(args);
  return issues.length === 0
    ? Effect.void
    : Effect.fail(
        new SubAgentInputError({
          toolName,
          issues,
          message: `Invalid input for sub-agent tool "${toolName}": ${issues.join("; ")}`,
        }),
      );
};
