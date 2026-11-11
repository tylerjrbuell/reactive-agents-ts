// Seam pins: skills/shell-git-readonly.ts, skills/shell-command-segments.ts and
// skills/shell-git-env.ts, imported directly. Behavior pins over real git live
// in scoped-shell-git-hardening.test.ts.
import { describe, test, expect } from "bun:test";
import { readOnlyGitDenial, GIT_READ_ONLY_SUBCOMMANDS } from "../../src/skills/shell-git-readonly.js";
import {
  hasOutputRedirect,
  isRedirectAmpersand,
  pathCandidateTokens,
  shellWords,
  splitCommandSegments,
  withoutNullRedirects,
} from "../../src/skills/shell-command-segments.js";
import { minimalGitConfig, readGitIdentity, readOnlyGitEnv } from "../../src/skills/shell-git-env.js";
import { buildHostShellEnv } from "../../src/skills/shell-host-process.js";

describe("readOnlyGitDenial — allow-list, not block-list", () => {
  test.each([
    "git status",
    "git -C sub --no-pager log --oneline -3",
    "/usr/bin/git diff HEAD~1",
    "git branch -vv",
    "git branch --contains HEAD",
    "git tag -l 'v*'",
    "git tag --sort=-creatordate",
    "git remote show origin",
    "git stash show -p",
    "git grep -n foo",
    "git log --oneline --ours",
    "gh pr list --state open --json number,title",
    "gh repo view owner/name",
    "gh api repos/o/r/pulls",
    "gh api -X GET search/issues -f q=bug",
    "gh api --method=get repos/o/r",
    "gh api -H 'Accept: x' repos/o/r --jq .name",
    "gh --version",
    "gh",
    "git",
    "git log | git cat-file --batch-check",
  ])("allows `%s`", (command) => {
    expect(readOnlyGitDenial(command)).toBeNull();
  });

  test.each([
    ["git config core.fsmonitor x", 'git "config"'],
    ["git c\\onfig x y", 'git "config"'],
    ['git "config" x y', 'git "config"'],
    ["git p", 'git "p"'],
    ["git status | git config x y", 'git "config"'],
    ["git log --out=f", "--output"],
    ["git diff --output=f", "--output"],
    ["git grep --open-files-in-pager=id x", "grep -O"],
    ["git grep -nOid x", "grep -O"],
    ["git branch x", "creates a branch"],
    ["git branch -vD x", "changes refs"],
    ["git branch --del x", "changes refs"],
    ["git branch --set-upstream-to=origin/main", "changes refs"],
    ["git tag -a v1 -m x", "changes refs"],
    ["git tag v1", "creates a tag"],
    ["git remote set-url origin x", "git remote set-url"],
    ["git stash pop", "git stash pop"],
    ["git stash", "git stash"],
    ["git --exec-path status", 'git option "--exec-path"'],
    ["git -c a=b status", 'git option "-c"'],
    ["git log > f", "output redirect"],
    ["git log 2>f", "output redirect"],
    ["gh api -XPOST repos/o/r", "gh api -X POST"],
    ["gh api -iX DELETE repos/o/r", "gh api -X DELETE"],
    ["gh api --method PATCH repos/o/r", "gh api -X PATCH"],
    ["gh api graphql -f query=x", "gh api with fields"],
    ["gh api repos/o/r --input body.json", "gh api with fields"],
    ["gh alias set --shell x id", 'gh "alias"'],
    ["gh extension install o/x", 'gh "extension"'],
    ["gh pr checkout 1", "gh pr checkout"],
    ["gh pr", "gh pr"],
    ["gh auth token", 'gh "auth"'],
    ["gh repo view --web", "gh --web"],
  ])("refuses `%s`", (command, fragment) => {
    const reason = readOnlyGitDenial(command);
    expect(reason).not.toBeNull();
    expect(reason).toContain(fragment);
    expect(reason).toContain("read-only git/gh shell");
    expect(reason).toContain("asks for approval");
  });

  test("other programs' segments are left to the allow-list", () => {
    expect(readOnlyGitDenial("ls -la")).toBeNull();
  });

  test("no write subcommand is on the list", () => {
    for (const sub of ["config", "commit", "push", "checkout", "rebase", "submodule", "bisect", "difftool", "clone", "reset", "am", "apply"]) {
      expect(GIT_READ_ONLY_SUBCOMMANDS).not.toContain(sub);
    }
  });
});

