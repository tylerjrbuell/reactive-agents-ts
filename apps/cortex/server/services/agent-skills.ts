/**
 * Living skills backend: an agent's stored skills (the framework SkillStore in its
 * memory database) with confidence, usage and version history, and the actions on
 * them. Every read and write goes through the framework, never by opening
 * `memory.db`:
 *
 *   - list:    `agent.skills()` on the Memory studio's inspector agent (test provider,
 *              the agent's own database; services/memory-inspector.ts);
 *   - refine:  `agent.refineSkills()` on an agent built with the agent's own provider
 *              and model over the same database, so the refinement LLM is the agent's;
 *   - export:  `agent.exportSkill(name, <workspace>/.agents/skills/<name>)`;
 *   - import:  `agent.loadSkill(dir)` for a Cortex library row written to a temp SKILL.md;
 *   - rollback: the framework's `SkillStoreService.rollback` run in the inspector agent's
 *              runtime. The agent API has no rollback yet, so this path publishes no
 *              `SkillRolledBack` event (framework gap, reported).
 *
 * Lock / unlock is not offered: neither the agent API nor `SkillStoreService.update`
 * can change `evolutionMode`, and re-storing the record (INSERT OR REPLACE) would
 * cascade-delete its version history.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Option, Schema } from "effect";
import type { SkillRecord, SkillVersion } from "@reactive-agents/core";
import { SkillStoreService } from "@reactive-agents/memory";
import { ProviderNameSchema, ReactiveAgents, type ReactiveAgent } from "@reactive-agents/runtime";
import type { MemoryInspector } from "./memory-inspector.js";
import { providerKeyForAgent } from "./provider-key-store.js";

/** One stored version of a skill (dates as ISO strings). */
export interface AgentSkillVersionDto {
  readonly version: number;
  /** `active`: a version the skill ran as; `candidate`: a refinement still on trial. */
  readonly status: "active" | "candidate";
  readonly instructions: string;
  readonly refinedAt: string;
  readonly successRateAtRefinement: number;
  /** The skill's use count when this version was recorded; `null` when unknown. */
  readonly useCountAtRefinement: number | null;
}

/** A stored skill as the living-skills API returns it. */
export interface AgentSkillDto {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly source: string;
  readonly confidence: string;
  readonly evolutionMode: string;
  readonly version: number;
  readonly instructions: string;
  readonly useCount: number;
  readonly successRate: number;
  readonly refinementCount: number;
  readonly taskCategories: readonly string[];
  readonly lastActivatedAt: string | null;
  readonly lastRefinedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Oldest first. The current version may be absent until its first refinement records it. */
  readonly versions: readonly AgentSkillVersionDto[];
}

/** The provider and model a refinement runs on. */
export interface RefineModel {
  readonly provider: string;
  readonly model?: string;
}

/** What one refinement pass did (framework `SkillRefinementResult`). */
export interface RefineReport {
  readonly refined: number;
  readonly unchanged: number;
  readonly skipped: number;
  readonly failed: number;
}

const iso = (d: Date | string | null | undefined): string | null =>
  d == null ? null : d instanceof Date ? d.toISOString() : new Date(d).toISOString();

const useCountAt = (v: SkillVersion): number | null =>
  "useCountAtRefinement" in v && typeof v.useCountAtRefinement === "number" ? v.useCountAtRefinement : null;

/** Map a framework skill record to its JSON shape. Pure. */
export function agentSkillDto(r: SkillRecord): AgentSkillDto {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    source: r.source,
    confidence: r.confidence,
    evolutionMode: r.evolutionMode,
    version: r.version,
    instructions: r.instructions,
    useCount: r.useCount,
    successRate: r.successRate,
    refinementCount: r.refinementCount,
    taskCategories: [...r.taskCategories],
    lastActivatedAt: iso(r.lastActivatedAt),
    lastRefinedAt: iso(r.lastRefinedAt),
    createdAt: iso(r.createdAt) ?? "",
    updatedAt: iso(r.updatedAt) ?? "",
    versions: [...r.versionHistory]
      .sort((a, b) => a.version - b.version)
      .map((v) => ({
        version: v.version,
        status: v.status,
        instructions: v.instructions,
        refinedAt: iso(v.refinedAt) ?? "",
        successRateAtRefinement: v.successRateAtRefinement,
        useCountAtRefinement: useCountAt(v),
      })),
  };
}

/** Skill names become a directory name: no separators, no dot-dot, no NUL. */
export function isSafeSkillName(name: string): boolean {
  return name.trim() !== "" && name.length <= 200 && !/[\\/\0]/.test(name) && name !== "." && name !== "..";
}

const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * A SKILL.md document for a Cortex library row: front matter (name and description,
 * each on one line) and the body. Values stay unquoted: the framework's front-matter
 * reader (`parseSKILLmd`) keeps quotes as part of the value. Pure.
 */
