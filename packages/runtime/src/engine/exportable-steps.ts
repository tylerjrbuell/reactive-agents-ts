/**
 * Exportable reasoning steps — the one boundary where in-run steps become the
 * `TaskResult.metadata.reasoningSteps` that leave the engine.
 *
 * A tool result built with `toolContent(...)` keeps its typed parts on the
 * step as `metadata.contentParts` (Plan 9 Phase 4 stage E) so the next
 * provider request sees the media. Those parts may hold inline base64 bytes.
 * Everything downstream of the result — `StreamCompleted.metadata` on the SSE
 * wire, the durable `run_events` journal row, `AgentResult`, `ChatReply` —
 * must record what the media was, never its bytes (size, PII). Each inline
 * image/audio part is replaced by core's `inlineMediaStub` (the same rule as
 * `redactInlineMedia`); URL-sourced media and file parts carry no bytes and
 * are kept.
 *
 * In-run readers keep the raw `ctx.metadata.reasoningSteps`; only the
 * exported copy is redacted. Steps without inline media are returned by
 * reference, and a list with none is returned as-is (no copy).
 *
 * Pure. No Effect, no state.
 */
import { inlineMediaStub, isInlineMediaPart } from "@reactive-agents/core";
import type { ExecutionContext } from "../types.js";

/** One step as carried on `ExecutionContext.metadata.reasoningSteps`. */
export type ExportableStep = NonNullable<ExecutionContext["metadata"]["reasoningSteps"]>[number];

/** The step's `metadata.contentParts`, when present as an array. Typed `unknown` at this boundary. */
const contentPartsOf = (step: ExportableStep): readonly unknown[] | undefined => {
  const meta: object | undefined = step.metadata;
  if (meta === undefined || !("contentParts" in meta)) return undefined;
  const parts: unknown = meta.contentParts;
  return Array.isArray(parts) ? parts : undefined;
};

/** One step with its inline media parts stubbed, or the same step when it has none. */
const exportableStep = (step: ExportableStep): ExportableStep => {
  const parts = contentPartsOf(step);
  if (parts === undefined || !parts.some(isInlineMediaPart)) return step;
  const metadata = {
    ...step.metadata,
    contentParts: parts.map((p) => (isInlineMediaPart(p) ? inlineMediaStub(p) : p)),
  };
  return { ...step, metadata };
};

/**
 * The steps as they may leave the engine: no step's `metadata.contentParts`
 * carries an inline base64 image/audio payload. Returns `steps` itself when no
 * step needed redaction.
 */
export const exportableSteps = (steps: readonly ExportableStep[]): readonly ExportableStep[] => {
  const out = steps.map(exportableStep);
  return out.every((s, i) => s === steps[i]) ? steps : out;
};
