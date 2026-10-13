// packages/llm-provider/src/providers/local-probe.ts
//
// Phase 1 Sprint 2 S2.4 (lifted forward) — Ollama capability probe via
// /api/show. Replaces the static-table band-aid for local models: any
// model the user has pulled gets its capabilities derived from Ollama's
// own report at first use, then cached so subsequent requests skip the
// probe.
//
// Wave 2a (2026-10-13) — S2.4-proper landed: the process-Map cache below
// collapses onto the persistent capability store (capability-store.ts).
// Read order: in-memory Map → capability store → live /api/show probe;
// a successful probe writes through to BOTH. Cross-process persistence
// means a fresh process for an already-probed model hits the store, not
// the network. A duck-typed CalibrationStore can be injected via
// `setCapabilityStore()` to replace the default JSON-file store.
//
// Why this lives in `providers/local.ts`-adjacent: the probe is
// inherently provider-specific (Ollama exposes /api/show; cloud
// providers don't have an equivalent). Future probes for Anthropic
// (capability discovery API) etc. live next to their providers.

import type { Capability } from "../capability.js";
import { getCapabilityStore } from "../capability-store.js";

// ─── Module-scope cache (in-memory layer over the persistent store) ─────────

/**
 * One probe per (model, baseUrl) per process. Subsequent requests for the
 * same model reuse the cached Capability — no re-probing, no store read.
 *
 * The persistent layer beneath this Map is the capability store
 * (capability-store.ts) — the deferred S2.4 CalibrationStore write-through
 * landed there in Wave 2a.
 */
const probeCache = new Map<string, Capability>();

function probeKey(baseUrl: string, model: string): string {
  return `${baseUrl}::${model}`;
}

// ─── /api/show field parsing ────────────────────────────────────────────────

/**
 * Parse Ollama's `details.parameter_size` ("1.7B", "8.0B", "120B") into a
 * parameter count in billions. Returns undefined for anything unparseable
 * ("unknown", missing, quantization-suffixed strings) so downstream claims
 * can distinguish "measured small" from "not measured".
 */
export function parseParameterSizeBillions(sizeStr: string | undefined): number | undefined {
  if (!sizeStr) return undefined;
  const m = sizeStr.trim().match(/^([\d.]+)B$/i);
  if (!m) return undefined;
  const billions = Number(m[1]);
  return Number.isFinite(billions) && billions > 0 ? billions : undefined;
}

/**
 * Derive the informational tier bucket from a parameter size. All
 * Ollama-served models are "local" by definition — downstream consumers
 * don't yet discriminate within local-tier (see D-2026-07-30-H: the
 * PROFILE tier, resolved elsewhere, is the load-bearing classification;
 * this field stays informational).
 */
function tierFromParameterSize(sizeStr: string | undefined): Capability["tier"] {
  if (parseParameterSizeBillions(sizeStr) === undefined) return "local";
  return "local";
}

/**
 * Markers that a Go/Jinja chat template renders tool calls. Detection is
 * deliberately generous (any tool-call construct in the template text):
 * this field answers "does the template have a path that emits tool
 * tokens", which is what the model's ACTUAL tool-calling ability hinges
 * on for local models whose `capabilities` array is known to lie
 * (cogito/qwen3 family: advertise tools, template drops them).
 */
const TOOL_TEMPLATE_MARKERS: readonly string[] = [
  "tool_call",
  ".toolcalls",
  ".tool_calls",
  "function_call",
  ".functioncall",
  "function.name",
  '"tool"',
  "'tool'",
];

/**
 * Tri-state chat-template tool-emission detection from /api/show's
 * `template` string.
 *
 *   true       — template references tool-call constructs (has an emission path)
 *   false      — template measured (non-empty) and contains NO tool constructs
 *   undefined  — no template in the response (older Ollama, plugin models) → unmeasured
 */
export function detectToolTemplateEmission(
  template: string | undefined,
): boolean | undefined {
  if (template === undefined || template.trim().length === 0) return undefined;
  const lower = template.toLowerCase();
  return TOOL_TEMPLATE_MARKERS.some((marker) => lower.includes(marker));
}

// ─── /api/show response → Capability ─────────────────────────────────────────

