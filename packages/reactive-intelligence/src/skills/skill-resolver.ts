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
  /**
   * When true, suppress scanning of `~/.agents/skills` and `~/.reactive-agents/skills`.
   * Used by tests to keep resolution hermetic to the configured `customPaths` and
   * `projectRoot`. Defaults to `false` (global skills merge into resolver output).
   * Resolves HS-25.
   */
  readonly skipGlobalPaths?: boolean;
  /**
   * Skill names to ALWAYS activate (inject full instructions at bootstrap),
   * regardless of confidence tier or task relevance. This is the deterministic
   * "load this skill into context" control — a caller who passes
   * `.withSkills({ paths, activate: ["gws-drive"] })` wants that skill's
   * procedure present before the agent acts, not merely discoverable. Bypasses
   * the relevance floor by design (explicit intent).
   */
  readonly activate?: readonly string[];
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

/**
 * Choose which skills to ACTIVATE (full-content injection) for a task.
 *
 * Union of three sources, deduped by name (first wins, and `sorted` is already
 * confidence-ranked so the strongest variant is kept):
 *   1. expert-confidence learned skills (always)
 *   2. explicit `activate` names from the caller (always — bypasses the floor)
 *   3. task-relevant skills scoring above a precision floor, capped at
 *      RELEVANCE_MAX so a big catalog can never flood the prompt
 *
 * Then every chosen skill's declared PREREQUISITE skills are pulled in
 * transitively (see `expandPrerequisites`) — a skill whose instructions depend
 * on a shared reference (auth, invocation syntax) is useless without it.
 *
 * The floor matters: injecting a whole SKILL.md is expensive, so a weak
 * incidental keyword hit must NOT auto-activate — the same honesty lesson as
 * tool discovery. Explicit intent is the only thing that skips it.
 */
const RELEVANCE_FLOOR = 2;
const RELEVANCE_MAX = 2;

export function selectActivated(
  sorted: readonly SkillRecord[],
  taskDescription: string,
  activate: readonly string[] | undefined,
): SkillRecord[] {
  const explicit = new Set((activate ?? []).map((n) => n.toLowerCase()));
  const chosen = new Map<string, SkillRecord>();

  for (const s of sorted) {
    if (s.confidence === "expert" || explicit.has(s.name.toLowerCase())) {
      if (!chosen.has(s.name)) chosen.set(s.name, s);
    }
  }

  // Relevance-matched, bounded — skip any already chosen above.
  const relevant = rankSkillsByTask(sorted, taskDescription)
    .filter((r) => r.score >= RELEVANCE_FLOOR && !chosen.has(r.skill.name))
    .slice(0, RELEVANCE_MAX);
  for (const r of relevant) chosen.set(r.skill.name, r.skill);

  // Dependency closure — a prerequisite is NOT relevance-bounded: an activated
  // skill that can't function without its shared reference must load it.
  expandPrerequisites(chosen, sorted);

  return Array.from(chosen.values());
}

/**
 * Pull every chosen skill's declared PREREQUISITE skills into the activation
 * set, transitively. Prerequisites are declared in a skill's body as a linked
 * reference on a line mentioning "prerequisite", e.g.
 *
 *   > **PREREQUISITE:** Read `../gws-shared/SKILL.md` for auth and syntax.
 *
 * Only LINKED prerequisites count — a bare `## Prerequisites` heading is prose,
 * not a skill dependency, and must not trigger activation. A prerequisite only
 * activates if it was actually discovered (present in `sorted`); a reference to
 * a missing skill is skipped (the body still tells the model to generate it).
 * Bounded by the discovered set + a visited guard, so a dependency cycle
 * terminates.
 */
function expandPrerequisites(
  chosen: Map<string, SkillRecord>,
  sorted: readonly SkillRecord[],
): void {
  const byName = new Map<string, SkillRecord>();
  for (const s of sorted) byName.set(s.name.toLowerCase(), s);

  const queue: string[] = Array.from(chosen.values()).map((s) => s.name);
  const visited = new Set<string>();
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (visited.has(name)) continue;
    visited.add(name);
    const skill = chosen.get(name) ?? byName.get(name.toLowerCase());
    if (!skill) continue;
    for (const depName of extractPrerequisiteNames(skill.instructions)) {
      const dep = byName.get(depName.toLowerCase());
      if (dep && !chosen.has(dep.name)) {
        chosen.set(dep.name, dep);
        queue.push(dep.name);
      }
    }
  }
}

/**
 * Extract prerequisite skill names from a skill body: `../<name>/SKILL.md`
 * links that appear on a line mentioning "prerequisite" (case-insensitive).
 * Line-scoped so a related-helper link elsewhere in the body is not mistaken
 * for a hard dependency.
 */
function extractPrerequisiteNames(instructions: string): string[] {
  const names: string[] = [];
  const linkRe = /\.\.\/([a-z0-9][a-z0-9._-]*)\/SKILL\.md/gi;
  for (const line of instructions.split(/\r?\n/)) {
    if (!/prerequisite/i.test(line)) continue;
    for (const m of line.matchAll(linkRe)) {
      if (m[1]) names.push(m[1]);
    }
  }
  return names;
}

/**
 * Rank skills by task relevance. Cheap deterministic scorer over the skill's
 * name + description tokens vs the task tokens:
 *   +3 a task token appears in the skill NAME
 *   +1 a task token appears in the skill DESCRIPTION
 * Only tokens of length >= 4 count, so short common words ("the", "list",
 * "file") do not manufacture spurious matches. Descending by score.
 */
function rankSkillsByTask(
  skills: readonly SkillRecord[],
  taskDescription: string,
): { skill: SkillRecord; score: number }[] {
  const tokens = Array.from(
    new Set(
      taskDescription
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 4),
    ),
  );
  if (tokens.length === 0) return [];
  return skills
    .map((skill) => {
      const name = skill.name.toLowerCase();
      const desc = skill.description.toLowerCase();
      let score = 0;
      for (const tok of tokens) {
        if (name.includes(tok)) score += 3;
        else if (desc.includes(tok)) score += 1;
      }
      return { skill, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
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
        resolve: ({ taskDescription, modelId: _modelId, agentId }) =>
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
              config.skipGlobalPaths,
            );

            // 3. Convert InstalledSkill → SkillRecord
            const installedRecords = discovery.skills.map(toSkillRecord);

            // 4. Merge with precedence: learned wins on name collision
            const merged = mergeWithPrecedence(learnedSkills, installedRecords);

            // 5. Sort: expert first, then trusted, then tentative; within tier by score
            const sorted = sortByConfidenceAndScore(merged);

            // 6. Classify what to ACTIVATE (inject full instructions at
            // bootstrap), so the agent has the procedure before it acts rather
            // than only a catalog entry it must remember to fetch. Three
            // sources, unioned:
            //   - expert       learned skills the evolution loop graduated
            //   - explicit     names the caller passed via `activate` (intent —
            //                  bypasses the relevance floor)
            //   - relevant     top task-matched skills above a precision floor,
            //                  bounded so a large catalog cannot flood context
            const autoActivate = selectActivated(sorted, taskDescription, config.activate);

            return { all: sorted, autoActivate, catalog: sorted };
          }),

        generateCatalogXml: (skills, options) => generateCatalogXml(skills, options),
      };
    }),
  );
