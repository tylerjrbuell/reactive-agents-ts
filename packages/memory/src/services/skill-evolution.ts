import { Effect, Context, Layer } from "effect";
import type { SkillRecord, SkillVersion, SkillConfidence } from "@reactive-agents/core";
import type { MemoryLLM, DailyLogEntry } from "../types.js";
import { DatabaseError } from "../errors.js";
import { SkillStoreService } from "./skill-store.js";

// ─── Service Tag ───

export class SkillEvolutionService extends Context.Tag("SkillEvolutionService")<
  SkillEvolutionService,
  {
    /**
     * Refine a skill's instructions using LLM based on recent episodic evidence.
     * Skips locked skills. Creates a "candidate" version.
     * Also generates contentVariants (summary/condensed) via LLM, falling back to heuristic.
     */
    readonly refine: (
      skill: SkillRecord,
      recentEpisodes: readonly DailyLogEntry[],
    ) => Effect.Effect<SkillRecord, DatabaseError>;

    /**
     * Check if a skill has regressed post-refinement.
     * If successRate dropped below the rate at refinement time, rollback.
     */
    readonly checkRegression: (
      skill: SkillRecord,
    ) => Effect.Effect<{ rolledBack: boolean }, DatabaseError>;

    /**
     * Check confidence promotion thresholds and promote if eligible.
     * tentative→trusted: 5+ uses, successRate >= 0.8
     * trusted→expert: 20+ uses, successRate >= 0.9
     */
    readonly checkPromotion: (
      skill: SkillRecord,
    ) => Effect.Effect<{ promoted: boolean; newConfidence?: SkillConfidence }, DatabaseError>;

    /**
     * Generate summary and condensed content variants from full instructions.
     * Uses LLM when available, falls back to heuristic extraction.
     */
    readonly generateVariants: (
      instructions: string,
    ) => Effect.Effect<{ summary: string; condensed: string }, unknown>;
  }
>() {}

// ─── Heuristic Helpers ───

/**
 * Split by `#` headings and take the first sentence of each section body.
 */
