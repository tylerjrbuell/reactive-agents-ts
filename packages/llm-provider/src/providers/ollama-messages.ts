import type { Capability } from "../capability.js";
import type { InputModality } from "../capabilities.js";
import type { ContentBlock, LLMMessage } from "../types.js";
import {
  joinText,
  resolveContentPolicy,
  resolveParts,
  type ContentPolicy,
  type DegradedPart,
  type ImageWireRules,
  type ResolvedPart,
} from "../content-parts.js";

// Ollama /api/chat message conversion (moved out of local.ts, Plan 9 Phase 4
// stage C; local.ts is a ceiling-pinned shell).

/** Input modalities of the Ollama /api/chat wire format. */
export const OLLAMA_INPUT_MODALITIES: readonly InputModality[] = ["text", "image"];

/**
 * Images ride the message `images` array as raw base64 (no data-URL prefix)
 * on user and tool messages. Ollama does not fetch URLs, so URL sources become
 * stubs; so do images on assistant messages.
 */
export const OLLAMA_IMAGE_RULES: ImageWireRules = { url: false, roles: ["user", "tool"] };

export type OllamaMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  tool_calls?: Array<{
    function: { name: string; arguments: Record<string, unknown> };
  }>;
};

/**
 * Per-request content policy for an Ollama model, from the provider
 * declaration and the model capability (probe rows carry `/api/show` vision).
 *
 * @param capability — the resolved model capability
 */
export const ollamaContentPolicy = (
  capability: Pick<Capability, "supportsVision" | "source">,
): ContentPolicy => resolveContentPolicy(OLLAMA_INPUT_MODALITIES, capability);

/** Text plus (only when non-empty) the base64 image list. */
const textAndImages = (parts: readonly ResolvedPart[]): { content: string; images?: string[] } => {
  const images = parts.flatMap((p) => (p.kind === "image" ? [p.source.data] : []));
  return images.length > 0 ? { content: joinText(parts), images } : { content: joinText(parts) };
};

/**
 * Convert messages to Ollama wire messages. Image parts map to `images` or a
 * degradation stub in place; text-only messages are unchanged.
 *
 * @param messages — provider-neutral messages
 * @param policy — the per-request content policy
 * @returns wire messages plus the degradations to emit
 */
export const toOllamaMessages = (
  messages: readonly LLMMessage[],
  policy: ContentPolicy,
): { readonly messages: OllamaMessage[]; readonly degraded: readonly DegradedPart[] } => {
  const degraded: DegradedPart[] = [];
  const route = (blocks: readonly ContentBlock[], role: LLMMessage["role"]) => {
    const r = resolveParts(blocks, role, policy, OLLAMA_IMAGE_RULES);
    degraded.push(...r.degraded);
    return r.parts;
  };
  const out = messages.map((m): OllamaMessage => {
    // Tool result messages — pass through directly (Ollama supports role:"tool")
    if (m.role === "tool") {
      return typeof m.content === "string"
        ? { role: "tool" as const, content: m.content }
        : { role: "tool" as const, ...textAndImages(route(m.content, "tool")) };
    }
    // Assistant messages — extract text and convert tool_use blocks to tool_calls
    if (m.role === "assistant") {
      const textContent =
        typeof m.content === "string" ? m.content : joinText(route(m.content, "assistant"));
      const toolUseBlocks =
        typeof m.content !== "string"
          ? m.content.filter(
              (b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use",
            )
          : [];
      return {
        role: "assistant" as const,
        content: textContent,
        ...(toolUseBlocks.length > 0
          ? {
              tool_calls: toolUseBlocks.map((tc) => ({
                function: {
                  name: tc.name,
                  arguments: (tc.input ?? {}) as Record<string, unknown>,
                },
              })),
            }
          : {}),
      };
    }
    // system
    if (m.role === "system") return { role: "system" as const, content: m.content };
    // user
    return typeof m.content === "string"
      ? { role: "user" as const, content: m.content }
      : { role: "user" as const, ...textAndImages(route(m.content, "user")) };
  });
  return { messages: out, degraded };
};
