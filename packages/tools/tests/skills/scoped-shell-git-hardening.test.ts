// Behavior pins: the no-approval git/gh shell preset is read-only.
//
// Code review of dev (2026-11-10) found the scoped [git, gh] shell ran with
// requiresApproval: false and a git block-list that missed
// `git config core.fsmonitor '<cmd>'` and `git config alias.x '!cmd'`: code
// execution that persists in the user's real .git/config. It also copied the
// whole global gitconfig (! aliases, credential helpers, token insteadOf URLs)
// into the shell HOME. A block-list cannot be complete for git, so the preset
// runs an allow-list of read-only subcommands (skills/shell-git-readonly.ts)
// and git sees a minimal config with only user.name / user.email.
//
// These tests run real git in a throwaway repository. gh writes go to a fake
// GH_CONFIG_DIR, so a regression never touches the developer's gh config.
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Effect } from "effect";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scopedShellTool } from "../../src/skills/scoped-shell.js";
import { shellExecuteHandler } from "../../src/skills/shell-execution.js";

type ShellResult = {
  readonly executed: boolean;
  readonly success?: boolean;
  readonly error?: string;
  readonly output?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
};

let root = "";
let repo = "";
let upstream = "";
let fakeHome = "";
let saved: NodeJS.ProcessEnv = {};

const gitSetup = (cwd: string, ...args: string[]): void => {
  const r = spawnSync("git", ["-c", "user.name=Setup", "-c", "user.email=setup@test.invalid", ...args], {
    cwd,
    encoding: "utf8",
  });
  expect({ args, status: r.status }).toEqual({ args, status: 0 });
};

const preset = (command: string): Promise<ShellResult> =>
  Effect.runPromise(
    scopedShellTool(["git", "gh"], { cwd: repo, allowUnsafeCwd: true }).handler({ command }),
  ) as Promise<ShellResult>;

const marker = (name: string): string => join(root, name);

beforeAll(() => {
  saved = { ...process.env };
  root = mkdtempSync(join(tmpdir(), "ra-git-preset-"));
  fakeHome = join(root, "home");
  mkdirSync(fakeHome);
  // A realistic global config: identity plus the entries that must never reach the shell.
  writeFileSync(
    join(fakeHome, ".gitconfig"),
    [
      "[user]",
      "\tname = RA Test User",
      "\temail = ra@test.invalid",
      "[alias]",
      `\tp = !touch ${marker("alias-ran")}`,
      "[credential]",
      "\thelper = store",
      '[url "https://secret-token@github.com/"]',
      "\tinsteadOf = https://github.com/",
      "",
    ].join("\n"),
  );
  process.env.HOME = fakeHome;
  process.env.GH_CONFIG_DIR = join(fakeHome, "gh");
  delete process.env.GIT_CONFIG_GLOBAL;
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;

  upstream = join(root, "upstream");
  mkdirSync(upstream);
  gitSetup(upstream, "init", "-q", "-b", "main");
  writeFileSync(join(upstream, "a.txt"), "one\n");
  gitSetup(upstream, "add", "a.txt");
  gitSetup(upstream, "commit", "-q", "-m", "first");
  repo = join(root, "repo");
  gitSetup(root, "clone", "-q", upstream, repo);

  // A hook and an fsmonitor command already in the repository: the read-only
  // preset must not run them (core.hooksPath / core.fsmonitor overridden).
  const hook = join(repo, ".git", "hooks", "reference-transaction");
  writeFileSync(hook, `#!/bin/sh\ntouch ${marker("hook-ran")}\n`);
  chmodSync(hook, 0o755);
  const fsmon = join(root, "fsmon.sh");
  writeFileSync(fsmon, `#!/bin/sh\ntouch ${marker("fsmonitor-ran")}\nexit 1\n`);
  chmodSync(fsmon, 0o755);
  gitSetup(repo, "config", "core.fsmonitor", fsmon);

  // A new upstream commit so `git fetch` updates a ref (fires reference-transaction).
  writeFileSync(join(upstream, "b.txt"), "two\n");
  gitSetup(upstream, "add", "b.txt");
  gitSetup(upstream, "commit", "-q", "-m", "second");
});

afterAll(() => {
  process.env = saved;
  rmSync(root, { recursive: true, force: true });
});

