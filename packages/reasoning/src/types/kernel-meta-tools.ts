import { Schema } from "effect";

/** Static snapshot passed into `brief` / `pulse` tool handlers */
export const StaticBriefInfoSchema = Schema.Struct({
  indexedDocuments: Schema.Array(
    Schema.Struct({
      source: Schema.String,
      chunkCount: Schema.Number,
      format: Schema.String,
    }),
  ),
  availableSkills: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      purpose: Schema.String,
    }),
  ),
  memoryBootstrap: Schema.Struct({
    semanticLines: Schema.Number,
    episodicEntries: Schema.Number,
  }),
});

/**
 * Meta-tool flags + data threaded from runtime into the reasoning kernel / ReAct path.
 * (Builder-level `MetaToolsConfig` is wider; this is the resolved kernel payload.)
 */
export const KernelMetaToolsSchema = Schema.Struct({
  brief: Schema.optional(Schema.Boolean),
  find: Schema.optional(Schema.Boolean),
  pulse: Schema.optional(Schema.Boolean),
  recall: Schema.optional(Schema.Boolean),
  checkpoint: Schema.optional(Schema.Boolean),
  staticBriefInfo: Schema.optional(StaticBriefInfoSchema),
  harnessContent: Schema.optional(Schema.String),
});

export type KernelMetaToolsConfig = typeof KernelMetaToolsSchema.Type;
