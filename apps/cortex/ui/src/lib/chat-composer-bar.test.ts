import { describe, expect, test } from "bun:test";
import { quickBarChips, type QuickBarChipContext } from "./chat-quickbar-chips.js";
import { composerBar, configGroups, disclosureSummary, MAX_BAR_CHIPS } from "./chat-composer-bar.js";

const ctx = (over: Partial<QuickBarChipContext> = {}): QuickBarChipContext => ({
  provider: "ollama",
  model: "qwen3",
  modelThinking: null,
  thinkingChoice: "auto",
  strategyLabel: "ReAct",
  pinnedSkillCount: 0,
  documentCount: 0,
  ...over,
});
const barCmds = (cfg: Record<string, unknown>, c = ctx()) => composerBar(quickBarChips(cfg, c), cfg, c).shown.map((x) => x.cmd);

describe("composerBar", () => {
  test("a default chat shows only the provider · model chip", () => {
    expect(barCmds({})).toEqual(["/model "]);
  });

  test("only settings that differ from the defaults join the model chip", () => {
    const cfg = { strategy: "plan-execute", maxIterations: 8, workspace: "/home/me/proj", terminalTools: true, tools: ["web-search"] };
    expect(barCmds(cfg, ctx({ thinkingChoice: "off" }))).toEqual(["/model ", "/thinking ", "/strategy ", "/tools "]);
  });

  test("a stored strategy or step cap stays on the bar even when it equals the default", () => {
    expect(barCmds({ strategy: "reactive", maxIterations: 16 })).toEqual(["/model ", "/strategy ", "/iterations "]);
  });

  test("the step chip shows for any valid value, preset or not, and hides only when unset", () => {
    for (const n of [1, 10, 16, 20, 50, 200]) {
      const cfg = { maxIterations: n };
      const c = ctx();
      const chip = composerBar(quickBarChips(cfg, c), cfg, c).shown.find((x) => x.cmd === "/iterations ");
      expect(chip?.text).toBe(`${n} steps`);
    }
    expect(barCmds({})).toEqual(["/model "]);
    expect(barCmds({ maxIterations: 0 })).toEqual(["/model "]);
  });

  test("a model with no thinking mode never shows a thinking chip", () => {
    expect(barCmds({}, ctx({ thinkingChoice: "off", modelThinking: false }))).toEqual(["/model "]);
  });

  test("the bar is capped and counts what moved into the Config popover", () => {
    const cfg = { strategy: "plan-execute", maxIterations: 8, workspace: "/w/a", terminalTools: true, tools: ["web-search"], agentControl: true };
    const c = ctx({ thinkingChoice: "on", documentCount: 2 });
    const bar = composerBar(quickBarChips(cfg, c), cfg, c);
    expect(bar.shown).toHaveLength(MAX_BAR_CHIPS);
    // model, thinking, strategy, steps, tools, shell, workspace, agent control, documents = 9 wanted
    expect(bar.hidden).toBe(9 - MAX_BAR_CHIPS);
  });

  test("no provider: nothing but on-chips, and no Config groups", () => {
    const c = ctx({ provider: "", model: "", documentCount: 1 });
    expect(composerBar(quickBarChips({}, c), {}, c).shown.map((x) => x.cmd)).toEqual(["/docs "]);
    expect(configGroups(quickBarChips({}, c), {}, c)).toEqual([]);
  });
});

describe("configGroups", () => {
  test("Model, Reasoning, Tools, Workspace and Limits, every row opening its slash picker", () => {
    const groups = configGroups(quickBarChips({}, ctx()), {}, ctx());
    expect(groups.map((g) => g.title)).toEqual(["Model", "Reasoning", "Tools", "Workspace", "Limits"]);
    expect(groups.flatMap((g) => g.rows.map((r) => r.cmd))).toEqual([
      "/provider ", "/model ", "/thinking ", "/strategy ", "/skills ", "/agent ", "/tools ", "/terminal ", "/mcp ", "/tools disclosure", "/approvals ", "/workspace ", "/docs ", "/iterations ", "/durable ",
    ]);
  });

  test("Durable runs shows Off by default and On once set", () => {
    const row = (cfg: Record<string, unknown>) => configGroups(quickBarChips(cfg, ctx()), cfg, ctx()).flatMap((g) => g.rows).find((r) => r.cmd === "/durable ");
    expect(row({})).toMatchObject({ label: "Durable runs", value: "Off", on: false });
    expect(row({ durableRuns: { enabled: true } })).toMatchObject({ value: "On", on: true });
  });

  test("rows show the current value and mark changed settings", () => {
    const cfg = { mcpServerIds: ["a", "b"], workspace: "/home/me/proj", rawConfig: { tools: { disclosure: "index" } } };
    const rows = configGroups(quickBarChips(cfg, ctx()), cfg, ctx()).flatMap((g) => g.rows);
    expect(rows.find((r) => r.cmd === "/mcp ")).toMatchObject({ value: "2 on", on: true });
    expect(rows.find((r) => r.cmd === "/workspace ")).toMatchObject({ value: "proj", on: true });
    expect(rows.find((r) => r.cmd === "/tools disclosure")).toMatchObject({ on: true });
    expect(rows.find((r) => r.cmd === "/provider ")).toMatchObject({ value: "ollama", on: false });
    expect(rows.find((r) => r.cmd === "/model ")).toMatchObject({ value: "qwen3", on: false });
    expect(rows.find((r) => r.cmd === "/mcp ")).toBeDefined();
  });

  test("the Approvals row shows the default gate, and off after the opt-out", () => {
    const row = (cfg: Record<string, unknown>) => configGroups(quickBarChips(cfg, ctx()), cfg, ctx()).flatMap((g) => g.rows).find((r) => r.cmd === "/approvals ");
    expect(row({})).toMatchObject({ value: "risky tools", on: true });
    expect(row({ askBeforeRiskyTools: false })).toMatchObject({ value: "off", on: false });
  });

  test("a setting with no chip still has a row", () => {
    const rows = configGroups(quickBarChips({}, ctx()), {}, ctx()).flatMap((g) => g.rows);
    expect(rows.find((r) => r.cmd === "/docs ")).toMatchObject({ value: "None", on: false });
    expect(rows.find((r) => r.cmd === "/mcp ")).toMatchObject({ value: "None on", on: false });
  });
});

describe("disclosureSummary", () => {
  test("no stored mode: the framework picks by model tier", () => {
    expect(disclosureSummary({}).text).toBe("Disclosure: tier default");
  });

  test("a stored mode is named with what it does and how many tools are picked", () => {
    const s = disclosureSummary({ tools: ["web-search", "http-get"], rawConfig: { tools: { disclosure: "index" } } });
    expect(s.text).toBe("Disclosure: index (2 tools picked), a name index; schemas load on use");
    expect(s.explain).toContain("never changes which tools are permitted");
  });
});