describe("git/gh preset: writes and code-running subcommands are refused", () => {
  test("`git config core.fsmonitor <cmd>` is refused and .git/config is unchanged", async () => {
    const before = readFileSync(join(repo, ".git", "config"), "utf8");
    const r = await preset(`git config core.fsmonitor 'touch ${marker("pwned")}'`);
    expect(r.executed).toBe(false);
    expect(r.success).toBe(false);
    expect(r.error).toContain("read-only");
    expect(readFileSync(join(repo, ".git", "config"), "utf8")).toBe(before);
  });

  test("`git config --global alias.p '!cmd' && git p` is refused; the user's own ! alias is not reachable", async () => {
    const r = await preset(`git config --global alias.x '!touch ${marker("pwned")}' && git x`);
    expect(r.executed).toBe(false);
    const viaUserAlias = await preset("git p");
    expect(viaUserAlias.executed).toBe(false);
    expect(viaUserAlias.error).toContain('"p"');
    expect(existsSync(marker("alias-ran"))).toBe(false);
    expect(existsSync(marker("pwned"))).toBe(false);
  });

  test.each([
    "git rebase -x id HEAD~1",
    "git submodule foreach id",
    "git bisect run id",
    "git difftool -y -x id",
    "git commit -m x",
    "git push origin main",
    "git checkout -b other",
    "git -C . config core.pager id",
    "git 'con'fig core.pager id",
    "git branch newbranch",
    "git branch -D main",
    "git tag v1",
    "git stash",
    "git remote add x ../upstream",
    "git log --output=out.txt",
    "git grep -O id one",
    "git --git-dir=.git status",
  ])("refuses `%s`", async (command) => {
    const r = await preset(command);
    expect(r.executed).toBe(false);
    expect(r.success).toBe(false);
    expect(r.error).toContain("read-only");
  });

  test.each([
    "gh alias set --shell zz 'id'",
    "gh extension install ./nope",
    "gh extension exec x",
    "gh api -X POST repos/o/r/issues",
    "gh api repos/o/r/issues -f title=x",
    "gh repo delete o/r --yes",
    "gh pr merge 1",
    "gh auth token",
    "gh config set editor id",
    "gh pr view 1 --web",
  ])("refuses `%s`", async (command) => {
    const r = await preset(command);
    expect(r.executed).toBe(false);
    expect(r.success).toBe(false);
    expect(r.error).toContain("read-only");
  });

  test("an output redirect is refused (it would write .git/config or a hook)", async () => {
    const r = await preset("git log > out.txt");
    expect(r.executed).toBe(false);
    expect(r.error).toContain("read-only");
    expect(existsSync(join(repo, "out.txt"))).toBe(false);
  });

  test("the refusal names the alternative: the terminal, which asks for approval", async () => {
    const r = await preset("git commit -m x");
    expect(r.error).toContain("terminal");
    expect(r.error).toContain("approval");
  });
});

describe("git/gh preset: read-only subcommands run without approval", () => {
  test.each([
    "git status",
    "git log --oneline -5",
    "git diff",
    "git show --stat HEAD",
    "git branch",
    "git branch -a",
    "git branch --list 'ma*'",
    "git remote -v",
    "git remote get-url origin",
    "git rev-parse HEAD",
    "git ls-files",
    "git tag",
    "git stash list",
    "git -C . log -1 --format=%s",
    "git --version",
    "git rev-parse HEAD | git cat-file --batch-check",
  ])("runs `%s`", async (command) => {
    const r = await preset(command);
    expect(r.error).toBeUndefined();
    expect(r.executed).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  test("`gh --version` runs", async () => {
    const r = await preset("gh --version");
    expect(r.executed).toBe(true);
  });

  test("`git fetch origin` runs and the repository's hooks do not", async () => {
    const r = await preset("git fetch origin");
    expect(r.error).toBeUndefined();
    expect(r.exitCode).toBe(0);
    expect(existsSync(marker("hook-ran"))).toBe(false);
  });

  test("`git status` does not run the repository's core.fsmonitor command", async () => {
    const r = await preset("git status");
    expect(r.exitCode).toBe(0);
    expect(existsSync(marker("fsmonitor-ran"))).toBe(false);
  });
});

describe("git/gh preset with approvalCommands: a matched write runs (the approval gate ran first)", () => {
  const approved = (command: string): Promise<ShellResult> =>
    Effect.runPromise(
      scopedShellTool(["git", "gh"], { cwd: repo, allowUnsafeCwd: true, approvalCommands: ["git push"] }).handler({
        command,
      }),
    ) as Promise<ShellResult>;

  test("`git push` is refused without rules and runs with ['git push']; hooks stay off", async () => {
    const refused = await preset("git push origin HEAD:refs/heads/approved");
    expect(refused.executed).toBe(false);
    expect(refused.error).toContain("read-only");

    const r = await approved("git push origin HEAD:refs/heads/approved");
    expect(r.error).toBeUndefined();
    expect(r.executed).toBe(true);
    expect(r.exitCode).toBe(0);
    const ref = spawnSync("git", ["rev-parse", "--verify", "refs/heads/approved"], { cwd: upstream, encoding: "utf8" });
    expect(ref.status).toBe(0);
    expect(existsSync(marker("hook-ran"))).toBe(false);
  });

  test("a write the rules do not name is still refused and .git/config is unchanged", async () => {
    const before = readFileSync(join(repo, ".git", "config"), "utf8");
    const r = await approved(`git config alias.x '!touch ${marker("pwned")}'`);
    expect(r.executed).toBe(false);
    expect(r.error).toContain("read-only");
    expect(readFileSync(join(repo, ".git", "config"), "utf8")).toBe(before);
  });
});

describe("git config inheritance passes only the identity", () => {
  test("the shell's global config has user.name / user.email and nothing else", async () => {
    const handler = shellExecuteHandler({ inheritGitConfig: true, cwd: repo, allowUnsafeCwd: true });
    const r = (await Effect.runPromise(handler({ command: "git config --global --list" }))) as ShellResult;
    expect(r.exitCode).toBe(0);
    const lines = (r.output ?? "").trim().split("\n").sort();
    expect(lines).toEqual(["user.email=ra@test.invalid", "user.name=RA Test User"]);
    expect(r.output).not.toContain("secret-token");
    expect(r.output).not.toContain("alias");
    expect(r.output).not.toContain("credential");
  });

  test("no .gitconfig is left in the shell HOME (sandbox dir) after a call", async () => {
    const handler = shellExecuteHandler({ inheritGitConfig: true });
    await Effect.runPromise(handler({ command: "git config --global user.name" }));
    const r = (await Effect.runPromise(handler({ command: "ls -a" }))) as ShellResult;
    expect(r.executed).toBe(true);
    expect((r.output ?? "").split("\n")).not.toContain(".gitconfig");
  });
});
