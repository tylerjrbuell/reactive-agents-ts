import { Effect, Context, Layer } from "effect";
import type { SkillRecord } from "@reactive-agents/core";

// ─── Types ───

export type DistillationResult = {
  readonly refined: number;
  readonly skipped: number;
  readonly errors: number;
};

export type SkillDistillerConfig = {
  readonly refinementThreshold: number; // default: 5 episodic entries since lastRefinedAt
};

/**
 * Interface for the distiller's external dependencies.
 * These are injected to avoid direct package imports from reactive-intelligence → memory.
 */
export type SkillDistillerDeps = {
  readonly listSkills: (agentId: string) => Effect.Effect<SkillRecord[], unknown>;
  readonly getRecentEpisodes: (
    agentId: string,
    since: Date,
    limit: number,
  ) => Effect.Effect<readonly { content: string; provider?: string; createdAt: Date }[], unknown>;
  readonly refineSkill: (
    skill: SkillRecord,
    episodes: readonly { content: string }[],
  ) => Effect.Effect<SkillRecord, unknown>;
};

// ─── Service Tag ───

export class SkillDistillerService extends Context.Tag("SkillDistillerService")<
  SkillDistillerService,
  {
    /**
     * Run a distillation pass for an agent.
     * For each non-locked skill with enough episodic evidence, trigger LLM refinement.
     * Filters out test-provider entries from episodic evidence.
     */
    readonly distill: (agentId: string) => Effect.Effect<DistillationResult, unknown>;
  }
>() {}

// ─── Factory ───

export const makeSkillDistillerService = (
  deps: SkillDistillerDeps,
  config: SkillDistillerConfig = { refinementThreshold: 5 },
): Layer.Layer<SkillDistillerService> =>
  Layer.succeed(SkillDistillerService, {
    distill: (agentId) =>
      Effect.gen(function* () {
        let refined = 0;
        let skipped = 0;
        let errors = 0;

        // 1. Get all non-locked skills
        const allSkills = yield* deps.listSkills(agentId);
        const eligibleSkills = allSkills.filter((s) => s.evolutionMode !== "locked");

        for (const skill of eligibleSkills) {
          try {
            // 2. Get episodic entries since lastRefinedAt (or createdAt)
            const since = skill.lastRefinedAt ?? skill.createdAt;
            const episodes = yield* deps.getRecentEpisodes(agentId, since, 100);

            // 3. Filter out test-provider entries
            const realEpisodes = episodes.filter((e) => {
              const provider = e.provider;
              if (!provider) return true; // no provider = assume real
              return provider !== "test" && !provider.startsWith("test-");
            });

            // 4. Check threshold
            if (realEpisodes.length < config.refinementThreshold) {
              skipped++;
              continue;
            }

            // 5. Refine
            yield* deps.refineSkill(skill, realEpisodes);
            refined++;
          } catch {
            errors++;
          }
        }

        return { refined, skipped, errors };
      }),
  });
