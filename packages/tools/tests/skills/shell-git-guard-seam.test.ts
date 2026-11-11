// Seam pin: git code-execution guard (skills/shell-git-guard.ts).
// The scoped [git, gh] shell allows git, so every git option that makes git
// run a program of the caller's choosing must be refused by the default
// block-list. Rules live in GIT_BLOCKED_RULES and are spread into
// DEFAULT_BLOCKED_RULES; both views are pinned here.
import { describe, test, expect } from "bun:test";

import { GIT_BLOCKED_RULES } from "../../src/skills/shell-git-guard.js";
import {
  DEFAULT_BLOCKED_RULES,
  findBlockedReason,
  isCommandBlocked,
} from "../../src/skills/shell-execution.js";

const blockedBySeam = (command: string): boolean =>
  findBlockedReason(command, GIT_BLOCKED_RULES) !== null;

const BLOCKED: ReadonlyArray<string> = [
  // --upload-pack: any subcommand, = or space value, abbreviated, quoted
  "git clone --upload-pack=touch /tmp/pwned https://x/r.git",
  "git clone --upload-pack 'touch /tmp/pwned' https://x/r.git",
  "git fetch --upload-pack 'touch /tmp/pwned' origin",
  "git ls-remote --upload-pack=touch origin",
  "git pull --upload-pack=touch origin main",
  "git clone --upload-p=touch https://x/r.git",
  "git clone --up=touch https://x/r.git",
  "git fetch '--upload-pack=touch' origin",
  "git -C /repo fetch --upload-pack=touch origin",
  "gh repo clone owner/name -- --upload-pack=touch",
  // --exec is git's alias for --upload-pack (ls-remote) / --receive-pack (push)
  "git ls-remote --exec=touch origin",
  "git push --exec=touch origin main",
  // --receive-pack: any subcommand, abbreviated
  "git push --receive-pack=touch origin main",
  "git push --receive-pack 'touch /tmp/pwned' origin main",
  "git send-pack --receive-pack=touch origin",
  "git push --rece=touch origin main",
  // clone -u <cmd> (short --upload-pack), glued, bundled, quoted
  "git clone -u 'touch /tmp/pwned' https://x/r.git",
  "git clone -utouch https://x/r.git",
  "git clone -qu touch https://x/r.git",
  "git clone --depth 1 -u touch https://x/r.git",
  "gh repo clone owner/name -- -u touch",
  // --exec-path=<dir> runs git-<subcommand> from an attacker directory
  "git --exec-path=/tmp/x status",
  "git '--exec-path=/tmp/x' status",
];

const ALLOWED: ReadonlyArray<string> = [
  "git push -u origin main",
  "git push --set-upstream origin main",
  "git fetch -u origin",
  "git fetch --update-head-ok origin",
  "git -C /repo log -1",
  "git --version",
  "git --exec-path",
  "git status",
  "git log --reverse --oneline",
  "git clone https://x/r.git",
  "git clone --depth 1 https://x/r.git",
  "git -C clone-dir push -u origin main",
  "gh repo view owner/name",
];

describe("shell-git-guard seam", () => {
  test("GIT_BLOCKED_RULES is spread into DEFAULT_BLOCKED_RULES", () => {
    for (const rule of GIT_BLOCKED_RULES) {
      expect(DEFAULT_BLOCKED_RULES).toContain(rule);
    }
  });

  test.each(BLOCKED)("refuses: %s", (command) => {
    expect(blockedBySeam(command)).toBe(true);
    expect(isCommandBlocked(command)).toBe(true);
  });

  test.each(ALLOWED)("allows: %s", (command) => {
    expect(blockedBySeam(command)).toBe(false);
    expect(isCommandBlocked(command)).toBe(false);
  });

  test("refusal reasons name the vector", () => {
    expect(findBlockedReason("git fetch --upload-pack=x origin")).toContain("--upload-pack");
    expect(findBlockedReason("git push --receive-pack=x origin")).toContain("--receive-pack");
    expect(findBlockedReason("git clone -u x https://x/r.git")).toContain("clone -u");
    expect(findBlockedReason("git --exec-path=/tmp/x status")).toContain("--exec-path");
  });

  test("pre-existing git -c / --config refusals still hold", () => {
    expect(isCommandBlocked("git -c core.pager=id log")).toBe(true);
    expect(isCommandBlocked("git clone --config core.pager=id repo")).toBe(true);
  });
});
