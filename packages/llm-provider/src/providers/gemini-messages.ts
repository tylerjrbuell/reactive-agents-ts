import type { InputModality } from "../capabilities.js";
import type { LLMMessage } from "../types.js";
import { resolveCapability } from "../capability-resolver.js";
import {
  joinText,
  resolveContentPolicy,
  resolveParts,
  routeImage,
  type ContentPolicy,
  type DegradedPart,
  type ImageWireRules,
} from "../content-parts.js";

// Gemini message conversion (moved out of gemini.ts, Plan 9 Phase 4 stage C).

/** Input modalities of the Gemini generateContent wire format. */
export const GEMINI_INPUT_MODALITIES: readonly InputModality[] = ["text", "image"];

/**
 * Images ride `inlineData` parts on user and model turns. URL sources are not
 * fetched (Gemini `fileData` takes uploaded-file URIs, not arbitrary URLs), so
 * they become stubs; so do images inside tool results (`functionResponse`).
 */
export const GEMINI_IMAGE_RULES: ImageWireRules = { url: false, roles: ["user", "assistant"] };

/**
 * Per-request content policy for a Gemini model (provider declaration plus the
 * model's resolved capability).
 *
 * @param model — Gemini model id
 */
export const geminiContentPolicy = (model: string): ContentPolicy =>
  resolveContentPolicy(GEMINI_INPUT_MODALITIES, resolveCapability("gemini", model));

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args: unknown } }
  | { functionResponse: { name: string; response: unknown } };

export type GeminiContent = {
  role: "user" | "model";
  parts: GeminiPart[];
};

/**
 * Convert messages to Gemini contents (system messages are skipped: they go
 * through `config.systemInstruction`). Image blocks map to `inlineData` or a
 * degradation stub in place.
 *
 * @param messages — provider-neutral messages
 * @param policy — the per-request content policy
 * @returns contents plus the degradations to emit
 */
export const toGeminiContents = (
  messages: readonly LLMMessage[],
  policy: ContentPolicy,
): { readonly contents: GeminiContent[]; readonly degraded: readonly DegradedPart[] } => {
  const result: GeminiContent[] = [];
  const degraded: DegradedPart[] = [];

  for (const msg of messages) {
    if (msg.role === "system") continue; // handled via config.systemInstruction

    // Handle tool result messages
    if (msg.role === "tool") {
      let content: string;
      if (typeof msg.content === "string") content = msg.content;
      else {
        const r = resolveParts(msg.content, "tool", policy, GEMINI_IMAGE_RULES);
        degraded.push(...r.degraded);
        content = joinText(r.parts);
      }
      result.push({
        role: "user",
        parts: [{
          functionResponse: {
            name: msg.toolName ?? "unknown_tool",
            response: { content },
          },
        }],
      });
      continue;
    }

    const role = msg.role === "assistant" ? "model" : "user";

    if (typeof msg.content === "string") {
      result.push({ role, parts: [{ text: msg.content }] });
    } else {
      const parts: GeminiPart[] = [];
      for (const block of msg.content) {
        if (block.type === "text") {
          parts.push({ text: block.text });
        } else if (block.type === "tool_use") {
          parts.push({
            functionCall: { name: block.name, args: block.input },
          });
        } else if (block.type === "tool_result") {
          parts.push({
            functionResponse: {
              name: (block as { name?: string }).name ?? "unknown_tool",
              response: { content: block.content },
            },
          });
        } else if (block.type === "image") {
          const route = routeImage(block.source, msg.role, policy, GEMINI_IMAGE_RULES);
          if (route.kind === "send") {
            parts.push({ inlineData: { mimeType: route.source.media_type, data: route.source.data } });
          } else {
            parts.push({ text: route.text });
            degraded.push(route.degraded);
          }
        }
      }
      if (parts.length > 0) {
        result.push({ role, parts });
      }
    }
  }

  return { contents: result, degraded };
};
