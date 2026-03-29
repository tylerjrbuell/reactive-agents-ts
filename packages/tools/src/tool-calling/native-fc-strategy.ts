import { Effect } from "effect";
import type { ToolCallResolver, ToolCallResult, ToolCallSpec, ResolverInput } from "./types.js";

export class NativeFCStrategy implements ToolCallResolver {
  resolve(response: ResolverInput, availableTools: readonly { name: string }[]): Effect.Effect<ToolCallResult, never> {
    return Effect.succeed(this.extract(response, availableTools));
  }

  private extract(response: ResolverInput, _availableTools: readonly { name: string }[]): ToolCallResult {
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

    // Fallback: detect tool calls embedded in text content.
    // Some models (e.g. qwen2.5-coder, older llama variants) output valid tool call
    // JSON as text instead of native tool_use blocks when FC is active.
    // Parse these and convert to structured tool calls so the harness can execute them.
    if (hasContent) {
      const parsed = extractTextToolCalls(content, _availableTools);
      if (parsed.length > 0) {
        return { _tag: "tool_calls", calls: parsed, thinking: undefined };
      }
    }

    // Only classify as final_answer when the model produced actual content.
    // An empty end_turn response means the model didn't know what to do —
    // treat it as thinking so the kernel reprompts with context.
    if ((response.stopReason === "end_turn" || response.stopReason === "stop") && hasContent) {
      return { _tag: "final_answer", content };
    }

    return { _tag: "thinking", content };
  }
}

// ─── Text Tool Call Extraction ────────────────────────────────────────────────

/**
 * Extracts tool calls embedded as JSON in model text output.
 * Handles models that output tool calls as text instead of native FC blocks.
 *
 * Supported patterns:
 *   ```json\n{ "name": "tool", "arguments": {...} }\n```
 *   { "name": "tool", "arguments": {...} }  (bare JSON)
 *   { "tool": "tool", "parameters": {...} } (alternate schema)
 */
function extractTextToolCalls(
  content: string,
  availableTools: readonly { name: string }[],
): ToolCallSpec[] {
  const toolNames = new Set(availableTools.map((t) => t.name));
  const results: ToolCallSpec[] = [];

  // Extract all JSON blocks from content (code-fenced or bare)
  const jsonCandidates: string[] = [];

  // ```json ... ``` blocks
  const fencedMatches = content.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/g);
  for (const m of fencedMatches) {
    if (m[1]) jsonCandidates.push(m[1].trim());
  }

  // If no fenced blocks, try the whole content as JSON
  if (jsonCandidates.length === 0) {
    const trimmed = content.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      jsonCandidates.push(trimmed);
    }
  }

  for (const candidate of jsonCandidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const spec = toToolCallSpec(parsed, toolNames);
      if (spec) results.push(spec);
    } catch {
      // Not valid JSON — skip
    }
  }

  return results;
}

function toToolCallSpec(
  parsed: unknown,
  toolNames: ReadonlySet<string>,
): ToolCallSpec | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  // Pattern 1: { "name": "tool-name", "arguments": {...} }
  // Pattern 2: { "name": "tool-name", "parameters": {...} }
  const name = (obj.name as string | undefined) ?? (obj.tool as string | undefined) ?? (obj.tool_name as string | undefined);
  const args = (obj.arguments ?? obj.parameters ?? obj.args ?? obj.input ?? {}) as Record<string, unknown>;

  if (!name || typeof name !== "string") return null;

  // Normalize hyphenated names (some models use underscores)
  const normalizedName = name.replace(/_/g, "-");
  const matchedName = toolNames.has(name) ? name : toolNames.has(normalizedName) ? normalizedName : null;
  if (!matchedName) return null;

  return {
    id: `text-tc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: matchedName,
    arguments: typeof args === "object" && args !== null ? args : {},
  };
}
