import { describe, expect, test } from "bun:test";
import {
  ADD_MODES,
  autoSelectId,
  availableMcpServers,
  bareToolName,
  disabledInUse,
  disabledInUseText,
  disabledMcpServers,
  isStale,
  probeQueue,
  PROBE_CONCURRENCY,
  PROBE_TIMEOUT_MS,
  STALE_AFTER_MS,
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

describe("background status checks", () => {
  test("the rules: 10 minutes stale, 2 at once, 15 seconds each", () => {
    expect([STALE_AFTER_MS, PROBE_CONCURRENCY, PROBE_TIMEOUT_MS]).toEqual([600_000, 2, 15_000]);
  });

  test("isStale: never checked or older than 10 minutes; fresh is not; disabled never", () => {
    expect(isStale({ lastCheckedAt: null }, NOW)).toBe(true);
    expect(isStale({}, NOW)).toBe(true);
    expect(isStale({ lastCheckedAt: NOW - STALE_AFTER_MS - 1 }, NOW)).toBe(true);
    expect(isStale({ lastCheckedAt: NOW - STALE_AFTER_MS }, NOW)).toBe(false);
    expect(isStale({ lastCheckedAt: NOW - 1000 }, NOW)).toBe(false);
    expect(isStale({ enabled: false, lastCheckedAt: null }, NOW)).toBe(false);
  });

  test("probeQueue picks stale enabled servers, never-checked first then oldest, skipping running ones", () => {
    const rows = [
      row({ serverId: "fresh", lastCheckedAt: NOW - 1000 }),
      row({ serverId: "old", lastCheckedAt: NOW - 3_600_000 }),
      row({ serverId: "never" }),
      row({ serverId: "off", enabled: false }),
      row({ serverId: "busy" }),
      row({ serverId: "older", lastCheckedAt: NOW - 7_200_000 }),
    ];
    expect(probeQueue(rows, NOW, new Set(["busy"]))).toEqual(["never", "older", "old"]);
  });

  test("probeQueue with force (Recheck all) takes every enabled server, still skipping running ones and never disabled ones", () => {
    const rows = [row({ serverId: "a", lastCheckedAt: NOW - 1000 }), row({ serverId: "b", enabled: false }), row({ serverId: "c", lastCheckedAt: NOW - 5000 })];
    expect(probeQueue(rows, NOW, new Set(["c"]), true)).toEqual(["a"]);
    expect(probeQueue([], NOW, new Set(), true)).toEqual([]);
  });

  test("a checking row reads Checking… with a neutral tone (never the running tone); disabled rows never check", () => {
    const r = serverListRow(row({ lastStatus: "ok", lastCheckedAt: NOW - 60_000, tools: [{ toolName: "a" }] }), NOW, true);
    expect([r.label, r.tone, r.checking]).toEqual(["Checking…", "idle", true]);
    expect(r.toolText).toBe("1 tool");
    expect(r.checkedText).toBe("checked 1 minute ago");
    const off = serverListRow(row({ enabled: false }), NOW, true);
    expect([off.label, off.checking]).toEqual(["Disabled", false]);
    expect(serverListRow(row({ lastStatus: "ok" }), NOW).checking).toBe(false);
  });

  test("autoSelectId keeps a pick that still exists, else the first server, else nothing", () => {
    const rows = [row({ serverId: "a" }), row({ serverId: "b" })];
    expect(autoSelectId(rows, "b")).toBe("b");
    expect(autoSelectId(rows, null)).toBe("a");
    expect(autoSelectId(rows, "gone")).toBe("a");
    expect(autoSelectId([], "a")).toBeNull();
  });
});

describe("agent-facing MCP servers (disabled ones are never offered)", () => {
  const rows = [row({ serverId: "a", name: "on" }), row({ serverId: "b", name: "off", enabled: false }), row({ serverId: "c", name: "old", enabled: undefined })];

  test("availableMcpServers keeps enabled rows (absent = on); disabledMcpServers is the complement", () => {
    expect(availableMcpServers(rows).map((r) => r.serverId)).toEqual(["a", "c"]);
    expect(disabledMcpServers(rows).map((r) => r.serverId)).toEqual(["b"]);
    expect(availableMcpServers([])).toEqual([]);
  });

  test("disabledInUse lists only the switched-off servers a config still names", () => {
    expect(disabledInUse(rows, ["a", "b"]).map((r) => r.serverId)).toEqual(["b"]);
    expect(disabledInUse(rows, ["a", "c"])).toEqual([]);
    expect(disabledInUse(rows, [])).toEqual([]);
  });

  test("the note words one or several servers", () => {
    expect(disabledInUseText(["files"])).toBe("Uses a disabled server (skipped): files");
    expect(disabledInUseText(["a", "b"])).toBe("Uses disabled servers (skipped): a, b");
  });
});
