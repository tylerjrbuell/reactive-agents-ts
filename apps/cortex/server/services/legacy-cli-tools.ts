/**
 * Migration for configs stored before the framework folded the `gh-cli`,
 * `git-cli` and `gws-cli` wrapper tools into a scoped `shell-execute`
 * (owner-approved 2026-11-10). A stored chat session or saved agent that still
 * names `gh-cli` / `git-cli` gets the builtin shell toolset that runs its
 * program (`git`), so it keeps working and the UI never shows a tool that no
 * longer exists. The mapping comes from `@reactive-agents/tools`
 * (`DEPRECATED_CLI_TOOLS` x `BUILTIN_SHELL_PRESETS`); nothing here hand-copies
 * a program list.
 *
 * The `workspace` (gws) shell toolset was removed from the framework the same
 * day, so `gws-cli` and a stored `workspace` pick have no replacement: they are
 * dropped with a server warning, never mapped to the shell (`terminalTools` is
 * not turned on for them). Any other removed name the framework no longer maps
 * to a toolset is dropped the same way.
 */
import { BUILTIN_SHELL_PRESETS, DEPRECATED_CLI_TOOLS } from "@reactive-agents/tools";
import { cortexLog } from "../cortex-log.js";

/**
 * Tool picks Cortex stored that no longer exist and have no replacement. Hard-coded because
 * the framework stops listing them once removed: `workspace` was a shell toolset (gws),
 * `gws-cli` its wrapper tool.
 */
const RETIRED_TOOL_PICKS: ReadonlySet<string> = new Set(["gws-cli", "workspace"]);

/** Removed tool name → the shell preset (toolset alias) whose programs include its program. */
const LEGACY_CLI_TO_TOOLSET: ReadonlyMap<string, string> = new Map(
  Object.entries(DEPRECATED_CLI_TOOLS).flatMap(([name, program]) => {
    if (RETIRED_TOOL_PICKS.has(name)) return [];
    const preset = Object.entries(BUILTIN_SHELL_PRESETS).find(
      ([alias, programs]) => !RETIRED_TOOL_PICKS.has(alias) && (programs as readonly string[]).includes(program),
    );
    return preset ? [[name, preset[0]] as const] : [];
  }),
);

/** Names to drop: the retired picks plus any removed CLI tool the framework no longer maps. */
const DROPPED: ReadonlySet<string> = new Set([
  ...RETIRED_TOOL_PICKS,
  ...Object.keys(DEPRECATED_CLI_TOOLS).filter((n) => !LEGACY_CLI_TO_TOOLSET.has(n)),
]);

const key = (n: string): string => n.trim().toLowerCase();

// One warning per dropped name per process: stored configs are re-read on every list call.
const warned = new Set<string>();
function warnDropped(name: string): void {
  if (warned.has(name)) return;
  warned.add(name);
  cortexLog("warn", "tools", `dropped removed tool "${name}" from a stored config (no replacement; the framework removed it)`);
}

/** Rewrite removed CLI tool names to their shell toolset, drop retired ones; dedupes and keeps first-seen order. */
export function migrateLegacyCliToolNames(names: readonly string[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    const k = key(n);
    if (DROPPED.has(k)) {
      warnDropped(k);
      continue;
    }
    out.push(LEGACY_CLI_TO_TOOLSET.get(k) ?? n);
  }
  return [...new Set(out)];
}

function migrateList(raw: string): string {
  const parts = raw.split(/[\n,]+/).map((s) => s.trim()).filter((s) => s.length > 0);
  return migrateLegacyCliToolNames(parts).join(", ");
}

const isStale = (n: unknown): boolean => typeof n === "string" && (LEGACY_CLI_TO_TOOLSET.has(key(n)) || DROPPED.has(key(n)));

/**
 * Return `config` with `tools` and `additionalToolNames` migrated. Returns the
 * same object when nothing names a removed tool; never mutates the input.
 */
export function migrateLegacyCliToolsInConfig(config: Record<string, unknown>): Record<string, unknown> {
  const tools = config.tools;
  const addl = config.additionalToolNames;
  const staleTools = Array.isArray(tools) && tools.some(isStale);
  const staleAddl = typeof addl === "string" && addl.split(/[\n,]+/).some(isStale);
  if (!staleTools && !staleAddl) return config;
  return {
    ...config,
    ...(staleTools
      ? { tools: migrateLegacyCliToolNames((tools as unknown[]).filter((t): t is string => typeof t === "string")) }
      : {}),
    ...(staleAddl ? { additionalToolNames: migrateList(addl) } : {}),
  };
}