/**
 * Translate Ollama's /api/show response into a Capability descriptor.
 *
 * Key extractions:
 *   - context_length: looked up via the `<family>.context_length` key in
 *     model_info. Falls back to 8192 if missing — every modern Ollama model
 *     exposes this, so missing means an unusual/older model.
 *   - capabilities: Ollama returns ["completion", "vision", "tools", "thinking"]
 *     as flat strings. We map them to our boolean fields.
 *   - parameter_size: captured into `parameterSizeBillions` and drives tier
 *     classification.
 *   - template: scanned for tool-call tokens → `toolTemplateEmitsTokens`
 *     (Wave 2a — the raw-material signal behind the derived
 *     supportsToolCalling claim; see providers/local.ts).
 *
 * Pure / no I/O. Caller does the fetch.
 */
function showResponseToCapability(
  model: string,
  show: {
    capabilities?: readonly string[];
    details?: { family?: string; parameter_size?: string };
    model_info?: Record<string, unknown>;
    template?: string;
  },
): Capability {
  const caps = new Set(show.capabilities ?? []);
  const family = show.details?.family;

  // Find the family-prefixed context_length key. Examples:
  //   "gemma4.context_length", "llama.context_length", "qwen3.context_length"
  let contextLength = 0;
  if (show.model_info) {
    const ctxKey = Object.keys(show.model_info).find((k) =>
      k.endsWith(".context_length"),
    );
    if (ctxKey) {
      const v = show.model_info[ctxKey];
      if (typeof v === "number") contextLength = v;
    }
  }
  // Fallback when /api/show didn't give us a context_length key (older models)
  if (contextLength <= 0) contextLength = 8192;

  // Recommended num_ctx is conservative: cap at 32K even when the model
  // supports 128K+, because local GPU memory is the real constraint.
  // Users override per-request via { numCtx: N } when they have headroom.
  const recommendedNumCtx = Math.min(contextLength, 32_768);

  return {
    provider: "ollama",
    model,
    tier: tierFromParameterSize(show.details?.parameter_size),
    maxContextTokens: contextLength,
    recommendedNumCtx,
    maxOutputTokens: Math.min(4096, Math.floor(contextLength / 4)),
    tokenizerFamily: family === "llama" ? "llama" : "unknown",
    supportsPromptCaching: false,
    supportsVision: caps.has("vision"),
    supportsThinkingMode: caps.has("thinking"),
    supportsStreamingToolCalls: caps.has("tools"),
    toolCallDialect: caps.has("tools") ? "native-fc" : "none",
    parameterSizeBillions: parseParameterSizeBillions(show.details?.parameter_size),
    toolTemplateEmitsTokens: detectToolTemplateEmission(show.template),
    source: "probe",
  };
}

// ─── Public probe ────────────────────────────────────────────────────────────

/**
 * Probe an Ollama-served model's capabilities via /api/show.
 *
 *   - Read order: in-process Map → capability store (cross-process,
 *     persistent — the S2.4 write-through) → live probe. A store hit is
 *     promoted into the Map so repeats are free.
 *   - Returns null on any failure (network error, 404 model-not-pulled,
 *     malformed response). Callers fall back to the static table or the
 *     conservative fallback.
 *   - 5s timeout — local Ollama responds in <100ms typically; anything
 *     slower means trouble we don't want to wait on.
 */
export async function probeOllamaCapability(
  model: string,
  baseUrl: string,
  apiKey?: string,
): Promise<Capability | null> {
  const key = probeKey(baseUrl, model);
  const cached = probeCache.get(key);
  if (cached) return cached;

  // Store-first for cross-process persistence: a prior run's probe result
  // (or an injected CalibrationStore row) serves without touching network.
  // Rows are endpoint-scoped (W2a review fix 2) — the same tag on two
  // servers never cross-serves; baseUrl-less legacy rows are a miss and
  // self-heal on the next successful probe.
  const store = getCapabilityStore();
  const fromStore = store.loadCapability("ollama", model, baseUrl);
  if (fromStore) {
    probeCache.set(key, fromStore);
    return fromStore;
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${baseUrl}/api/show`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ name: model }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as Parameters<typeof showResponseToCapability>[1];
    const cap = showResponseToCapability(model, data);
    probeCache.set(key, cap);
    // S2.4 write-through — persist per model + endpoint so future processes
    // skip the probe.
    store.saveCapability(cap, baseUrl);
    return cap;
  } catch {
    return null;
  }
}

/**
 * Test seam — wipes the module-scope cache. Tests that exercise the
 * probe path explicitly need this so a prior test's cached entry doesn't
 * leak into the next test.
 */
export function _resetProbeCacheForTesting(): void {
  probeCache.clear();
}
