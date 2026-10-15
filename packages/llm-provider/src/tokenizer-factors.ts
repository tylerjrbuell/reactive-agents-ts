// packages/llm-provider/src/tokenizer-factors.ts
//
// W2c (plan 2.3, 2026-10-13) — per-tokenizer-family correction factors for
// the shared token estimator. Root-cause chain: the Capability registry has
// carried `tokenizerFamily` as ZERO-CONSUMER data since S1.1; budget gates
// and the num_ctx math compute on `estimateTokenCount`'s chars-per-token
// heuristic, which (measured below) undercounts JSON-dense content on the
// llama-family BPE vocabularies that dominate the local tier. This module
// finally makes the registry field load-bearing.
//
// MEASURED, not folklore (full arithmetic in
// .superpowers/sdd/2026-10-12-local-tier-reliability-control-program/w2c-report.md):
//
//   regime          measured true/naive (prompt_eval_count / estimator)
//   --------------  ------------------------------------------------------
//   dense JSON      llama3.1 1.032 | llama3.2 1.053 | qwen3:4b 1.157
//                   | qwen3.5 1.157 | (gemma4 1.128 — family "unknown",
//                   no factor applied)
//   FC-prompt resid 1.245 (committed qwen3:4b traces, schema text already
//                   folded into naive at /3 — the per-tool template wrap)
//   prose           0.77-0.89 — naive OVER-counts; left untouched (shrinking
//                   it would push budget gates toward the unsafe direction)
//
//   Shipped seed: the plan's llama≈1.35 was probe-3's `naive*1.35` folklore
//   (never measured against prompt_eval_count). Measured upper signal is the
//   1.245 FC-prompt residual; shipped llama dense factor = 1.25 (covers the
//   live qwen 1.157 with headroom, ≈ the committed FC residual, NOT the seed).
//
// Storage: `src/calibrations/tokenizer-factors.json`, shipped in the package
// `files` field via the same "beside calibrations" convention as the per-model
// calibration JSONs (same dir, same dist path). The in-code
// FALLBACK_TOKENIZER_FACTORS below mirrors it; a test pins both against each
// other (W2a mirror-guard pattern) so a half-edit can't silently drift.

import fs from "node:fs";
import path from "node:path";
import { Schema } from "effect";
import type { TokenizerFamily } from "./capability.js";

/** Per-regime multipliers for one tokenizer family. */
export interface TokenizerRegime {
  /** Multiplier on the dense (structural-JSON) branch only. */
  readonly dense: number;
}

export interface TokenizerFactors {
  readonly schema: number;
  readonly measured: string;
  readonly families: Partial<Record<TokenizerFamily, TokenizerRegime>>;
}

const TokenizerRegimeSchema = Schema.Struct({
  dense: Schema.Number.pipe(Schema.positive()),
});

const TokenizerFactorsFileSchema = Schema.Struct({
  schema: Schema.Number,
  measured: Schema.String,
  families: Schema.Record({
    key: Schema.String,
    value: TokenizerRegimeSchema,
  }),
});

/**
 * In-code mirror of `calibrations/tokenizer-factors.json`. Used when the file
 * is unreadable (odd bundling, read-only fs) — NOT a license to drift:
 * tokenizer-factors.test.ts pins file and fallback against each other.
 */
export const FALLBACK_TOKENIZER_FACTORS: TokenizerFactors = {
  schema: 1,
  measured:
    "2026-10-13 /api/chat prompt_eval_count + committed fixture traces (llama-family only)",
  families: {
    llama: { dense: 1.25 },
  },
};

function factorsPathCandidates(explicitPath?: string): string[] {
  if (explicitPath) return [explicitPath];
  try {
    const moduleDir = path.dirname(new URL(import.meta.url).pathname);
    return [
      path.join(moduleDir, "calibrations", "tokenizer-factors.json"),
      path.join(moduleDir, "..", "src", "calibrations", "tokenizer-factors.json"),
    ];
  } catch {
    return [];
  }
}

function decodeFactors(raw: string): TokenizerFactors | null {
  try {
    const data = JSON.parse(raw);
    const decoded = Schema.decodeUnknownSync(TokenizerFactorsFileSchema)(data);
    const families: Partial<Record<TokenizerFamily, TokenizerRegime>> = {};
    for (const [key, value] of Object.entries(decoded.families)) {
      if (
        key === "tiktoken-cl100k" ||
        key === "claude" ||
        key === "gemini" ||
        key === "llama" ||
        key === "unknown"
      ) {
        families[key] = value;
      }
    }
    return { schema: decoded.schema, measured: decoded.measured, families };
  } catch {
    return null;
  }
}

let cachedDefault: TokenizerFactors | null = null;

/**
 * Load the factor table. With an explicit path the read is uncached (test
 * seam); the default shipped file is read once and cached for the process.
 * Any failure (missing file, malformed JSON, schema mismatch) degrades to
 * `FALLBACK_TOKENIZER_FACTORS` — estimation must never fail an agent run.
 */
export function loadTokenizerFactors(explicitPath?: string): TokenizerFactors {
  if (explicitPath) {
    try {
      const decoded = decodeFactors(fs.readFileSync(explicitPath, "utf-8"));
      return decoded ?? FALLBACK_TOKENIZER_FACTORS;
    } catch {
      return FALLBACK_TOKENIZER_FACTORS;
    }
  }
  if (cachedDefault) return cachedDefault;
  for (const candidate of factorsPathCandidates()) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const decoded = decodeFactors(fs.readFileSync(candidate, "utf-8"));
      if (decoded) {
        cachedDefault = decoded;
        return decoded;
      }
    } catch {
      // try next candidate
    }
  }
  cachedDefault = FALLBACK_TOKENIZER_FACTORS;
  return cachedDefault;
}

/**
 * Dense-regime multiplier for a tokenizer family. Unknown family, undefined
 * family, and unmeasured families (claude / gemini / tiktoken-cl100k — their
 * providers count via real tokenizer APIs; the heuristic here is fallback
 * only, and no prompt_eval_count measurement exists for them) all return
 * 1.0 = no behavior change.
 *
 * Provisional marks (W2b spirit) are NOT plumbed: `estimateTokenCount`
 * returns a bare number and reshaping it would touch all 13 consumer call
 * sites — documented absence per w2c-brief ruling 1.
 */
export function getTokenizerDenseFactor(
  family: TokenizerFamily | undefined,
): number {
  if (!family || family === "unknown") return 1.0;
  const regime = loadTokenizerFactors().families[family];
  return regime?.dense ?? 1.0;
}

/** Test seam — drop the cached default table. */
export function _resetTokenizerFactorsCacheForTesting(): void {
  cachedDefault = null;
}
