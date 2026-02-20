import { Effect, Context, Layer } from "effect";
import type { GuardrailResult, GuardrailConfig } from "./types.js";
import { GuardrailError } from "./errors.js";
import { detectInjection } from "./detectors/injection-detector.js";
import { detectPii } from "./detectors/pii-detector.js";
import { detectToxicity } from "./detectors/toxicity-detector.js";
import { checkContract } from "./contracts/agent-contract.js";

// ─── Service Tag ───

export class GuardrailService extends Context.Tag("GuardrailService")<
  GuardrailService,
  {
    /** Check input text against all configured guardrails. */
    readonly check: (text: string) => Effect.Effect<GuardrailResult, GuardrailError>;

    /** Check output text (may have different rules). */
    readonly checkOutput: (text: string) => Effect.Effect<GuardrailResult, GuardrailError>;

    /** Get current config. */
    readonly getConfig: () => Effect.Effect<GuardrailConfig, never>;
  }
>() {}

// ─── Live Implementation ───

export const GuardrailServiceLive = (config: GuardrailConfig) =>
  Layer.succeed(GuardrailService, {
    check: (text) =>
      Effect.gen(function* () {
        const violations: Array<{ type: GuardrailResult["violations"][number]["type"]; severity: GuardrailResult["violations"][number]["severity"]; message: string; details?: string }> = [];

        if (config.enableInjectionDetection) {
          const result = yield* detectInjection(text);
          if (result.detected) {
            violations.push({
              type: result.type,
              severity: result.severity,
              message: result.message,
              details: result.details,
            });
          }
        }

        if (config.enablePiiDetection) {
          const result = yield* detectPii(text);
          if (result.detected) {
            violations.push({
              type: result.type,
              severity: result.severity,
              message: result.message,
              details: result.details,
            });
          }
        }

        if (config.enableToxicityDetection) {
          const result = yield* detectToxicity(text, config.customBlocklist ?? []);
          if (result.detected) {
            violations.push({
              type: result.type,
              severity: result.severity,
              message: result.message,
              details: result.details,
            });
          }
        }

        if (config.contract) {
          const result = yield* checkContract(text, config.contract);
          if (result.detected) {
            violations.push({
              type: result.type,
              severity: result.severity,
              message: result.message,
              details: result.details,
            });
          }
        }

        const score = violations.length === 0 ? 1 : Math.max(0, 1 - violations.length * 0.25);

        return {
          passed: violations.length === 0,
          violations: [...violations],
          score,
          checkedAt: new Date(),
        } satisfies GuardrailResult;
      }),

    checkOutput: (text) =>
      Effect.gen(function* () {
        const violations: Array<{ type: GuardrailResult["violations"][number]["type"]; severity: GuardrailResult["violations"][number]["severity"]; message: string; details?: string }> = [];

        // Output checks: PII and toxicity (not injection)
        if (config.enablePiiDetection) {
          const result = yield* detectPii(text);
          if (result.detected) {
            violations.push({
              type: result.type,
              severity: result.severity,
              message: result.message,
              details: result.details,
            });
          }
        }

        if (config.enableToxicityDetection) {
          const result = yield* detectToxicity(text, config.customBlocklist ?? []);
          if (result.detected) {
            violations.push({
              type: result.type,
              severity: result.severity,
              message: result.message,
              details: result.details,
            });
          }
        }

        if (config.contract) {
          const result = yield* checkContract(text, config.contract);
          if (result.detected) {
            violations.push({
              type: result.type,
              severity: result.severity,
              message: result.message,
              details: result.details,
            });
          }
        }

        const score = violations.length === 0 ? 1 : Math.max(0, 1 - violations.length * 0.25);

        return {
          passed: violations.length === 0,
          violations: [...violations],
          score,
          checkedAt: new Date(),
        } satisfies GuardrailResult;
      }),

    getConfig: () => Effect.succeed(config),
  });
