import { describe, expect, test } from "bun:test";
import { defaultConfig } from "./types/agent-config.js";
import {
  effectiveToolsEnabled,
  hasToolSelection,
  mcpAvailableCount,
  mcpServerMode,
  mcpToolAvailable,
  toggleMcpServerAttached,
  toggleMcpTool,
  toggleServerTools,
} from "./tool-selection.js";

describe("MCP server selection (attached = every tool available)", () => {
  const umami = { serverId: "u", tools: ["umami/a", "umami/b", "umami/c"] };
  const cfg = (tools: string[], mcpServerIds: string[]) => ({ tools, mcpServerIds });

  test("attaching names no tools; every tool of the server is available", () => {
    const next = toggleMcpServerAttached(cfg(["web-search"], []), umami);
    expect(next).toEqual({ tools: ["web-search"], mcpServerIds: ["u"] });
    expect(mcpServerMode(next, umami)).toBe("all");
    expect(mcpAvailableCount(next, umami)).toBe(3);
  });

  test("detaching drops the id and any named tools of that server only", () => {
    expect(toggleMcpServerAttached(cfg(["web-search", "umami/a"], ["u", "other"]), umami)).toEqual({ tools: ["web-search"], mcpServerIds: ["other"] });
  });

  test("an old explicit list stays a subset: only the named tools are available", () => {
    const c = cfg(["umami/a", "umami/c"], ["u"]);
    expect(mcpServerMode(c, umami)).toBe("subset");
    expect(mcpToolAvailable(c, umami, "umami/a")).toBe(true);
    expect(mcpToolAvailable(c, umami, "umami/b")).toBe(false);
  });

  test("an unattached server offers nothing", () => {
    expect(mcpServerMode(cfg(["umami/a"], []), umami)).toBe("off");
    expect(mcpAvailableCount(cfg([], []), umami)).toBe(0);
  });

  test("excluding one tool of an attached server names the rest", () => {
    expect(toggleMcpTool(cfg([], ["u"]), umami, "umami/b")).toEqual({ tools: ["umami/a", "umami/c"], mcpServerIds: ["u"] });
  });

  test("restoring the last excluded tool collapses back to all (nothing named)", () => {
    expect(toggleMcpTool(cfg(["umami/a", "umami/c"], ["u"]), umami, "umami/b")).toEqual({ tools: [], mcpServerIds: ["u"] });
  });

  test("removing the only named tool detaches the server (an empty subset would mean all)", () => {
    expect(toggleMcpTool(cfg(["x", "umami/a"], ["u"]), umami, "umami/a")).toEqual({ tools: ["x"], mcpServerIds: [] });
  });

  test("clicking a tool of an unattached server attaches it with just that tool", () => {
    expect(toggleMcpTool(cfg(["x"], []), umami, "umami/b")).toEqual({ tools: ["x", "umami/b"], mcpServerIds: ["u"] });
  });

  test("other servers' tools are untouched", () => {
    const next = toggleMcpTool(cfg(["other/z"], ["u", "o"]), umami, "umami/a");
    expect(next.tools).toContain("other/z");
    expect(next.mcpServerIds).toEqual(["u", "o"]);
  });
});

describe("tool selection → tools enabled", () => {
  test("a selection enables tools unless explicitly switched off; explicit on works with none", () => {
    const withTools = { ...defaultConfig(), tools: ["web-search"] };
    const none = { ...defaultConfig(), tools: [] };
    expect(hasToolSelection(withTools)).toBe(true);
    expect(effectiveToolsEnabled(withTools, undefined)).toBe(true);
    expect(effectiveToolsEnabled(withTools, false)).toBe(false);
    expect(effectiveToolsEnabled(none, undefined)).toBe(false);
    expect(effectiveToolsEnabled(none, true)).toBe(true);
    expect(effectiveToolsEnabled({ ...none, mcpServerIds: ["m"] }, undefined)).toBe(true);
  });
});

describe("toggleServerTools", () => {
  const server = ["a", "b", "c"];
  test("selects every tool of the server when not all are selected, keeping other selections", () => {
    expect(toggleServerTools(["x", "a"], server)).toEqual(["x", "a", "b", "c"]);
  });
  test("clears the whole server when all are selected, keeping other selections", () => {
    expect(toggleServerTools(["x", "a", "b", "c"], server)).toEqual(["x"]);
  });
  test("a server with no cached tools is a no-op", () => {
    expect(toggleServerTools(["x"], [])).toEqual(["x"]);
  });
});
