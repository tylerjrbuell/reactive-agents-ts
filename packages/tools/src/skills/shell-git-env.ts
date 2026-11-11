/**
 * git environment for `shell-execute` host runs that inherit git config
 * (`ShellExecuteConfig.inheritGitConfig`).
 *
 * git gets a per-call global config with only the user's `user.name` and
 * `user.email`, read from the real global config. Nothing else is passed:
 * the real file can hold `!` aliases, credential helpers and `insteadOf`
 * URLs with tokens, and a copy put all of that in front of the model. The
 * config lives in its own temporary directory, never in the shell HOME, and
 * is removed when the call ends.
 *
 * For the read-only git/gh preset (`gitReadOnly`) the directory also holds
 * an empty hooks directory, and the environment turns off the system config,
 * hooks and fsmonitor (command-line-level config, which overrides the
 * repository's own `.git/config`).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The real user's global git config file, from the real environment: an
 * explicit `GIT_CONFIG_GLOBAL`, else `~/.gitconfig`, else
 * `$XDG_CONFIG_HOME/git/config` (default `~/.config/git/config`). The first
 * one that exists wins; `undefined` when there is none.
 */
export function realGitGlobalConfig(): string | undefined {
  const home = process.env.HOME;
  const xdg = process.env.XDG_CONFIG_HOME ?? (home ? join(home, ".config") : undefined);
  const candidates = [
    process.env.GIT_CONFIG_GLOBAL,
    home ? join(home, ".gitconfig") : undefined,
    xdg ? join(xdg, "git", "config") : undefined,
  ];
  return candidates.find((p): p is string => p !== undefined && existsSync(p));
}

/** Commit identity from a git config file. */
export interface GitIdentity {
  readonly name?: string;
  readonly email?: string;
}

/** A git config value: surrounding quotes and inline `#` / `;` comments removed, escapes resolved. */
function parseValue(raw: string): string {
  let out = "";
  let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch === "\\" && i + 1 < raw.length) {
      const next = raw[++i]!;
      out += next === "n" ? " " : next === "t" ? "\t" : next;
    } else if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "#" || ch === ";")) break;
    else out += ch;
  }
  return out.trim();
}

/**
 * Read `user.name` and `user.email` from git config text. Only the
 * `[user]` section is read; `include` directives are not followed. The last
 * value wins, as in git.
 */
export function readGitIdentity(configText: string): GitIdentity {
  let section = "";
  let name: string | undefined;
  let email: string | undefined;
  for (const line of configText.split(/\r?\n/)) {
    const header = /^\s*\[\s*([A-Za-z0-9.-]+)\s*("?)[^\]]*\]/.exec(line);
    if (header) {
      // `[user "x"]` is a subsection (user.x.name), not user.name.
      section = header[1]!.toLowerCase() + (header[2] === '"' ? ".sub" : "");
      continue;
    }
    if (section !== "user") continue;
    const entry = /^\s*(name|email)\s*=(.*)$/i.exec(line);
    if (!entry) continue;
    const value = parseValue(entry[2]!);
    if (entry[1]!.toLowerCase() === "name") name = value;
    else email = value;
  }
  return { ...(name ? { name } : {}), ...(email ? { email } : {}) };
}

/** Quote a value for a git config file. */
const quote = (value: string): string =>
  `"${value.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** git config text with only `identity`. */
export function minimalGitConfig(identity: GitIdentity): string {
  const lines = [
    ...(identity.name !== undefined ? [`\tname = ${quote(identity.name)}`] : []),
    ...(identity.email !== undefined ? [`\temail = ${quote(identity.email)}`] : []),
  ];
  return lines.length === 0 ? "" : `[user]\n${lines.join("\n")}\n`;
}

/** Per-call git files for one host run. Remove `dir` when the run ends. */
export interface GitShellFiles {
  /** Temporary directory holding the files below. */
  readonly dir: string;
  /** Minimal global config (`GIT_CONFIG_GLOBAL`). */
  readonly globalConfig: string;
  /** Empty hooks directory; set only for the read-only preset. */
  readonly hooksPath?: string;
}

/**
 * Create the per-call git files: a minimal global config with the real
 * user's identity and, when `readOnly`, an empty hooks directory. An
 * unreadable real config gives an empty global config.
 */
export function prepareGitShellFiles(readOnly: boolean): GitShellFiles {
  // mkdtemp creates the dir with mode 0700 (CWE-377).
  const dir = mkdtempSync(join(tmpdir(), "rax-shell-git-"));
  const source = realGitGlobalConfig();
  let identity: GitIdentity = {};
  try {
    if (source !== undefined) identity = readGitIdentity(readFileSync(source, "utf8"));
  } catch {
    // unreadable config: git runs without an identity
  }
  const globalConfig = join(dir, "config");
  writeFileSync(globalConfig, minimalGitConfig(identity), { mode: 0o600 });
  if (!readOnly) return { dir, globalConfig };
  const hooksPath = join(dir, "hooks");
  mkdirSync(hooksPath, { mode: 0o700 });
  return { dir, globalConfig, hooksPath };
}

/**
 * Environment for the read-only preset: no system config, and
 * command-line-level config (`GIT_CONFIG_COUNT`) that points hooks at the
 * empty `hooksPath` and turns fsmonitor off. That level overrides the
 * repository's `.git/config`, so a hook or fsmonitor command already in the
 * repository does not run.
 */
export function readOnlyGitEnv(hooksPath: string): Record<string, string> {
  return {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: hooksPath,
    GIT_CONFIG_KEY_1: "core.fsmonitor",
    GIT_CONFIG_VALUE_1: "false",
  };
}
