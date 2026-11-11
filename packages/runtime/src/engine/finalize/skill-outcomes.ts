/**
 * Living-skills usage stats: after a run ends, every SkillStore skill the run
 * used gets its `useCount`, `successRate` and `lastActivatedAt` updated from
 * the run's one outcome (`runOutcome`, the debrief's verdict).
 *
 * "Used" means the run put the skill body in context: bootstrap activations
 * (builder and run pins plus relevance picks, `ctx.metadata.autoActivateSkills`)
 * and agent activations (`activate-skill`, the run ledger's `skill-activated`
 * facts). A name with no SkillStore record (a filesystem-only skill) is
 * skipped: there is no stored stat to update.
 *
 * Outcome credit matches the procedural-memory lane in local-learning.ts:
 * `failure` counts against the skill, `success` and `partial` count for it,
 * and `abstained` adds no evidence (only `lastActivatedAt` moves).
 *
 * Runs only when `SkillStoreService` is provided (memory on and
 * `skillPersistence` not `false`). Store failures are swallowed to the shared
 * channel: bookkeeping never fails a finished run.
 */
import { Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { SkillStoreService } from "@reactive-agents/memory";
import type { RunOutcomeClass } from "../util.js";
import { readRunLedger } from "../run-ledger-scope.js";

/** One skill's stats after one more use. Pure. */
export const nextSkillStats = (
  prior: { readonly useCount: number; readonly successRate: number },
  outcome: RunOutcomeClass,
): { readonly useCount: number; readonly successRate: number } => {
  if (outcome === "abstained") return prior;
  const useCount = prior.useCount + 1;
  const credit = outcome === "failure" ? 0 : 1;
  return { useCount, successRate: (prior.successRate * prior.useCount + credit) / useCount };
};

const namesIn = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.flatMap((s: unknown) =>
        typeof s === "object" && s !== null && "name" in s && typeof s.name === "string" && s.name.length > 0
          ? [s.name]
          : [],
      )
    : [];

/**
 * The skill names a run used, deduped in first-seen order: bootstrap
 * activations, then agent activations from the run ledger. Pure.
 */
export const usedSkillNames = (
  metadata: Readonly<Record<string, unknown>> | undefined,
): readonly string[] => {
  const bootstrap = namesIn(metadata?.["autoActivateSkills"]);
  const agent = (readRunLedger(metadata) ?? []).flatMap((e) => (e.kind === "skill-activated" ? [e.name] : []));
  return Array.from(new Set([...bootstrap, ...agent]));
};

/** Update the stored stats of each used skill from the run outcome. */
export const recordSkillOutcomes = (args: {
  readonly agentId: string;
  readonly skillNames: readonly string[];
  readonly runOutcome: RunOutcomeClass;
  readonly now?: Date;
}): Effect.Effect<void, never> => {
  if (args.skillNames.length === 0) return Effect.void;
  return Effect.gen(function* () {
    const storeOpt = yield* Effect.serviceOption(SkillStoreService);
    if (storeOpt._tag !== "Some") return;
    const store = storeOpt.value;
    const at = args.now ?? new Date();
    yield* Effect.forEach(
      args.skillNames,
      (name) =>
        Effect.gen(function* () {
          const skill = yield* store.getByName(args.agentId, name);
          if (skill === null) return;
          const stats = nextSkillStats(skill, args.runOutcome);
          yield* store.update(skill.id, { ...stats, lastActivatedAt: at });
        }).pipe(
          Effect.catchAll((err) =>
            emitErrorSwallowed({ site: "runtime/src/engine/finalize/skill-outcomes.ts:record-skill-outcome", tag: errorTag(err) }),
          ),
        ),
      { discard: true },
    );
  });
};
