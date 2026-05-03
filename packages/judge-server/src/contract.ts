import { Schema } from "effect";

export const JudgeRequest = Schema.Struct({
  taskId: Schema.String,
  sutResponse: Schema.String,
  taskInput: Schema.Unknown,
  sutModel: Schema.String,
  runId: Schema.String,
  taskCriteria: Schema.optional(Schema.String),
});
export type JudgeRequest = Schema.Schema.Type<typeof JudgeRequest>;

export const ReproducibilityMetadata = Schema.Struct({
  judgeModelSha: Schema.String,
  judgeCodeSha: Schema.String,
});
export type ReproducibilityMetadata = Schema.Schema.Type<typeof ReproducibilityMetadata>;

export const JudgeLayerResult = Schema.Struct({
  layerName: Schema.String,
  score: Schema.Number,
  passed: Schema.Boolean,
  details: Schema.optional(Schema.String),
});
export type JudgeLayerResult = Schema.Schema.Type<typeof JudgeLayerResult>;

export const JudgeResponse = Schema.Struct({
  taskId: Schema.String,
  passed: Schema.Boolean,
  overallScore: Schema.Number,
  recommendation: Schema.Literal("accept", "review", "reject"),
  layerResults: Schema.Array(JudgeLayerResult),
  reproducibility: ReproducibilityMetadata,
});
export type JudgeResponse = Schema.Schema.Type<typeof JudgeResponse>;
