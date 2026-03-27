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
    if (response.stopReason === "end_turn" || response.stopReason === "stop") {
      return { _tag: "final_answer", content: response.content ?? "" };
    }
    return { _tag: "thinking", content: response.content ?? "" };
  }
}
