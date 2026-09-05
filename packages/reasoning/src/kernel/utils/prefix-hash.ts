// File: src/kernel/utils/prefix-hash.ts
//
// Cache explainability (W2, spec finding F-8).
//
// Before this, a `cacheRead=0` was a dead end: you learned THAT the prompt
// cache missed, never WHICH segment moved. Anthropic caches by exact prefix in
// `tools` -> `system` -> `messages` order, so churn at position zero
// invalidates every downstream breakpoint. Hashing the two cacheable segments
// separately makes the culprit nameable in a receipt diff.
//
// Pure — no Effect, no state.

import { createHash } from "node:crypto";

/** 16 hex chars = 64 bits. Collision risk is irrelevant for run-local diffs. */
const HASH_LEN = 16;

function hash(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex").slice(0, HASH_LEN);
}

/**
 * Hash of the cacheable system-prompt prefix. Undefined hashes as the empty
 * string rather than returning "", so "no system prompt" and "hash not
 * computed" stay distinguishable at the consumer (absent field vs present hash).
 */
export function hashPromptPrefix(systemPrompt: string | undefined): string {
  return hash(systemPrompt ?? "");
}

/**
 * Hash of the ordered wire tool surface.
 *
 * ORDER SENSITIVE by design. Two runs sending the same tools in a different
 * order genuinely cannot share a cache entry, so normalizing the order would
 * hide the exact churn this exists to catch (failure mode F10). Names are
 * length-prefixed so ["a,b"] and ["a","b"] cannot collide.
 */
export function hashToolSurface(toolNames: readonly string[] | undefined): string {
  const encoded = (toolNames ?? []).map((n) => `${n.length}:${n}`).join("");
  return hash(encoded);
}
