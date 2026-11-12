import { describe, expect, test } from "bun:test";
import { quickBarChips, type QuickBarChipContext } from "./chat-quickbar-chips.js";

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
  test("provider set: provider, model, thinking, strategy, tools, shell, workspace, steps in order", () => {
    const chips = quickBarChips({ terminalTools: true, workspace: "/home/me/proj/" }, ctx());
    expect(chips.map((c) => c.cmd)).toEqual([
      "/provider ", "/model ", "/thinking ", "/strategy ", "/tools ", "/terminal ", "/workspace ", "/iterations ",
    ]);
    expect(chips.find((c) => c.cmd === "/workspace ")).toMatchObject({ text: "proj", icon: "folder", title: "/home/me/proj/", on: true });
    // A setting that is switched on reads as on (kit Chip `on`); the shell on this machine is on.
    expect(chips.find((c) => c.cmd === "/terminal ")?.on).toBe(true);
    expect(chips.find((c) => c.cmd === "/terminal ")?.text).toBe("Shell on this machine");
    expect(chips.find((c) => c.cmd === "/thinking ")?.text).toBe("Thinking auto");
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
    expect(noModel.find((c) => c.cmd === "/model ")?.text).toBe("default model");
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
