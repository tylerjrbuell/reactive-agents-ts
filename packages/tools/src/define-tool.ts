import { Effect, Schema, ParseResult, SchemaAST as AST } from "effect";
import type { ToolDefinition, ToolParameter } from "./types.js";
import { ToolExecutionError, ToolDefinitionError } from "./errors.js";
import { type StandardSchemaV1, isStandardSchema } from "./standard-schema.js";

// ─── Types ───

/**
 * Any schema accepted by {@link defineTool} as the `input` field.
 *
 * - An Effect `Schema.Schema<A, I>` (canonical — full parameter metadata is
 *   extracted from the AST), or
 * - Any Standard Schema (Zod, Valibot, ArkType, or
 *   `Schema.standardSchemaV1(...)`) — validated via the `~standard` interface,
 *   with best-effort parameter metadata extraction for Zod and Valibot.
 *
 * The decoded (output) type `A` is inferred automatically and flows into the
 * handler's `args` parameter.
 */
export type ToolSchema<A> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | Schema.Schema<A, any, never>
  | StandardSchemaV1<unknown, A>;

/**
 * Handler for a tool. May return:
 * - a plain value (`T`),
 * - a `Promise<T>` (the canonical ergonomic form — write a normal `async` fn),
 * - or an `Effect.Effect<T, E>` (the advanced form, for Effect-native authors).
 *
 * All three are normalised to `Effect.Effect<unknown, ToolExecutionError>` at
 * runtime — thrown errors and rejected promises become `ToolExecutionError`.
 */
export type ToolHandler<A> = (
  args: A,
) => Effect.Effect<unknown, unknown> | Promise<unknown> | unknown;

/**
 * Options for defineTool — combines ToolDefinition metadata with a typed handler.
 *
 * @typeParam A - The decoded type of the input schema (inferred automatically).
 */
export interface DefineToolOptions<A> {
  /** Tool name — unique identifier used to invoke it. */
  name: string;
  /** Human-readable description shown to the LLM. */
  description: string;
  /**
   * Schema describing the tool's input parameters. Accepts an Effect
   * `Schema.Struct` (canonical) or any Standard Schema (Zod / Valibot /
   * ArkType). The decoded type is inferred and passed to the handler.
   */
  input: ToolSchema<A>;
  /**
   * Handler that receives the decoded (validated) args. Write a plain
   * `async (args) => ...` for the ergonomic path, or return an `Effect` for
   * the advanced path — both are supported.
   */
  handler: ToolHandler<A>;
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
 * Structurally assignable to the `tools` array entry expected by
 * `.withTools({ tools: [...] })`.
 */
export interface DefinedTool {
  /** The ToolDefinition with parameters extracted from the input schema. */
  readonly definition: ToolDefinition;
  /**
   * Wrapped handler that validates raw args at runtime, then calls the typed
   * handler. Errors are mapped to ToolExecutionError.
   */
  readonly handler: (
    args: Record<string, unknown>,
  ) => Effect.Effect<unknown, ToolExecutionError>;
}

// ─── AST Walking (Effect Schema) ───

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
      return inferParamType(ast.from);
    case "Union": {
      const nonUndefined = ast.types.find((t: AST.AST) => t._tag !== "UndefinedKeyword");
      if (nonUndefined) {
        return inferParamType(nonUndefined);
      }
      return "string";
    }
    case "Literal":
      if (typeof ast.literal === "string") return "string";
      if (typeof ast.literal === "number") return "number";
      if (typeof ast.literal === "boolean") return "boolean";
      return "string";
    default:
      return "string";
  }
}

/**
 * Extract enum values from a Union of Literal AST nodes, if applicable.
 * Returns undefined if this is not a string-literal union.
 */
function inferEnumValues(ast: AST.AST): string[] | undefined {
  if (ast._tag === "Transformation") {
    return inferEnumValues(ast.from);
  }
  if (ast._tag === "Union") {
    const nonUndefined = ast.types.filter((t: AST.AST) => t._tag !== "UndefinedKeyword");
    if (nonUndefined.length === 1) {
      return inferEnumValues(nonUndefined[0]!);
    }
    if (
      nonUndefined.length > 1 &&
      nonUndefined.every(
        (t: AST.AST) => t._tag === "Literal" && typeof (t as AST.Literal).literal === "string",
      )
    ) {
      return nonUndefined.map((t: AST.AST) => String((t as AST.Literal).literal));
    }
    return undefined;
  }
  return undefined;
}

