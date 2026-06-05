/**
 * Shared schema utilities for provider adapters.
 *
 * `deepClone` replaces the `JSON.parse(JSON.stringify(...))` idiom that was
 * copy-pasted across the providers' `completeStructured` paths (gemini, openai,
 * local) and `toStrictToolSchema` (openai). Centralizing it removes the
 * copy-paste hazard (GH #156) while keeping behavior identical: a structural
 * deep copy of a JSON-serializable value.
 *
 * Inputs are always JSON-serializable schema objects (the output of
 * `Schema.encodedSchema(...)` or a plain JSON Schema), so the round-trip is
 * lossless. Do NOT use this for values containing functions, `undefined`,
 * `Date`, `Map`/`Set`, or cyclic references.
 *
 * The parameter is `unknown` (callers pass `Schema` instances whose compile-time
 * type does not match their runtime JSON shape); the caller supplies `T` to
 * describe the runtime shape of the cloned value.
 */
export const deepClone = <T>(value: unknown): T =>
  JSON.parse(JSON.stringify(value)) as T;
