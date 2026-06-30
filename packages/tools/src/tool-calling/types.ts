import { Effect } from "effect";
import type { Rationale } from "@reactive-agents/core";

/** A structured tool call extracted from an LLM response */
export interface ToolCallSpec {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  /**
   * Optional rationale emitted by the model alongside the call (v0.11.x).
   * When present, the act phase forwards it onto `ToolCallEvent` (tool-call-start)
   * so post-hoc debriefs can show *why* the tool was chosen.
   */
  readonly rationale?: Rationale;
}

/** Result of resolving an LLM response into actionable intent */
export type ToolCallResult =
  | { readonly _tag: "tool_calls"; readonly calls: readonly ToolCallSpec[]; readonly thinking?: string }
  | { readonly _tag: "final_answer"; readonly content: string }
  | { readonly _tag: "thinking"; readonly content: string }
  // O3: abstain — model honestly declines when it cannot ground a response.
  // Terminal: mirrors final_answer but signals inability rather than an answer.
  | { readonly _tag: "abstained"; readonly reason: string; readonly missing: readonly string[] };

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
