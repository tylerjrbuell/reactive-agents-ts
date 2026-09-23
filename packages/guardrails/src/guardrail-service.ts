import { Effect, Context, Layer, Option } from "effect";
import { EventBus } from "@reactive-agents/core";
import { JudgmentService } from "@reactive-agents/judgment";
import type { GuardrailResult, GuardrailConfig, ViolationType, Severity } from "./types.js";
import { GuardrailError } from "./errors.js";
import { detectInjection } from "./detectors/injection-detector.js";
import { detectPii } from "./detectors/pii-detector.js";
import { detectToxicity } from "./detectors/toxicity-detector.js";
import { checkContract } from "./contracts/agent-contract.js";
import { runJudgmentBattery, maxSeverity } from "./detectors/judgment-battery.js";

type Violation = { readonly type: ViolationType; readonly severity: Severity; readonly message: string; readonly details?: string };

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

/**
 * Task 11: merges the opt-in judgment battery into `violations` for the
 * input-side `check()`. Runs parallel to the regex detectors that already
 * ran — never replaces them. `Effect.serviceOption` means an unconfigured
 * `JudgmentService` (no `.withJudgment()` on the builder) is a clean,
 * zero-cost no-op that doesn't widen this effect's requirements.
 *
 * "additive" (default): only ever ADDS a violation or escalates severity —
 * the result stays a superset of today's regex-only behavior, so nothing
 * that passes today can start blocking after enabling this.
 * "jev-primary" (explicit opt-in): the battery's verdict is authoritative
 * per type and can also remove a regex hit it disagrees with.
 */
const applyJudgmentBattery = (
  violations: Violation[],
  text: string,
  config: GuardrailConfig,
): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const maybeJudgment = yield* Effect.serviceOption(JudgmentService);
    if (Option.isNone(maybeJudgment)) return;

    const battery = yield* runJudgmentBattery(maybeJudgment.value, text);
    if (battery === null) return;

    const actionThreshold = config.judgmentActionThreshold ?? 0.7;
    const reviewThreshold = config.judgmentReviewThreshold ?? 0.4;
    const strictness = config.judgmentStrictness ?? "additive";

    const checks: ReadonlyArray<{ readonly type: ViolationType; readonly jevP: number; readonly message: string }> = [
      {
        type: "prompt-injection",
        jevP: Math.max(battery.injection, battery.jailbreakRoleplay),
        message: "Judgment battery flagged prompt injection or jailbreak attempt",
      },
      { type: "pii-detected", jevP: battery.piiExposure, message: "Judgment battery flagged PII exposure" },
      { type: "toxicity", jevP: battery.toxicity, message: "Judgment battery flagged toxic content" },
    ];

    for (const c of checks) {
      const regexIdx = violations.findIndex((v) => v.type === c.type);
      const regexHit = regexIdx !== -1;
      const jevHit = c.jevP >= actionThreshold;

      if (strictness === "jev-primary") {
        if (regexHit && !jevHit) {
          violations.splice(regexIdx, 1);
        } else if (!regexHit && jevHit) {
          violations.push({ type: c.type, severity: battery.severity, message: c.message });
        }
        continue;
      }

      // additive: never removes a regex hit; only escalates severity when this
      // SPECIFIC dimension also hit — the battery's one shared `severity` Score
      // must not inflate a violation type the battery itself disagrees with.
      if (!regexHit && jevHit) {
        violations.push({ type: c.type, severity: battery.severity, message: c.message });
      } else if (regexHit && jevHit) {
        violations[regexIdx] = {
          ...violations[regexIdx]!,
          severity: maxSeverity(violations[regexIdx]!.severity, battery.severity),
        };
      }
    }

    // Review band: evaluated per dimension (not one aggregate max) so a
    // borderline signal on one dimension still surfaces even when a
    // different dimension already crossed the action threshold.
    const dimensions: ReadonlyArray<{ readonly name: string; readonly probability: number }> = [
      { name: "injection", probability: battery.injection },
      { name: "pii_exposure", probability: battery.piiExposure },
      { name: "toxicity", probability: battery.toxicity },
      { name: "jailbreak_roleplay", probability: battery.jailbreakRoleplay },
    ];
    const reviewBand = dimensions.filter((d) => d.probability >= reviewThreshold && d.probability < actionThreshold);
    if (reviewBand.length > 0) {
      const maybeEventBus = yield* Effect.serviceOption(EventBus);
      if (Option.isSome(maybeEventBus)) {
        for (const d of reviewBand) {
          yield* maybeEventBus.value.publish({
            _tag: "GuardrailReviewFlagged",
            side: "input",
            dimension: d.name,
            probability: d.probability,
            severity: battery.severity,
          });
        }
      }
    }
  });

/**
 * Task 11 Step 3: observability-only output screening. Fires
 * `GuardrailOutputFlagged` with the battery's raw scores; never mutates the
 * returned `GuardrailResult` — enforcement is a follow-up task.
 */
const screenOutputWithJudgmentBattery = (text: string): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const maybeJudgment = yield* Effect.serviceOption(JudgmentService);
    if (Option.isNone(maybeJudgment)) return;

    const battery = yield* runJudgmentBattery(maybeJudgment.value, text);
    if (battery === null) return;

    const maybeEventBus = yield* Effect.serviceOption(EventBus);
    if (Option.isNone(maybeEventBus)) return;

    yield* maybeEventBus.value.publish({
      _tag: "GuardrailOutputFlagged",
      injection: battery.injection,
      piiExposure: battery.piiExposure,
      toxicity: battery.toxicity,
      jailbreakRoleplay: battery.jailbreakRoleplay,
      severity: battery.severity,
    });
  });

// ─── Live Implementation ───

export const GuardrailServiceLive = (config: GuardrailConfig) =>
  Layer.succeed(GuardrailService, {
    check: (text) =>
      Effect.gen(function* () {
        const violations: Violation[] = [];

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

        if (config.enableJudgmentBattery) {
          yield* applyJudgmentBattery(violations, text, config);
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
        const violations: Violation[] = [];

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

        if (config.screenOutputs) {
          yield* screenOutputWithJudgmentBattery(text);
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