export function librarySkillMarkdown(row: { readonly name: string; readonly description: string; readonly content: string }): string {
  const name = oneLine(row.name);
  const description = oneLine(row.description) !== "" ? oneLine(row.description) : name;
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${row.content.trim()}\n`;
}

const isProviderName = Schema.is(ProviderNameSchema);

/** Builds the agent a refinement runs on. Injectable for tests. */
export type RefineAgentFactory = (args: {
  readonly agentId: string;
  readonly dbPath: string;
  readonly provider: Schema.Schema.Type<typeof ProviderNameSchema>;
  readonly model?: string;
}) => Promise<ReactiveAgent>;

/** The default refine agent: the agent's provider and model over its own memory database. */
export const defaultRefineAgent: RefineAgentFactory = ({ agentId, dbPath, provider, model }) => {
  const apiKey = providerKeyForAgent(provider);
  let b = ReactiveAgents.create()
    .withName("cortex-skill-refine")
    .withAgentId(agentId)
    .withProvider(provider, apiKey ? { apiKey } : undefined)
    .withMemory({ dbPath });
  if (model) b = b.withModel(model);
  return b.build();
};

/** Result of a living-skills call; `invalid` = bad input, `conflict` = would replace an existing skill. */
export type SkillResult<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly reason: "missing" | "invalid" | "conflict" | "error"; readonly error: string };

type FailReason = "missing" | "invalid" | "conflict" | "error";
const fail = <A>(reason: FailReason, error: string): SkillResult<A> => ({ ok: false, reason, error });

/** Per-agent living-skills reads and actions over one {@link MemoryInspector}. */
export class AgentSkillsService {
  constructor(
    private readonly inspector: MemoryInspector,
    private readonly refineAgent: RefineAgentFactory = defaultRefineAgent,
  ) {}

  /** The agent's stored skills; `missing` when it has no memory database. */
  list(agentId: string): Promise<SkillResult<AgentSkillDto[]>> {
    return this.inspector.withAgent(agentId, async (agent) => (await agent.skills()).map(agentSkillDto));
  }

  /**
   * One refinement pass on the agent's own model. Each non-locked skill is refined,
   * unchanged, skipped (too little new evidence) or failed.
   */
  async refine(agentId: string, model: RefineModel): Promise<SkillResult<RefineReport>> {
    if (!isProviderName(model.provider)) return fail("invalid", `Unknown provider "${model.provider}"`);
    const provider = model.provider;
    return this.inspector.withAgent(agentId, async () => {
      const agent = await this.refineAgent({
        agentId,
        dbPath: this.inspector.dbPathFor(agentId),
        provider,
        ...(model.model ? { model: model.model } : {}),
      });
      try {
        const r = await agent.refineSkills();
        return { refined: r.refined, unchanged: r.unchanged, skipped: r.skipped, failed: r.failed };
      } finally {
        await agent.dispose();
      }
    });
  }

  /**
   * Restore the skill's previous version (the framework store's rollback: version
   * N-1 becomes current and version N is dropped). `missing` for an unknown skill or
   * one with no earlier version.
   */
  async rollback(agentId: string, skillName: string): Promise<SkillResult<AgentSkillDto>> {
    const r = await this.inspector.withAgent(agentId, async (agent) => {
      const skill = (await agent.skills()).find((s) => s.name === skillName);
      if (!skill) return { notFound: `Skill "${skillName}" not found` } as const;
      const outcome = await agent.runtime.runPromise(
        Effect.gen(function* () {
          const store = yield* Effect.serviceOption(SkillStoreService);
          if (Option.isNone(store)) return { notFound: "This agent has no skill store" } as const;
          return yield* store.value.rollback(skill.id).pipe(
            Effect.as({ done: true } as const),
            Effect.catchTag("MemoryNotFoundError", () =>
              Effect.succeed({ notFound: `"${skillName}" has no earlier version to roll back to` } as const),
            ),
          );
        }),
      );
      if ("notFound" in outcome) return outcome;
      const after = (await agent.skills()).find((s) => s.name === skillName);
      return after ? { skill: agentSkillDto(after) } : ({ notFound: `Skill "${skillName}" not found` } as const);
    });
    if (!r.ok) return r;
    return "skill" in r.value ? { ok: true, value: r.value.skill } : fail("missing", r.value.notFound);
  }

  /**
   * Write the skill as `<root>/.agents/skills/<name>/SKILL.md` (framework
   * `exportSkill`; an existing file is replaced). `root` must be checked by the caller.
   */
  async exportToWorkspace(agentId: string, skillName: string, root: string): Promise<SkillResult<{ path: string }>> {
    if (!isSafeSkillName(skillName)) return fail("invalid", `Skill name "${skillName}" cannot be a folder name`);
    return this.inspector.withAgent(agentId, async (agent) => ({
      path: await agent.exportSkill(skillName, join(root, ".agents", "skills", skillName)),
    }));
  }

  /**
   * Load a Cortex library row into the agent's skills (framework `loadSkill`, which
   * stores it as an installed, locked skill). Refused when the agent already has a
   * skill with that name: loading would replace it and drop its version history.
   */
  async importLibrarySkill(
    agentId: string,
    row: { readonly name: string; readonly description: string; readonly content: string },
  ): Promise<SkillResult<AgentSkillDto>> {
    if (!isSafeSkillName(row.name)) return fail("invalid", `Skill name "${row.name}" cannot be a folder name`);
    if (row.content.trim() === "") return fail("invalid", "The library skill has no instructions");
    const r = await this.inspector.withAgent(agentId, async (agent) => {
      if ((await agent.skills()).some((s) => s.name === row.name)) {
        return { conflict: `This agent already has a skill named "${row.name}"` } as const;
      }
      const dir = mkdtempSync(join(tmpdir(), "cortex-skill-"));
      try {
        const skillDir = join(dir, row.name);
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(join(skillDir, "SKILL.md"), librarySkillMarkdown(row));
        await agent.loadSkill(skillDir);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      const loaded = (await agent.skills()).find((s) => s.name === row.name);
      return loaded ? { skill: agentSkillDto(loaded) } : ({ conflict: "The skill did not load" } as const);
    });
    if (!r.ok) return r;
    return "skill" in r.value ? { ok: true, value: r.value.skill } : fail("conflict", r.value.conflict);
  }
}
