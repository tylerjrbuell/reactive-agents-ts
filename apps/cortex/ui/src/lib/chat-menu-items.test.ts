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

describe("/approvals rows", () => {
  const catalog = { ...EMPTY_CATALOG, shellPresets: { git: ["git", "gh"] }, approvalRequired: ["file-write", "shell-execute"] };
  const withApply = (input: string, cfg: Patch, toolNames: string[]) => {
    const patches: Patch[] = [];
    const p = picker(input, { cfg, toolNames, catalog, apply: (_w, patch) => void patches.push(patch) });
    return { rows: pickerItems(p.ctx), calls: p.calls, patches };
  };

  test("add <command> writes a normalized rule to the top-level approvalPolicy (replacing a legacy gate)", () => {
    const { rows, patches } = withApply("/approvals add git   commit", { durableRuns: { enabled: true, approvalTools: ["web-search"] } }, ["git"]);
    expect(rows.map((r) => r.label)).toEqual(["Ask before git commit"]);
    void rows[0]!.run();
    expect(patches).toEqual([{ approvalPolicy: { mode: "detach", tools: ["web-search"], commands: ["git commit"] } }]);
  });

  test("a bare * is refused as a rule", () => {
    const { rows } = withApply("/approvals add *", {}, ["git"]);
    expect(rows[0]!.label).toBe('"*" matches nothing');
  });

  test("lists mode, tools (git pick as shell-execute), rules, add and off; locks auto-gated tools", () => {
    const cfg = { approvalPolicy: { mode: "detach", tools: [], commands: ["git push"] } };
    const { rows, calls } = withApply("/approvals ", cfg, ["file-write", "git"]);
    expect(rows.map((r) => r.key)).toEqual(["mode:detach", "mode:block", "tool:file-write", "tool:shell-execute", "rule:git push", "add", "off"]);
    expect(rows.find((r) => r.key === "tool:file-write")).toMatchObject({ active: true, hint: "always asks" });
    expect(rows.find((r) => r.key === "tool:shell-execute")).toMatchObject({ active: false, hint: "tool" });
    void rows.find((r) => r.key === "rule:git push")!.run();
    expect(calls.at(-1)).toBe(`toggle:Remove rule git push:${JSON.stringify({ approvalPolicy: { mode: "detach", tools: [], commands: [] } })}`);
  });
});

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

  test("a selected tool the catalog does not list gets a row that unticks it (2026-11-11 QA: calculator)", () => {
    const catalog = {
      ...EMPTY_CATALOG,
      toolsets: { web: ["web-search", "http-get"] },
      builtinTools: [{ name: "web-search", label: "web-search" }],
      mcpServers: [{ serverId: "s1", name: "ctx7", tools: ["get-library-docs"] }],
    };
    const cfg = { tools: ["calculator", "web-search", "web", "get-library-docs"], enableTools: true };
    const { ctx, calls } = picker("/tools ", { cfg, catalog, toolNames: cfg.tools });
    const rows = pickerItems(ctx);
    const calc = rows.find((r) => r.key === "tool:calculator");
    expect(calc).toMatchObject({ multi: true, active: true, label: "calculator", hint: "not in the catalog" });
    expect(rows.filter((r) => r.key.startsWith("tool:")).map((r) => r.key)).toEqual(["tool:web-search", "tool:calculator"]);
    void calc!.run();
    expect(calls).toEqual(['toggle:calculator:{"tools":["web-search","web","get-library-docs"],"enableTools":true}']);
  });

  test("terminal rows patch from the config at run time", () => {
    const { ctx, calls } = picker("/terminal host");
    const rows = pickerItems(ctx);
    expect(rows.map((r) => r.key)).toEqual(["host"]);
    void rows[0]!.run();
    expect(calls[0]).toStartWith("apply:");
  });
});

describe("skill pickers", () => {
  const skills = [
    { name: "release-notes", description: "Write release notes", source: "workspace" as const, root: "/ws/.agents/skills" },
    { name: "review", description: "Review code", source: "claude" as const, root: "/ws/.claude/skills" },
  ];

  test("/skill <name> marks the skill for the next message only (no config PATCH)", () => {
    const queued: string[] = [];
    const { ctx, calls } = picker("/skill rel", { skills, toggleQueuedSkill: (n) => void queued.push(n) });
    const rows = pickerItems(ctx);
    expect(rows.map((r) => r.key)).toEqual(["once:release-notes"]);
    expect(rows[0]!.detail).toBe("Write release notes · .agents/skills");
    void rows[0]!.run();
    expect(queued).toEqual(["release-notes"]);
    expect(calls).toEqual([]);
  });

  test("/skills <name> pins by name for every turn (no scan root written)", () => {
    const { ctx, calls } = picker("/skills rev", { skills });
    void pickerItems(ctx)[0]!.run();
    expect(calls).toEqual(['toggle:Pin review:{"skills":{"paths":[],"activate":["review"]}}']);
  });

  test("/skill with no workspace skills says where to put one", () => {
    const { ctx } = picker("/skill ", { skills: [] });
    expect(pickerItems(ctx).map((r) => r.label)).toEqual(["No skills in this workspace"]);
  });
});

describe("commandMenuItems", () => {
  const base = (input: string, over: Partial<CommandMenuContext> = {}): CommandMenuContext => ({
    slash: parseSlash(input),
    skills: [{ name: "review", description: "Review code", source: "workspace", root: "/ws/.agents/skills" }],
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

  test("a queued skill reads next message, a pinned one every turn; the detail names where it was found", () => {
    expect(commandMenuItems(base("/review", { queuedSkills: ["review"] })).at(-1)).toMatchObject({ hint: "next message", active: true });
    expect(commandMenuItems(base("/review", { pinned: ["review"] })).at(-1)).toMatchObject({ hint: "every turn", active: true });
    expect(commandMenuItems(base("/review")).at(-1)?.detail).toBe("Review code · .agents/skills");
  });

  test("empty once the user typed past the command", () => {
    expect(commandMenuItems(base("/model "))).toEqual([]);
    expect(commandMenuItems(base("plain"))).toEqual([]);
  });
});
