import { describe, expect, test } from "bun:test";
import { commandNameOf, matchEntries, panelTitle, settingEntries, surfaceBack, surfaceView } from "./config-menu-nav.js";
import { CHAT_COMMANDS, parseSlash, resolveCommand } from "./chat-commands.js";
import { configGroups } from "./chat-composer-bar.js";
import { quickBarChips, type QuickBarChipContext } from "./chat-quickbar-chips.js";
import { commandMenuItems } from "./chat-menu-items.js";

const chipCtx: QuickBarChipContext = {
  provider: "ollama",
  model: "qwen3",
  modelThinking: null,
  thinkingChoice: "auto",
  strategyLabel: "ReAct",
  pinnedSkillCount: 0,
  documentCount: 0,
};
const groups = configGroups(quickBarChips({}, chipCtx), {}, chipCtx);
const settings = settingEntries(groups);
const rows = groups.flatMap((g) => g.rows);

describe("one registry: Config rows and slash commands are the same entries", () => {
  test("every Config row's slash alias is a real command", () => {
    for (const r of rows) {
      expect(CHAT_COMMANDS.map((c) => String(c.name))).toContain(commandNameOf(r.cmd));
    }
  });

  test("every setting command (one with a panel) has a Config row, bar the one-message /skill", () => {
    const withPanel = CHAT_COMMANDS.filter((c) => c.picker !== undefined).map((c) => c.name);
    const missing = withPanel.filter((n) => !settings.has(n) && n !== "skill");
    expect(missing).toEqual([]);
  });

  test("/agent has a panel, so Agent control opens in place with its on/off rows", () => {
    expect(resolveCommand(parseSlash("/agent ")!)).toMatchObject({ name: "agent", picker: "agent" });
    expect(settings.get("agent")).toMatchObject({ label: "Agent control" });
  });

  test("the alias of a row with arguments still names its command", () => {
    expect(commandNameOf("/tools disclosure")).toBe("tools");
    expect(commandNameOf("/model ")).toBe("model");
  });
});

describe("the root list", () => {
  const names = (q: string) => matchEntries(q, settings).map((c) => c.name);

  test("no text after the slash lists every command", () => {
    expect(names("")).toEqual(CHAT_COMMANDS.map((c) => c.name));
  });

  test("filters by the text after the slash, name first", () => {
    expect(names("mod")[0]).toBe("model");
    expect(names("zzz")).toEqual([]);
  });

  test("a Config name finds its command: /control reaches /agent", () => {
    expect(names("control")).toContain("agent");
    expect(names("directory")).toContain("workspace");
  });

  test("the list shows each setting's alias with its current value as the hint", () => {
    const items = commandMenuItems({
      slash: parseSlash("/")!,
      settings,
      skills: null,
      queuedSkills: [],
      pinned: [],
      runCommand: () => undefined,
      completeCommand: () => undefined,
      toggleQueuedSkill: () => undefined,
    });
    const provider = items.find((i) => i.key === "provider");
    expect(provider).toMatchObject({ label: "/provider", hint: "ollama" });
    expect(items.find((i) => i.key === "agent")).toMatchObject({ label: "/agent", hint: "Off" });
    // A command without a setting keeps the argument hint.
    expect(items.find((i) => i.key === "rename")).toMatchObject({ label: "/rename", hint: "<name>" });
  });

  test("during a run only the config commands are listed", () => {
    const items = commandMenuItems({
      slash: parseSlash("/")!,
      settings,
      sending: true,
      skills: [{ name: "x", description: "", path: "" } as never],
      queuedSkills: [],
      pinned: [],
      runCommand: () => undefined,
      completeCommand: () => undefined,
      toggleQueuedSkill: () => undefined,
    });
    expect(items.map((i) => i.key)).toContain("model");
    expect(items.map((i) => i.key)).not.toContain("clear");
    expect(items.some((i) => i.key.startsWith("skill:"))).toBe(false);
  });
});

describe("surface levels (the composer text is the state)", () => {
  test("no slash is closed; / and /mod are the root; /model is its panel", () => {
    expect(surfaceView(parseSlash("hello"))).toEqual({ kind: "closed" });
    expect(surfaceView(parseSlash("/"))).toEqual({ kind: "root", query: "" });
    expect(surfaceView(parseSlash("/mod"))).toEqual({ kind: "root", query: "mod" });
    expect(surfaceView(parseSlash("/model "))).toMatchObject({ kind: "panel", command: { name: "model" } });
    expect(surfaceView(parseSlash("/agent "))).toMatchObject({ kind: "panel", command: { name: "agent" } });
  });

  test("a command with a typed argument and no panel is not a panel", () => {
    expect(surfaceView(parseSlash("/rename Foo"))).toEqual({ kind: "closed" });
    expect(surfaceView(parseSlash("/nosuch x"))).toEqual({ kind: "closed" });
  });

  test("Back goes from a panel to the unfiltered root, then closes", () => {
    const panel = surfaceView(parseSlash("/tools research"));
    expect(surfaceBack(panel)).toBe("/");
    const root = surfaceView(parseSlash(surfaceBack(panel)!));
    expect(root).toEqual({ kind: "root", query: "" });
    expect(surfaceBack(root)).toBeNull();
    expect(surfaceBack({ kind: "closed" })).toBeNull();
  });

  test("a panel is titled by its Config name, else its alias", () => {
    expect(panelTitle(resolveCommand(parseSlash("/agent ")!)!, settings)).toBe("Agent control");
    expect(panelTitle(resolveCommand(parseSlash("/agent ")!)!, new Map())).toBe("/agent");
  });
});
