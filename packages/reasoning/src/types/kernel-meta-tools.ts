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
 * `recall()`'s tunables, mirrored from the builder-level `RecallConfig`
 * (`@reactive-agents/runtime`'s `types.ts`) so a user's
 * `.withTools({ metaTools: { recallConfig } })` survives the builder→kernel
 * boundary. Previously declared on the builder type but dropped when
 * `kernelMetaTools` was assembled — `makeRecallHandler` always ran with
 * `config: undefined`, silently ignoring anything a caller set here.
 */
export const RecallConfigSchema = Schema.Struct({
  previewLength: Schema.optional(Schema.Number),
  autoFullThreshold: Schema.optional(Schema.Number),
  maxEntries: Schema.optional(Schema.Number),
  maxTotalBytes: Schema.optional(Schema.Number),
  fullReturnCapChars: Schema.optional(Schema.Number),
});

export type KernelRecallConfig = typeof RecallConfigSchema.Type;

/**
 * Meta-tool flags + data threaded from runtime into the reasoning kernel / ReAct path.
 * (Builder-level `MetaToolsConfig` is wider; this is the resolved kernel payload.)
 */
export const KernelMetaToolsSchema = Schema.Struct({
  brief: Schema.optional(Schema.Boolean),
  find: Schema.optional(Schema.Boolean),
  pulse: Schema.optional(Schema.Boolean),
  recall: Schema.optional(Schema.Boolean),
  recallConfig: Schema.optional(RecallConfigSchema),
  /**
   * `relate` — queries the memory link graph (see `AgentMemory.getRelated`,
   * `@reactive-agents/core`). Only takes effect when a memory adapter that
   * implements `getRelated` is actually present (e.g. `.withMemory()`'s
   * Zettelkasten-backed adapter) — requesting it without one is a no-op,
   * not an error, matching `find`'s "webFallback ignored without a
   * provider" precedent. Deliberately NOT part of any default meta-tool
   * set (explicit opt-in only, 2026-09-03 design decision to keep new
   * capability additions from silently widening the default tool surface).
   */
  relate: Schema.optional(Schema.Boolean),
  /** P6a (2026-07-07) — universal task checklist: model decomposes multi-step
   *  work once, checks items off as it goes; every call renders the full list
   *  so drift is visible. Strategy-agnostic (react/reflexion/code-action get
   *  the tracking rail plan-execute always had). */
  todo: Schema.optional(Schema.Boolean),
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
