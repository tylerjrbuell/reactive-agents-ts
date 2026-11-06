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
    expect(chips.find((c) => c.cmd === "/workspace ")).toMatchObject({ text: "proj", icon: "folder_open", title: "/home/me/proj/" });
    expect(chips.find((c) => c.cmd === "/terminal ")?.text).toBe("Shell on this machine");
    expect(chips.find((c) => c.cmd === "/thinking ")?.text).toBe("Thinking auto");
  });

  test("no provider: only skills / agent control / docs chips", () => {
    const chips = quickBarChips({ agentControl: true }, ctx({ provider: "", pinnedSkillCount: 1, documentCount: 2 }));
    expect(chips.map((c) => c.text)).toEqual(["1 skill pinned", "Agent control", "2 documents"]);
  });

  test("model without thinking mode; no model ⇒ no thinking chip; no workspace label", () => {
    expect(quickBarChips({}, ctx({ modelThinking: false })).find((c) => c.cmd === "/thinking ")?.text).toBe("No thinking mode");
    const noModel = quickBarChips({}, ctx({ model: "" }));
    expect(noModel.some((c) => c.cmd === "/thinking ")).toBe(false);
    expect(noModel.find((c) => c.cmd === "/model ")?.text).toBe("default model");
    expect(noModel.find((c) => c.cmd === "/workspace ")).toMatchObject({ text: "No workspace", icon: "folder_off" });
  });
});
