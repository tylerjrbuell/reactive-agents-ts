import { Effect, Context, Layer, Option } from "effect";
import { createHash } from "node:crypto";
import * as path from "node:path";
import type { SkillRecord } from "@reactive-agents/core";
import { SkillStoreService } from "@reactive-agents/memory";
import { discoverSkills } from "./skill-registry.js";
import type { InstalledSkill } from "./skill-registry.js";

// ─── Types ───

/**
 * One skill `activate-skill` may load, as the resolver hands it to the run.
 * Structurally the `ResolvedSkill` of `@reactive-agents/tools` (this package
 * does not depend on tools).
 */
export type ActivatableSkill = {
  /** The procedure body (SKILL.md frontmatter stripped, or the stored instructions). */
  readonly body: string;
  /**
   * Absolute directory of a filesystem skill; `file` reads are confined to it.
   * Absent for learned/promoted skills: they have no files, so a `file` read is refused.
   */
  readonly dir?: string;
  /** sha256 of `body`, matching `run-started.config.skills.catalog[].sha256`. */
  readonly sha256: string;
  readonly version: number;
  readonly source: SkillRecord["source"];
  /** Bundled files, only when a filesystem skill has any. */
  readonly resources?: { readonly scripts: string[]; readonly references: string[] };
};

export type ResolvedSkills = {
  readonly all: readonly SkillRecord[];
  readonly autoActivate: readonly SkillRecord[]; // expert + explicit + relevant (non-tentative) — inject at bootstrap
  readonly catalog: readonly SkillRecord[];       // all skills for catalog XML
  /** Name to activatable skill. Same names as `catalog`: the run never offers a skill it cannot load. */
  readonly activatable: ReadonlyMap<string, ActivatableSkill>;
};

export type SkillResolverConfig = {
  /** Configured skill dirs; relative entries resolve against the discovery root, not cwd. */
  readonly customPaths: readonly string[];
  readonly agentId: string;
  /**
   * Fallback discovery root, used when `resolve()` is called without `root`.
   * Defaults to `process.cwd()`.
   */
  readonly projectRoot?: string;
  /**
   * Scan `~/.agents/skills` and `~/.reactive-agents/skills` (lowest precedence).
   * Default `false`: global skills are opt-in (`.withSkills({ global: true })`).
   * `resolve({ includeGlobal })` overrides this per call.
   */
  readonly includeGlobal?: boolean;
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
    /**
     * Resolve all available skills for a task. Combines SQLite + filesystem, applies precedence
     * (learned wins over every filesystem source; filesystem order per `discoverSkills`).
     * `root` is the run's file root (falls back to config `projectRoot`, then cwd);
     * `includeGlobal` overrides config `includeGlobal`.
     */
    readonly resolve: (params: {
      taskDescription: string;
      modelId: string;
      agentId: string;
      root?: string;
      includeGlobal?: boolean;
    }) => Effect.Effect<ResolvedSkills, unknown>;

    /** Generate <available_skills> catalog XML for system prompt injection. */
    readonly generateCatalogXml: (skills: readonly SkillRecord[]) => string;
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

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

function toActivatable(record: SkillRecord, installed: InstalledSkill | undefined): ActivatableSkill {
  const base = {
    body: record.instructions,
    sha256: sha256(record.instructions),
    version: record.version,
    source: record.source,
  };
  if (installed === undefined) return base;
  const { scripts, references } = installed.resources;
  return {
    ...base,
    dir: path.dirname(path.resolve(installed.filePath)),
    ...(scripts.length > 0 || references.length > 0
      ? { resources: { scripts: [...scripts], references: [...references] } }
      : {}),
  };
}

/**
 * The run's skill catalog and the skills `activate-skill` may load, from one
 * list, so the two can never disagree. Learned (store) skills win a name
 * collision over discovered ones; a winning learned skill carries no directory
 * (its body is not the file on disk). Filesystem skills carry the directory and
 * resources discovery found. `catalog` is confidence-sorted (expert first).
 */
export function buildSkillCatalog(
  learned: readonly SkillRecord[],
  installed: readonly InstalledSkill[],
): { readonly catalog: SkillRecord[]; readonly activatable: ReadonlyMap<string, ActivatableSkill> } {
  const byName = new Map<string, { record: SkillRecord; installed?: InstalledSkill }>();
  // Discovery already resolved filesystem precedence (earliest wins); keep its choice.
  for (const skill of installed) {
    if (!byName.has(skill.name)) byName.set(skill.name, { record: toSkillRecord(skill), installed: skill });
  }
  for (const skill of learned) {
    if (byName.get(skill.name)?.installed !== undefined) {
      console.warn(`[SkillResolver] Collision on '${skill.name}': learned skill overrides installed`);
    }
    byName.set(skill.name, { record: skill });
  }
  const catalog = sortByConfidenceAndScore(Array.from(byName.values(), (e) => e.record));
  const activatable = new Map<string, ActivatableSkill>();
  for (const record of catalog) activatable.set(record.name, toActivatable(record, byName.get(record.name)?.installed));
  return { catalog, activatable };
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
  // Tentative skills are excluded: auto-activation via relevance is reserved
  // for trusted/expert confidence (tentative skills stay catalog-only until
  // the evolution loop graduates them).
  const relevant = rankSkillsByTask(sorted, taskDescription)
    .filter((r) => r.score >= RELEVANCE_FLOOR && !chosen.has(r.skill.name) && r.skill.confidence !== "tentative")
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

/**
 * Generate <available_skills> catalog XML per spec Section 4.4. Entries carry
 * no loading hint: the system-prompt header names `activate-skill`
 * (skills spec step 4).
 */
function generateCatalogXml(skills: readonly SkillRecord[]): string {
  const lines: string[] = ["<available_skills>"];
  for (const skill of skills) {
    lines.push("  <skill>");
    lines.push(`    <name>${skill.name}</name>`);
    lines.push(`    <description>${skill.description}</description>`);
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
        resolve: ({ taskDescription, modelId: _modelId, agentId, root, includeGlobal }) =>
          Effect.gen(function* () {
            // 1. Query SQLite for learned skills (if store available)
            let learnedSkills: SkillRecord[] = [];
            if (Option.isSome(storeOption)) {
              const allStored = yield* storeOption.value.listAll(agentId);
              learnedSkills = allStored;
            }

            // 2. Discover filesystem skills
            const discovery = discoverSkills(
              root ?? config.projectRoot ?? process.cwd(),
              config.customPaths,
              { agentId, global: includeGlobal ?? config.includeGlobal ?? false },
            );

            // 3. Merge (learned wins on name collision), sort (expert first,
            // then trusted, then tentative; within tier by score), and pair
            // every catalog skill with what `activate-skill` needs to load it.
            const { catalog: sorted, activatable } = buildSkillCatalog(learnedSkills, discovery.skills);

            // 4. Classify what to ACTIVATE (inject full instructions at
            // bootstrap), so the agent has the procedure before it acts rather
            // than only a catalog entry it must remember to fetch. Three
            // sources, unioned:
            //   - expert       learned skills the evolution loop graduated
            //   - explicit     names the caller passed via `activate` (intent —
            //                  bypasses the relevance floor)
            //   - relevant     top task-matched skills above a precision floor,
            //                  bounded so a large catalog cannot flood context
            const autoActivate = selectActivated(sorted, taskDescription, config.activate);

            return { all: sorted, autoActivate, catalog: sorted, activatable };
          }),

        generateCatalogXml,
      };
    }),
  );
