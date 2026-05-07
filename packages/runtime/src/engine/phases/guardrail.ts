/**
 * GUARDRAIL phase — input safety check (prompt injection, PII, policy violations).
 *
 * Optional; gated by `config.enableGuardrails`. Acquires `GuardrailService`
 * lazily inside the phase (the service may or may not be wired into the layer).
 *
 * On violation: publishes `GuardrailViolationDetected` and fails with
 * `GuardrailViolationError`. On pass: writes the score into `ctx.metadata`.
 *
 * Extracted from `execution-engine.ts:986-1044` (Phase 2: GUARDRAIL).
 */
import { Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { GuardrailService } from "@reactive-agents/guardrails";
import { GuardrailViolationError } from "../../errors.js";
import { extractTaskText } from "../util.js";
import type { Phase } from "../phase.js";

export const guardrail: Phase = {
  name: "guardrail",

  skip: (_ctx, deps) => !deps.config.enableGuardrails,

  run: (ctx, deps) =>
    Effect.gen(function* () {
      const guardrailOpt = yield* Effect.serviceOption(GuardrailService).pipe(
        Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
      );
      if (guardrailOpt._tag !== "Some") return ctx;

      const inputText = extractTaskText(deps.task.input);
      const result = yield* guardrailOpt.value.check(inputText).pipe(
        Effect.catchAll(() =>
          Effect.succeed({
            passed: true,
            violations: [],
            score: 1,
            checkedAt: new Date(),
          }),
        ),
      );

      if (!result.passed) {
        const violationSummary = result.violations
          .map((v: any) => `${v.type}: ${v.message}`)
          .join("; ");
        if (deps.eb) {
          yield* deps.eb
            .publish({
              _tag: "GuardrailViolationDetected",
              taskId: ctx.taskId,
              violations: result.violations.map((v: any) => `${v.type}: ${v.message}`),
              score: result.score,
              blocked: true,
            })
            .pipe(
              Effect.catchAll((err) =>
                emitErrorSwallowed({
                  site: "runtime/src/engine/phases/guardrail.ts:violation-publish",
                  tag: errorTag(err),
                }),
              ),
            );
        }
        return yield* Effect.fail(
          new GuardrailViolationError({
            message: `Input guardrail check failed: ${violationSummary}`,
            taskId: ctx.taskId,
            violation: violationSummary,
          }),
        );
      }

      return {
        ...ctx,
        metadata: { ...ctx.metadata, guardrailScore: result.score },
      };
    }),
};
