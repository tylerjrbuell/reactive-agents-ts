/**
 * Minimal, self-contained copy of the Standard Schema v1 interface
 * (https://github.com/standard-schema/standard-schema).
 *
 * Zod (>=3.24), Valibot, ArkType and Effect's `Schema.standardSchemaV1`
 * all implement this exact shape under the `~standard` property. We inline
 * it here rather than depend on `@standard-schema/spec` so the tools package
 * carries no extra runtime dependency — structural typing makes any real
 * Standard Schema assignable to this interface.
 */

// eslint-disable-next-line @typescript-eslint/no-namespace
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace StandardSchemaV1 {
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => Result<Output> | Promise<Result<Output>>;
    readonly types?: Types<Input, Output> | undefined;
  }

  export type Result<Output> = SuccessResult<Output> | FailureResult;

  export interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }

  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }

  export interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }

  export interface PathSegment {
    readonly key: PropertyKey;
  }

  export interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }

  /** Infer the decoded (output) type of a Standard Schema. */
  export type InferOutput<S extends StandardSchemaV1> =
    S extends StandardSchemaV1<unknown, infer O> ? O : never;
}

/** Runtime guard — does this value implement the Standard Schema interface? */
export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  if (typeof value !== "object" || value === null) return false;
  const std = (value as Record<string, unknown>)["~standard"];
  if (typeof std !== "object" || std === null) return false;
  const props = std as Record<string, unknown>;
  return props.version === 1 && typeof props.validate === "function";
}
