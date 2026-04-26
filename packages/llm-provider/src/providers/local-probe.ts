// packages/llm-provider/src/providers/local-probe.ts
//
// Phase 1 Sprint 2 S2.4 (lifted forward) — Ollama capability probe via
// /api/show. Replaces the static-table band-aid for local models: any
// model the user has pulled gets its capabilities derived from Ollama's
// own report at first use, then cached in module scope so subsequent
// requests within the same process skip the probe.
//
// Why this lives in `providers/local.ts`-adjacent: the probe is
// inherently provider-specific (Ollama exposes /api/show; cloud
// providers don't have an equivalent). Future probes for Anthropic
// (capability discovery API) etc. live next to their providers.

import type { Capability } from "../capability.js";

// ─── Module-scope cache ──────────────────────────────────────────────────────

/**
 * One probe per (model, baseUrl) per process. Subsequent requests for the
 * same model reuse the cached Capability — no re-probing.
 *
 * For cross-process persistence (so users don't re-probe on every script
 * run), Sprint 2 S2.4-proper will write through to CalibrationStore. This
 * module-scope Map is the immediate fix.
 */
const probeCache = new Map<string, Capability>();

function probeKey(baseUrl: string, model: string): string {
  return `${baseUrl}::${model}`;
}

// ─── Tier classification from parameter size ────────────────────────────────

function tierFromParameterSize(sizeStr: string | undefined): Capability["tier"] {
  // Ollama returns sizes like "3.0B", "8.0B", "70.0B", "405.0B"
  if (!sizeStr) return "local";
  const m = sizeStr.match(/^([\d.]+)B$/i);
  if (!m) return "local";
  const billions = Number(m[1]);
  // All Ollama models are "local" by definition; tier here is informational.
  // Could refine: <8B → local-small, 8-30B → local, 30B+ → local-large.
  // Sticking with "local" for now since downstream consumers don't yet
  // discriminate within local-tier.
  if (Number.isNaN(billions)) return "local";
  return "local";
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
 *   - parameter_size: drives tier classification.
 *
 * Pure / no I/O. Caller does the fetch.
 */
function showResponseToCapability(
  model: string,
  show: {
    capabilities?: readonly string[];
    details?: { family?: string; parameter_size?: string };
    model_info?: Record<string, unknown>;
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
    source: "probe",
  };
}

// ─── Public probe ────────────────────────────────────────────────────────────

/**
 * Probe an Ollama-served model's capabilities via /api/show.
 *
 *   - Returns null on any failure (network error, 404 model-not-pulled,
 *     malformed response). Callers fall back to the static table or the
 *     conservative fallback.
 *   - Module-scope cached: probing the same model twice in one process
 *     hits memory, not the network.
 *   - 5s timeout — local Ollama responds in <100ms typically; anything
 *     slower means trouble we don't want to wait on.
 *
 * Future: this result should also write through to CalibrationStore so
 * cross-process persistence skips the probe entirely (S2.4 proper).
 */
export async function probeOllamaCapability(
  model: string,
  baseUrl: string,
): Promise<Capability | null> {
  const key = probeKey(baseUrl, model);
  const cached = probeCache.get(key);
  if (cached) return cached;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${baseUrl}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as Parameters<typeof showResponseToCapability>[1];
    const cap = showResponseToCapability(model, data);
    probeCache.set(key, cap);
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
