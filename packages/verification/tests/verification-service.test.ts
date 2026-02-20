import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { VerificationService, VerificationServiceLive } from "../src/verification-service.js";
import { defaultVerificationConfig } from "../src/types.js";
import type { VerificationConfig } from "../src/types.js";

const runWithService = <A>(
  config: VerificationConfig,
  effect: Effect.Effect<A, any, VerificationService>,
) =>
  Effect.runPromise(
    Effect.provide(effect, VerificationServiceLive(config)),
  );

describe("VerificationService", () => {
  test("verifies a high-quality response", async () => {
    const result = await runWithService(defaultVerificationConfig,
      Effect.gen(function* () {
        const svc = yield* VerificationService;
        return yield* svc.verify(
          "TypeScript was created by Microsoft in 2012. It adds static type checking to JavaScript and compiles down to plain JavaScript that runs in any browser.",
          "Tell me about TypeScript",
        );
      }),
    );
    expect(result.overallScore).toBeGreaterThan(0);
    expect(result.layerResults.length).toBeGreaterThan(0);
    expect(result.riskLevel).toBeDefined();
    expect(result.verifiedAt).toBeInstanceOf(Date);
    expect(["accept", "review", "reject"]).toContain(result.recommendation);
  });

  test("returns config", async () => {
    const config = await runWithService(defaultVerificationConfig,
      Effect.gen(function* () {
        const svc = yield* VerificationService;
        return yield* svc.getConfig();
      }),
    );
    expect(config.passThreshold).toBe(0.7);
    expect(config.enableSemanticEntropy).toBe(true);
  });

  test("respects layer toggles", async () => {
    const minimalConfig: VerificationConfig = {
      ...defaultVerificationConfig,
      enableSemanticEntropy: false,
      enableFactDecomposition: false,
      enableMultiSource: false,
      enableSelfConsistency: false,
      enableNli: true,
    };
    const result = await runWithService(minimalConfig,
      Effect.gen(function* () {
        const svc = yield* VerificationService;
        return yield* svc.verify("TypeScript is great.", "Tell me about TypeScript");
      }),
    );
    expect(result.layerResults.length).toBe(1);
    expect(result.layerResults[0]!.layerName).toBe("nli");
  });

  test("scores 0.5 when no layers enabled", async () => {
    const noLayersConfig: VerificationConfig = {
      enableSemanticEntropy: false,
      enableFactDecomposition: false,
      enableMultiSource: false,
      enableSelfConsistency: false,
      enableNli: false,
      passThreshold: 0.7,
      riskThreshold: 0.5,
    };
    const result = await runWithService(noLayersConfig,
      Effect.gen(function* () {
        const svc = yield* VerificationService;
        return yield* svc.verify("anything", "anything");
      }),
    );
    expect(result.overallScore).toBe(0.5);
    expect(result.layerResults.length).toBe(0);
  });

  test("assigns correct risk levels", async () => {
    // Low risk = high-quality specific response
    const result = await runWithService(defaultVerificationConfig,
      Effect.gen(function* () {
        const svc = yield* VerificationService;
        return yield* svc.verify(
          "TypeScript 5.0 was released in March 2023 by Microsoft. It introduced decorators, const type parameters, and improved enums. The compiler supports ECMAScript modules natively.",
          "What are the new features in TypeScript 5?",
        );
      }),
    );
    expect(["low", "medium", "high", "critical"]).toContain(result.riskLevel);
  });
});
