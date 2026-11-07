/**
 * Skills configuration: the public option shapes for `.withSkills()` and
 * `run(task, { skills })`, the agent's resolved {@link AgentSkills} settings,
 * and the runtime layer that registers skill resolution.
 *
 * The layer block was moved out of `createRuntime` (runtime.ts) when skills
 * became per-run (skills spec step 2,
 * wiki/Architecture/Design-Specs/2026-11-06-skills-and-extension-model.md §4):
 * discovery now runs at each run's file root, so the runtime only records the
 * settings and the fallback root here; `engine/bootstrap/skill-resolve.ts`
 * resolves per run.
 */
import { Context, Layer } from "effect";
import type { EventBus } from "@reactive-agents/core";
import {
  createReactiveIntelligenceLayer,
  makeSkillResolverService,
  type SkillLayerConfig,
} from "@reactive-agents/reactive-intelligence";
import type { RuntimeOptions } from "./runtime-types.js";

/**
 * Options for `.withSkills()` (and `RuntimeOptions.skills`). Every field is
 * optional: `.withSkills()` with no argument discovers the run's workspace
 * skills only.
 *
 * Discovery runs per run, rooted at the run's file root (run `workspace` >
 * `.withTools({ workspace })` > ambient `withFileRoot()` > `process.cwd()`).
 * Scan order, earlier wins on a name collision:
 * `<root>/.<agentId>/skills`, `<root>/.agents/skills`, `paths`,
 * `<root>/.claude/skills`, then (only with `global: true`)
 * `~/.agents/skills` and `~/.reactive-agents/skills`.
 */
export interface SkillsOptions {
  /**
   * Extra skill directories, each holding `<skill>/SKILL.md` subfolders
   * (agentskills.io layout). Relative paths resolve against the run's file
   * root, not `process.cwd()`.
   */
  readonly paths?: readonly string[];
  /**
   * Skill names to ALWAYS activate: their full instructions are injected into
   * the agent's context at bootstrap, regardless of confidence or task
   * relevance. Task-relevant skills are also auto-activated; this is the
   * deterministic override.
   */
  readonly activate?: readonly string[];
  /**
   * Also scan the user-global `~/.agents/skills` and
   * `~/.reactive-agents/skills` (lowest precedence). Default `false`.
   */
  readonly global?: boolean;
}

/** Options-bag mixin for run entries that accept per-run skill pins. */
export interface SkillsRunOption {
  /**
   * Per-run skills. `activate` pins skills for this run only, on top of the
   * builder's `.withSkills({ activate })`. Needs `.withSkills()`: without it
   * no skills are discovered and the pin has nothing to load.
   */
  readonly skills?: { readonly activate?: readonly string[] };
}

/** Task-context key carrying a run's {@link SkillsRunOption} pins to the engine. */
export const SKILLS_ACTIVATE_CONTEXT_KEY = "skillsActivate";

/** Spread-ready carrier: `{ skillsActivate }` when pins are set, `{}` otherwise. */
export const skillsCarry = (
  skills?: SkillsRunOption["skills"],
): { skillsActivate?: readonly string[] } =>
  skills?.activate !== undefined && skills.activate.length > 0
    ? { [SKILLS_ACTIVATE_CONTEXT_KEY]: [...skills.activate] }
    : {};

/** The agent's skills settings, resolved from {@link SkillsOptions} at runtime creation. */
export interface AgentSkillsSettings {
  /** Configured skill dirs, trimmed, empties dropped (root-relative when relative). */
  readonly paths: readonly string[];
  /** Builder-level pins (`.withSkills({ activate })`). */
  readonly activate: readonly string[];
  /** Whether user-global skill dirs are scanned. */
  readonly global: boolean;
  /** Discovery root when no file root is bound: `skillDiscoveryRoot`, else `process.cwd()`. */
  readonly fallbackRoot: string;
}

/**
 * The agent's skills settings, provided in its runtime only when skills are
 * configured. The engine reads it per run; its presence is what turns the
 * `run-started.config.skills` record on.
 */
export class AgentSkills extends Context.Tag("@reactive-agents/runtime/AgentSkills")<
  AgentSkills,
  AgentSkillsSettings
>() {}

/** Resolve {@link AgentSkillsSettings} from runtime options; `undefined` when skills are off. */
export const agentSkillsSettings = (options: RuntimeOptions): AgentSkillsSettings | undefined => {
  const skills = options.skills;
  if (skills === undefined) return undefined;
  return {
    paths:
      skills.paths
        ?.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
        .map((p) => p.trim()) ?? [],
    activate: skills.activate !== undefined ? [...skills.activate] : [],
    global: skills.global === true,
    fallbackRoot: options.skillDiscoveryRoot ?? process.cwd(),
  };
};

/**
 * Reactive Intelligence (entropy sensing) + optional skill resolver, plus the
 * {@link AgentSkills} settings when skills are configured. RI off and skills
 * off: `Layer.empty`.
 */
export function buildReactiveIntelSkillsLayer(
  options: RuntimeOptions,
  eventBusLayer: Layer.Layer<EventBus>,
) {
  const settings = agentSkillsSettings(options);
  const skillLayerForRi: SkillLayerConfig | undefined = settings
    ? {
        resolver: {
          customPaths: settings.paths,
          agentId: options.agentId,
          projectRoot: settings.fallbackRoot,
          includeGlobal: settings.global,
          ...(settings.activate.length > 0 ? { activate: [...settings.activate] } : {}),
        },
      }
    : undefined;

  const reactiveIntelOptLayer = options.enableReactiveIntelligence
    ? // The RI layer's calibration-update subscriber (wired in
      // `createReactiveIntelligenceLayer`) requires `EventBus`. Per the
      // `Layer.mergeAll` caveat documented in createRuntime (gateway/extra layers hit
      // the same thing), sibling layers in a single `mergeAll` do NOT
      // auto-wire each other's requirements — provide the runtime's shared
      // `eventBusLayer` explicitly so the subscriber joins the SAME bus
      // instance `reactive-observer.ts` publishes `EntropyScored` to.
      createReactiveIntelligenceLayer(
        options.reactiveIntelligenceOptions,
        undefined,
        skillLayerForRi,
      ).pipe(Layer.provide(eventBusLayer))
    : skillLayerForRi?.resolver
      ? makeSkillResolverService(skillLayerForRi.resolver)
      : Layer.empty;

  return settings ? Layer.merge(reactiveIntelOptLayer, Layer.succeed(AgentSkills, settings)) : reactiveIntelOptLayer;
}
