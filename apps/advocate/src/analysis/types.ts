// apps/advocate/src/analysis/types.ts
import { Schema } from "effect";

export const ConfidenceSchema = Schema.Literal("high", "medium", "low");
export type Confidence = Schema.Schema.Type<typeof ConfidenceSchema>;

export const EvidenceItemSchema = Schema.Struct({
  id: Schema.String,
  competitor: Schema.String,
  source: Schema.Literal("release", "discussion"),
  summary: Schema.String,
  url: Schema.String,
  capturedAt: Schema.String,
  confidence: ConfidenceSchema,
});
export type EvidenceItem = Schema.Schema.Type<typeof EvidenceItemSchema>;

export type IntelConfig = {
  readonly repos: readonly string[];
  readonly perRepo: number;
};
export type IntelDeps = {
  readonly fetchImpl: typeof fetch;
};
