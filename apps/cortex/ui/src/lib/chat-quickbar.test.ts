import { describe, expect, test } from "bun:test";
import {
  builtinsSuggestions,
  disclosureChoice,
  disclosurePatch,
  effectiveIterations,
  parseIterations,
  presetPatch,
  terminalChoice,
  terminalPatch,
  toggleMcpServerPatch,
  toggleToolPatch,
  toggleToolsetPatch,
  toolsetChoice,
  toolsetSummary,
} from "./chat-quickbar.js";

describe("chat quick bar", () => {
  test("toolset summary is always visible", () => {
    expect(toolsetSummary({ enableTools: false, tools: ["web-search"] })).toBe("Tools off");
    expect(toolsetSummary({})).toBe("Tools off");
    expect(toolsetSummary({ enableTools: true })).toBe("No tools");
    expect(toolsetSummary({ tools: ["web-search", "file-read", "grep"], terminalTools: true })).toBe("web-search, file-read +2");
    expect(toolsetSummary({ enableTools: true, mcpServerIds: ["m1"] })).toBe("1 MCP");
  });

  test("toolset toggles add all members, then remove all", () => {
    const on = toggleToolsetPatch({ tools: ["grep"] }, ["web-search", "http-get", "grep"]);
    expect(on.tools).toEqual(["grep", "web-search", "http-get"]);
    expect(toggleToolsetPatch({ tools: on.tools }, ["web-search", "http-get", "grep"]).tools).toEqual([]);
    expect(toggleToolPatch({ tools: ["a"] }, "a").tools).toEqual([]);
    expect(toggleToolPatch({}, "a")).toEqual({ tools: ["a"], enableTools: true });
  });

  test("a shell toolset selects its own name and shows its programs, never the bare shell", () => {
    const presets = { git: ["git", "gh"], workspace: ["gws"] };
    const git = toolsetChoice("git", ["shell-execute"], presets, []);
    expect(git).toEqual({ tokens: ["git"], active: false, detail: "git · gh via shell" });
    expect(toggleToolsetPatch({ tools: [] }, git.tokens).tools).toEqual(["git"]);
    // the full host shell being on does not make the scoped git toolset look selected
    expect(toolsetChoice("git", ["shell-execute"], presets, ["shell-execute"]).active).toBe(false);
    expect(toolsetChoice("git", ["shell-execute"], presets, ["git"]).active).toBe(true);
    // ordinary toolsets keep selecting their members
    expect(toolsetChoice("web", ["web-search", "http-get"], presets, ["web-search", "http-get"])).toEqual({
      tokens: ["web-search", "http-get"],
      active: true,
      detail: "web-search, http-get",
    });
    // inherited keys are not presets
    expect(toolsetChoice("constructor", ["x"], presets, []).tokens).toEqual(["x"]);
  });

  test("MCP server id and its tools move together", () => {
    const on = toggleMcpServerPatch({ tools: ["web-search"] }, "srv", ["srv/a", "srv/b"]);
    expect(on).toEqual({ tools: ["web-search", "srv/a", "srv/b"], mcpServerIds: ["srv"], enableTools: true });
    expect(toggleMcpServerPatch(on, "srv", ["srv/a", "srv/b"])).toEqual({ tools: ["web-search"], mcpServerIds: [], enableTools: true });
  });

  test("preset copies a saved agent's toolset", () => {
    expect(presetPatch({ tools: ["file-read"], terminalTools: true, model: "x" })).toEqual({ tools: ["file-read"], mcpServerIds: [], terminalTools: true, enableTools: true });
  });

  test("terminal choice round-trips and keeps other shell options", () => {
    expect(terminalChoice({})).toBe("off");
    const docker = terminalPatch({ terminalShellOptions: { timeoutMs: 5000 } }, "docker");
    expect(docker).toEqual({ terminalTools: true, enableTools: true, terminalShellOptions: { timeoutMs: 5000, sandbox: "docker" } });
    expect(terminalChoice(docker)).toBe("docker");
    const host = terminalPatch(docker, "host");
    expect(terminalChoice(host)).toBe("host");
    expect(host.terminalShellOptions).toEqual({ timeoutMs: 5000 });
    expect(terminalPatch(host, "off")).toEqual({ terminalTools: false });
  });

  test("iterations", () => {
    expect(parseIterations("12")).toBe(12);
    expect(parseIterations("0")).toBeUndefined();
    expect(parseIterations("2.5")).toBeUndefined();
    expect(parseIterations("x")).toBeUndefined();
    expect(effectiveIterations({})).toBe(16);
    expect(effectiveIterations({ maxIterations: 4 })).toBe(4);
  });
});

describe("tool disclosure (`.withTools({ disclosure })`)", () => {
  test("reads rawConfig.tools.disclosure; anything else is the tier default", () => {
    expect(disclosureChoice({})).toBeUndefined();
    expect(disclosureChoice({ rawConfig: { tools: { disclosure: "index" } } })).toBe("index");
    expect(disclosureChoice({ rawConfig: { tools: { disclosure: "hybrid" } } })).toBeUndefined();
  });

  test("setting it keeps every other rawConfig key; clearing drops an emptied tools object", () => {
    const cfg = { rawConfig: { profile: "lean", tools: { builtins: ["read"] } } };
    expect(disclosurePatch(cfg, "discover")).toEqual({ rawConfig: { profile: "lean", tools: { builtins: ["read"], disclosure: "discover" } } });
    expect(disclosurePatch({ rawConfig: { profile: "lean", tools: { disclosure: "all" } } }, undefined)).toEqual({ rawConfig: { profile: "lean" } });
  });

  test("builtins suggestions come from the served toolsets (so `read` shows up) plus `all`", () => {
    expect(builtinsSuggestions({ read: ["file-read"], research: ["web-search"] })).toEqual(["read", "research", "all"]);
  });
});
