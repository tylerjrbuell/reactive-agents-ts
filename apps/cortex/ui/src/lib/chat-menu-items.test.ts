import { describe, expect, test } from "bun:test";
import { commandMenuItems, pickerItems, type CommandMenuContext, type PickerContext } from "./chat-menu-items.js";
import { parseSlash, resolveCommand } from "./chat-commands.js";
import { EMPTY_CATALOG } from "./chat-quickbar-data.js";

type Patch = Record<string, unknown>;

function picker(input: string, over: Partial<PickerContext> = {}): { ctx: PickerContext; calls: string[] } {
  const calls: string[] = [];
  const slash = parseSlash(input);
  const ctx: PickerContext = {
    slash,
    command: slash ? resolveCommand(slash) : undefined,
    cfg: {},
    provider: "ollama",
    model: "qwen3:14b",
    models: [{ value: "qwen3:14b", label: "qwen3:14b", thinking: true }],
    providers: ["anthropic", "ollama"],
    thinkingChoice: "auto",
    modelThinking: null,
    strategy: "reactive",
    workspace: "",
    shell: "off",
    toolNames: [],
    catalog: EMPTY_CATALOG,
    skills: [],
    pinned: [],
    docs: [],
    apply: (what) => void calls.push(`apply:${what}`),
    setProvider: (p) => void calls.push(`provider:${p}`),
    toggle: (what, patch) => void calls.push(`toggle:${what}:${JSON.stringify(patch())}`),
    swapDraft: (next) => void calls.push(`draft:${next}`),
    browseWorkspace: () => void calls.push("browse"),
    info: (title) => void calls.push(`info:${title}`),
    ...over,
  };
  return { ctx, calls };
}

describe("pickerItems", () => {
  test("no rows until a picker command has an argument", () => {
    expect(pickerItems(picker("/model").ctx)).toEqual([]);
    expect(pickerItems(picker("/clear ").ctx)).toEqual([]);
    expect(pickerItems(picker("hello").ctx)).toEqual([]);
  });

  test("provider rows mark the current provider and run setProvider", () => {
    const { ctx, calls } = picker("/provider ");
    const rows = pickerItems(ctx);
    expect(rows.map((r) => r.key)).toEqual(["anthropic", "ollama"]);
    expect(rows[1]).toMatchObject({ active: true, hint: "current" });
    void rows[0]!.run();
    expect(calls).toEqual(["provider:anthropic"]);
  });

  test("model rows filter by the typed text and offer a custom id", () => {
    const rows = pickerItems(picker("/model llama3").ctx);
    expect(rows.map((r) => r.label)).toEqual(['Use "llama3"']);
    const all = pickerItems(picker("/model ").ctx);
    expect(all[0]).toMatchObject({ active: true, badge: "think", hint: "thinking model" });
  });

  test("a multi row computes its patch from the config when it runs, not when it was built", () => {
    let cfg: Patch = { enableTools: false };
    const base = picker("/tools ").ctx;
    const calls: string[] = [];
    const ctx: PickerContext = {
      ...base,
      get cfg() { return cfg; },
      toggle: (what, patch) => void calls.push(`${what}:${JSON.stringify(patch())}`),
    };
    const power = pickerItems(ctx).find((r) => r.key === "power")!;
    expect(power).toMatchObject({ multi: true, label: "Turn tools on", active: false });
    cfg = { enableTools: true }; // a previous queued toggle already turned tools on
    void power.run();
    expect(calls).toEqual(['Tools on/off:{"enableTools":false}']);
  });

  test("workspace picker offers browse, and clear once a workspace is set", () => {
    const { ctx, calls } = picker("/workspace ", { workspace: "/repo" });
    const rows = pickerItems(ctx);
    expect(rows.map((r) => r.key)).toEqual(["/repo", "browse", "clear"]);
    void rows.find((r) => r.key === "browse")!.run();
    expect(calls).toEqual(["browse"]);
  });

  test("docs add row applies a new source and reports a duplicate", () => {
    const fresh = picker("/docs add ./notes.md");
    void pickerItems(fresh.ctx)[0]!.run();
    expect(fresh.calls).toEqual(["apply:Added ./notes.md"]);
    const dup = picker("/docs add ./notes.md", { cfg: { documents: [{ source: "./notes.md" }] } });
    void pickerItems(dup.ctx)[0]!.run();
    expect(dup.calls).toEqual(["info:Already added"]);
  });

  test("terminal rows patch from the config at run time", () => {
    const { ctx, calls } = picker("/terminal host");
    const rows = pickerItems(ctx);
    expect(rows.map((r) => r.key)).toEqual(["host"]);
    void rows[0]!.run();
    expect(calls[0]).toStartWith("apply:");
  });
});

describe("commandMenuItems", () => {
  const base = (input: string, over: Partial<CommandMenuContext> = {}): CommandMenuContext => ({
    slash: parseSlash(input),
    skills: [{ name: "review", description: "Review code", skillDir: ".agents/skills/review" }],
    queuedSkills: [],
    pinned: [],
    runCommand: () => {},
    completeCommand: () => {},
    toggleQueuedSkill: () => {},
    ...over,
  });

  test("lists matching commands, then skills", () => {
    const rows = commandMenuItems(base("/re"));
    expect(rows.map((r) => r.key)).toContain("rerun");
    expect(rows.at(-1)).toMatchObject({ key: "skill:review", hint: "skill", active: false });
  });

  test("a queued skill reads queued, a pinned one pinned", () => {
    expect(commandMenuItems(base("/review", { queuedSkills: ["review"] })).at(-1)).toMatchObject({ hint: "queued", active: true });
    expect(commandMenuItems(base("/review", { pinned: ["review"] })).at(-1)).toMatchObject({ hint: "pinned", active: true });
  });

  test("empty once the user typed past the command", () => {
    expect(commandMenuItems(base("/model "))).toEqual([]);
    expect(commandMenuItems(base("plain"))).toEqual([]);
  });
});
