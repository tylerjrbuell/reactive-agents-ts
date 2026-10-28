import type { MetaToolsConfig } from "../types.js";

/**
 * Meta-tools that are ON by default (task-facing default set, resolved in
 * `build-effect/runtime-construction.ts`) and therefore silently dropped by
 * the exact-set form `.withMetaTools({ ... })` when the caller does not name
 * them. Keep in sync with that default set.
 */
const DEFAULT_ON_META_TOOLS = ["recall"] as const;

/**
 * Default-on meta-tools that an exact-set `.withMetaTools(config)` call
 * leaves out (omitted or explicitly `false`).
 *
 * @returns names of dropped default-on meta-tools; empty when none dropped
 */
export const droppedDefaultMetaTools = (
  config: MetaToolsConfig,
): readonly string[] =>
  DEFAULT_ON_META_TOOLS.filter((name) => config[name] !== true);

/**
 * Build the one-line notice for a dropped default-on meta-tool set, or
 * `undefined` when nothing was dropped.
 */
export const droppedMetaToolsNotice = (
  config: MetaToolsConfig,
): string | undefined => {
  const dropped = droppedDefaultMetaTools(config);
  if (dropped.length === 0) return undefined;
  const names = dropped.join(", ");
  const keep = dropped.map((n) => `${n}: true`).join(", ");
  return (
    `[reactive-agents] .withMetaTools({...}) enables exactly the meta-tools you name; ` +
    `default-on "${names}" is NOT included. ` +
    `Add \`${keep}\` to keep it (large tool results rely on recall).`
  );
};

/**
 * Whether the harness-skill text can actually reach the model. The kernel
 * injects it only when `brief` or `pulse` is on (resolve-think-surface.ts);
 * otherwise generating it is a write-only field. `harnessSkill: false`
 * always disables it.
 */
export const harnessSkillInjectable = (config: MetaToolsConfig): boolean =>
  config.harnessSkill !== false &&
  (config.brief === true || config.pulse === true);
