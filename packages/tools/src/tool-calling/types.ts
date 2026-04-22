import { Effect } from "effect";

/** A structured tool call extracted from an LLM response */
export interface ToolCallSpec {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

/** Result of resolving an LLM response into actionable intent */
export type ToolCallResult =
  | { readonly _tag: "tool_calls"; readonly calls: readonly ToolCallSpec[]; readonly thinking?: string }
  | { readonly _tag: "final_answer"; readonly content: string }
  | { readonly _tag: "thinking"; readonly content: string };

/** Minimal LLM response shape the resolver needs */
export interface ResolverInput {
  readonly content?: string;
  readonly toolCalls?: readonly { id: string; name: string; input: unknown }[];
  readonly stopReason?: string;
}

/** Tool hint for resolver — name is required; param names enable shape-match fallback. */
export interface ResolverToolHint {
  readonly name: string;
  /** Optional parameter names — when present, enables parameter-shape matching
   *  for LLM outputs that emit argument dicts without a `name`/`tool` identifier. */
  readonly paramNames?: readonly string[];
}

/** Interface for resolving LLM responses into tool calls */
export interface ToolCallResolver {
  resolve(
    response: ResolverInput,
    availableTools: readonly ResolverToolHint[],
  ): Effect.Effect<ToolCallResult, never>;
  resolveWithDialect?(
    response: ResolverInput,
    availableTools: readonly ResolverToolHint[],
  ): Effect.Effect<{ result: ToolCallResult; dialect: string }, never>;
}
