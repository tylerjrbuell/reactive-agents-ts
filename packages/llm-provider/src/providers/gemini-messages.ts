import type { InputModality } from "../capabilities.js";
import type { LLMMessage } from "../types.js";
import { resolveCapability } from "../capability-resolver.js";
import {
  joinText,
  resolveContentPolicy,
  resolveParts,
  routeMedia,
  type AudioCapableRules,
  type ContentPolicy,
  type DegradedPart,
  type ImageWireRules,
} from "../content-parts.js";
import { relocateToolImages } from "../tool-result-images.js";

// Gemini message conversion (moved out of gemini.ts, Plan 9 Phase 4 stage C).

/** Input modalities of the Gemini generateContent wire format. */
export const GEMINI_INPUT_MODALITIES: readonly InputModality[] = ["text", "image", "audio"];

/**
 * Images ride `inlineData` parts on user and model turns. URL sources are not
 * fetched (Gemini `fileData` takes uploaded-file URIs, not arbitrary URLs), so
 * they become stubs. Images inside tool results move to a follow-up user
 * content (`relocateToolImages`), not `functionResponse.parts`.
 *
 * Audio rides `inlineData` on user turns: base64 only, in the formats the
 * Gemini audio-understanding docs list (WAV, MP3, AIFF, AAC, OGG, FLAC).
 */
export const GEMINI_IMAGE_RULES: AudioCapableRules = {
  url: false,
  roles: ["user", "assistant"],
  audio: {
    roles: ["user"],
    mediaTypes: [
      "audio/wav",
      "audio/x-wav",
      "audio/mp3",
      "audio/mpeg",
      "audio/aiff",
      "audio/x-aiff",
      "audio/aac",
      "audio/ogg",
      "audio/flac",
      "audio/x-flac",
    ],
  },
};

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
 * degradation stub in place. A tool-result image moves to a follow-up user
 * content (see `relocateToolImages`).
 *
 * @param input — provider-neutral messages
 * @param policy — the per-request content policy
 * @returns contents plus the degradations to emit
 */
export const toGeminiContents = (
  input: readonly LLMMessage[],
  policy: ContentPolicy,
): { readonly contents: GeminiContent[]; readonly degraded: readonly DegradedPart[] } => {
  const result: GeminiContent[] = [];
  const relocated = relocateToolImages(input, policy, GEMINI_IMAGE_RULES);
  const messages = relocated.messages;
  const degraded: DegradedPart[] = [...relocated.degraded];

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
        } else {
          // image, audio and file blocks
          const route = routeMedia(block, msg.role, policy, GEMINI_IMAGE_RULES);
          if (route.kind === "text") {
            parts.push({ text: route.text });
            if (route.degraded !== undefined) degraded.push(route.degraded);
          } else {
            parts.push({ inlineData: { mimeType: route.source.media_type, data: route.source.data } });
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
