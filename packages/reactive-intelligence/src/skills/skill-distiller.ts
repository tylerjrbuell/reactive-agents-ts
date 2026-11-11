import { Effect, Context, Layer } from "effect";
import type { SkillRecord } from "@reactive-agents/core";

// ─── Types ───

/** One skill whose refinement failed during a distillation pass. */
export type DistillationFailure = {
  readonly skillId: string;
  readonly skillName: string;
  /** Readable description of the failure or defect. */
  readonly cause: string;
};

/**
 * Outcome of one distillation pass. Each eligible (non-locked) skill lands in
 * exactly one bucket, so `refined + unchanged + skipped + failed` equals the
 * number of eligible skills.
 */
export type DistillationResult = {
  /** Refine returned a skill whose content differs from the input. */
  readonly refined: number;
  /** Refine ran but returned the same content (no LLM, LLM fallback, identical output). */
  readonly unchanged: number;
  /** Not enough real episodic evidence since the last refinement. */
  readonly skipped: number;
  /** Fetching episodes or refining failed; the pass continued with the other skills. */
  readonly failed: number;
  readonly failures: readonly DistillationFailure[];
};

/**
 * Whether a refine actually changed the skill. Content decides, not the
 * version number: a bumped version with identical instructions is a no-op.
 */
const contentChanged = (before: SkillRecord, after: SkillRecord): boolean =>
  after.instructions !== before.instructions ||
  after.contentVariants.full !== before.contentVariants.full;

const describeCause = (cause: unknown): string => {
  if (typeof cause === "string") return cause;
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    return String(cause.message);
  }
  return String(cause);
};

type SkillOutcome = "refined" | "unchanged" | "skipped";

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
        const counts = { refined: 0, unchanged: 0, skipped: 0 };
        const failures: DistillationFailure[] = [];

        // 1. Get all non-locked skills
        const allSkills = yield* deps.listSkills(agentId);
        const eligibleSkills = allSkills.filter((s) => s.evolutionMode !== "locked");

        for (const skill of eligibleSkills) {
          const processSkill = Effect.gen(function* () {
            // 2. Get episodic entries since lastRefinedAt (or createdAt)
            const since = skill.lastRefinedAt ?? skill.createdAt;
            const episodes = yield* deps.getRecentEpisodes(agentId, since, 100);

            // 3. Filter out test-provider entries
            const realEpisodes = episodes.filter((e) => {
              const provider = e.provider;
              if (!provider) return true; // no provider = assume real
              return provider !== "test" && !provider.startsWith("test-");
            });

            // 4. Check threshold (below it, the skill is skipped)
            let outcome: SkillOutcome = "skipped";
            if (realEpisodes.length >= config.refinementThreshold) {
              // 5. Refine; only a content change counts as a refinement
              const after = yield* deps.refineSkill(skill, realEpisodes);
              outcome = contentChanged(skill, after) ? "refined" : "unchanged";
            }
            return outcome;
          });

          // One skill's failure (or defect) is recorded and the pass moves on.
          const outcome = yield* processSkill.pipe(
            Effect.catchAllDefect((defect) => Effect.fail(defect)),
            Effect.either,
          );
          if (outcome._tag === "Right") {
            counts[outcome.right]++;
          } else {
            failures.push({ skillId: skill.id, skillName: skill.name, cause: describeCause(outcome.left) });
          }
        }

        return { ...counts, failed: failures.length, failures };
      }),
  });
