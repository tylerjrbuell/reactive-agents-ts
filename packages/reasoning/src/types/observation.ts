// File: src/types/observation.ts
import { Schema } from "effect";

// ─── Observation Category ───

export const ObservationCategory = Schema.Literal(
  "file-write",
  "file-read",
  "web-search",
  "http-get",
  "code-execute",
  "agent-delegate",
  "scratchpad",
  "custom",
  "error",
);
export type ObservationCategory = typeof ObservationCategory.Type;

// ─── Result Kind ───

export const ResultKind = Schema.Literal("side-effect", "data", "error");
export type ResultKind = typeof ResultKind.Type;

// ─── Observation Result ───

export const ObservationResultSchema = Schema.Struct({
  success: Schema.Boolean,
  toolName: Schema.String,
  displayText: Schema.String,
  category: ObservationCategory,
  resultKind: ResultKind,
  preserveOnCompaction: Schema.Boolean,
});
export type ObservationResult = typeof ObservationResultSchema.Type;

// ─── Category Mapping ───

const TOOL_CATEGORY_MAP: Record<string, ObservationCategory> = {
  "file-write": "file-write",
  "file-read": "file-read",
  "web-search": "web-search",
  "http-get": "http-get",
  "code-execute": "code-execute",
  "recall": "scratchpad",
  "spawn-agent": "agent-delegate",
};

export const categorizeToolName = (toolName: string): ObservationCategory =>
  TOOL_CATEGORY_MAP[toolName] ?? (toolName.startsWith("agent-") ? "agent-delegate" : "custom");

// ─── Result Kind Mapping ───

const SIDE_EFFECT_CATEGORIES: ReadonlySet<ObservationCategory> = new Set([
  "file-write",
  "code-execute",
  "scratchpad",
]);

export const deriveResultKind = (
  category: ObservationCategory,
  success: boolean,
): ResultKind => {
  if (!success) return "error";
  return SIDE_EFFECT_CATEGORIES.has(category) ? "side-effect" : "data";
};
