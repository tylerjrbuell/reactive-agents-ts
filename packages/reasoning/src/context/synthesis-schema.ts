import { Schema } from "effect";

/**
 * JSON-serializable ICS fields (no `synthesisStrategy` function).
 * Use for `ReactiveAgentsConfig` / decode; attach `synthesisStrategy` at runtime when needed.
 */
export const SynthesisConfigJsonSchema = Schema.Struct({
  mode: Schema.Literal("auto", "fast", "deep", "custom", "off"),
  model: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.String),
  temperature: Schema.optional(Schema.Number),
});
export type SynthesisConfigJson = typeof SynthesisConfigJsonSchema.Type;
