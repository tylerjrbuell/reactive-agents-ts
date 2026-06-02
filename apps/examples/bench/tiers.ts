export type Tier = "frontier" | "mid" | "local";

export interface TierSpec {
  readonly tier: Tier;
  readonly provider: "anthropic" | "openai" | "ollama";
  readonly model: string;
}

// Mirrors the assembly-ab-grid-hardened receipt tiers + harness-core Phase-A tiers.
// local qwen3.5 (NOT cogito:3b — runaway). Override via env in run-grid if needed.
export const TIERS: readonly TierSpec[] = [
  { tier: "frontier", provider: "anthropic", model: "claude-sonnet-4-6" },
  { tier: "mid", provider: "anthropic", model: "claude-haiku-4-5" },
  { tier: "local", provider: "ollama", model: "qwen3.5:latest" },
];
