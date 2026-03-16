import { Effect, Schema, ParseResult } from "effect";
import { AST } from "effect";
import type { ToolDefinition, ToolParameter } from "./types.js";
import { ToolExecutionError } from "./errors.js";

// ─── Types ───

/**
 * Options for defineTool — combines ToolDefinition metadata with a typed handler.
 *
 * @typeParam A - The decoded type of the input schema (inferred automatically)
 */
export interface DefineToolOptions<A> {
  /** Tool name — unique identifier used to invoke it. */
  name: string;
  /** Human-readable description shown to the LLM. */
  description: string;
  /** Effect Schema describing the tool's input parameters. */
  input: Schema.Schema<A, Record<string, unknown>>;
  /** Typed handler that receives decoded (validated) args and returns an Effect. */
  handler: (args: A) => Effect.Effect<unknown, unknown>;
  /** Risk level. Defaults to "low". */
  riskLevel?: ToolDefinition["riskLevel"];
  /** Execution timeout in ms. Defaults to 30,000. */
  timeoutMs?: number;
  /** Whether a human must approve execution. Defaults to false. */
  requiresApproval?: boolean;
  /** Functional category for discovery. */
  category?: ToolDefinition["category"];
  /** Human-readable return type description. */
  returnType?: string;
  /** Whether results can be cached. */
  isCacheable?: boolean;
  /** Custom cache TTL in ms. */
  cacheTtlMs?: number;
}

/**
 * The result of defineTool — a ToolDefinition with a validated wrapped handler.
 */
export interface DefinedTool {
  /** The ToolDefinition with parameters extracted from the input schema. */
  readonly definition: ToolDefinition;
  /**
   * Wrapped handler that validates raw args at runtime, then calls the typed handler.
   * Errors are mapped to ToolExecutionError.
   */
  readonly handler: (args: Record<string, unknown>) => Effect.Effect<unknown, ToolExecutionError>;
}

// ─── AST Walking ───

/**
 * Infer a ToolParameter type string from an Effect Schema AST node.
 * Unwraps Transformations and optional Unions to find the base type.
 */
function inferParamType(ast: AST.AST): ToolParameter["type"] {
  switch (ast._tag) {
    case "StringKeyword":
      return "string";
    case "NumberKeyword":
      return "number";
    case "BooleanKeyword":
      return "boolean";
    case "TupleType":
      return "array";
    case "TypeLiteral":
      return "object";
    case "Transformation":
      // Unwrap transformation to get the underlying type
      return inferParamType(ast.from);
    case "Union": {
      // For optional fields: Union(T, UndefinedKeyword) — find the non-undefined branch
      const nonUndefined = ast.types.find(t => t._tag !== "UndefinedKeyword");
      if (nonUndefined) {
        return inferParamType(nonUndefined);
      }
      return "string"; // fallback
    }
    case "Literal":
      // A single literal — determine its type by the literal value
      if (typeof ast.literal === "string") return "string";
      if (typeof ast.literal === "number") return "number";
      if (typeof ast.literal === "boolean") return "boolean";
      return "string";
    default:
      return "string"; // safe fallback for unknowns
  }
}

/**
 * Extract enum values from a Union of Literal AST nodes, if applicable.
 * Returns undefined if this is not a string-literal union.
 */
function inferEnumValues(ast: AST.AST): string[] | undefined {
  // Unwrap Transformation
  if (ast._tag === "Transformation") {
    return inferEnumValues(ast.from);
  }
  // For optional fields: Union(T, UndefinedKeyword)
  if (ast._tag === "Union") {
    const nonUndefined = ast.types.filter(t => t._tag !== "UndefinedKeyword");
    // Only one non-undefined branch — recurse into it
    if (nonUndefined.length === 1) {
      return inferEnumValues(nonUndefined[0]!);
    }
    // Multiple non-undefined branches — could be a string-literal union (enum)
    if (nonUndefined.length > 1 && nonUndefined.every(t => t._tag === "Literal" && typeof (t as AST.Literal).literal === "string")) {
      return nonUndefined.map(t => String((t as AST.Literal).literal));
    }
    return undefined;
  }
  return undefined;
}

/**
 * Walk a Schema.Struct AST to extract ToolParameter[] metadata.
 * Handles required and optional fields, type inference, and enum values.
 */
function schemaToParameters(schema: Schema.Schema<unknown>): ToolParameter[] {
  const ast = schema.ast;

  // Walk into Transformation to get the TypeLiteral
  const typeLiteral = ast._tag === "Transformation" ? ast.from : ast;

  if (typeLiteral._tag !== "TypeLiteral") {
    return [];
  }

  return typeLiteral.propertySignatures.map((prop): ToolParameter => {
    const name = String(prop.name);
    const isOptional = prop.isOptional;
    const paramType = inferParamType(prop.type);
    const enumValues = inferEnumValues(prop.type);

    const param: ToolParameter = {
      name,
      type: paramType,
      description: `${name} parameter`,
      required: !isOptional,
    };

    if (enumValues !== undefined) {
      return { ...param, enum: enumValues };
    }

    return param;
  });
}

// ─── defineTool ───

/**
 * Type-safe tool factory that uses Effect Schema to infer handler argument types.
 *
 * - Extracts `ToolParameter[]` metadata from the Schema AST automatically
 * - Wraps the handler to validate raw args at runtime via `Schema.decodeUnknown`
 * - Maps validation errors to `ToolExecutionError`
 *
 * @example
 * ```typescript
 * const searchTool = defineTool({
 *   name: "search",
 *   description: "Search the web",
 *   input: Schema.Struct({
 *     query: Schema.String,
 *     maxResults: Schema.optional(Schema.Number),
 *   }),
 *   handler: (args) => {
 *     // args is typed as { query: string; maxResults?: number }
 *     return Effect.succeed(`Results for: ${args.query}`);
 *   },
 * });
 * // searchTool.definition — ToolDefinition
 * // searchTool.handler    — (args: Record<string, unknown>) => Effect<unknown, ToolExecutionError>
 * ```
 */
export function defineTool<A>(options: DefineToolOptions<A>): DefinedTool {
  const {
    name,
    description,
    input,
    handler,
    riskLevel = "low",
    timeoutMs = 30_000,
    requiresApproval = false,
    category,
    returnType,
    isCacheable,
    cacheTtlMs,
  } = options;

  // Extract parameters from Schema AST
  const parameters = schemaToParameters(input as Schema.Schema<unknown>);

  // Build the ToolDefinition
  const definition: ToolDefinition = {
    name,
    description,
    parameters,
    riskLevel,
    timeoutMs,
    requiresApproval,
    source: "function",
    ...(category !== undefined ? { category } : {}),
    ...(returnType !== undefined ? { returnType } : {}),
    ...(isCacheable !== undefined ? { isCacheable } : {}),
    ...(cacheTtlMs !== undefined ? { cacheTtlMs } : {}),
  };

  // Build the runtime-validated handler wrapper
  const decode = Schema.decodeUnknown(input as Schema.Schema<A, Record<string, unknown>>);

  const wrappedHandler = (
    rawArgs: Record<string, unknown>,
  ): Effect.Effect<unknown, ToolExecutionError> =>
    decode(rawArgs).pipe(
      Effect.flatMap(handler),
      Effect.mapError((err) =>
        new ToolExecutionError({
          message:
            err instanceof ParseResult.ParseError
              ? ParseResult.TreeFormatter.formatErrorSync(err)
              : String(err),
          toolName: name,
          input: rawArgs,
          cause: err,
        }),
      ),
    );

  return { definition, handler: wrappedHandler };
}