/** Read an Effect Schema AST node off a value, if present. */
function getSchemaAst(input: unknown): AST.AST | undefined {
  // Effect schemas are callable — `typeof` is "function", not "object".
  if ((typeof input !== "object" && typeof input !== "function") || input === null) {
    return undefined;
  }
  const ast = (input as Record<string, unknown>).ast;
  if (typeof ast === "object" && ast !== null && "_tag" in ast) {
    return ast as AST.AST;
  }
  return undefined;
}

/**
 * Walk a Schema.Struct AST to extract ToolParameter[] metadata.
 * Handles required and optional fields, type inference, and enum values.
 */
function astToParameters(ast: AST.AST): ToolParameter[] {
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

// ─── Zod introspection (best-effort) ───

function zodDef(field: unknown): Record<string, unknown> | undefined {
  if (typeof field !== "object" || field === null) return undefined;
  const def = (field as Record<string, unknown>)._def;
  return typeof def === "object" && def !== null ? (def as Record<string, unknown>) : undefined;
}

/** Resolve `{ type, required, enum? }` for a single Zod field, unwrapping wrappers. */
function zodFieldInfo(
  field: unknown,
  required = true,
): { type: ToolParameter["type"]; required: boolean; enum?: string[] } {
  const def = zodDef(field);
  const typeName = typeof def?.typeName === "string" ? def.typeName : undefined;
  switch (typeName) {
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
      return zodFieldInfo(def?.innerType, false);
    case "ZodEffects":
      return zodFieldInfo(def?.schema, required);
    case "ZodString":
      return { type: "string", required };
    case "ZodNumber":
      return { type: "number", required };
    case "ZodBoolean":
      return { type: "boolean", required };
    case "ZodArray":
      return { type: "array", required };
    case "ZodObject":
      return { type: "object", required };
    case "ZodEnum": {
      const values = Array.isArray(def?.values) ? def.values.map((x) => String(x)) : undefined;
      return values ? { type: "string", required, enum: values } : { type: "string", required };
    }
    case "ZodLiteral": {
      const val = def?.value;
      if (typeof val === "number") return { type: "number", required };
      if (typeof val === "boolean") return { type: "boolean", required };
      return { type: "string", required };
    }
    default:
      return { type: "string", required };
  }
}

function zodShapeToParameters(input: unknown): ToolParameter[] | undefined {
  const rec = input as Record<string, unknown>;
  let shape: Record<string, unknown> | undefined;
  if (typeof rec.shape === "object" && rec.shape !== null) {
    shape = rec.shape as Record<string, unknown>;
  } else {
    const def = zodDef(input);
    if (def && typeof def.shape === "function") {
      const s = (def.shape as () => unknown)();
      if (typeof s === "object" && s !== null) shape = s as Record<string, unknown>;
    }
  }
  if (!shape) return undefined;
  return Object.entries(shape).map(([name, field]): ToolParameter => {
    const info = zodFieldInfo(field);
    const param: ToolParameter = {
      name,
      type: info.type,
      description: `${name} parameter`,
      required: info.required,
    };
    return info.enum ? { ...param, enum: info.enum } : param;
  });
}

// ─── Valibot introspection (best-effort) ───

function valibotFieldInfo(
  field: unknown,
  required = true,
): { type: ToolParameter["type"]; required: boolean; enum?: string[] } {
  if (typeof field !== "object" || field === null) return { type: "string", required };
  const rec = field as Record<string, unknown>;
  const type = typeof rec.type === "string" ? rec.type : undefined;
  switch (type) {
    case "optional":
    case "nullable":
    case "nullish":
    case "exact_optional":
      return valibotFieldInfo(rec.wrapped, false);
    case "string":
      return { type: "string", required };
    case "number":
      return { type: "number", required };
    case "boolean":
      return { type: "boolean", required };
    case "array":
      return { type: "array", required };
    case "object":
      return { type: "object", required };
    case "picklist":
    case "enum": {
      const options = Array.isArray(rec.options) ? rec.options.map((x) => String(x)) : undefined;
      return options ? { type: "string", required, enum: options } : { type: "string", required };
    }
    default:
      return { type: "string", required };
  }
}

function valibotEntriesToParameters(input: unknown): ToolParameter[] | undefined {
  const entries = (input as Record<string, unknown>).entries;
  if (typeof entries !== "object" || entries === null) return undefined;
  return Object.entries(entries as Record<string, unknown>).map(([name, field]): ToolParameter => {
    const info = valibotFieldInfo(field);
    const param: ToolParameter = {
      name,
      type: info.type,
      description: `${name} parameter`,
      required: info.required,
    };
    return info.enum ? { ...param, enum: info.enum } : param;
  });
}

// ─── Parameter extraction dispatch ───

function extractParameters(input: unknown): ToolParameter[] {
  // Effect Schema (or anything exposing a SchemaAST) — richest metadata.
  const ast = getSchemaAst(input);
  if (ast !== undefined) return astToParameters(ast);

  if (isStandardSchema(input)) {
    const vendor = input["~standard"].vendor;
    if (vendor === "zod") {
      const params = zodShapeToParameters(input);
      if (params) return params;
    }
    if (vendor === "valibot") {
      const params = valibotEntriesToParameters(input);
      if (params) return params;
    }
  }
  return [];
}

// ─── Argument decoding dispatch ───

function formatStandardIssues(issues: ReadonlyArray<StandardSchemaV1.Issue>): string {
  return issues
    .map((issue) => {
      const path = issue.path
        ?.map((seg) => (typeof seg === "object" && seg !== null ? String(seg.key) : String(seg)))
        .join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

function decodeArgs(
  input: ToolSchema<unknown>,
  rawArgs: Record<string, unknown>,
  toolName: string,
): Effect.Effect<unknown, ToolExecutionError> {
  // Standard Schema path (Zod / Valibot / ArkType / Schema.standardSchemaV1).
  if (isStandardSchema(input)) {
    const std = input["~standard"];
    return Effect.tryPromise({
      try: () => Promise.resolve(std.validate(rawArgs)),
      catch: (e) =>
        new ToolExecutionError({
          message: `Validation threw for "${toolName}": ${e instanceof Error ? e.message : String(e)}`,
          toolName,
          input: rawArgs,
          cause: e,
        }),
    }).pipe(
      Effect.flatMap((result) =>
        result.issues === undefined
          ? Effect.succeed(result.value)
          : Effect.fail(
              new ToolExecutionError({
                message: `Invalid arguments for "${toolName}": ${formatStandardIssues(result.issues)}`,
                toolName,
                input: rawArgs,
              }),
            ),
      ),
    );
  }

  // Effect Schema path.
  const decode = Schema.decodeUnknown(input as Schema.Schema<unknown>);
  return decode(rawArgs).pipe(
    Effect.mapError(
      (err) =>
        new ToolExecutionError({
          message:
            err instanceof ParseResult.ParseError
              ? ParseResult.TreeFormatter.formatErrorSync(err)
              : String(err),
          toolName,
          input: rawArgs,
          cause: err,
        }),
    ),
  );
}

// ─── Handler normalisation ───

function runHandler(
  handler: ToolHandler<unknown>,
  args: unknown,
  toolName: string,
  rawArgs: Record<string, unknown>,
): Effect.Effect<unknown, ToolExecutionError> {
  let out: unknown;
  try {
    out = handler(args);
  } catch (e) {
    return Effect.fail(
      new ToolExecutionError({
        message: `Tool "${toolName}" threw: ${e instanceof Error ? e.message : String(e)}`,
        toolName,
        input: rawArgs,
        cause: e,
      }),
    );
  }

  const effect: Effect.Effect<unknown, unknown> = Effect.isEffect(out)
    ? (out as Effect.Effect<unknown, unknown>)
    : Effect.tryPromise({ try: () => Promise.resolve(out), catch: (e) => e });

  return effect.pipe(
    Effect.mapError((e) =>
      e instanceof ToolExecutionError
        ? e
        : new ToolExecutionError({
            message: `Tool "${toolName}" failed: ${e instanceof Error ? e.message : String(e)}`,
            toolName,
            input: rawArgs,
            cause: e,
          }),
    ),
  );
}

// ─── Options validation ───

/**
 * Validate the options object BEFORE touching `schema.ast`. Catches the common
 * first-touch mistake of passing intuitive-but-wrong field names
 * (`parameters` / `execute`) and throws a typed, actionable error instead of a
 * raw `TypeError: undefined is not an object (evaluating 'schema.ast')`.
 */
function assertValidOptions(options: unknown): void {
  if (typeof options !== "object" || options === null) {
    throw new ToolDefinitionError({
      message:
        "defineTool(options): expected an options object with { name, description, input, handler }.",
      toolName: "<unknown>",
      field: "options",
    });
  }
  const raw = options as Record<string, unknown>;
  const toolName = typeof raw.name === "string" ? raw.name : "<unknown>";

  if (raw.input == null) {
    const hint =
      raw.parameters !== undefined
        ? " You passed 'parameters'. Did you mean 'input'? defineTool expects a schema (Effect Schema.Struct or a Standard Schema like Zod/Valibot) under the 'input' key. The plain `parameters: [...]` array belongs to the lower-level `tool()` helper / raw ToolDefinition, not defineTool."
        : " Provide a schema, e.g. input: Schema.Struct({ query: Schema.String }).";
    throw new ToolDefinitionError({
      message: `defineTool({ name: "${toolName}" }): missing required 'input' schema.${hint}`,
      toolName,
      field: "input",
    });
  }

  if (typeof raw.handler !== "function") {
    const hint =
      typeof raw.execute === "function"
        ? " You passed 'execute'. Did you mean 'handler'? defineTool invokes the function under the 'handler' key."
        : " Provide a handler, e.g. handler: async (args) => { ... }.";
    throw new ToolDefinitionError({
      message: `defineTool({ name: "${toolName}" }): missing required 'handler' function.${hint}`,
      toolName,
      field: "handler",
    });
  }
}

// ─── defineTool ───

/**
 * Type-safe tool factory. The **canonical** first-touch shape: a schema plus a
 * plain `async` handler whose `args` are typed from the schema.
 *
 * - `input` accepts an Effect `Schema.Struct` (full parameter metadata) or any
 *   Standard Schema (Zod / Valibot / ArkType / `Schema.standardSchemaV1`).
 * - `handler` may be a plain async function (canonical) or return an `Effect`
 *   (advanced) — both work.
 * - `args` are inferred from the schema — no `Record<string, unknown>`.
 * - Malformed options throw a typed {@link ToolDefinitionError} (never a raw
 *   `TypeError`).
 *
 * @example Canonical (plain async + Effect Schema)
 * ```typescript
 * const searchTool = defineTool({
 *   name: "search",
 *   description: "Search the web",
 *   input: Schema.Struct({
 *     query: Schema.String,
 *     maxResults: Schema.optional(Schema.Number),
 *   }),
 *   // args is typed as { query: string; maxResults?: number }
 *   handler: async (args) => `Results for: ${args.query}`,
 * });
 * ```
 *
 * @example Zod schema
 * ```typescript
 * const t = defineTool({
 *   name: "add",
 *   description: "Add two numbers",
 *   input: z.object({ a: z.number(), b: z.number() }),
 *   handler: async ({ a, b }) => a + b, // { a: number; b: number }
 * });
 * ```
 *
 * @example Advanced (Effect handler)
 * ```typescript
 * const t = defineTool({
 *   name: "search",
 *   description: "Search",
 *   input: Schema.Struct({ query: Schema.String }),
 *   handler: (args) => Effect.succeed(`Results for: ${args.query}`),
 * });
 * ```
 */
export function defineTool<A>(options: DefineToolOptions<A>): DefinedTool {
  assertValidOptions(options);

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

  const parameters = extractParameters(input);

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

  const typedHandler = handler as ToolHandler<unknown>;
  const typedInput = input as ToolSchema<unknown>;

  const wrappedHandler = (
    rawArgs: Record<string, unknown>,
  ): Effect.Effect<unknown, ToolExecutionError> =>
    decodeArgs(typedInput, rawArgs, name).pipe(
      Effect.flatMap((decoded) => runHandler(typedHandler, decoded, name, rawArgs)),
    );

  return { definition, handler: wrappedHandler };
}
