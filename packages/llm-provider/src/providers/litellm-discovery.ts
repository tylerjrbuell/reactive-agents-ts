// packages/llm-provider/src/providers/litellm-discovery.ts
//
// LiteLLM capability discoverer: GET {baseUrl}/model/info on the LiteLLM proxy
// and report the limits it states for the deployment named `model`.
//
// Shape (LiteLLM proxy docs, "Model Management" /model/info; NOT verified
// against a live proxy in this repo, 2026-11-19):
//   { data: [ { model_name, litellm_params: { model }, model_info: {
//       max_input_tokens, max_output_tokens, supports_vision,
//       supports_reasoning, ... } } ] }
// Each entry is one deployment. A model_name may map to several deployments
// (load balancing); the smallest stated window and output limit win, since the
// proxy may route a request to any of them. Unknown or null fields are not
// reported.
//
// Endpoint: `ctx.endpoint`, then LITELLM_BASE_URL, then http://localhost:4000
// (the LiteLLM provider's own order). LiteLLM is self-hosted, so the caller's
// endpoint is honored; the optional key is sent only to it.

import { Effect, Option } from "effect";
import type { ReportedModelMetadata } from "../capability-reported.js";
import type { CapabilityDiscoverer } from "../capability-discovery.js";
import { discoverReported, getJson, positiveInt, type DiscoveryFetch } from "./discovery-common.js";

type Rec = Readonly<Record<string, unknown>>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const flag = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

const minDefined = (a: number | undefined, b: number | undefined): number | undefined =>
  a === undefined ? b : b === undefined ? a : Math.min(a, b);

/**
 * The limits a /model/info body states for the deployments named `model`.
 *
 * @param body - the /model/info response body
 * @param model - the LiteLLM model name (what the LiteLLM provider sends)
 * @returns the stated fields, or `Option.none()` when no deployment matched
 */
export function parseLiteLLMModelInfo(body: unknown, model: string): Option.Option<ReportedModelMetadata> {
  if (!isRec(body) || !Array.isArray(body.data)) return Option.none();
  const infos = body.data
    .filter((d): d is Rec => isRec(d) && d.model_name === model)
    .map((d) => (isRec(d.model_info) ? d.model_info : {}));
  if (infos.length === 0) return Option.none();
  let maxContextTokens: number | undefined;
  let maxOutputTokens: number | undefined;
  for (const info of infos) {
    maxContextTokens = minDefined(maxContextTokens, positiveInt(info.max_input_tokens));
    maxOutputTokens = minDefined(maxOutputTokens, positiveInt(info.max_output_tokens));
  }
  // Flags only when every deployment agrees.
  const agreed = (key: string): boolean | undefined => {
    const values = infos.map((i) => flag(i[key]));
    const first = values[0];
    return first !== undefined && values.every((v) => v === first) ? first : undefined;
  };
  const supportsVision = agreed("supports_vision");
  const supportsThinkingMode = agreed("supports_reasoning");
  return Option.some({
    ...(maxContextTokens !== undefined ? { maxContextTokens } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(supportsVision !== undefined ? { supportsVision } : {}),
    ...(supportsThinkingMode !== undefined ? { supportsThinkingMode } : {}),
  });
}

/**
 * Build the LiteLLM discoverer.
 *
 * Skips the request for a static row or already-reported metadata.
 *
 * @param fetchImpl - fetch implementation; defaults to the global `fetch`
 */
export const makeLiteLLMCapabilityDiscoverer =
  (fetchImpl: DiscoveryFetch = (url, init) => fetch(url, init)): CapabilityDiscoverer =>
  (model, ctx) =>
    discoverReported("litellm", model, () => {
      const base = (ctx.endpoint ?? process.env.LITELLM_BASE_URL ?? "http://localhost:4000").replace(/\/+$/, "");
      const apiKey = ctx.apiKey ?? process.env.LITELLM_API_KEY;
      const headers: Record<string, string> =
        apiKey !== undefined && apiKey.length > 0 ? { authorization: `Bearer ${apiKey}` } : {};
      return getJson(fetchImpl, `${base}/model/info`, headers).pipe(
        Effect.map((body) => parseLiteLLMModelInfo(body, model)),
      );
    });
