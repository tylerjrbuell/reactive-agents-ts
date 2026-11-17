import { describe, expect, test } from "bun:test";
import { quickBarChips, type QuickBarChipContext } from "./chat-quickbar-chips.js";
import { composerBar } from "./chat-composer-bar.js";

const ctx = (over: Partial<QuickBarChipContext> = {}): QuickBarChipContext => ({
  provider: "anthropic",
  model: "claude-x",
  modelThinking: null,
  thinkingChoice: "auto",
  strategyLabel: "ReAct",
  pinnedSkillCount: 0,
  documentCount: 0,
  ...over,
});

describe("quickBarChips", () => {
  test("provider set: provider+model (one chip), thinking, strategy, tools, shell, workspace, steps in order", () => {
    const chips = quickBarChips({ terminalTools: true, workspace: "/home/me/proj/" }, ctx());
    expect(chips[0]).toMatchObject({ text: "anthropic · claude-x", icon: "cloud", cmd: "/model ", title: "Provider: anthropic, Model: claude-x" });
    expect(chips[0]!.segments?.map((s) => [s.text, s.cmd])).toEqual([["anthropic", "/provider "], ["claude-x", "/model "]]);
    expect(chips.map((c) => c.cmd)).toEqual([
      "/model ", "/thinking ", "/strategy ", "/tools ", "/terminal ", "/workspace ", "/iterations ",
    ]);
    expect(chips.find((c) => c.cmd === "/workspace ")).toMatchObject({ text: "proj", icon: "folder", title: "/home/me/proj/", on: true });
    // A setting that is switched on reads as on (kit Chip `on`); the shell on this machine is on.
    expect(chips.find((c) => c.cmd === "/terminal ")?.on).toBe(true);
    expect(chips.find((c) => c.cmd === "/terminal ")?.text).toBe("Shell on this machine");
    expect(chips.find((c) => c.cmd === "/thinking ")?.text).toBe("Thinking auto");
  });

  // Regression: dd44d9f4b stopped writing an attached server's tools into cfg.tools (the framework exposes all of
  // them), but the chip still counted cfg.tools only, so umami/signal added nothing to "web-search".
  describe("tools chip counts what attached MCP servers contribute", () => {
    const servers = [
      { serverId: "s1", name: "umami", tools: ["umami/stats", "umami/events", "umami/pages"] },
      { serverId: "s2", name: "signal", tools: ["signal/send", "signal/read"] },
    ];
    const toolsChip = (cfg: Record<string, unknown>, over: Partial<QuickBarChipContext> = {}) => quickBarChips(cfg, ctx({ mcpServers: servers, ...over })).find((c) => c.cmd === "/tools ")!;

    test("built-ins plus every tool of servers with no explicit entries", () => {
      const chip = toolsChip({ tools: ["web-search"], mcpServerIds: ["s1", "s2"], enableTools: true });
      expect(chip.text).toBe("web-search +5");
      expect(chip.title).toBe("Tools: web-search; umami: 3 tools (stats, events, pages); signal: 2 tools (send, read)");
      expect(chip.on).toBe(true);
    });

    test("a switched-off server still named in the config adds nothing and the tooltip says it is skipped", () => {
      const off = [{ serverId: "s9", name: "files", tools: ["files/read"] }];
      const chip = toolsChip({ tools: ["web-search", "files/read"], mcpServerIds: ["s1", "s9"], enableTools: true }, { disabledMcpServers: off });
      expect(chip.text).toBe("web-search +3");
      expect(chip.title).toBe("Tools: web-search; Uses a disabled server (skipped): files; umami: 3 tools (stats, events, pages)");
      const only = toolsChip({ mcpServerIds: ["s9"], enableTools: true }, { disabledMcpServers: off });
      expect(only.text).toBe("No tools");
      expect(only.title).toBe("Tools: Uses a disabled server (skipped): files");
    });

    test("explicit server/tool entries restrict that server", () => {
      const chip = toolsChip({ tools: ["web-search", "umami/stats"], mcpServerIds: ["s1"], enableTools: true });
      expect(chip.text).toBe("web-search +1");
      expect(chip.title).toContain("umami: 1 tool (stats)");
    });

    test("MCP-only selection is on the bar", () => {
      const cfg = { mcpServerIds: ["s1"], enableTools: true };
      const chips = quickBarChips(cfg, ctx({ mcpServers: servers }));
      expect(chips.find((c) => c.cmd === "/tools ")).toMatchObject({ text: "3 MCP", on: true });
      expect(composerBar(chips, cfg, { thinkingChoice: "auto", modelThinking: null }).shown.map((c) => c.cmd)).toContain("/tools ");
    });

    test("a server still being listed or failed says so", () => {
      const cold = [{ serverId: "s1", name: "umami", tools: [] as string[] }];
      expect(toolsChip({ tools: ["web-search"], mcpServerIds: ["s1"], enableTools: true }, { mcpServers: cold, mcpDiscovery: { s1: { status: "loading" } } }).title).toBe("Tools: web-search; umami: listing tools…");
      expect(toolsChip({ mcpServerIds: ["s1"], enableTools: true }, { mcpServers: cold, mcpDiscovery: { s1: { status: "failed", error: "connect refused" } } }).title).toBe("Tools: umami: could not list tools (connect refused)");
    });

    test("no servers: unchanged", () => {
      expect(toolsChip({ tools: ["web-search"], enableTools: true }).text).toBe("web-search");
      expect(toolsChip({}).text).toBe("Tools off");
      expect(toolsChip({ enableTools: true }).text).toBe("No tools");
    });
  });

  test("no provider: only skills / agent control / docs chips", () => {
    const chips = quickBarChips({ agentControl: true }, ctx({ provider: "", pinnedSkillCount: 1, documentCount: 2 }));
    expect(chips.map((c) => c.text)).toEqual(["1 skill pinned", "Agent control", "2 documents"]);
  });

  test("the Agent control chip counts the extra capability groups switched on", () => {
    const chips = quickBarChips({ agentControl: true, agentControlGroups: ["tools", "limits"] }, ctx({ provider: "" }));
    expect(chips.map((c) => c.text)).toContain("Agent control +2");
  });

  test("model without thinking mode; no model ⇒ no thinking chip; no workspace label", () => {
    expect(quickBarChips({}, ctx({ modelThinking: false })).find((c) => c.cmd === "/thinking ")?.text).toBe("No thinking mode");
    const noModel = quickBarChips({}, ctx({ model: "" }));
    expect(noModel.some((c) => c.cmd === "/thinking ")).toBe(false);
    expect(noModel.find((c) => c.cmd === "/model ")?.text).toBe("anthropic · default model");
    expect(noModel.find((c) => c.cmd === "/workspace ")).toMatchObject({ text: "No workspace", icon: "folder", on: false });
    expect(noModel.find((c) => c.cmd === "/terminal ")?.on).toBe(false);
  });

  test("shell off but the git toolset picked: the shell chip says the toolset brings it", () => {
    const shellPresets = { git: ["git", "gh"] };
    const chip = quickBarChips({ tools: ["git"] }, ctx({ shellPresets })).find((c) => c.cmd === "/terminal ");
    expect(chip?.text).toBe("Shell: git · gh only");
    expect(chip?.title).toContain("enabled by git toolset (git · gh only)");
    // no toolset picked, or no presets loaded yet: the plain choice
    expect(quickBarChips({ tools: ["web-search"] }, ctx({ shellPresets })).find((c) => c.cmd === "/terminal ")?.text).toBe("Shell off");
    expect(quickBarChips({ tools: ["git"] }, ctx()).find((c) => c.cmd === "/terminal ")?.text).toBe("Shell off");
    // the user's full shell wins the label
    expect(quickBarChips({ tools: ["git"], terminalTools: true }, ctx({ shellPresets })).find((c) => c.cmd === "/terminal ")?.text).toBe(
      "Shell on this machine",
    );
  });
});
