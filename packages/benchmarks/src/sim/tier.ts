/**
 * Phase Z: seeded stochastic layer. A {@link Tier} holds per-turn failure rates
 * and the probability the model follows a harness steering signal. {@link withTier}
 * wraps a shape's naive policy and injects those failures. Parameters are
 * UNCALIBRATED illustrative priors (`status` says so): they make the sweep run, they
 * do not predict a real model. Calibration is the S5 spike.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import type { TestTurn } from "@reactive-agents/llm-provider";
import { makeRng, type PolicyContext, type PolicyModel } from "./policy-model.js";
import { obeys } from "./compliance.js";

const Probability = Schema.Number.pipe(Schema.between(0, 1));

/** Per-turn failure rates for one model tier. */
export const TierSchema = Schema.Struct({
  name: Schema.String,
  /** Honesty flag: `uncalibrated` until an S5 fit lands. */
  status: Schema.Literal("uncalibrated", "calibrated"),
  /** A tool turn becomes a prose-only turn (no call). */
  pStall: Probability,
  /** A tool turn becomes a premature final answer. */
  pPrematureFinal: Probability,
  /** A tool turn repeats the previous call. */
  pRepeat: Probability,
  /** A tool turn calls a tool that does not exist. */
  pHallucinatedTool: Probability,
  /** A tool turn becomes a decline. */
  pDecline: Probability,
  /** Chance a model follows a harness steering signal (a guidance line, a forced call). */
  complianceGivenGuidance: Probability,
  provenance: Schema.String,
});
export type Tier = typeof TierSchema.Type;

const TIERS_DIR = join(dirname(fileURLToPath(import.meta.url)), "tiers");

/** Names of the tier files shipped under `src/sim/tiers/`. */
export function tierNames(): readonly string[] {
  return readdirSync(TIERS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();
}

/** Load and validate a tier file; fails (rejects) on a missing file or a bad field. */
export function loadTier(name: string): Tier {
  return Schema.decodeUnknownSync(TierSchema)(JSON.parse(readFileSync(join(TIERS_DIR, `${name}.json`), "utf8")));
}

const isToolTurn = (t: TestTurn): boolean => "toolCall" in t || "toolCalls" in t;

type Fault = "hallucinatedTool" | "stall" | "prematureFinal" | "repeat" | "decline";

/** Pick at most one fault from one uniform draw (bands in a fixed order). */
function pickFault(tier: Tier, u: number): Fault | undefined {
  const bands: readonly (readonly [Fault, number])[] = [
    ["hallucinatedTool", tier.pHallucinatedTool],
    ["stall", tier.pStall],
    ["prematureFinal", tier.pPrematureFinal],
    ["repeat", tier.pRepeat],
    ["decline", tier.pDecline],
  ];
  let edge = 0;
  for (const [fault, p] of bands) {
    edge += p;
    if (u < edge) return fault;
  }
  return undefined;
}

/**
 * Wrap a naive policy with a tier's failures. Stateful (remembers the last call it
 * issued), so build one per run. Each agent turn draws a fixed 3 numbers from the
 * run's stream (fault pick, steering follow, a seed for the base policy's own
 * sub-stream), so two arms with one seed share their randomness. A fault only
 * replaces a TOOL turn; a final answer the base already wrote is left alone. A
 * fault is suppressed when the request carries steering the model follows.
 */
export function withTier(base: PolicyModel, tier: Tier): PolicyModel {
  let lastCall: TestTurn | undefined;
  return (req, ctx) => {
    const pick = ctx.rng();
    const sub = makeRng(Math.floor(ctx.rng() * 0x100000000));
    const follows = obeys(req, ctx.rng, tier.complianceGivenGuidance);
    const inner: PolicyContext = { ...ctx, rng: sub, compliance: tier.complianceGivenGuidance };
    const turn = base(req, inner);
    if (!isToolTurn(turn)) return turn;
    const fault = follows ? undefined : pickFault(tier, pick);
    if (fault === undefined) {
      lastCall = turn;
      return turn;
    }
    switch (fault) {
      case "hallucinatedTool":
        return { toolCall: { name: "nonexistent-tool", args: {} } };
      case "stall":
        return { text: "Let me think about how to approach this before acting." };
      case "prematureFinal":
        return { text: "The task is complete." };
      case "repeat":
        return lastCall ?? turn;
      case "decline":
        return { text: "I cannot complete this task." };
    }
  };
}
