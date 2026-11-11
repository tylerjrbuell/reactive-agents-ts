/**
 * Production wiring for `agent.refineSkills()` (living skills, roadmap F5).
 *
 * The reactive-intelligence `SkillDistillerService` takes its dependencies
 * injected (`SkillDistillerDeps`) so that package never imports memory. This
 * module builds those deps from the agent's own services:
 *
 *   - `listSkills`: the agent's `SkillStoreService` records.
 *   - `getRecentEpisodes`: `EpisodicMemoryService.getRecent`, kept to entries
 *     newer than the skill's last refinement (or creation).
 *   - `refineSkill`: memory's `SkillEvolutionService.refine`, with the LLM
 *     bridged from the agent's own `LLMService` (its configured provider).
 *     A refine that changed the skill's content publishes `SkillRefined`.
 *
 * Opt-in by construction: the deps exist only when the agent's runtime holds
 * a SkillStore (memory on, `skillPersistence` not `false`), episodic memory
 * and an LLM. Otherwise {@link buildSkillDistillerDeps} yields `null` and the
 * facade reports zero counts.
 */
import { Context, Effect, Layer, Option } from "effect";
import type { SkillRecord } from "@reactive-agents/core";
import { LLMService } from "@reactive-agents/llm-provider";
import {
  EpisodicMemoryService,
  SkillEvolutionService,
  SkillStoreService,
  makeSkillEvolutionService,
  type DailyLogEntry,
  type MemoryLLM,
} from "@reactive-agents/memory";
import type { DistillationResult, SkillDistillerDeps } from "@reactive-agents/reactive-intelligence";
import { publishSkillEvent } from "../engine/finalize/skill-outcomes.js";

/**
 * What `agent.refineSkills()` reports. Each eligible (non-locked) skill lands
 * in exactly one bucket: `refined` (content changed, version bumped),
 * `unchanged` (refine ran, same content), `skipped` (fewer than the threshold
 * of episodic entries since its last refinement) or `failed`.
 */
export interface SkillRefinementResult {
  readonly refined: number;
  readonly unchanged: number;
  readonly skipped: number;
  readonly failed: number;
}

/** Zero counts: no distiller configured, or the pass itself could not run. */
export const NO_SKILL_REFINEMENT: SkillRefinementResult = { refined: 0, unchanged: 0, skipped: 0, failed: 0 };

/** Project a distillation pass onto the public result shape. Pure. */
export const toSkillRefinementResult = (r: DistillationResult): SkillRefinementResult => ({
  refined: r.refined,
  unchanged: r.unchanged,
  skipped: r.skipped,
  failed: r.failed,
});

const memoryRole = (role: string): "system" | "assistant" | "user" =>
  role === "system" ? "system" : role === "assistant" ? "assistant" : "user";

/** Bridge the agent's LLMService into the memory package's `MemoryLLM`. */
const bridgeLlm = (llm: Context.Tag.Service<typeof LLMService>): MemoryLLM => ({
  complete: (req) =>
    llm
      .complete({
        messages: req.messages.map((m) => ({ role: memoryRole(m.role), content: m.content })),
        temperature: req.temperature,
        maxTokens: req.maxTokens,
      })
      .pipe(
        Effect.map((r) => ({
          content: r.content,
          usage: r.usage ? { totalTokens: r.usage.totalTokens } : undefined,
        })),
      ),
});

const contentChanged = (before: SkillRecord, after: SkillRecord): boolean =>
  after.instructions !== before.instructions || after.contentVariants.full !== before.contentVariants.full;

/**
 * Build `SkillDistillerDeps` from the agent's services, or `null` when the
 * agent has no SkillStore, episodic memory or LLM.
 */
export const buildSkillDistillerDeps = (): Effect.Effect<SkillDistillerDeps | null> =>
  Effect.gen(function* () {
    const storeOpt = yield* Effect.serviceOption(SkillStoreService);
    const episodicOpt = yield* Effect.serviceOption(EpisodicMemoryService);
    const llmOpt = yield* Effect.serviceOption(LLMService);
    if (Option.isNone(storeOpt) || Option.isNone(episodicOpt) || Option.isNone(llmOpt)) return null;
    const store = storeOpt.value;
    const episodic = episodicOpt.value;
    const evolutionLayer = makeSkillEvolutionService(bridgeLlm(llmOpt.value)).pipe(
      Layer.provide(Layer.succeed(SkillStoreService, store)),
    );
    // The distiller hands back the episode objects it was given (filtered), so
    // the full DailyLogEntry is recovered by identity for `refine`.
    const entries = new WeakMap<object, DailyLogEntry>();

    return {
      listSkills: (agentId) => store.listAll(agentId),
      getRecentEpisodes: (agentId, since, limit) =>
        episodic.getRecent(agentId, limit).pipe(
          Effect.map((all) => {
            const recent = all.filter((e) => e.createdAt.getTime() > since.getTime());
            for (const e of recent) entries.set(e, e);
            return recent;
          }),
        ),
      refineSkill: (skill, episodes) =>
        Effect.gen(function* () {
          const evolution = yield* SkillEvolutionService;
          const evidence = episodes.flatMap((e) => {
            const entry = entries.get(e);
            return entry ? [entry] : [];
          });
          const after = yield* evolution.refine(skill, evidence);
          if (contentChanged(skill, after)) {
            yield* publishSkillEvent({
              _tag: "SkillRefined",
              skillName: skill.name,
              previousVersion: skill.version,
              newVersion: after.version,
              taskCategory: skill.taskCategories[0] ?? "general",
            });
          }
          return after;
        }).pipe(Effect.provide(evolutionLayer)),
    } satisfies SkillDistillerDeps;
  });
