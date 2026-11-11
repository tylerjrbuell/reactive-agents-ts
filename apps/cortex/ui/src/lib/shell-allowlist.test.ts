import { describe, expect, it } from "bun:test";
import {
  SHELL_QUICK_ADD,
  effectiveShellCommands,
  isOptInCommand,
  missingGroupCommands,
  parseCommandInput,
  shellCommandsPatch,
  withCommands,
  type ShellCommandCatalog,
} from "./shell-allowlist.js";
import { cortexRunsPostBody } from "./cortex-runs-post-body.js";
import { defaultConfig, defaultShellOptions } from "./types/agent-config.js";

const catalog: ShellCommandCatalog = {
  defaults: ["git", "ls", "cat"],
  optIn: ["node", "bun", "npm", "npx", "curl"],
  groups: { github: ["gh"], web: ["curl"], javascript: ["node", "bun", "npm", "npx"] },
};
const fields = (o: Partial<{ add: string; allowed: string; access: string[] }> = {}) => ({
  terminalShellAdditionalCommands: o.add ?? "",
  terminalShellAllowedCommands: o.allowed ?? "",
  commandAccess: o.access ?? [],
});

describe("effectiveShellCommands", () => {
  it("is the framework defaults when nothing is stored", () => {
    expect(effectiveShellCommands(fields(), catalog)).toEqual(["git", "ls", "cat"]);
  });

  it("folds legacy groups and extras into one list", () => {
    expect(effectiveShellCommands(fields({ access: ["javascript"], add: "stripe" }), catalog)).toEqual([
      "git", "ls", "cat", "stripe", "node", "bun", "npm", "npx",
    ]);
  });

  it("starts from the replacement list when one is stored, still adding extras and groups", () => {
    expect(effectiveShellCommands(fields({ allowed: "git, ls", add: "jq", access: ["web"] }), catalog)).toEqual(["git", "ls", "jq", "curl"]);
  });

  it("ignores unknown groups", () => {
    expect(effectiveShellCommands(fields({ access: ["bogus"] }), catalog)).toEqual(["git", "ls", "cat"]);
  });
});

describe("shellCommandsPatch", () => {
  it("saves a folded legacy config as additional commands without commandAccess", () => {
    const list = effectiveShellCommands(fields({ access: ["javascript"], add: "stripe" }), catalog);
    expect(shellCommandsPatch(list, catalog)).toEqual({
      terminalShellAdditionalCommands: "stripe, node, bun, npm, npx",
      terminalShellAllowedCommands: "",
      commandAccess: [],
    });
  });

  it("saves the defaults alone as empty fields (framework default)", () => {
    expect(shellCommandsPatch(["git", "ls", "cat"], catalog)).toEqual({ terminalShellAdditionalCommands: "", terminalShellAllowedCommands: "", commandAccess: [] });
  });

  it("removing a default saves the whole list as allowedCommands", () => {
    expect(shellCommandsPatch(["git", "cat", "node"], catalog)).toEqual({
      terminalShellAdditionalCommands: "",
      terminalShellAllowedCommands: "git, cat, node",
      commandAccess: [],
    });
  });

  it("round-trips: the saved fields reload as the same list", () => {
    for (const list of [["git", "ls", "cat", "node"], ["ls", "curl"]]) {
      const p = shellCommandsPatch(list, catalog);
      expect(effectiveShellCommands(p, catalog)).toEqual(list);
    }
  });
});

describe("run body after an edit", () => {
  it("a legacy config, once edited, sends its commands as additional and no commandAccess", () => {
    const legacy = {
      ...defaultConfig(),
      terminalTools: true,
      terminalShellAdditionalCommands: "stripe",
      terminalShellOptions: { ...defaultShellOptions(), commandAccess: ["javascript"] },
    };
    const p = shellCommandsPatch(effectiveShellCommands({ ...legacy, commandAccess: legacy.terminalShellOptions.commandAccess }, catalog), catalog);
    const edited = { ...legacy, ...p, terminalShellOptions: { ...legacy.terminalShellOptions, commandAccess: p.commandAccess } };
    const b = cortexRunsPostBody("x", edited) as { terminalShellAdditionalCommands?: string; terminalShellOptions?: unknown };
    expect(b.terminalShellAdditionalCommands).toBe("stripe, node, bun, npm, npx");
    expect(b.terminalShellOptions).toBeUndefined();
  });
});

describe("input + quick add", () => {
  it("parses comma / space separated names and rejects non-executables", () => {
    expect(parseCommandInput("node, bun  stripe\nnode")).toEqual({ valid: ["node", "bun", "stripe"], invalid: [] });
    expect(parseCommandInput("rm;ls ../x")).toEqual({ valid: [], invalid: ["rm;ls", "../x"] });
  });

  it("appends without duplicates", () => {
    expect(withCommands(["git", "ls"], ["ls", "node"])).toEqual(["git", "ls", "node"]);
  });

  it("a group adds only the commands still missing", () => {
    expect(missingGroupCommands(["git", "node"], "javascript", catalog)).toEqual(["bun", "npm", "npx"]);
    expect(missingGroupCommands(["git"], "bogus", catalog)).toEqual([]);
  });

  it("offers no github quick add (the git toolset brings gh)", () => {
    expect(SHELL_QUICK_ADD.map((g) => g.id)).not.toContain("github");
  });

  it("marks framework opt-in commands", () => {
    expect(isOptInCommand("curl", catalog)).toBe(true);
    expect(isOptInCommand("git", catalog)).toBe(false);
  });
});
