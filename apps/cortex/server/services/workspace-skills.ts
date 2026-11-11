/**
 * Workspace skills: the SKILL.md skills an agent can load, found with the
 * framework's own discovery (`discoverSkills` / `skillScanPaths` from
 * `@reactive-agents/reactive-intelligence`) at the same root the run uses.
 *
 * A run discovers skills at its file root (run workspace > `.withTools({ workspace })`
 * > `process.cwd()`), scanning `<root>/.<agentId>/skills`, `<root>/.agents/skills`,
 * the configured `paths`, `<root>/.claude/skills`, then the user-global dirs only
 * with `global: true`. Cortex lists exactly that set, so what the chat and Lab show
 * is what the agent can activate. Cortex keeps no copy of the scan order.
 *
 * Pins are skill NAMES (`withSkills({ activate })`, `runStream(task, { skills })`);
 * {@link migrateChatSkillsConfig} rewrites the cwd-relative roots older chat pins
 * stored, so a pin made before still resolves when the workspace differs from the
 * server cwd.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { discoverSkills, skillScanPaths } from "@reactive-agents/reactive-intelligence";
import { parseCortexSkillsConfig, type CortexSkillsConfig } from "./cortex-agent-config.js";

/** Which scan root a skill came from (display label for the UI). */
export type WorkspaceSkillSource = "agent" | "workspace" | "configured" | "claude" | "global";

/** One discoverable skill (summary only, never the body). */
export interface WorkspaceSkill {
  readonly name: string;
  readonly description: string;
  /** Absolute path to the skill's SKILL.md. */
  readonly filePath: string;
  /** Absolute scan directory it was found in (e.g. `<ws>/.agents/skills`). */
  readonly root: string;
  readonly source: WorkspaceSkillSource;
}

/** The discovery result for one root. */
export interface WorkspaceSkillListing {
  /** Discovery root: the workspace, or the server cwd when none is set. */
  readonly root: string;
  /** Every directory scanned, in precedence order, with whether it exists. */
  readonly scanned: readonly { readonly path: string; readonly source: WorkspaceSkillSource; readonly exists: boolean }[];
  readonly skills: readonly WorkspaceSkill[];
  /** Same-name skills a higher-precedence root shadowed. */
  readonly collisions: readonly { readonly name: string; readonly kept: string; readonly discarded: string }[];
  readonly warnings: readonly string[];
}

/** Inputs for {@link listWorkspaceSkills}. */
export interface WorkspaceSkillScope {
  /** Absolute discovery root. */
  readonly root: string;
  /** Configured extra dirs (`withSkills({ paths })`), resolved against `root`. */
  readonly paths?: readonly string[];
  /** Scanned as `<root>/.<agentId>/skills` when set. */
  readonly agentId?: string;
  /** Also scan the user-global dirs (`withSkills({ global: true })`). */
  readonly global?: boolean;
}

function sourceOf(dir: string, scope: WorkspaceSkillScope): WorkspaceSkillSource {
  const root = path.resolve(scope.root);
  if (scope.agentId && dir === path.join(root, `.${scope.agentId}`, "skills")) return "agent";
  if (dir === path.join(root, ".agents", "skills")) return "workspace";
  if (dir === path.join(root, ".claude", "skills")) return "claude";
  if ((scope.paths ?? []).some((p) => path.resolve(root, p) === dir)) return "configured";
  return "global";
}

