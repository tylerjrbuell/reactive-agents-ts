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
 *   - import:  `agent.loadSkill(dir, { evolutionMode })` for a Cortex library row written
 *              to a temp SKILL.md; with `update`, a reload over a same-name skill (the
 *              framework keeps its history and adds a version when the text changed);
 *   - rollback: `agent.rollbackSkill(name)` (publishes `SkillRolledBack`, reason `manual`);
 *   - mode:    `agent.setSkillMode(name, mode)` (lock / unlock; history untouched).
 *
 * The lifecycle events these actions publish (`SkillRefined` from Refine now,
 * `SkillRolledBack` from Roll back) belong to no run, so no ingest stream carries
 * them; the service hands them to a {@link SkillEventSink}, which the server writes
 * to cortex.db so the History timeline shows them.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import type { AgentEvent, SkillEvolutionMode, SkillRecord, SkillVersion } from "@reactive-agents/core";
import { SKILL_LIFECYCLE_TAGS } from "@reactive-agents/ui-core";
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

/** A YAML single-quoted scalar: `''` escapes a quote, nothing else is special. */
const yamlQuoted = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/**
 * A SKILL.md document for a Cortex library row: front matter (name and description,
 * each on one line, single-quoted so a value that itself starts and ends with a quote
 * or holds `: ` reads back exactly) and the body. Pure.
 */
export function librarySkillMarkdown(row: { readonly name: string; readonly description: string; readonly content: string }): string {
  const name = oneLine(row.name);
  const description = oneLine(row.description) !== "" ? oneLine(row.description) : name;
  return `---\nname: ${yamlQuoted(name)}\ndescription: ${yamlQuoted(description)}\n---\n\n${row.content.trim()}\n`;
}

/** The evolution modes a skill can be set to (framework `SkillEvolutionMode`). */
export const SKILL_EVOLUTION_MODES = ["auto", "suggest", "locked"] as const satisfies readonly SkillEvolutionMode[];

/** Whether `s` names an evolution mode. */
export function isSkillEvolutionMode(s: string): s is SkillEvolutionMode {
  return (SKILL_EVOLUTION_MODES as readonly string[]).includes(s);
}

/**
 * Receives the skill lifecycle events a Cortex action published on the agent's bus
 * (manual refine or rollback; no run, so no `taskId`).
 */
export type SkillEventSink = (agentId: string, events: readonly AgentEvent[]) => void;

/** Options for moving a library row into an agent's skills. */
export interface LibraryImportOptions {
  /** How the skill may evolve; unset = the framework's default (`locked` for a new skill, else its current mode). */
  readonly evolutionMode?: SkillEvolutionMode;
  /** Reload over a same-name skill the agent already has (its history is kept). Without it a clash is `conflict`. */
  readonly update?: boolean;
}

const LIFECYCLE_TAGS: ReadonlySet<string> = new Set(SKILL_LIFECYCLE_TAGS);

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
  /**
   * @param recordEvents where manual refine / rollback events go (the server writes
   *   them to cortex.db); the default drops them.
   */
  constructor(
    private readonly inspector: MemoryInspector,
    private readonly refineAgent: RefineAgentFactory = defaultRefineAgent,
    private readonly recordEvents: SkillEventSink = () => {},
  ) {}

  /** Run `f`, handing the lifecycle events `agent` publishes meanwhile to the sink. */
  private async capturing<A>(agentId: string, agent: ReactiveAgent, f: () => Promise<A>): Promise<A> {
    const seen: AgentEvent[] = [];
    const unsubscribe = await agent.subscribe((event) => {
      if (LIFECYCLE_TAGS.has(event._tag)) seen.push(event);
    });
    try {
      return await f();
    } finally {
      unsubscribe();
      if (seen.length > 0) this.recordEvents(agentId, seen);
    }
  }

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
        const r = await this.capturing(agentId, agent, () => agent.refineSkills());
        return { refined: r.refined, unchanged: r.unchanged, skipped: r.skipped, failed: r.failed };
      } finally {
        await agent.dispose();
      }
    });
  }

  /** The skill named `skillName` after a change, as `missing` when it is gone. */
  private async skillAfter(agent: ReactiveAgent, skillName: string): Promise<{ skill: AgentSkillDto } | { notFound: string }> {
    const after = (await agent.skills()).find((s) => s.name === skillName);
    return after ? { skill: agentSkillDto(after) } : { notFound: `Skill "${skillName}" not found` };
  }

  /**
   * Restore the skill's previous version (framework `agent.rollbackSkill`: version
   * N-1 becomes current, N is dropped, `SkillRolledBack` reason `manual` is published
   * and recorded). `missing` for an unknown skill or one with no earlier version.
   */
  async rollback(agentId: string, skillName: string): Promise<SkillResult<AgentSkillDto>> {
    const r = await this.inspector.withAgent(agentId, async (agent) => {
      await this.capturing(agentId, agent, () => agent.rollbackSkill(skillName));
      return this.skillAfter(agent, skillName);
    });
    if (!r.ok) return r;
    return "skill" in r.value ? { ok: true, value: r.value.skill } : fail("missing", r.value.notFound);
  }

  /**
   * Set how the skill may evolve (framework `agent.setSkillMode`): `locked` stops
   * refinement, promotion and regression rollback; `auto` lets runs drive them;
   * `suggest` proposes refinements only. Version history is untouched.
   */
  async setMode(agentId: string, skillName: string, mode: string): Promise<SkillResult<AgentSkillDto>> {
    if (!isSkillEvolutionMode(mode)) return fail("invalid", `Unknown evolution mode "${mode}"`);
    const r = await this.inspector.withAgent(agentId, async (agent) => {
      await agent.setSkillMode(skillName, mode);
      return this.skillAfter(agent, skillName);
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
   * Load a Cortex library row into the agent's skills (framework `loadSkill`).
   * A name the agent already has is a `conflict` unless `options.update` is set: then
   * the row reloads over that skill, which keeps its stats and version history and
   * becomes a new version when the text differs (so it can be rolled back).
   */
  async importLibrarySkill(
    agentId: string,
    row: { readonly name: string; readonly description: string; readonly content: string },
    options: LibraryImportOptions = {},
  ): Promise<SkillResult<AgentSkillDto>> {
    if (!isSafeSkillName(row.name)) return fail("invalid", `Skill name "${row.name}" cannot be a folder name`);
    if (row.content.trim() === "") return fail("invalid", "The library skill has no instructions");
    const r = await this.inspector.withAgent(agentId, async (agent) => {
      if (!options.update && (await agent.skills()).some((s) => s.name === row.name)) {
        return { conflict: `This agent already has a skill named "${row.name}". Update it to load this text as its next version.` } as const;
      }
      const dir = mkdtempSync(join(tmpdir(), "cortex-skill-"));
      try {
        const skillDir = join(dir, row.name);
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(join(skillDir, "SKILL.md"), librarySkillMarkdown(row));
        await agent.loadSkill(skillDir, options.evolutionMode ? { evolutionMode: options.evolutionMode } : {});
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
