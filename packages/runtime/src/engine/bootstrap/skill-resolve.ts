/**
 * Per-run skill resolution (skills spec step 2,
 * wiki/Architecture/Design-Specs/2026-11-06-skills-and-extension-model.md §4).
 *
 * Runs once per run, BEFORE `AgentStarted`, so `run-started.config.skills`
 * can record what the run saw; `skill-postprocess.ts` consumes the result
 * after bootstrap.
 *
 * - Root: the run's bound file root (run `workspace` > `.withTools({ workspace })`
 *   > ambient `withFileRoot()`), else the agent's fallback root
 *   (`skillDiscoveryRoot`, else `process.cwd()`).
 * - Globals: only with `.withSkills({ global: true })`.
 * - Pins: builder `activate` plus the run's `run(task, { skills: { activate } })`.
 *
 * Without {@link AgentSkills} (a resolver supplied some other way) the
 * resolver runs on its own config, no record is produced and no skill is
 * activatable mid-run.
 */
import { Effect, Option } from "effect";
import { createHash } from "node:crypto";
import type { SkillRecord, Task } from "@reactive-agents/core";
import { getRunSlot } from "@reactive-agents/core/internal/run-scope";
import {
  SkillResolverService,
  discoverSkills,
  skillScanPaths,
  type ResolvedSkills,
} from "@reactive-agents/reactive-intelligence";
import { capturedFileRoot, fileRootSlot } from "@reactive-agents/tools/internal/run-slots";
import type { ReactiveAgentsConfig } from "../../types.js";
import { extractTaskText } from "../util.js";
import { AgentSkills, SKILLS_ACTIVATE_CONTEXT_KEY } from "../../runtime-skills-layer.js";
import { buildActivatableSkills, type ActivatableSkillEntry } from "./skill-activatable.js";

/** The `run-started.config.skills` record. Names and hashes only, never bodies. */
export interface RunSkillsRecord {
  /** Directories scanned, in precedence order (earlier wins). */
  readonly roots: readonly string[];
  /** Every catalog skill, sorted by name; `sha256` is of the skill body (instructions). */
  readonly catalog: readonly { readonly name: string; readonly sha256: string }[];
  /** Pinned skill names: builder `activate` then the run's `skills.activate`, deduped. */
  readonly pinned: readonly string[];
}

/** One run's resolved skills. */
export interface RunSkills {
  readonly resolved: ResolvedSkills;
  /** `<available_skills>` catalog XML (empty when nothing resolved). */
  readonly catalogXml: string;
  /** Present only when skills are configured via {@link AgentSkills}. */
  readonly record?: RunSkillsRecord;
  /**
   * Skills `activate-skill` may load (skill-activatable.ts). Empty without
   * {@link AgentSkills}: the discovery arguments are unknown then.
   */
  readonly activatable: readonly ActivatableSkillEntry[];
}

const EMPTY: ResolvedSkills = { all: [], autoActivate: [], catalog: [] };

/** The run's own pins from `task.metadata.context.skillsActivate`. */
export const readRunSkillPins = (task: Pick<Task, "metadata">): readonly string[] => {
  const raw = (task.metadata?.context as Record<string, unknown> | undefined)?.[SKILLS_ACTIVATE_CONTEXT_KEY];
  return Array.isArray(raw) ? raw.filter((n): n is string => typeof n === "string" && n.length > 0) : [];
};

/**
 * Add run-pinned skills (matched case-insensitively against `all`) to
 * `autoActivate`, keeping the resolver's order and skipping duplicates.
 * Prerequisite expansion is the resolver's (builder pins get it; run pins do
 * not, until `resolve()` accepts per-call pins).
 */
export const withRunPins = (resolved: ResolvedSkills, pins: readonly string[]): ResolvedSkills => {
  if (pins.length === 0) return resolved;
  const wanted = new Set(pins.map((n) => n.toLowerCase()));
  const have = new Set(resolved.autoActivate.map((s) => s.name));
  const added = resolved.all.filter((s) => wanted.has(s.name.toLowerCase()) && !have.has(s.name));
  return added.length === 0 ? resolved : { ...resolved, autoActivate: [...resolved.autoActivate, ...added] };
};

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Build the record from what the run resolved. Pure. */
export const buildRunSkillsRecord = (args: {
  readonly roots: readonly string[];
  readonly catalog: readonly SkillRecord[];
  readonly pinned: readonly string[];
}): RunSkillsRecord => ({
  roots: [...args.roots],
  catalog: args.catalog
    .map((s) => ({ name: s.name, sha256: sha256(s.instructions ?? "") }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
  pinned: Array.from(new Set(args.pinned)),
});

/** Resolve this run's skills; `undefined` when no `SkillResolverService` is registered. */
export const resolveRunSkills = (args: {
  readonly task: Task;
  readonly config: ReactiveAgentsConfig;
  readonly modelId: string;
}): Effect.Effect<RunSkills | undefined, never> => {
  const { task, config, modelId } = args;
  return Effect.gen(function* () {
    const resolverOpt = yield* Effect.serviceOption(SkillResolverService);
    if (Option.isNone(resolverOpt)) return undefined;
    const resolver = resolverOpt.value;
    const settings = Option.getOrUndefined(yield* Effect.serviceOption(AgentSkills));
    const bound = (yield* getRunSlot(fileRootSlot)) ?? capturedFileRoot();
    const root = bound ?? settings?.fallbackRoot;
    const runPins = readRunSkillPins(task);

    const resolved = yield* resolver
      .resolve({
        taskDescription: extractTaskText(task.input),
        modelId,
        agentId: config.agentId,
        ...(root !== undefined ? { root } : {}),
        ...(settings ? { includeGlobal: settings.global } : {}),
      })
      .pipe(
        Effect.map((r) => withRunPins(r, runPins)),
        Effect.catchAll(() => Effect.succeed(EMPTY)),
      );

    const catalogXml = resolved.all.length > 0 ? resolver.generateCatalogXml(resolved.catalog) : "";
    const scanRoot = root ?? process.cwd();
    const scanOptions = { agentId: config.agentId, global: settings?.global === true };
    const record = settings
      ? buildRunSkillsRecord({
          roots: skillScanPaths(scanRoot, settings.paths, scanOptions),
          catalog: resolved.catalog,
          pinned: [...settings.activate, ...runPins],
        })
      : undefined;
    // Same scan the resolver ran (same root, paths, options), for the skill
    // directories `SkillRecord` does not carry. A scan fault leaves the run
    // catalog-only, as it was before activation existed.
    const activatable =
      settings && resolved.catalog.length > 0
        ? yield* Effect.try(() =>
            buildActivatableSkills(resolved.catalog, discoverSkills(scanRoot, settings.paths, scanOptions).skills),
          ).pipe(Effect.orElseSucceed((): readonly ActivatableSkillEntry[] => []))
        : [];
    return { resolved, catalogXml, activatable, ...(record ? { record } : {}) };
  });
};
