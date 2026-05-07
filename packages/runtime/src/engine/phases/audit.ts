/**
 * AUDIT phase — emit a single observability info log summarizing the run for
 * compliance and monitoring. Optional; gated by `config.enableAudit`.
 *
 * Extracted from `execution-engine.ts:3692-3711` (Phase 9: AUDIT).
 */
import { Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { Phase } from "../phase.js";

export const audit: Phase = {
  name: "audit",

  skip: (_ctx, deps) => !deps.config.enableAudit,

  run: (ctx, deps) =>
    Effect.gen(function* () {
      if (deps.obs) {
        yield* deps.obs
          .info("Execution audit trail", {
            taskId: ctx.taskId,
            agentId: ctx.agentId,
            iterations: ctx.iteration,
            tokensUsed: ctx.tokensUsed,
            cost: ctx.cost,
            strategy: ctx.selectedStrategy,
            duration: Date.now() - ctx.startedAt.getTime(),
            phase: "audit",
          })
          .pipe(
            Effect.catchAll((err) =>
              emitErrorSwallowed({ site: "runtime/src/engine/phases/audit.ts:run", tag: errorTag(err) }),
            ),
          );
      }
      return ctx;
    }),
};
