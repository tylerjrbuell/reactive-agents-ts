/**
 * Final-output screens shared by every arm.
 *
 * Owns: the behavioral-contract `checkOutput` screen (maxOutputLength /
 * deniedTopics / requireDisclosure — block severity fails the run, warning
 * severity surfaces via `obs`) and the guardrail final-output screen (PII /
 * toxicity — violations fail CLOSED with a published GuardrailViolationDetected
 * event; service errors fail OPEN but EMIT).
 *
 * Both run ONCE here, in the shared post-arm code that sees the final output
 * regardless of which arm produced it. The `return yield* Effect.fail(...)`
 * shapes are preserved: the failures leave this module's error channel and
 * propagate through the engine's `RuntimeErrors` union exactly as when the
 * code sat inline.
 *
 * Moved verbatim from execution-engine.ts (GH #221 W26 decomposition, former
 * "Behavioral contract: checkOutput" + "Guardrail final-output screen" blocks,
 * lines 1047-1159).
 */
import { Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { BehavioralContractService, GuardrailService } from "@reactive-agents/guardrails";
import type { ExecutionContext, ReactiveAgentsConfig } from "../types.js";
import { BehavioralContractViolationError, GuardrailViolationError } from "../errors.js";
import type { EbLike, ObsLike } from "./runtime-context.js";

export interface OutputScreenDeps {
  readonly config: ReactiveAgentsConfig;
  readonly ctx: ExecutionContext;
  readonly obs: ObsLike | null;
  readonly eb: EbLike | null;
  readonly outputForSuccess: string;
}

export const screenFinalOutput = (
  deps: OutputScreenDeps,
): Effect.Effect<void, BehavioralContractViolationError | GuardrailViolationError> => {
  const { config, ctx, obs, eb, outputForSuccess } = deps;
  return Effect.gen(function* () {
    // ── Behavioral contract: checkOutput (maxOutputLength / deniedTopics /
    // requireDisclosure) ──
    // The one dimension with no kernel-native equivalent AND no prior
    // caller anywhere in the monorepo (a pre-existing gap, not a Move-1
    // regression — see behavioral-contract-bridge.ts doc block). Runs
    // ONCE here, in the shared post-arm code that sees the final output
    // regardless of which arm produced it. A "block" severity violation
    // fails the run the same way the old inline-arm tool/iteration
    // violations did, for a uniform failure mode across all 3 contract
    // dimensions. A "warning" surfaces via `obs` without failing.
    if (config.enableBehavioralContracts) {
      const bcOpt = yield* Effect.serviceOption(BehavioralContractService).pipe(
        Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
      );
      if (bcOpt._tag === "Some") {
        const violation = yield* bcOpt.value.checkOutput(outputForSuccess).pipe(
          Effect.catchAll(() => Effect.succeed(null)),
        );
        if (violation) {
          if (violation.severity === "block") {
            return yield* Effect.fail(
              new BehavioralContractViolationError({
                message: violation.message,
                taskId: ctx.taskId,
                rule: violation.rule,
                violation: violation.message,
              }),
            );
          }
          if (obs) {
            yield* obs
              .info(`⚠ [behavioral-contract] ${violation.message}`)
              .pipe(
                Effect.catchAll((err) =>
                  emitErrorSwallowed({
                    site: "runtime/src/execution-engine.ts:behavioral-contract-output-warning",
                    tag: errorTag(err),
                  }),
                ),
              );
          }
        }
      }
    }

    // ── Guardrail final-output screen (PII / toxicity) ──────────
    // Wave 6.2: `GuardrailService.checkOutput` had no caller
    // anywhere — the GUARDRAIL phase screens only the INPUT, so a
    // run could exfiltrate PII it legitimately retrieved and ship
    // it as its answer. Runs ONCE here, next to the behavioral
    // contract output check, in the shared post-arm code that sees
    // the final output regardless of arm. Policy (explicit):
    // violations fail CLOSED (block + event, mirroring the input
    // phase); service errors fail OPEN but EMIT (never silent).
    if (config.enableGuardrails) {
      const goutOpt = yield* Effect.serviceOption(GuardrailService).pipe(
        Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
      );
      if (goutOpt._tag === "Some") {
        const outputCheck = yield* goutOpt.value.checkOutput(outputForSuccess).pipe(
          Effect.catchAll((err) =>
            Effect.gen(function* () {
              if (obs) {
                yield* obs
                  .info(
                    `⚠ [guardrail] output screen unavailable, failing open: ${String(err)}`,
                  )
                  .pipe(
                    Effect.catchAll((swallow) =>
                      emitErrorSwallowed({
                        site: "runtime/src/execution-engine.ts:guardrail-output-screen-unavailable",
                        tag: errorTag(swallow),
                      }),
                    ),
                  );
              }
              return null;
            }),
          ),
        );
        if (outputCheck !== null && !outputCheck.passed) {
          const outputViolationSummary = outputCheck.violations
            .map((v: { type: unknown; message: unknown }) => `${String(v.type)}: ${String(v.message)}`)
            .join("; ");
          if (eb) {
            yield* eb
              .publish({
                _tag: "GuardrailViolationDetected",
                taskId: ctx.taskId,
                violations: outputCheck.violations.map((v: { type: unknown; message: unknown }) =>
                  `${String(v.type)}: ${String(v.message)}`),
                score: outputCheck.score,
                blocked: true,
              })
              .pipe(
                Effect.catchAll((swallow) =>
                  emitErrorSwallowed({
                    site: "runtime/src/execution-engine.ts:guardrail-output-violation-publish",
                    tag: errorTag(swallow),
                  }),
                ),
              );
          }
          return yield* Effect.fail(
            new GuardrailViolationError({
              message: `Output guardrail check failed: ${outputViolationSummary}`,
              taskId: ctx.taskId,
              violation: outputViolationSummary,
            }),
          );
        }
      }
    }
  });
};
