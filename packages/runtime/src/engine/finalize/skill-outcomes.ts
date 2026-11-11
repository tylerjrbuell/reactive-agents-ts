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
 * After the stats update, each skill is re-read from the store and run through
 * the memory package's SkillEvolutionService: `checkRegression` first (a
 * refined candidate with at least 3 uses since refinement whose success rate
 * fell below its rate at refinement rolls back to the prior version,
 * publishing `SkillRolledBack`), then, only when
 * nothing rolled back, `checkPromotion` (tentative to trusted at 5+ uses and
 * 0.8+, trusted to expert at 20+ uses and 0.9+, never for locked skills,
 * publishing `SkillPromoted`).
 *
 * Runs only when `SkillStoreService` is provided (memory on and
 * `skillPersistence` not `false`). Store failures are swallowed to the shared
 * channel: bookkeeping never fails a finished run.
 */
import { Context, Effect, Layer } from "effect";
import { EventBus, emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { AgentEvent } from "@reactive-agents/core";
import { SkillEvolutionService, SkillStoreService, makeSkillEvolutionService } from "@reactive-agents/memory";
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

/**
 * Publish one skill lifecycle event when an EventBus is present. Shared by the
 * run-end evolution step here and `agent.refineSkills()`.
 */
export const publishSkillEvent = (event: AgentEvent): Effect.Effect<void, never> =>
  Effect.serviceOption(EventBus).pipe(
    Effect.flatMap((bus) => (bus._tag === "Some" ? bus.value.publish(event) : Effect.void)),
  );

/**
 * Regression check, then promotion check, on the skill's CURRENT store record
 * (re-read after the stats update, so the thresholds see this run's evidence).
 */
const evolveSkill = (
  store: Context.Tag.Service<typeof SkillStoreService>,
  skillId: string,
  taskId: string | undefined,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const evolution = yield* SkillEvolutionService;
    const current = yield* store.get(skillId);
    if (current === null) return;
    const regression = yield* evolution.checkRegression(current);
    if (regression.rolledBack) {
      const restored = yield* store.get(skillId);
      yield* publishSkillEvent({
        _tag: "SkillRolledBack",
        skillName: current.name,
        fromVersion: current.version,
        toVersion: restored?.version ?? current.version - 1,
        reason: "regression",
        ...(taskId !== undefined ? { taskId } : {}),
      });
      return;
    }
    const promotion = yield* evolution.checkPromotion(current);
    if (promotion.promoted && promotion.newConfidence !== undefined) {
      yield* publishSkillEvent({
        _tag: "SkillPromoted",
        skillName: current.name,
        fromConfidence: current.confidence,
        toConfidence: promotion.newConfidence,
        ...(taskId !== undefined ? { taskId } : {}),
      });
    }
  }).pipe(Effect.provide(makeSkillEvolutionService().pipe(Layer.provide(Layer.succeed(SkillStoreService, store)))));

/**
 * Update the stored stats of each used skill from the run outcome, then promote
 * or roll back. `taskId` (the run's task) rides on the published
 * `SkillPromoted` / `SkillRolledBack` events so observers can link them to the run.
 */
export const recordSkillOutcomes = (args: {
  readonly agentId: string;
  readonly taskId?: string;
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
          yield* evolveSkill(store, skill.id, args.taskId);
        }).pipe(
          Effect.catchAll((err) =>
            emitErrorSwallowed({ site: "runtime/src/engine/finalize/skill-outcomes.ts:record-skill-outcome", tag: errorTag(err) }),
          ),
        ),
      { discard: true },
    );
  });
};