describe("shell-command-segments", () => {
  test("shellWords removes quotes and escapes the way sh does", () => {
    expect(shellWords(`git 'con'fig "a b" c\\ d`)).toEqual(["git", "config", "a b", "c d"]);
    expect(shellWords(`a "x\\y" "q\\"r" ''`)).toEqual(["a", "x\\y", 'q"r', ""]);
  });

  test("hasOutputRedirect ignores quoted and escaped >", () => {
    expect(hasOutputRedirect("git log --format='%h>%s'")).toBe(false);
    expect(hasOutputRedirect('git log --format="a>b"')).toBe(false);
    expect(hasOutputRedirect("git log \\> x")).toBe(false);
    expect(hasOutputRedirect("git log >> x")).toBe(true);
  });

  test("hasOutputRedirect: an fd dup writes no file, `&>`/`>&file` do", () => {
    expect(hasOutputRedirect("git diff 2>&1 | head")).toBe(false);
    expect(hasOutputRedirect("git log >&2")).toBe(false);
    expect(hasOutputRedirect("git log 2>&-")).toBe(false);
    expect(hasOutputRedirect("git log &>f")).toBe(true);
    expect(hasOutputRedirect("git log >&f")).toBe(true);
    expect(hasOutputRedirect("git log >&1f")).toBe(true);
    expect(hasOutputRedirect("git log 2>&1 >f")).toBe(true);
  });

  test("readOnlyGitDenial allows `git diff 2>&1 | head` (run 01M7622DY0G1D8VEKYV2FVYZW7)", () => {
    expect(readOnlyGitDenial("git diff HEAD~1 2>&1 | head -40")).toBeNull();
    expect(readOnlyGitDenial("git log |& head")).toBeNull();
    expect(readOnlyGitDenial("git log &>f")).toContain("output redirect");
  });

  test("readOnlyGitDenial allows redirects to exactly /dev/null, refuses every other target", () => {
    for (const command of [
      "git log 2>/dev/null",
      "git log >/dev/null 2>&1",
      "git remote 2>/dev/null",
      "git status &>/dev/null && git log -1",
      "git log 2>/dev/null | head",
      "git log >|/dev/null",
    ]) {
      expect(readOnlyGitDenial(command)).toBeNull();
    }
    for (const command of ["git log >/tmp/x", "git log 2>/dev/null >/tmp/x", "git log 2>/dev/null>/tmp/x", "git log >/dev/sda", "git log >|/tmp/x"]) {
      expect(readOnlyGitDenial(command)).toContain("output redirect");
    }
  });

  test("splitCommandSegments: `>|` (noclobber override) is a redirect, not a pipe", () => {
    expect(splitCommandSegments("echo hi >| ls")).toEqual(["echo hi >| ls"]);
    expect(splitCommandSegments("a 2>|f | b")).toEqual(["a 2>|f", "b"]);
    expect(splitCommandSegments("a >'|' b")).toEqual(["a >'|' b"]);
    expect(splitCommandSegments("a | b")).toEqual(["a", "b"]);
  });

  test("isRedirectAmpersand: `&` after < > | or before > is a redirect, else background", () => {
    const at = (command: string): boolean => isRedirectAmpersand(command, command.indexOf("&"));
    for (const command of ["a 2>&1", "a >&2", "a <&0", "a &>f", "a &>>f", "a |& b"]) expect(at(command)).toBe(true);
    for (const command of ["a &", "a & b", "a &b", "&b"]) expect(at(command)).toBe(false);
  });

  test("splitCommandSegments treats `|&` as a pipe", () => {
    expect(splitCommandSegments("a 2>&1 |& b &>f")).toEqual(["a 2>&1", "b &>f"]);
  });

  test("pathCandidateTokens exposes glued redirect targets", () => {
    expect(pathCandidateTokens(" a&>/x 2>../y b>c |& d")).toEqual(["a", "/x", "2", "../y", "b", "c", "d"]);
  });

  test("splitCommandSegments keeps quoted operators", () => {
    expect(splitCommandSegments("git log --format='a|b' | git x && y")).toEqual([
      "git log --format='a|b'",
      "git x",
      "y",
    ]);
  });

  test("withoutNullRedirects blanks only redirects whose target is exactly /dev/null", () => {
    const blank = (s: string) => withoutNullRedirects(s).trim().replace(/\s+/g, " ");
    expect(blank("make 2>/dev/null")).toBe("make");
    expect(blank("a &>/dev/null b")).toBe("a b");
    expect(blank("a >> '/dev/null'")).toBe("a");
    expect(blank("a >&/dev/null")).toBe("a");
    expect(blank("cat </dev/null")).toBe("cat");
    expect(blank("a2>/dev/null")).toBe("a2"); // `2` is part of the word, not an fd
    expect(withoutNullRedirects("make 2>/dev/null")).toHaveLength("make 2>/dev/null".length);
    // The target word ends at the next operator, so a glued redirect survives.
    expect(blank("a 2>/dev/null>/etc/x")).toBe("a >/etc/x");
    expect(blank("a 2>/dev/null&b")).toBe("a &b");
    for (const kept of ["a >/dev/null2", "a >/dev/null/x", "a >/dev/./sda", "a >/dev/null'x'", "a 2>&1", "a <</dev/null", "echo '>/dev/null'", "a \\>/dev/null"]) {
      expect(withoutNullRedirects(kept)).toBe(kept);
    }
  });
});

