// packages/llm-provider/src/providers/anthropic-discovery.ts
//
// Anthropic capability discoverer: GET /v1/models/{model_id} for a model the
// static table does not list, and report its limits.
//
// The per-model endpoint returns the same ModelInfo object as the listing
// (platform.claude.com/docs/en/api/models/retrieve; listing fields verified
// 2026-10-29): max_input_tokens -> maxContextTokens, max_tokens ->
// maxOutputTokens, capabilities.image_input.supported -> supportsVision,
// capabilities.thinking.supported -> supportsThinkingMode. Parsing is shared
// with the listing (model-discovery.ts `anthropicReportedMetadata`).
//
// Security: the key goes only to api.anthropic.com, the same fixed host model
// discovery uses; a caller-supplied endpoint is ignored.

import { Effect, Option } from "effect";
import type { ReportedModelMetadata } from "../capability-reported.js";
import type { CapabilityDiscoverer } from "../capability-discovery.js";
import { anthropicReportedMetadata } from "../model-discovery.js";
import { discoverReported, getJson, type DiscoveryFetch } from "./discovery-common.js";

const MODELS_URL = "https://api.anthropic.com/v1/models";
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Build the Anthropic discoverer.
 *
 * Skips the request for a static row or already-reported metadata. Without an
 * API key (`ctx.apiKey`, then `ANTHROPIC_API_KEY`) it asks nothing.
 *
 * @param fetchImpl - fetch implementation; defaults to the global `fetch`
 */
export const makeAnthropicCapabilityDiscoverer =
  (fetchImpl: DiscoveryFetch = (url, init) => fetch(url, init)): CapabilityDiscoverer =>
  (model, ctx) =>
    discoverReported("anthropic", model, () => {
      const apiKey = ctx.apiKey ?? process.env.ANTHROPIC_API_KEY;
      if (apiKey === undefined || apiKey.length === 0) {
        return Effect.succeed(Option.none<ReportedModelMetadata>());
      }
      return getJson(fetchImpl, `${MODELS_URL}/${encodeURIComponent(model)}`, {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      }).pipe(Effect.map((body) => Option.some(anthropicReportedMetadata(body))));
    });
