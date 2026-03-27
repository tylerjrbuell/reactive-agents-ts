import { Effect } from "effect";
import type { ToolCallResolver, ToolCallResult, ToolCallSpec, ResolverInput } from "./types.js";

export class NativeFCStrategy implements ToolCallResolver {
  resolve(response: ResolverInput, _availableTools: readonly { name: string }[]): Effect.Effect<ToolCallResult, never> {
    return Effect.succeed(this.extract(response));
  }

  private extract(response: ResolverInput): ToolCallResult {
    const calls = response.toolCalls;
    if (calls && calls.length > 0) {
      const specs: ToolCallSpec[] = calls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: (typeof tc.input === "object" && tc.input !== null ? tc.input : {}) as Record<string, unknown>,
      }));
      return { _tag: "tool_calls", calls: specs, thinking: response.content || undefined };
    }

    const content = response.content ?? "";
    const hasContent = content.trim().length > 0;

    // Only classify as final_answer when the model produced actual content.
    // An empty end_turn response means the model didn't know what to do —
    // treat it as thinking so the kernel reprompts with context.
    if ((response.stopReason === "end_turn" || response.stopReason === "stop") && hasContent) {
      return { _tag: "final_answer", content };
    }

    return { _tag: "thinking", content };
  }
}
