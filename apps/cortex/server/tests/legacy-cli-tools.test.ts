import { describe, expect, test } from "bun:test";
import { DEPRECATED_CLI_TOOLS } from "@reactive-agents/tools";
import { migrateLegacyCliToolNames, migrateLegacyCliToolsInConfig } from "../services/legacy-cli-tools.js";
import { mergeCortexUiToolNames, normalizeCortexAgentConfig } from "../services/cortex-agent-config.js";
import { cortexParamsToAgentConfig } from "../services/cortex-to-agent-config.js";
import { openDatabase } from "../db/schema.js";
import { createChatSession, getChatSession, listChatSessions } from "../db/chat-queries.js";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A chat session / saved agent config stored before gh-cli, git-cli and gws-cli were folded
 * into the shell, and before the `workspace` (gws) shell toolset was removed.
 */
const OLD_STORED_CONFIG: Record<string, unknown> = {
  provider: "anthropic",
  model: "claude-haiku-4-5",
  tools: ["web-search", "git-cli", "gh-cli", "gws-cli", "workspace"],
  additionalToolNames: "gh-cli, gws-cli, my-custom",
};

describe("legacy CLI tool names (gh-cli / git-cli / gws-cli) and the retired workspace toolset", () => {
  test("gh-cli / git-cli map to the git toolset; gws-cli and workspace are dropped; deduped, order kept", () => {
    expect(migrateLegacyCliToolNames(["web-search", "git-cli", "gh-cli", "gws-cli", "workspace"])).toEqual([
      "web-search",
      "git",
    ]);
  });

  test("gws-cli and a stored workspace pick never survive, alone or with other tools", () => {
    expect(migrateLegacyCliToolNames(["gws-cli"])).toEqual([]);
    expect(migrateLegacyCliToolNames(["workspace"])).toEqual([]);
    expect(migrateLegacyCliToolNames(["  Workspace ", "GWS-CLI", "file-read"])).toEqual(["file-read"]);
  });

  test("every removed framework name is mapped to git or dropped (no dead tool left behind)", () => {
    for (const name of Object.keys(DEPRECATED_CLI_TOOLS)) {
      const mapped = migrateLegacyCliToolNames([name]);
      expect(mapped).not.toContain(name);
      expect(mapped.every((m) => m === "git")).toBe(true);
    }
  });

  test("leaves current names untouched and returns the same config when nothing is stale", () => {
    const cfg = { tools: ["web-search", "git"] };
    expect(migrateLegacyCliToolsInConfig(cfg)).toBe(cfg);
  });

  test("an old stored config loads with the git toolset and without the retired picks; shell stays off", () => {
    const migrated = migrateLegacyCliToolsInConfig(OLD_STORED_CONFIG);
    expect(migrated.tools).toEqual(["web-search", "git"]);
    expect(migrated.additionalToolNames).toBe("git, my-custom");
    expect(migrated.terminalTools).toBeUndefined();
    // the stored object is not mutated
    expect(OLD_STORED_CONFIG.tools).toEqual(["web-search", "git-cli", "gh-cli", "gws-cli", "workspace"]);
  });

  test("a config whose only stale pick is workspace is still migrated", () => {
    expect(migrateLegacyCliToolsInConfig({ tools: ["workspace", "web-search"] }).tools).toEqual(["web-search"]);
  });

  test("normalizeCortexAgentConfig migrates them (chat + gateway build paths)", () => {
    const n = normalizeCortexAgentConfig(OLD_STORED_CONFIG);
    expect(n.tools).toEqual(["web-search", "git"]);
    expect(n.terminalTools).not.toBe(true);
  });

  test("mergeCortexUiToolNames migrates them (every build path converges here)", () => {
    expect(mergeCortexUiToolNames(["gh-cli"], "gws-cli")).toEqual(["git"]);
    expect(mergeCortexUiToolNames(["workspace"], "")).toEqual([]);
  });

  test("a chat session stored with the old names reads back migrated (what the UI shows)", () => {
    const path = join(tmpdir(), `cortex-legacy-cli-${process.pid}-${Date.now()}.db`);
    const db = openDatabase(path);
    try {
      const id = createChatSession(db, { agentConfig: OLD_STORED_CONFIG });
      expect(getChatSession(db, id)?.agentConfig.tools).toEqual(["web-search", "git"]);
      expect(listChatSessions(db).find((s) => s.sessionId === id)?.agentConfig.tools).toEqual(["web-search", "git"]);
    } finally {
      db.close();
      rmSync(path, { force: true });
    }
  });

  test("the built agent config asks for the git toolset, never a removed or retired name", () => {
    const cfg = cortexParamsToAgentConfig({ provider: "anthropic", tools: ["git-cli", "gws-cli", "workspace"] });
    const allowed = cfg.tools?.allowedTools ?? [];
    expect(allowed).toContain("git");
    expect(allowed).not.toContain("workspace");
    for (const dead of Object.keys(DEPRECATED_CLI_TOOLS)) expect(allowed).not.toContain(dead);
    expect(cfg.tools?.terminal).toBeUndefined();
  });
});
