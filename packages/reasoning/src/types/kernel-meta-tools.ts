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
  /** Overhaul (RA_OVERHAUL) — register write_result_to_file: the model orchestrates
   *  a deliverable by REFERENCING a stored result; the system materializes the full
   *  data. Replaces the marker-copy / transcription path. */
  writeResultToFile: Schema.optional(Schema.Boolean),
  checkpoint: Schema.optional(Schema.Boolean),
  /** Earned-abstention action: model declines instead of fabricating when it
   *  cannot ground an answer / required input is unavailable. Availability is
   *  gated in think.ts (never offered on iter-0 of a solvable task). */
  abstain: Schema.optional(Schema.Boolean),
  /** Agentic-UI: offer request_user_input — model may pause the run durably
   *  to ask the human for a form/choice/confirmation. Requires durable runs;
   *  enabled via builder .withUserInteraction(). */
  userInteraction: Schema.optional(Schema.Boolean),
  staticBriefInfo: Schema.optional(StaticBriefInfoSchema),
  harnessContent: Schema.optional(Schema.String),
});

export type KernelMetaToolsConfig = typeof KernelMetaToolsSchema.Type;
