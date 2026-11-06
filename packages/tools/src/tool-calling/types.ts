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
  /**
   * Provenance of a call parsed from assistant TEXT (canonical tool-call
   * extraction D1). Absent on native provider calls.
   */
  readonly extraction?: CallExtraction;
}

/** Which assistant-text parser tier produced a call, highest fidelity first. */
export type TextCallTier = "taught-markup" | "dialect-marker" | "json" | "call-form" | "cli-form";

/**
 * How a text-sourced call was read. `span` is the half-open `[start, end)`
 * range of the call in the parsed content; `form` is `embedded` when the call
 * sits inside an expression or assignment (`const d = fileRead(…)`).
 */
export interface CallExtraction {
  readonly source: "text";
  /** Surface dialect label (`taught`, `gemma-marker`, `function-xml`, `json`, `nameless-shape`, `call`, `cli`). */
  readonly dialect: string;
  readonly tier: TextCallTier;
  /** Argument grammar arm (`json`, `lenient-json`, `key-value`, `positional`, `empty`, `taught`, `cli`). */
  readonly argParse: string;
  readonly span: { readonly start: number; readonly end: number };
  readonly form: "standalone" | "embedded";
}

/** Arguments accepted by the `abstain` meta-tool. `reason` is schema-required. */
export interface AbstainArgs {
  readonly reason: string;
  readonly missing?: readonly string[];
}

/** Result of resolving an LLM response into actionable intent */
export type ToolCallResult =
  | { readonly _tag: "tool_calls"; readonly calls: readonly ToolCallSpec[]; readonly thinking?: string }
  | { readonly _tag: "final_answer"; readonly content: string }
  | {
      readonly _tag: "thinking";
      readonly content: string;
      /**
       * Additive machine-readable marker. `"unresolved-tool-call"` means the
       * model's reply was tool-call-shaped (or named an unavailable tool) but could
       * not be resolved to an executable known tool, so it was NOT treated as a
       * final answer. Consumers (kernel) may count consecutive occurrences.
       * Absent on ordinary thinking results.
       */
      readonly reason?: "unresolved-tool-call";
      /**
       * The resolver's reprompt hint for an unresolved call (unparseable call
       * text, or a name off the surface), as a typed field. Present only with
       * `reason: "unresolved-tool-call"`. Read this instead of splitting
       * `content`: `content` still carries `[raw reply, hint].join("\n\n")`
       * for one release so existing consumers keep working, then becomes the
       * raw reply alone.
       */
      readonly hint?: string;
    }
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
  /**
   * Optional required-parameter names. The text parser binds a lone
   * positional argument only to a tool with exactly one required param; when
   * absent, a tool with exactly one declared param qualifies instead.
   */
  readonly requiredParams?: readonly string[];
  /**
   * Optional risk level (see `ToolDefinition.riskLevel`). A call EMBEDDED in
   * an expression or assignment executes only for `"low"`; absent counts as
   * not-low, so embedded calls reprompt instead of executing (D7c).
   */
  readonly riskLevel?: "low" | "medium" | "high" | "critical";
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
