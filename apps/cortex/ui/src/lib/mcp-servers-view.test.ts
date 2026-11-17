import { describe, expect, test } from "bun:test";
import {
  ADD_MODES,
  bareToolName,
  failureOf,
  filterServers,
  filterServerTools,
  isReadOnlyTool,
  readOnlyOf,
  schemaParams,
  schemaTooltip,
  serverListRow,
  statusTone,
  testOutcomeText,
  toolCountText,
} from "./mcp-servers-view.js";
import type { McpListRow, McpToolDetail } from "./tool-workshop.js";

const NOW = 1_000_000_000;
const row = (over: Partial<McpListRow> = {}): McpListRow => ({ serverId: "s1", name: "files", config: {}, tools: [], ...over });

describe("add menu", () => {
  test("Quick line, Form, Import JSON in that order (import is an entry, not a toggle)", () => {
    expect(ADD_MODES.map((m) => m.id)).toEqual(["quick", "form", "import"]);
    expect(ADD_MODES.map((m) => m.label)).toEqual(["Quick line", "Form", "Import JSON"]);
  });
});

describe("statusTone", () => {
  test("never maps to running: that tone means a run is live", () => {
    expect(statusTone("ok")).toBe("done");
    expect(statusTone("error")).toBe("failed");
    expect(statusTone("disabled")).toBe("stopped");
    expect(statusTone("unknown")).toBe("idle");
  });
});

describe("serverListRow", () => {
  test("connected: chip, tool count and last check", () => {
    const r = serverListRow(row({ lastStatus: "ok", lastCheckedAt: NOW - 120_000, tools: [{ toolName: "a" }, { toolName: "b" }] }), NOW);
    expect(r.label).toBe("Connected");
    expect(r.toolText).toBe("2 tools");
    expect(r.checkedText).toBe("checked 2 minutes ago");
    expect(r.dimmed).toBe(false);
  });

  test("failed and not-checked rows", () => {
    expect(serverListRow(row({ lastStatus: "error", lastError: "boom" }), NOW).label).toBe("Failed");
    const unchecked = serverListRow(row(), NOW);
    expect(unchecked.label).toBe("Not checked");
    expect(unchecked.toolText).toBe("No tools yet");
    expect(unchecked.checkedText).toBeUndefined();
  });

  test("disabled rows are dimmed and show no last-check text even after an old check", () => {
    const r = serverListRow(row({ enabled: false, lastStatus: "ok", lastCheckedAt: NOW - 1000 }), NOW);
    expect(r.label).toBe("Disabled");
    expect(r.dimmed).toBe(true);
    expect(r.checkedText).toBeUndefined();
  });

  test("an older server build with no enabled field reads as on", () => {
    expect(serverListRow(row({ lastStatus: "ok" }), NOW).dimmed).toBe(false);
  });
});

describe("toolCountText / filterServers / failureOf / testOutcomeText", () => {
  test("count words", () => {
    expect(toolCountText(0)).toBe("No tools yet");
    expect(toolCountText(1)).toBe("1 tool");
    expect(toolCountText(4)).toBe("4 tools");
  });

  test("search by name or id; blank keeps all", () => {
    const rows = [row({ serverId: "a1", name: "github" }), row({ serverId: "b2", name: "files" })];
    expect(filterServers(rows, "").length).toBe(2);
    expect(filterServers(rows, " GIT ").map((r) => r.name)).toEqual(["github"]);
    expect(filterServers(rows, "b2").map((r) => r.name)).toEqual(["files"]);
  });

  test("the failure card shows only for an enabled failed server, with a fallback sentence", () => {
    expect(failureOf(row({ lastStatus: "error", lastError: " spawn ENOENT " }))).toBe("spawn ENOENT");
    expect(failureOf(row({ lastStatus: "error" }))).toBe("The last connection attempt failed.");
    expect(failureOf(row({ lastStatus: "error", enabled: false }))).toBeNull();
    expect(failureOf(row({ lastStatus: "ok" }))).toBeNull();
  });

  test("test outcome line: count on success, the scrubbed error on failure", () => {
    expect(testOutcomeText({ ok: true, toolCount: 3, checkedAt: 1 })).toBe("Connected: 3 tools");
    expect(testOutcomeText({ ok: false, error: "refused" })).toBe("Failed: refused");
  });
});

describe("read-only coverage", () => {
  const tools: McpToolDetail[] = [{ toolName: "files/read" }, { toolName: "files/write" }, { toolName: "list" }];

  test("readOnlyOf: true = all, a list = names, anything else = none", () => {
    expect(readOnlyOf({ readOnly: true })).toEqual({ all: true, names: [] });
    expect(readOnlyOf({ readOnly: ["read", 4] })).toEqual({ all: false, names: ["read"] });
    expect(readOnlyOf({})).toEqual({ all: false, names: [] });
    expect(readOnlyOf({ readOnly: false })).toEqual({ all: false, names: [] });
  });

  test("names match with or without the server prefix", () => {
    expect(bareToolName("files", "files/read")).toBe("read");
    expect(bareToolName("files", "read")).toBe("read");
    expect(isReadOnlyTool({ readOnly: ["read"] }, "files", "files/read")).toBe(true);
    expect(isReadOnlyTool({ readOnly: ["files/read"] }, "files", "read")).toBe(true);
    expect(isReadOnlyTool({ readOnly: ["read"] }, "files", "files/write")).toBe(false);
    expect(isReadOnlyTool({ readOnly: true }, "files", "anything")).toBe(true);
    expect(isReadOnlyTool({}, "files", "files/read")).toBe(false);
  });

  test("filter: all, included (read-only), excluded, with search", () => {
    const cfg = { readOnly: ["read", "list"] };
    expect(filterServerTools(tools, cfg, "files", "all").length).toBe(3);
    expect(filterServerTools(tools, cfg, "files", "included").map((t) => t.toolName)).toEqual(["files/read", "list"]);
    expect(filterServerTools(tools, cfg, "files", "excluded").map((t) => t.toolName)).toEqual(["files/write"]);
    expect(filterServerTools(tools, cfg, "files", "all", "WRI").map((t) => t.toolName)).toEqual(["files/write"]);
  });
});

describe("input schema", () => {
  const schema = {
    type: "object",
    properties: { path: { type: "string", description: "File path" }, depth: { type: ["integer", "null"] }, loose: {} },
    required: ["path"],
  };

  test("params in schema order with required, type unions and a fallback type", () => {
    expect(schemaParams(schema)).toEqual([
      { name: "path", type: "string", required: true, description: "File path" },
      { name: "depth", type: "integer | null", required: false, description: "" },
      { name: "loose", type: "any", required: false, description: "" },
    ]);
  });

  test("tooltip lists one line per parameter; no schema or properties says so", () => {
    expect(schemaTooltip(schema)).toBe("path (string, required): File path\ndepth (integer | null)\nloose (any)");
    expect(schemaTooltip(undefined)).toBe("No parameters");
    expect(schemaTooltip({ type: "object" })).toBe("No parameters");
    expect(schemaTooltip({ properties: [] })).toBe("No parameters");
  });
});
