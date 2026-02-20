import { Schema } from "effect";

export const PromptVariableType = Schema.Literal(
  "string",
  "number",
  "boolean",
  "array",
  "object",
);
export type PromptVariableType = typeof PromptVariableType.Type;

export const PromptVariableSchema = Schema.Struct({
  name: Schema.String,
  required: Schema.Boolean,
  type: PromptVariableType,
  description: Schema.optional(Schema.String),
  defaultValue: Schema.optional(Schema.Unknown),
});
export type PromptVariable = typeof PromptVariableSchema.Type;

export const PromptTemplateSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  version: Schema.Number,
  template: Schema.String,
  variables: Schema.Array(PromptVariableSchema),
  metadata: Schema.optional(
    Schema.Struct({
      author: Schema.optional(Schema.String),
      description: Schema.optional(Schema.String),
      tags: Schema.optional(Schema.Array(Schema.String)),
      model: Schema.optional(Schema.String),
      maxTokens: Schema.optional(Schema.Number),
    }),
  ),
});
export type PromptTemplate = typeof PromptTemplateSchema.Type;

export const CompiledPromptSchema = Schema.Struct({
  templateId: Schema.String,
  version: Schema.Number,
  content: Schema.String,
  tokenEstimate: Schema.Number,
  variables: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});
export type CompiledPrompt = typeof CompiledPromptSchema.Type;
