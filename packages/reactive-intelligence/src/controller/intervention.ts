import type { Effect } from "effect";
import type { KernelStateLike } from "@reactive-agents/core";
import type { ControllerDecision } from "../types.js";
import type { EntropyScore } from "../types.js";

export type InterventionMode = "dispatch" | "advisory" | "off";

export type KernelStatePatch =
  | { kind: "early-stop"; reason: string }
  | { kind: "set-temperature"; temperature: number }
  | { kind: "request-strategy-switch"; to: string; reason: string }
  | { kind: "inject-tool-guidance"; text: string }
  | { kind: "compress-messages"; targetTokens: number }
  | { kind: "inject-skill-content"; skillId: string; content: string }
  | { kind: "append-system-nudge"; text: string };

export interface InterventionCost {
  readonly tokensEstimated: number;
  readonly latencyMsEstimated: number;
}

export interface InterventionOutcome {
  readonly applied: boolean;
  readonly patches: readonly KernelStatePatch[];
  readonly cost: InterventionCost;
  readonly reason: string;
  readonly telemetry: Record<string, unknown>;
}

export type InterventionError = {
  readonly _tag: "InterventionFailed";
  readonly message: string;
};

export interface InterventionContext {
  readonly iteration: number;
  readonly entropyScore: EntropyScore;
  readonly recentDecisions: readonly ControllerDecision[];
  readonly budget: {
    readonly tokensSpentOnInterventions: number;
    readonly interventionsFiredThisRun: number;
  };
  /**
   * Model-adaptive entropy floor derived from calibration data + tier fallback.
   * When present, overrides `config.suppression.minEntropyComposite` so the
   * dispatcher threshold scales to the model's actual entropy range rather than
   * the hardcoded Anthropic-calibrated default (0.55).
   *
   * Computed in reactive-observer.ts via calibratedMinEntropy():
   *   - calibrated (≥20 samples): highEntropyThreshold × 0.6
   *   - local tier fallback:      0.12  (Ollama — no logprobs, floor ~0.15)
   *   - frontier tier fallback:   0.45  (Anthropic/OpenAI — with logprobs)
   *   - unknown fallback:         0.25
   */
  readonly adaptiveMinEntropy?: number;
}

export interface InterventionHandler<
  TDecision extends ControllerDecision["decision"] = ControllerDecision["decision"]
> {
  readonly type: TDecision;
  readonly description: string;
  readonly defaultMode: InterventionMode;
  readonly execute: (
    decision: Extract<ControllerDecision, { decision: TDecision }>,
    state: Readonly<KernelStateLike>,
    context: InterventionContext
  ) => Effect.Effect<InterventionOutcome, InterventionError, never>;
}

export interface InterventionSuppressionConfig {
  readonly minEntropyComposite: number;
  readonly minIteration: number;
  readonly maxFiresPerRun: number;
  readonly maxInterventionTokenBudget: number;
}

export interface InterventionConfig {
  readonly modes: Partial<Record<ControllerDecision["decision"], InterventionMode>>;
  readonly suppression: InterventionSuppressionConfig;
}

export const defaultInterventionConfig: InterventionConfig = {
  modes: {
    "early-stop": "dispatch",
    "temp-adjust": "dispatch",
    "switch-strategy": "dispatch",
    "skill-activate": "dispatch",
    "prompt-switch": "advisory",
    "tool-inject": "dispatch",
    "tool-failure-redirect": "dispatch",
    "memory-boost": "advisory",
    "skill-reinject": "advisory",
    "human-escalate": "advisory",
    "compress": "dispatch",
  },
  suppression: {
    minEntropyComposite: 0.55,
    minIteration: 2,
    maxFiresPerRun: 5,
    maxInterventionTokenBudget: 1500,
  },
};
