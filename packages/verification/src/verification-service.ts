import { Effect, Context, Layer } from "effect";
import type { VerificationResult, VerificationConfig, LayerResult, RiskLevel } from "./types.js";
import { VerificationError } from "./errors.js";
import { checkSemanticEntropy } from "./layers/semantic-entropy.js";
import { checkFactDecomposition } from "./layers/fact-decomposition.js";
import { checkMultiSource } from "./layers/multi-source.js";
import { checkSelfConsistency } from "./layers/self-consistency.js";
import { checkNli } from "./layers/nli.js";

// ─── Service Tag ───

export class VerificationService extends Context.Tag("VerificationService")<
  VerificationService,
  {
    /** Verify a response against an input query. */
    readonly verify: (
      response: string,
      input: string,
    ) => Effect.Effect<VerificationResult, VerificationError>;

    /** Get current verification config. */
    readonly getConfig: () => Effect.Effect<VerificationConfig, never>;
  }
>() {}

// ─── Live Implementation ───

export const VerificationServiceLive = (config: VerificationConfig) =>
  Layer.succeed(VerificationService, {
    verify: (response, input) =>
      Effect.gen(function* () {
        const layerResults: LayerResult[] = [];

        if (config.enableSemanticEntropy) {
          layerResults.push(yield* checkSemanticEntropy(response, input));
        }

        if (config.enableFactDecomposition) {
          layerResults.push(yield* checkFactDecomposition(response));
        }

        if (config.enableMultiSource) {
          layerResults.push(yield* checkMultiSource(response));
        }

        if (config.enableSelfConsistency) {
          layerResults.push(yield* checkSelfConsistency(response));
        }

        if (config.enableNli) {
          layerResults.push(yield* checkNli(response, input));
        }

        // Weighted average of layer scores
        const overallScore =
          layerResults.length > 0
            ? layerResults.reduce((sum, r) => sum + r.score, 0) / layerResults.length
            : 0.5;

        const riskLevel: RiskLevel =
          overallScore >= 0.8 ? "low" :
          overallScore >= 0.6 ? "medium" :
          overallScore >= 0.4 ? "high" : "critical";

        const recommendation =
          overallScore >= config.passThreshold ? "accept" as const :
          overallScore >= config.riskThreshold ? "review" as const :
          "reject" as const;

        return {
          overallScore,
          passed: overallScore >= config.passThreshold,
          riskLevel,
          layerResults: [...layerResults],
          recommendation,
          verifiedAt: new Date(),
        } satisfies VerificationResult;
      }),

    getConfig: () => Effect.succeed(config),
  });
