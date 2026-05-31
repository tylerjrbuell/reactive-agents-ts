export type Tier = "local" | "mid" | "large" | "frontier";

export interface CapabilityInput {
  window: number;
  outputBudget: number;
  dialect: "native-fc" | "text-parse" | "none";
  tier: Tier;
}

export interface ResolvedCapability {
  readonly window: number;
  readonly outputBudget: number;
  readonly dialect: CapabilityInput["dialect"];
  readonly tier: Tier;
  readonly recencyBudgetChars: number;
  readonly agedBudgetChars: number;
  predictNumCtx(assembledPromptTokens: number): number;
}

const BUCKETS = [8192, 16384, 32768, 65536, 131072] as const;

export function resolveCapability(input: CapabilityInput): ResolvedCapability {
  const recencyBudgetChars = Math.floor(input.window * 0.35 * 4);
  const agedBudgetChars = Math.max(600, Math.min(4000, Math.floor(input.window * 0.04 * 4)));
  return {
    ...input,
    recencyBudgetChars,
    agedBudgetChars,
    predictNumCtx(assembledPromptTokens: number): number {
      const need = assembledPromptTokens + input.outputBudget + 1024; // headroom
      return BUCKETS.find((b) => b >= need) ?? BUCKETS[BUCKETS.length - 1];
    },
  };
}
