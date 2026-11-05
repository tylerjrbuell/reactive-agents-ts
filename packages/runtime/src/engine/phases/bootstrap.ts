/**
 * BOOTSTRAP phase — fetch memory context for the agent (working memory,
 * episodic recap, semantic context). Transitions agentState `bootstrapping`
 * → `running`.
 *
 * The memory service is acquired lazily (it may not be wired). Failures fall
 * back to `memoryContext: undefined`; downstream phases handle the absent case.
 *
 * Extracted from `execution-engine.ts:828-852` (Phase 1: BOOTSTRAP).
 *
 * NOTE: Post-bootstrap initialization (skill application, experience tips,
 * MemorySnapshot publishing) currently lives inline in `execution-engine.ts`
 * between bootstrap and guardrail phases. Those concerns are not part of the
 * Phase contract and are folded into orchestrator code; future waves may
 * promote them into dedicated phases or into bootstrap itself.
 */
import { Effect } from "effect";
import { MemoryService } from "@reactive-agents/memory";
import type { Phase } from "../phase.js";

const MemoryServiceTag = MemoryService;

export const bootstrap: Phase = {
  name: "bootstrap",

  run: (ctx, _deps) =>
    Effect.gen(function* () {
      const memoryContext = yield* Effect.serviceOption(MemoryServiceTag).pipe(
        Effect.flatMap((opt) =>
          opt._tag === "Some"
            ? opt.value.bootstrap(ctx.agentId).pipe(Effect.map((mc) => mc))
            : Effect.succeed(undefined),
        ),
        Effect.catchAll(() => Effect.succeed(undefined)),
      );

      return {
        ...ctx,
        agentState: "running" as const,
        memoryContext,
      };
    }),
};
