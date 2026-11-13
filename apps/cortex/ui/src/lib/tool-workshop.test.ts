import { describe, expect, test } from "bun:test";
import {
  EMPTY_MCP_DRAFT,
  buildMcpPayload,
  defaultRequestJson,
  filterCatalog,
  kindLabel,
  kindTone,
  mcpDraftFromRow,
  mcpDraftJsonError,
  previewMcpImport,
  relativeTime,
  type CatalogEntry,
} from "./tool-workshop.js";

const entry = (over: Partial<CatalogEntry>): CatalogEntry => ({
  id: "x",
  kind: "built-in",
  name: "x",
  displayName: "x",
  description: "",
  parameters: [],
  executable: true,
  metrics: { callCount: 0, successRatePct: null, avgDurationMs: null, lastUsedAt: null },
  ...over,
});

describe("filterCatalog", () => {
  const catalog = [
    entry({ id: "a", displayName: "web-search", description: "Search the web" }),
    entry({ id: "b", kind: "mcp", displayName: "fs/read", description: "Read a file" }),
  ];
  test("blank search returns the catalog", () => {
    expect(filterCatalog(catalog, "  ")).toBe(catalog);
  });
  test("matches name, description or kind label", () => {
    expect(filterCatalog(catalog, "WEB").map((t) => t.id)).toEqual(["a"]);
    expect(filterCatalog(catalog, "file").map((t) => t.id)).toEqual(["b"]);
    expect(filterCatalog(catalog, "mcp").map((t) => t.id)).toEqual(["b"]);
  });
  test("kind labels are sentence case; tones carry meaning", () => {
    expect([kindLabel("built-in"), kindLabel("meta"), kindLabel("mcp"), kindLabel("custom")]).toEqual(["Built-in", "Meta", "MCP", "Custom"]);
    expect([kindTone("built-in"), kindTone("meta"), kindTone("mcp"), kindTone("custom")]).toEqual(["io", "accent", "neutral", "neutral"]);
  });
});

describe("defaultRequestJson", () => {
  test("no parameters is an empty object", () => {
    expect(defaultRequestJson([])).toBe("{}");
  });
  test("first enum value, 0, false or empty string per type", () => {
    const json = defaultRequestJson([
      { name: "mode", type: "string", required: true, description: "", enum: ["fast", "slow"] },
      { name: "n", type: "number", required: false, description: "" },
      { name: "flag", type: "boolean", required: false, description: "" },
      { name: "q", type: "string", required: true, description: "" },
    ]);
    expect(JSON.parse(json)).toEqual({ mode: "fast", n: 0, flag: false, q: "" });
  });
});

describe("relativeTime", () => {
  test("buckets", () => {
    expect(relativeTime(null)).toBe("—");
    expect(relativeTime(1000, 30_000)).toBe("just now");
    expect(relativeTime(0, 5 * 60_000)).toBe("5 minutes ago");
    expect(relativeTime(0, 3 * 3_600_000)).toBe("3 hours ago");
  });
});

describe("MCP form", () => {
  test("stdio payload splits args and drops endpoint and auth", () => {
    const body = buildMcpPayload({ ...EMPTY_MCP_DRAFT, name: " fs ", command: " bunx ", args: "-y, pkg\n.", endpoint: "http://x", env: '{"A":"1"}' });
    expect(body).toEqual({ name: "fs", transport: "stdio", command: "bunx", args: ["-y", "pkg", "."], env: { A: "1" } });
  });
  test("url transports send endpoint and auth", () => {
    const body = buildMcpPayload({ ...EMPTY_MCP_DRAFT, name: "ctx", transport: "sse", endpoint: "http://h/sse", auth: '{"type":"x"}' });
    expect(body).toEqual({ name: "ctx", transport: "sse", endpoint: "http://h/sse", auth: { type: "x" } });
  });
  test("JSON errors, including auth on stdio", () => {
    expect(mcpDraftJsonError({ ...EMPTY_MCP_DRAFT, headers: "{" })).toBe("Headers or env must be valid JSON objects");
    expect(mcpDraftJsonError({ ...EMPTY_MCP_DRAFT, auth: "{}" })).not.toBeNull();
    expect(mcpDraftJsonError({ ...EMPTY_MCP_DRAFT, transport: "sse", auth: "{}" })).toBeNull();
  });
  test("read-only: off sends nothing; all sends true; tools sends the trimmed names; trustAnnotations only when ticked", () => {
    const base = { ...EMPTY_MCP_DRAFT, name: "umami", command: "x" };
    expect(buildMcpPayload(base)).toEqual({ name: "umami", transport: "stdio", command: "x" });
    expect(buildMcpPayload({ ...base, readOnlyMode: "all", trustAnnotations: true })).toMatchObject({ readOnly: true, trustAnnotations: true });
    expect(buildMcpPayload({ ...base, readOnlyMode: "tools", readOnlyTools: " get-stats,\nget-events ,," }).readOnly).toEqual(["get-stats", "get-events"]);
    // "specific tools" with no names is not a promise: nothing is sent
    expect(buildMcpPayload({ ...base, readOnlyMode: "tools", readOnlyTools: " " })).not.toHaveProperty("readOnly");
  });
  test("read-only settings load back into the draft", () => {
    const row = (config: Record<string, unknown>) => mcpDraftFromRow({ serverId: "s", name: "u", tools: [], config: { transport: "stdio", ...config } });
    expect(row({})).toMatchObject({ readOnlyMode: "off", readOnlyTools: "", trustAnnotations: false });
    expect(row({ readOnly: true, trustAnnotations: true })).toMatchObject({ readOnlyMode: "all", trustAnnotations: true });
    expect(row({ readOnly: ["a", "b"] })).toMatchObject({ readOnlyMode: "tools", readOnlyTools: "a, b" });
  });
  test("draft from a saved row round-trips the config", () => {
    const d = mcpDraftFromRow({ serverId: "s", name: "row", tools: [], config: { transport: "stdio", command: "docker", args: ["run", "-i"], env: { K: "v" } } });
    expect(d).toMatchObject({ name: "row", transport: "stdio", command: "docker", args: "run, -i" });
    expect(JSON.parse(d.env)).toEqual({ K: "v" });
  });
});

describe("previewMcpImport", () => {
  test("recognised shapes", () => {
    expect(previewMcpImport("").error).toBe("Paste JSON to validate/import.");
    expect(previewMcpImport("[1,2]").preview).toBe("Detected array with 2 server entries.");
    expect(previewMcpImport('{"servers":[{}]}').preview).toBe("Detected { servers: [...] } with 1 entries.");
    expect(previewMcpImport('{"mcpServers":{"a":{"command":"x"},"b":{"url":"http://h"}}}').preview).toBe(
      "Detected Cursor-style mcpServers (2): a (stdio), b (url-based)",
    );
    expect(previewMcpImport('{"command":"x"}').preview).toBe("Detected single server object.");
  });
  test("bad JSON and unsupported shapes are errors", () => {
    expect(previewMcpImport("{").error).toStartWith("Invalid JSON:");
    expect(previewMcpImport("42").error).toBe("JSON shape is unsupported. Use object/array.");
  });
});
