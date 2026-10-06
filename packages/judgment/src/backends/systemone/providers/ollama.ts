/**
 * Ollama System One decision backend.
 *
 * Wraps the shared `systemone/engine.ts` with Ollama-specific endpoint
 * resolution, default model (`nimble`), timeout, and `keep_alive` semantics.
 */

import { resolveOllamaEndpoint } from "@reactive-agents/llm-provider";
import { type JudgmentBackend } from "../../../types.js";
import {
  makeSystemOneHttpBackend,
  type SystemOneHttpConfig,
  type SystemOneProviderDescriptor,
} from "../engine.js";

/** Configuration for the Ollama System One judgment backend. */
export interface OllamaJudgmentConfig {
  /** Ollama server root. Falls back to `OLLAMA_ENDPOINT` / `OLLAMA_HOST` / `OLLAMA_BASE` / localhost. */
  readonly baseUrl?: string;
  /** Model to score with. Defaults to `"nimble"`; use `"clef"` or `"clef-flash"` for images. */
  readonly model?: string;
  /** Request timeout in milliseconds. Defaults to 30_000 for cold local model loads. */
  readonly timeoutMs?: number;
  /** Value for the Ollama `keep_alive` body field. `0` and `-1` are meaningful and sent verbatim. */
  readonly keepAlive?: string | number;
  /** Test seam; defaults to `globalThis.fetch`. */
  readonly fetch?: typeof globalThis.fetch;
}

/** Build a `JudgmentBackend` that speaks the Ollama System One protocol. */
export const makeOllamaBackend = (
  config: OllamaJudgmentConfig = {},
): JudgmentBackend => {
  const descriptor: SystemOneProviderDescriptor = {
    name: "ollama",
    resolveEndpoint: resolveOllamaEndpoint,
    defaultModel: "nimble",
    defaultTimeoutMs: 30_000,
    limits: {
      minQuestions: 1,
      maxQuestions: 64,
      minCriteria: 2,
      maxCriteria: 26,
      maxBodyBytes: 65_536,
      images: { maxBodyBytes: 33_554_432 },
    },
    extraBodyFields: () =>
      config.keepAlive !== undefined ? { keep_alive: config.keepAlive } : {},
    describeHttpError: ({ status, body, model }) => {
      if (status === 404) {
        return `local model not found: run \`ollama pull ${model}\``;
      }

      if (status === 400) {
        const hint =
          "System One requires local GGUF weights with a scoring-capable runner (cloud, MLX, and Safetensors models are rejected; it is not available on Ollama Cloud). Images require a vision model such as `clef` or `clef-flash`.";
        if (body.length === 0) {
          return hint;
        }
        const truncated = body.length > 200 ? `${body.slice(0, 200)}…` : body;
        return `${hint} ${truncated}`;
      }

      return undefined;
    },
  };

  return makeSystemOneHttpBackend(descriptor, {
    baseUrl: config.baseUrl,
    model: config.model,
    timeoutMs: config.timeoutMs,
    fetch: config.fetch,
  });
};
