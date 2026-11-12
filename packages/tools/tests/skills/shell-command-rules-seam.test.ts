// Seam pins: skills/shell-command-rules.ts and the approvalCommands branch of
// skills/shell-git-readonly.ts, imported directly. The approval gate and the
// read-only git/gh shell share these rules, so a command a rule names only
// runs after a human approved it (owner decision 2026-11-11).
import { describe, test, expect } from "bun:test";
import {
  SHELL_TOOL_NAMES,
  commandMatchesRules,
  commandWords,
  isShellToolName,
  shellCallMatchesCommandRules,
} from "../../src/skills/shell-command-rules.js";
import { readOnlyGitDenial } from "../../src/skills/shell-git-readonly.js";
import { scopedShellConfig, scopedShellToolFor } from "../../src/skills/scoped-shell.js";
import * as toolsIndex from "../../src/index.js";

const call = (command: unknown, rules: readonly string[], tool = "shell-execute"): boolean =>
  shellCallMatchesCommandRules(tool, { command }, rules);

describe("shellCallMatchesCommandRules: word-prefix rules per command segment", () => {
  test.each([
    ["git push origin main", ["git push"]],
    ["git push", ["git push"]],
    ["rm -rf build", ["rm"]],
    ["git status && git push origin main", ["git push"]],
    ["git status; git push", ["git push"]],
    ["git log | git push", ["git push"]],
    ["git status || git push", ["git push"]],
    ["git status\ngit push", ["git push"]],
    ["GIT_TRACE=1 git push", ["git push"]],
    ["A=1 B=2 git push", ["git push"]],
    ["sudo git push", ["git push"]],
    ["git -C sub push", ["git push"]], // git global options are skipped (2026-11-12 M3)
    ["/usr/bin/git push", ["git push"]],
    ["git 'push' origin", ["git push"]],
    ["git push origin main", ["git push *"]],
    ["git push origin main", ["git push*"]],
    ["gh pr merge 1", ["gh pr merge", "git push"]],
  ])("`%s` matches %j", (command, rules) => {
    expect(call(command, rules)).toBe(true);
  });

  test.each([
    ["git status", ["git push"]],
    ["git pushx", ["git push"]],
    ["git log --grep 'git push'", ["git push"]],
    ["echo 'git push'", ["git push"]],
    ["git push", []],
    ["git push", [""]],
    ["git push", ["*"]],
    ["git", ["git push"]],
  ])("`%s` does not match %j", (command, rules) => {
    expect(call(command, rules)).toBe(false);
  });

  test("a non-shell tool never matches, even with a command argument", () => {
    expect(call("git push", ["git push"], "file-write")).toBe(false);
    expect(call("git push", ["git push"], "web-search")).toBe(false);
  });

  test("the removed gh-cli / git-cli names count as shell tools", () => {
    expect(SHELL_TOOL_NAMES).toEqual(["shell-execute", "gh-cli", "git-cli"]);
    expect(isShellToolName("gh-cli")).toBe(true);
    expect(call("git push", ["git push"], "git-cli")).toBe(true);
  });

  test("a missing or non-string command never matches", () => {
    expect(call(undefined, ["git push"])).toBe(false);
    expect(call(["git", "push"], ["git push"])).toBe(false);
    expect(shellCallMatchesCommandRules("shell-execute", {}, ["git push"])).toBe(false);
  });

  test("commandWords drops assignments and bare wrappers, keeps a wrapper with options", () => {
    expect(commandWords("FOO=1 env BAR=2 /bin/git push")).toEqual(["git", "push"]);
    expect(commandWords("sudo -u x git push")).toEqual(["sudo", "-u", "x", "git", "push"]);
    expect(commandMatchesRules("", ["git push"])).toBe(false);
  });

  test("exported from the package index", () => {
    expect(toolsIndex.shellCallMatchesCommandRules).toBe(shellCallMatchesCommandRules);
    expect(toolsIndex.SHELL_TOOL_NAMES).toBe(SHELL_TOOL_NAMES);
  });
});

describe("readOnlyGitDenial with approvalCommands", () => {
  test("refuses `git push origin main` with no rules, allows it with ['git push']", () => {
    expect(readOnlyGitDenial("git push origin main")).toContain('git "push"');
    expect(readOnlyGitDenial("git push origin main", [])).toContain('git "push"');
    expect(readOnlyGitDenial("git push origin main", ["git push"])).toBeNull();
  });

  test("a rule permits only the segments it names", () => {
    expect(readOnlyGitDenial("git config alias.x '!id'", ["git push"])).toContain('git "config"');
    expect(readOnlyGitDenial("git push && git config alias.x y", ["git push"])).toContain('git "config"');
    expect(readOnlyGitDenial("git status && git push", ["git push"])).toBeNull();
    expect(readOnlyGitDenial("gh pr merge 1", ["git push"])).toContain("gh pr merge");
    expect(readOnlyGitDenial("gh pr merge 1", ["gh pr merge"])).toBeNull();
  });

  test("an output redirect stays refused even when the segment matches", () => {
    expect(readOnlyGitDenial("git push > out.txt", ["git push"])).toContain("output redirect");
  });
});

describe("scopedShellConfig threads approvalCommands", () => {
  test("base.approvalCommands reaches the config; gitReadOnly stays on", () => {
    const config = scopedShellConfig(["git", "gh"], { approvalCommands: ["git push"] });
    expect(config.approvalCommands).toEqual(["git push"]);
    expect(config.gitReadOnly).toBe(true);
  });

  test("the tool description names the commands that run after approval", () => {
    const def = scopedShellToolFor(["git"], { approvalCommands: ["git push", "git commit"] });
    expect(def.description).toContain("after a human approves the call: git push, git commit");
    expect(scopedShellToolFor(["git"]).description).not.toContain("approves the call");
  });
});
