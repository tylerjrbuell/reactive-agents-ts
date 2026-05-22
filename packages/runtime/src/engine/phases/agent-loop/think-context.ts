/**
 * Local widening for the think-phase access patterns.
 *
 * `ExecutionContext` schema types `memoryContext` and `selectedModel` as
 * `Schema.optional(Schema.Unknown)` so the runtime surface stays loose for
 * tooling. The think phase needs structured access to a small known shape;
 * rather than scatter `as any` casts (HS-08 / #73), narrow once at the
 * boundary with `asThinkContext(c)` and read fields off the typed result.
 *
 * Mirrors the precedent set by #71 `HandlerState` / `asHandlerState()` and
 * #72 typed `BuilderState` option groups: local widening keeps the change
 * inside `@reactive-agents/runtime` without touching `@reactive-agents/core`.
 */
import type { ExecutionContext } from "../../../types.js";

/** Known shape of `memoryContext` used by the think phase. */
export interface MemoryContextShape {
  readonly semanticContext?: string;
  readonly recentEpisodes?: ReadonlyArray<{
    readonly eventType?: string;
    readonly content?: string;
    readonly metadata?: Record<string, unknown>;
  }>;
}

/**
 * `selectedModel` may be a bare string (provider-default name) or a model
 * object with a `.model` field (provider mapping). Both forms appear in the
 * codebase; this type covers both for narrowing.
 */
export type SelectedModelShape =
  | string
  | { readonly model?: string }
  | undefined;

/** Think-phase widening of ExecutionContext. */
export type ThinkContext = ExecutionContext & {
  readonly memoryContext?: MemoryContextShape;
  readonly selectedModel?: SelectedModelShape;
};

/**
 * Boundary helper — single named cast where the loose schema field meets the
 * typed access pattern. Behaviour-only: no runtime change.
 */
export const asThinkContext = (c: ExecutionContext): ThinkContext =>
  c as ThinkContext;

/**
 * LLM response widening for the optional `.model` field. Providers may return
 * a different model than the one requested (fallback, routing, model aliasing);
 * the think phase reads the actual model to update `c.selectedModel`.
 */
export interface ResponseWithModel {
  readonly model?: string;
}

/** Extract the optional `.model` field from an LLM response object. */
export const getResponseModel = (response: unknown): string | undefined => {
  if (response && typeof response === "object" && "model" in response) {
    const m = (response as ResponseWithModel).model;
    return typeof m === "string" ? m : undefined;
  }
  return undefined;
};

/** Extract a model-name string from a `selectedModel` field that may be string or object. */
export const getSelectedModelName = (
  m: SelectedModelShape,
): string | undefined => {
  if (m === undefined) return undefined;
  if (typeof m === "string") return m;
  return m.model;
};
