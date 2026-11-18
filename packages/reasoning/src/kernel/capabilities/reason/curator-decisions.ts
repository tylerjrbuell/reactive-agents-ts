/**
 * Curator-decision trace events for one projected render (think.ts).
 *
 * The projector's per-result keep-vs-compress decision reaches the debrief as
 * `CuratorDecisionEmitted` events (event -> execution-engine rationaleLog ->
 * trace normalize -> diagnose debrief). Each COMPRESSED result is the
 * budget-relevant evidence; a render that compressed nothing emits one "kept"
 * for the last projected result so a clean tool-using run still clears the
 * trace analyzer's curation blindspot.
 *
 * A compressed result stays compressed on every later turn, so emitting it per
 * turn grew the trace as results x iterations (audit 2026-11-18). Each ref's
 * `compressed` decision is emitted once per run: the refs already emitted live
 * in a run slot (`reset` for sub-agents, which curate their own window).
 * Outside a run scope there is no run to dedupe across, so every render emits.
 */
import { Effect } from "effect";
import { currentRunContext, getRunSlot, runSlot, type RunSlot } from "@reactive-agents/core/internal/run-scope";
import type { MessageTrace } from "../../../assembly/trace.js";
import { emitCuratorDecision } from "../../utils/diagnostics.js";

/** Refs whose `compressed` decision this run already emitted. Mutated in place. */
export type CuratorEmittedRefs = Set<string>;

/** The run's emitted-compression refs (fresh per run and per sub-agent run). */
export const curatorEmittedRefsSlot: RunSlot<CuratorEmittedRefs> = runSlot<CuratorEmittedRefs>(
  "reasoning.curatorEmittedRefs",
  { child: "reset", fresh: () => new Set() },
);

/** The active run's set, or `null` outside a run scope (no cross-turn dedupe). */
const runEmittedRefs: Effect.Effect<CuratorEmittedRefs | null> = Effect.flatMap(currentRunContext, (run) =>
  run === null ? Effect.succeed(null) : getRunSlot(curatorEmittedRefsSlot),
);

/** Emit the curator decisions for one render's projected messages. */
export function emitCuratorDecisions(args: {
  readonly taskId: string;
  readonly iteration: number;
  readonly messages: readonly MessageTrace[];
  readonly capability: { readonly window: number; readonly tier: string };
}): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const emitted = yield* runEmittedRefs;
    const toolResults = args.messages.filter(
      (m): m is MessageTrace & { ref: string } => m.role === "tool_result" && typeof m.ref === "string",
    );
    const compressedRefs = new Set<string>();
    for (const m of toolResults) {
      if (m.projection !== "preview+ref") continue;
      compressedRefs.add(m.ref);
      if (emitted?.has(m.ref) === true) continue;
      emitted?.add(m.ref);
      yield* emitCuratorDecision({
        taskId: args.taskId,
        iteration: args.iteration,
        action: "compressed",
        targetRef: m.ref,
        rationale: {
          why: `overflow: ${m.rawChars ?? m.chars} chars > budget ${m.budget ?? 0} (window ${args.capability.window}, ${args.capability.tier}) — projected as preview+ref`,
          refs: [m.ref],
        },
      });
    }
    const lastKept = [...toolResults].reverse().find((m) => !compressedRefs.has(m.ref));
    if (compressedRefs.size === 0 && lastKept) {
      yield* emitCuratorDecision({
        taskId: args.taskId,
        iteration: args.iteration,
        action: "kept",
        targetRef: lastKept.ref,
        rationale: {
          why: `fit: ${lastKept.chars} chars <= budget ${lastKept.budget ?? args.capability.window} — kept full`,
          refs: [lastKept.ref],
        },
      });
    }
  });
}
