import { Effect, Context, Layer, Option } from "effect";
import type { SkillRecord } from "@reactive-agents/core";
import { SkillStoreService } from "@reactive-agents/memory";
import { discoverSkills } from "./skill-registry.js";
import type { InstalledSkill } from "./skill-registry.js";

// ─── Types ───

export type ResolvedSkills = {
  readonly all: readonly SkillRecord[];
  readonly autoActivate: readonly SkillRecord[]; // expert confidence — inject at bootstrap
  readonly catalog: readonly SkillRecord[];       // all skills for catalog XML
};

export type SkillResolverConfig = {
  readonly customPaths: readonly string[];
  readonly agentId: string;
  readonly projectRoot?: string;
};

// ─── Service Tag ───

export class SkillResolverService extends Context.Tag("SkillResolverService")<
  SkillResolverService,
  {
    /** Resolve all available skills for a task. Combines SQLite + filesystem, applies precedence. */
    readonly resolve: (params: {
      taskDescription: string;
      modelId: string;
      agentId: string;
    }) => Effect.Effect<ResolvedSkills, unknown>;

    /** Generate <available_skills> catalog XML for system prompt injection. */
    readonly generateCatalogXml: (
      skills: readonly SkillRecord[],
      options?: { catalogOnlyHint?: boolean },
    ) => string;
  }
>() {}

// ─── Helpers ───

/** Convert an InstalledSkill to a SkillRecord with sensible defaults. */
function toSkillRecord(installed: InstalledSkill): SkillRecord {
  const now = new Date();
  return {
    id: `installed-${installed.name}`,
    name: installed.name,
    description: installed.description,
    agentId: "global",
    source: "installed",
    instructions: installed.instructions,
    version: 1,
    versionHistory: [],
    config: {
      strategy: "reactive",
      temperature: 0.7,
      maxIterations: 5,
      promptTemplateId: "default",
      systemPromptTokens: 0,
      compressionEnabled: false,
    },
    evolutionMode: "locked",
    confidence: "trusted",
    successRate: 0,
    useCount: 0,
    refinementCount: 0,
    taskCategories: [],
    modelAffinities: [],
    base: null,
    avgPostActivationEntropyDelta: 0,
    avgConvergenceIteration: 0,
    convergenceSpeedTrend: [],
    conflictsWith: [],
    lastActivatedAt: null,
    lastRefinedAt: null,
    createdAt: now,
    updatedAt: now,
    contentVariants: {
      full: installed.instructions,
      summary: null,
      condensed: null,
    },
  };
}

/** Merge learned + installed skills with precedence: learned wins on name collision. */
function mergeWithPrecedence(
  learned: readonly SkillRecord[],
  installed: readonly SkillRecord[],
): SkillRecord[] {
  const map = new Map<string, SkillRecord>();

  // Add installed first (lower precedence)
  for (const skill of installed) {
    map.set(skill.name, skill);
  }

  // Learned overrides installed on collision
  for (const skill of learned) {
    if (map.has(skill.name)) {
      console.warn(
        `[SkillResolver] Collision on '${skill.name}': learned skill overrides installed`,
      );
    }
    map.set(skill.name, skill);
  }

  return Array.from(map.values());
}

const CONFIDENCE_ORDER: Record<string, number> = {
  expert: 3,
  trusted: 2,
  tentative: 1,
};

/** Sort by confidence tier (expert > trusted > tentative), then by successRate * useCount descending. */
function sortByConfidenceAndScore(skills: readonly SkillRecord[]): SkillRecord[] {
  return [...skills].sort((a, b) => {
    const tierA = CONFIDENCE_ORDER[a.confidence] ?? 0;
    const tierB = CONFIDENCE_ORDER[b.confidence] ?? 0;
    if (tierB !== tierA) return tierB - tierA;
    const scoreA = a.successRate * a.useCount;
    const scoreB = b.successRate * b.useCount;
    return scoreB - scoreA;
  });
}

/** Generate <available_skills> catalog XML per spec Section 4.4. */
function generateCatalogXml(
  skills: readonly SkillRecord[],
  options?: { catalogOnlyHint?: boolean },
): string {
  const lines: string[] = ["<available_skills>"];
  for (const skill of skills) {
    lines.push("  <skill>");
    lines.push(`    <name>${skill.name}</name>`);
    let desc = skill.description;
    if (
      options?.catalogOnlyHint &&
      skill.contentVariants.summary === null &&
      skill.contentVariants.condensed === null
    ) {
      desc += ` [condensed — use get_skill_section("${skill.name}", "full") to access instructions]`;
    }
    lines.push(`    <description>${desc}</description>`);
    lines.push(`    <source>${skill.source}</source>`);
    lines.push(`    <confidence>${skill.confidence}</confidence>`);
    lines.push("  </skill>");
  }
  lines.push("</available_skills>");
  return lines.join("\n");
}

// ─── Live Layer ───

export const makeSkillResolverService = (config: SkillResolverConfig) =>
  Layer.effect(
    SkillResolverService,
    Effect.gen(function* () {
      // SkillStoreService is optional — gracefully degrade if memory is disabled
      const storeOption = yield* Effect.serviceOption(SkillStoreService);

      return {
        resolve: ({ taskDescription: _taskDescription, modelId: _modelId, agentId }) =>
          Effect.gen(function* () {
            // 1. Query SQLite for learned skills (if store available)
            let learnedSkills: SkillRecord[] = [];
            if (Option.isSome(storeOption)) {
              const allStored = yield* storeOption.value.listAll(agentId);
              learnedSkills = allStored;
            }

            // 2. Discover filesystem skills
            const discovery = discoverSkills(
              config.customPaths as string[],
              agentId,
              config.projectRoot,
            );

            // 3. Convert InstalledSkill → SkillRecord
            const installedRecords = discovery.skills.map(toSkillRecord);

            // 4. Merge with precedence: learned wins on name collision
            const merged = mergeWithPrecedence(learnedSkills, installedRecords);

            // 5. Sort: expert first, then trusted, then tentative; within tier by score
            const sorted = sortByConfidenceAndScore(merged);

            // 6. Classify
            const autoActivate = sorted.filter((s) => s.confidence === "expert");

            return { all: sorted, autoActivate, catalog: sorted };
          }),

        generateCatalogXml: (skills, options) => generateCatalogXml(skills, options),
      };
    }),
  );