describe("shell-git-env — only the identity passes", () => {
  test("readGitIdentity reads [user] name/email and nothing else", () => {
    const text = [
      "[core]",
      "\tname = not-me",
      "[User]",
      '\tname = "Ada \\"A\\" Lovelace" # comment',
      "\temail = ada@example.invalid ; comment",
      '[user "work"]',
      "\temail = work@example.invalid",
      "[alias]",
      "\tp = !id",
    ].join("\n");
    expect(readGitIdentity(text)).toEqual({ name: 'Ada "A" Lovelace', email: "ada@example.invalid" });
  });

  test("minimalGitConfig round-trips and strips control characters", () => {
    const text = minimalGitConfig({ name: 'x"\\y\nz', email: "e@x.invalid" });
    expect(text.split("\n")).toHaveLength(4);
    expect(readGitIdentity(text)).toEqual({ name: 'x"\\y z', email: "e@x.invalid" });
    expect(minimalGitConfig({})).toBe("");
  });

  test("read-only env turns off system config, hooks and fsmonitor; buildHostShellEnv adds it only with hooksPath", () => {
    expect(readOnlyGitEnv("/tmp/h")).toEqual({
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_VALUE_0: "/tmp/h",
      GIT_CONFIG_KEY_1: "core.fsmonitor",
      GIT_CONFIG_VALUE_1: "false",
    });
    const ro = buildHostShellEnv("/usr/bin", "/tmp/s", { globalConfig: "/tmp/g/config", hooksPath: "/tmp/g/hooks" });
    expect(ro.GIT_CONFIG_NOSYSTEM).toBe("1");
    expect(ro.GIT_CONFIG_VALUE_0).toBe("/tmp/g/hooks");
    const rw = buildHostShellEnv("/usr/bin", "/tmp/s", { globalConfig: "/tmp/g/config" });
    expect(rw.GIT_CONFIG_NOSYSTEM).toBeUndefined();
    expect(rw.GIT_CONFIG_COUNT).toBeUndefined();
  });
});