const isDir = (p: string): boolean => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** List the skills a run rooted at `scope.root` can load, through the framework's discovery. */
export function listWorkspaceSkills(scope: WorkspaceSkillScope): WorkspaceSkillListing {
  const paths = scope.paths ?? [];
  const opts = { ...(scope.agentId ? { agentId: scope.agentId } : {}), global: scope.global === true };
  const dirs = skillScanPaths(scope.root, paths, opts);
  const found = discoverSkills(scope.root, paths, opts);
  const skills = found.skills.map((s): WorkspaceSkill => {
    const root = path.dirname(path.dirname(s.filePath));
    return { name: s.name, description: s.description, filePath: s.filePath, root, source: sourceOf(root, scope) };
  });
  return {
    root: path.resolve(scope.root),
    scanned: dirs.map((d) => ({ path: d, source: sourceOf(d, scope), exists: isDir(d) })),
    skills: [...skills].sort((a, b) => a.name.localeCompare(b.name)),
    collisions: found.collisions,
    warnings: found.warnings,
  };
}

/**
 * The discovery root of a chat session or saved config: its `workspace` when set,
 * else the server cwd (the framework's own fallback when no file root is bound).
 */
export function skillRootOf(agentConfig: Readonly<Record<string, unknown>>, serverCwd: string = process.cwd()): string {
  const ws = typeof agentConfig.workspace === "string" ? agentConfig.workspace.trim() : "";
  return ws !== "" && path.isAbsolute(ws) ? path.resolve(ws) : path.resolve(serverCwd);
}

/**
 * The skills a chat session's agent can load: discovery at the session's root with its
 * (migrated) skills config and its stable agent id, the same inputs the chat agent is
 * built with (`chat-session-service` `buildChatAgentParams`).
 */
export function chatSessionSkillListing(
  session: { readonly agentConfig: Readonly<Record<string, unknown>>; readonly stableAgentId?: string },
  serverCwd: string = process.cwd(),
): WorkspaceSkillListing & { readonly pinned: readonly string[] } {
  const root = skillRootOf(session.agentConfig, serverCwd);
  const skills = migrateChatSkillsConfig(parseCortexSkillsConfig(session.agentConfig.skills), { root, serverCwd });
  const listing = listWorkspaceSkills({
    root,
    paths: skills.paths,
    ...(session.stableAgentId ? { agentId: session.stableAgentId } : {}),
    global: skills.global === true,
  });
  return { ...listing, pinned: skills.activate ?? [] };
}

/**
 * A chat session's skills config, with pins kept as names and the roots older
 * chat pins wrote rewritten.
 *
 * Chat pins used to add the pinned skill's root to `paths`, relative to the server
 * cwd, while the framework resolves relative `paths` against the run's workspace:
 * the pin silently failed once the two differed. Each relative path is rewritten
 * to an absolute directory: under the workspace when it exists there, else under
 * the server cwd (where older pins pointed); a path found in neither is kept as
 * written. A path that only repeats a root discovery already scans
 * (`<root>/.agents/skills`, `<root>/.claude/skills`) is dropped. Absolute paths
 * are kept. Always returns a config: every chat agent gets `withSkills()`.
 */
export function migrateChatSkillsConfig(
  skills: CortexSkillsConfig | undefined,
  opts: { readonly root: string; readonly serverCwd?: string },
): CortexSkillsConfig {
  const cwd = path.resolve(opts.serverCwd ?? process.cwd());
  const root = path.resolve(opts.root);
  const builtIn = new Set([path.join(root, ".agents", "skills"), path.join(root, ".claude", "skills")]);
  const out: string[] = [];
  for (const p of skills?.paths ?? []) {
    // Workspace-relative first (what the framework reads), then the server cwd older pins meant.
    const abs = path.isAbsolute(p)
      ? path.resolve(p)
      : isDir(path.resolve(root, p))
        ? path.resolve(root, p)
        : isDir(path.resolve(cwd, p))
          ? path.resolve(cwd, p)
          : undefined;
    // A missing relative dir is kept as written: the framework skips it, and the user's intent survives.
    const entry = abs ?? p;
    if ((abs !== undefined && builtIn.has(abs)) || out.includes(entry)) continue;
    out.push(entry);
  }
  return {
    paths: out,
    ...(skills?.activate?.length ? { activate: [...skills.activate] } : {}),
    ...(skills?.global === true ? { global: true } : {}),
  };
}