const heuristicSummary = (instructions: string): string => {
  const sections = instructions.split(/^#{1,3}\s+.+$/m);
  const headings = instructions.match(/^#{1,3}\s+.+$/gm) ?? [];
  const parts: string[] = [];
  for (let i = 0; i < headings.length; i++) {
    const body = sections[i + 1]?.trim() ?? "";
    if (!body) continue;
    const firstSentence = body.split(/(?<=[.!?])\s+/)[0] ?? body.slice(0, 100);
    parts.push(`${headings[i]!.replace(/^#+\s*/, "")} — ${firstSentence.trim()}`);
  }
  if (parts.length === 0) {
    // Fallback: first two sentences of the whole text
    const sentences = instructions.split(/(?<=[.!?])\s+/);
    return sentences.slice(0, 2).join(" ").trim();
  }
  return parts.join(". ");
};

const ACTION_VERBS =
  /^(Load|Run|Create|Check|Return|Parse|Use|Add|Remove|Set|Get|Find|Build|Send|Call|Fetch|Query|Write|Read|Save|Delete|Update|Validate|Generate|Process|Execute|Extract|Filter|Map|Reduce|Sort|Merge|Split|Convert|Transform|Format|Initialize|Start|Stop|Handle|Emit|Log|Register|Configure|Apply|Install|Enable|Disable|Trigger|Wait|Retry|Skip|Pass|Fail)\b/;

/**
 * Extract only imperative sentences (start with uppercase action verb).
 */
const heuristicCondensed = (instructions: string): string => {
  const lines = instructions
    .split(/\n+/)
    .map((l) => l.replace(/^[-*\d.]+\s*/, "").trim())
    .filter((l) => ACTION_VERBS.test(l));
  if (lines.length === 0) {
    // Fallback: first sentence
    const first = instructions.split(/(?<=[.!?])\s+/)[0] ?? instructions.slice(0, 120);
    return first.trim();
  }
  return lines.slice(0, 8).join(" ");
};

// ─── Live Implementation ───

export const makeSkillEvolutionService = (llm?: MemoryLLM) =>
  Layer.effect(
    SkillEvolutionService,
    Effect.gen(function* () {
      const store = yield* SkillStoreService;

      const generateVariants = (
        instructions: string,
      ): Effect.Effect<{ summary: string; condensed: string }, unknown> =>
        Effect.gen(function* () {
          if (!llm) {
            return {
              summary: heuristicSummary(instructions),
              condensed: heuristicCondensed(instructions),
            };
          }

          const summaryResult = yield* llm
            .complete({
              messages: [
                {
                  role: "user",
                  content: `Condense these skill instructions to key directives only, ~500 tokens. Remove examples and references.\n\n${instructions}`,
                },
              ],
              temperature: 0.3,
              maxTokens: 600,
            })
            .pipe(Effect.option);

          const condensedResult = yield* llm
            .complete({
              messages: [
                {
                  role: "user",
                  content: `Condense to essential directives only, ~150 tokens. Keep only imperative sentences.\n\n${instructions}`,
                },
              ],
              temperature: 0.3,
              maxTokens: 200,
            })
            .pipe(Effect.option);

          return {
            summary:
              summaryResult._tag === "Some"
                ? summaryResult.value.content.trim()
                : heuristicSummary(instructions),
            condensed:
              condensedResult._tag === "Some"
                ? condensedResult.value.content.trim()
                : heuristicCondensed(instructions),
          };
        });

      return {
        refine: (skill: SkillRecord, recentEpisodes: readonly DailyLogEntry[]) =>
          Effect.gen(function* () {
            // Guard: skip locked skills
            if (skill.evolutionMode === "locked") {
              return skill;
            }

            // Guard: no LLM available
            if (!llm) {
              return skill;
            }

            // Build the refinement prompt
            const episodeSummaries = recentEpisodes
              .map((e) => `- ${e.content}`)
              .join("\n");

            const newInstructionsResult = yield* llm
              .complete({
                messages: [
                  {
                    role: "system",
                    content:
                      "You are a skill refinement engine. Given the current skill instructions and recent execution summaries, produce improved instructions. Be more specific about edge cases, better approaches, and failure patterns observed. Return ONLY the improved markdown instructions, nothing else.",
                  },
                  {
                    role: "user",
                    content: `Current instructions:\n${skill.instructions}\n\nRecent execution summaries:\n${episodeSummaries}`,
                  },
                ],
                temperature: 0.5,
                maxTokens: 2000,
              })
              .pipe(Effect.option);

            // If LLM call failed, return skill unchanged
            if (newInstructionsResult._tag === "None") {
              return skill;
            }

            const newInstructions = newInstructionsResult.value.content.trim();

            // Create candidate version
            const newVersion: SkillVersion = {
              version: skill.version + 1,
              instructions: newInstructions,
              config: skill.config,
              refinedAt: new Date(),
              successRateAtRefinement: skill.successRate,
              status: "candidate",
            };

            yield* store.addVersion(skill.id, newVersion);

            yield* store.update(skill.id, {
              instructions: newInstructions,
              version: skill.version + 1,
              refinementCount: skill.refinementCount + 1,
              lastRefinedAt: new Date(),
            });

            // Generate content variants (LLM or heuristic fallback)
            const variants = yield* generateVariants(newInstructions).pipe(
              Effect.catchAll(() =>
                Effect.succeed({
                  summary: heuristicSummary(newInstructions),
                  condensed: heuristicCondensed(newInstructions),
                }),
              ),
            );

            yield* store.update(skill.id, {
              contentVariants: {
                full: newInstructions,
                summary: variants.summary,
                condensed: variants.condensed,
              },
            });

            // Return updated skill (fetch fresh from store)
            const updated = yield* store.get(skill.id);
            return updated ?? { ...skill, version: skill.version + 1, instructions: newInstructions, refinementCount: skill.refinementCount + 1, lastRefinedAt: new Date() };
          }),

        checkRegression: (skill: SkillRecord) =>
          Effect.gen(function* () {
            if (skill.versionHistory.length < 2) {
              return { rolledBack: false };
            }

            // Get the latest version
            const latest = skill.versionHistory[skill.versionHistory.length - 1]!;

            if (
              latest.status === "candidate" &&
              skill.successRate < latest.successRateAtRefinement
            ) {
              yield* store.rollback(skill.id).pipe(
                Effect.catchTag("MemoryNotFoundError", () => Effect.void),
              );
              return { rolledBack: true };
            }

            return { rolledBack: false };
          }),

        checkPromotion: (skill: SkillRecord) =>
          Effect.gen(function* () {
            if (
              skill.confidence === "tentative" &&
              skill.useCount >= 5 &&
              skill.successRate >= 0.8
            ) {
              yield* store.promote(skill.id, "trusted");
              return { promoted: true, newConfidence: "trusted" as SkillConfidence };
            }

            if (
              skill.confidence === "trusted" &&
              skill.useCount >= 20 &&
              skill.successRate >= 0.9
            ) {
              yield* store.promote(skill.id, "expert");
              return { promoted: true, newConfidence: "expert" as SkillConfidence };
            }

            return { promoted: false };
          }),

        generateVariants,
      };
    }),
  );
