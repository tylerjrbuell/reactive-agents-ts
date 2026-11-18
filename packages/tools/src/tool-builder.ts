import type { ToolDefinition, ToolParameter } from "./types.js";

/** A function passed to {@link ToolBuilder.handler}: one args object in, any value out. */
export type ToolBuilderHandler = (args: Record<string, unknown>) => unknown;

/**
 * What {@link ToolBuilder.build} returns. With a handler set (`H` is the
 * handler's own type), `handler` is required and keeps that exact type, so an
 * Effect-returning handler fits `.withTools({ tools: [...] })` with no cast.
 * Without one, `handler` is absent, and `.withTools()` rejects the entry at
 * compile time: it needs a handler to run the tool.
 */
export type BuiltTool<H extends ToolBuilderHandler | undefined> = H extends ToolBuilderHandler
  ? { readonly definition: ToolDefinition; readonly handler: H }
  : { readonly definition: ToolDefinition; readonly handler?: undefined };

/**
 * Fluent builder for a {@link ToolDefinition}. The type parameter tracks the
 * handler: `ToolBuilder.create()` starts with none, and `.handler(fn)` makes
 * the builder `ToolBuilder<typeof fn>`. A bare `ToolBuilder` annotation
 * accepts either state.
 */
export class ToolBuilder<H extends ToolBuilderHandler | undefined = ToolBuilderHandler | undefined> {
  private _name: string;
  private _description?: string;
  private _parameters: ToolParameter[] = [];
  private _riskLevel: ToolDefinition["riskLevel"] = "low";
  private _timeoutMs = 30_000;
  private _requiresApproval = false;
  private _returnType?: string;
  private _category?: ToolDefinition["category"];
  private _handler?: ToolBuilderHandler;

  constructor(name: string) {
    this._name = name;
  }

  /**
   * Fluent entry point — `ToolBuilder.create("name")` reads better than
   * `new ToolBuilder("name")` in a builder chain, and is the form used
   * throughout the docs. Equivalent to the constructor.
   */
  static create(name: string): ToolBuilder<undefined> {
    return new ToolBuilder<undefined>(name);
  }

  description(desc: string): this {
    this._description = desc;
    return this;
  }

  param(
    name: string,
    type: ToolParameter["type"],
    description: string,
    options?: { required?: boolean; default?: unknown; enum?: string[] }
  ): this {
    this._parameters.push({
      name,
      type,
      description,
      required: options?.required ?? false,
      ...(options?.default !== undefined ? { default: options.default } : {}),
      ...(options?.enum ? { enum: options.enum } : {}),
    } as ToolParameter);
    return this;
  }

  riskLevel(level: ToolDefinition["riskLevel"]): this {
    this._riskLevel = level;
    return this;
  }

  timeout(ms: number): this {
    this._timeoutMs = ms;
    return this;
  }

  requiresApproval(val = true): this {
    this._requiresApproval = val;
    return this;
  }

  returnType(type: string): this {
    this._returnType = type;
    return this;
  }

  category(cat: ToolDefinition["category"]): this {
    this._category = cat;
    return this;
  }

  /**
   * Register the tool's runtime function. It receives ONE object: the
   * validated tool args keyed by parameter name (destructure them directly,
   * e.g. `({ message }) => \`pong: ${message}\``), not a spread of positional
   * arguments — tool handlers everywhere in this codebase (`toolService`,
   * `toolBuilderToEntry`, `defineToolSimple`) are invoked with a single args
   * object.
   *
   * `.withTools({ tools })` runs the handler as an Effect, so return one
   * there (`Effect.succeed(value)`, `Effect.tryPromise(...)`). A plain-value
   * handler still builds, but `.withTools()` rejects it at compile time.
   */
  handler<F extends ToolBuilderHandler>(fn: F): ToolBuilder<F> {
    this._handler = fn;
    // Same instance, now typed with the handler: the type parameter is phantom
    // (it only shapes build()'s return), so no runtime state differs.
    return this as ToolBuilder<ToolBuilderHandler | undefined> as ToolBuilder<F>;
  }

  /**
   * Validate and produce `{ definition, handler }`. `handler` is present (and
   * required in the type) only when `.handler(fn)` was called.
   * @throws when no description was set.
   */
  build(): BuiltTool<H> {
    if (!this._description) {
      throw new Error("ToolBuilder: description is required");
    }
    const definition: ToolDefinition = {
      name: this._name,
      description: this._description,
      parameters: this._parameters,
      riskLevel: this._riskLevel,
      timeoutMs: this._timeoutMs,
      requiresApproval: this._requiresApproval,
      source: "function",
      ...(this._returnType ? { returnType: this._returnType } : {}),
      ...(this._category ? { category: this._category } : {}),
    };
    const built: BuiltTool<ToolBuilderHandler | undefined> = this._handler
      ? { definition, handler: this._handler }
      : { definition };
    // `_handler` is set exactly when H is a handler type (only handler() moves
    // H off undefined), so the runtime shape matches BuiltTool<H>.
    return built as BuiltTool<H>;
  }
}
