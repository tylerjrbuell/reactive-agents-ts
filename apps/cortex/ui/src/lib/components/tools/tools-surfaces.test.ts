/**
 * Server-render pins for the Lab > Tools surfaces: every state of the server list, detail pane,
 * credentials and custom tool editor (loading, empty, error, disabled, connected), plus the
 * shell's three tabs and the shared attach list with its effects strip.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderComponent } from "../kit/test-render.js";
import type { McpListRow, McpToolDetail } from "$lib/tool-workshop.js";

const NOW = 2_000_000_000;
const dir = (f: string) => join(import.meta.dir, f);
const parent = (f: string) => join(import.meta.dir, "..", f);
const markup = (html: string): string => html.replace(/<!--[^]*?-->/g, "");
const text = (html: string): string => markup(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const row = (over: Partial<McpListRow> = {}): McpListRow => ({
  serverId: "s1",
  name: "files",
  config: {},
  tools: [{ toolName: "files/read" }, { toolName: "files/write" }],
  enabled: true,
  lastStatus: "ok",
  lastError: null,
  lastCheckedAt: NOW - 60_000,
  ...over,
});
const noop = () => {};
const detailProps = (r: McpListRow, over: Record<string, unknown> = {}) => ({
  row: r, tools: [] as McpToolDetail[], testResult: null, testing: false, refreshing: false, saving: false, now: NOW,
  onTest: noop, onRefresh: noop, onToggleEnabled: noop, onEdit: noop, onRemove: noop, onSaveOptions: noop, onSaveCredentials: noop, ...over,
});

describe("Tools shell", () => {
  test("three sub-tabs, Servers first and selected; no Create tool panel", async () => {
    const html = markup(await renderComponent(parent("ToolWorkshop.svelte"), { serverUrl: "http://x" }));
    expect(html).toContain('aria-label="Tools sections"');
    const tabs = [...html.matchAll(/role="tab"[^>]*>([^<]*)/g)].map((m) => m[1]?.trim());
    expect(tabs).toEqual(["Servers", "Custom tools", "Catalog and test"]);
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>\s*Servers/);
    expect(html).not.toContain("Create tool");
  });
});

describe("ServerList", () => {
  const base = { servers: [] as McpListRow[], loading: false, selectedId: null, onSelect: noop, now: NOW };

  test("loading: a skeleton, no empty state", async () => {
    const html = markup(await renderComponent(dir("ServerList.svelte"), { ...base, loading: true }));
    expect(html).toContain('aria-label="Loading servers"');
    expect(html).not.toContain("No MCP servers yet");
  });

  test("empty: points at the one Add server action in the header, names the three ways, shows the example line, adds no button", async () => {
    const html = markup(await renderComponent(dir("ServerList.svelte"), base));
    expect(text(html)).toContain("No MCP servers yet");
    expect(text(html)).toContain("Add server above");
    expect(text(html)).toContain("mcpServers");
    expect(text(html)).toContain("npx -y @modelcontextprotocol/server-filesystem .");
    expect(html).not.toContain("<button");
  });

  test("rows: state chip, tool count, last check; disabled rows are dimmed", async () => {
    const servers = [
      row(),
      row({ serverId: "s2", name: "db", lastStatus: "error", lastError: "boom", tools: [] }),
      row({ serverId: "s3", name: "old", enabled: false }),
      row({ serverId: "s4", name: "new", lastStatus: null, lastCheckedAt: null, tools: [] }),
    ];
    const html = markup(await renderComponent(dir("ServerList.svelte"), { ...base, servers, selectedId: "s1" }));
    const t = text(html);
    expect(t).toContain("Connected");
    expect(t).toContain("2 tools · checked 1 minute ago");
    expect(t).toContain("Failed");
    expect(t).toContain("Disabled");
    expect(t).toContain("Not checked");
    expect(t).toContain("No tools yet");
    expect(html.match(/class="tsh-row[^"]*\bdim\b/g)?.length).toBe(1);
    expect(html).toMatch(/aria-current="true"/);
  });

  test("a server with a background check running reads Checking…, others keep their chip", async () => {
    const servers = [row({ lastStatus: null, lastCheckedAt: null }), row({ serverId: "s2", name: "db" })];
    const html = markup(await renderComponent(dir("ServerList.svelte"), { ...base, servers, checking: new Set(["s1"]) }));
    expect(html.match(/data-testid="server-checking"/g)?.length).toBe(1);
    expect(text(html)).toContain("Checking…");
    expect(text(html)).toContain("Connected");
    expect(text(html)).not.toContain("Not checked");
  });
});

describe("ServerDetail", () => {
  test("connected: actions, Enabled switch, tabs Tools | Options | Credentials, no failure card", async () => {
    const html = markup(await renderComponent(dir("ServerDetail.svelte"), detailProps(row())));
    const t = text(html);
    for (const w of ["Test", "Refresh tools", "Edit", "Remove", "Enabled", "Connected", "Tools", "Options", "Credentials"]) expect(t).toContain(w);
    expect(html).not.toContain("server-failed-card");
    expect(html).not.toContain("server-disabled-card");
  });

  test("failed: the scrubbed error, Retry and Edit config", async () => {
    const html = markup(await renderComponent(dir("ServerDetail.svelte"), detailProps(row({ lastStatus: "error", lastError: "spawn ENOENT" }))));
    expect(html).toContain('data-testid="server-failed-card"');
    const t = text(html);
    expect(t).toContain("spawn ENOENT");
    expect(t).toContain("Retry");
    expect(t).toContain("Edit config");
  });

  test("failed with no stored reason still says so", async () => {
    const html = markup(await renderComponent(dir("ServerDetail.svelte"), detailProps(row({ lastStatus: "error", lastError: null }))));
    expect(text(html)).toContain("The last connection attempt failed.");
  });

  test("disabled: an Enable card, the switch reads Disabled, Test and Refresh are off", async () => {
    const html = markup(await renderComponent(dir("ServerDetail.svelte"), detailProps(row({ enabled: false }))));
    expect(html).toContain('data-testid="server-disabled-card"');
    expect(text(html)).toContain("An agent never starts it");
    expect(html).not.toContain("server-failed-card");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*(<[^>]+>[^<]*)*Test/);
  });

  test("a test result shows inline: the tool count, or the scrubbed error", async () => {
    const ok = markup(await renderComponent(dir("ServerDetail.svelte"), detailProps(row(), { testResult: { ok: true, toolCount: 3, checkedAt: NOW } })));
    expect(text(ok)).toContain("Connected: 3 tools");
    const bad = markup(await renderComponent(dir("ServerDetail.svelte"), detailProps(row(), { testResult: { ok: false, error: "refused" } })));
    expect(text(bad)).toContain("Failed: refused");
    expect(bad).toMatch(/class="sd-test[^"]*\bbad\b/);
    expect(ok).not.toMatch(/class="sd-test[^"]*\bbad\b/);
  });
});

describe("ServerToolsPane", () => {
  const props = { serverName: "files", config: { readOnly: ["read"] } };

  test("loading skeleton, error, and empty", async () => {
    expect(markup(await renderComponent(dir("ServerToolsPane.svelte"), { ...props, tools: null }))).toContain("Loading tools");
    expect(text(await renderComponent(dir("ServerToolsPane.svelte"), { ...props, tools: null, error: "MCP server not found" }))).toContain("MCP server not found");
    expect(text(await renderComponent(dir("ServerToolsPane.svelte"), { ...props, tools: [] }))).toContain("No tools listed yet");
  });

  test("tools: bare names, descriptions, a Read-only chip only on covered tools, an input schema chip", async () => {
    const tools: McpToolDetail[] = [
      { toolName: "files/read", description: "Read a file", inputSchema: { properties: { path: { type: "string" } } } },
      { toolName: "files/write" },
    ];
    const html = markup(await renderComponent(dir("ServerToolsPane.svelte"), { ...props, tools }));
    expect(text(html)).toContain("Read a file");
    expect(html.match(/Read-only<\/span>/g)?.length).toBe(1);
    expect(html.match(/Input schema/g)?.length).toBe(2);
    expect(html).not.toContain("files/read");
  });
});

describe("ServerCredentialsPane: write-only", () => {
  test("a stored key shows a Set chip and a Replace field, never its value", async () => {
    const html = markup(await renderComponent(dir("ServerCredentialsPane.svelte"), {
      row: row({ config: { env: { API_TOKEN: "sk-live-12345" }, headers: { Authorization: "Bearer abc" } } }),
      saving: false,
      onSave: noop,
    }));
    expect(html).toContain("API_TOKEN");
    expect(html).toContain("Authorization");
    expect(html).toContain("Set");
    expect(html).toContain('placeholder="Replace value"');
    expect(html).not.toContain("sk-live-12345");
    expect(html).not.toContain("Bearer abc");
    expect(html).toContain('type="password"');
  });

  test("nothing stored: None set for both records, Save is disabled until a change", async () => {
    const html = markup(await renderComponent(dir("ServerCredentialsPane.svelte"), { row: row(), saving: false, onSave: noop }));
    expect(html.match(/None set\./g)?.length).toBe(2);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^]*?Save credentials/);
  });
});

describe("ServerOptionsPane", () => {
  test("starts from the saved option: all tools read-only, trust off", async () => {
    const html = markup(await renderComponent(dir("ServerOptionsPane.svelte"), { row: row({ config: { readOnly: true, trustAnnotations: true } }), saving: false, onSave: noop }));
    expect(text(html)).toContain("All tools are read-only");
    expect(text(html)).toContain("Trust the server's read-only hints");
    expect(html).toMatch(/role="switch"[^>]*aria-checked="true"/);
  });
});

describe("ServersTab", () => {
  const ctx = { base: "http://x" };

  test("loading and empty states", async () => {
    const loading = markup(await renderComponent(dir("ServersTab.svelte"), { ctx, servers: [], loading: true, onChanged: noop }));
    expect(loading).toContain("Loading servers");
    const empty = markup(await renderComponent(dir("ServersTab.svelte"), { ctx, servers: [], loading: false, onChanged: noop }));
    expect(text(empty)).toContain("No MCP servers yet");
    expect(text(empty)).toContain("Add server");
    expect(empty.match(/cx-btn-primary/g)?.length).toBe(1);
  });

  test("with servers and none picked: the first one is shown, never a Pick a server prompt", async () => {
    const html = markup(await renderComponent(dir("ServersTab.svelte"), { ctx, servers: [row(), row({ serverId: "s2", name: "db" })], loading: false, onChanged: noop }));
    expect(text(html)).not.toContain("Pick a server");
    expect(html).toContain('data-testid="server-detail"');
    expect(html).toContain('aria-label="Server files"');
    expect(html).toMatch(/aria-current="true"/);
  });

  test("the list header holds the search, the one primary action, the count and Recheck all", async () => {
    const html = markup(await renderComponent(dir("ServersTab.svelte"), { ctx, servers: [row(), row({ serverId: "s2", name: "db" })], loading: false, onChanged: noop }));
    const bar = html.slice(html.indexOf("tsh-bar"), html.indexOf("tsh-rows"));
    expect(bar).toContain('id="sl-search"');
    expect(text(bar)).toContain("Add server");
    expect(text(bar)).toContain("2 servers");
    expect(text(bar)).toContain("Recheck all");
    expect(html.match(/cx-btn-primary/g)?.length).toBe(1);
  });

  test("a disabled-only list shows its first server without checking anything", async () => {
    const html = markup(await renderComponent(dir("ServersTab.svelte"), { ctx, servers: [row({ enabled: false })], loading: false, onChanged: noop }));
    expect(html).toContain('data-testid="server-disabled-card"');
    expect(html).not.toContain('data-testid="server-checking"');
  });
});

describe("CustomToolEditor", () => {
  test("create: empty fields and an empty preview", async () => {
    const html = markup(await renderComponent(dir("CustomToolEditor.svelte"), { tool: null, saving: false, onSave: noop, onCancel: noop }));
    expect(html).toContain("New custom tool");
    expect(text(html)).toContain("Add tool");
    expect(html).toContain("No parameters.");
    expect(html).toMatch(/data-testid="custom-tool-preview"[^>]*>\[\]</);
  });

  test("edit: the saved name, description and parameter rows with the JSON preview", async () => {
    const tool = {
      id: "lab:t1", kind: "custom" as const, name: "my-tool", displayName: "my-tool", description: "Does it", executable: true,
      parameters: [{ name: "query", type: "string", required: true, description: "Search" }],
      metrics: { callCount: 0, successRatePct: null, avgDurationMs: null, lastUsedAt: null },
    };
    const html = markup(await renderComponent(dir("CustomToolEditor.svelte"), { tool, saving: false, onSave: noop, onCancel: noop }));
    expect(html).toContain('value="my-tool"');
    expect(html).toContain('value="Does it"');
    expect(html).toContain('value="query"');
    expect(text(html)).toContain("Save changes");
    expect(html).toContain('"name": "query"');
  });
});

describe("Catalog and Custom tabs", () => {
  const ctx = { base: "http://x" };
  const entry = (over: Record<string, unknown>) => ({
    id: "mcp:s1:x", kind: "mcp", name: "files/read", displayName: "files/read", description: "Read", parameters: [], executable: true,
    metrics: { callCount: 0, successRatePct: null, avgDurationMs: null, lastUsedAt: null }, ...over,
  });

  test("a disabled server's tool shows a Disabled badge in the catalog", async () => {
    const html = markup(await renderComponent(dir("CatalogTab.svelte"), { ctx, catalog: [entry({ disabled: true })], loading: false, onChanged: noop }));
    expect(text(html)).toContain("Disabled");
  });

  test("custom tab: empty and loading", async () => {
    const empty = markup(await renderComponent(dir("CustomToolsTab.svelte"), { ctx, catalog: [entry({})], loading: false, onChanged: noop }));
    expect(text(empty)).toContain("No custom tools yet");
    expect(text(empty)).toContain("New tool");
    expect(markup(await renderComponent(dir("CustomToolsTab.svelte"), { ctx, catalog: [], loading: true, onChanged: noop }))).toContain("Loading tools");
  });

  test("custom tab lists only Lab tools, dimming a disabled one", async () => {
    const catalog = [entry({}), entry({ id: "lab:t1", kind: "custom", name: "mine", displayName: "mine", disabled: true })];
    const html = markup(await renderComponent(dir("CustomToolsTab.svelte"), { ctx, catalog, loading: false, onChanged: noop }));
    expect(text(html)).toContain("mine");
    expect(text(html)).not.toContain("files/read");
    expect(html).toMatch(/class="tsh-row[^"]*\bdim\b/);
  });

  test("custom tab: the sub-tab count and the list read the same filter (an MCP entry is never counted)", async () => {
    const catalog = [entry({}), entry({ id: "lab:t1", kind: "custom", name: "mine", displayName: "mine" })];
    const html = markup(await renderComponent(dir("CustomToolsTab.svelte"), { ctx, catalog, loading: false, onChanged: noop }));
    expect(text(html)).toContain("1 custom tool");
    expect(html.match(/class="tsh-row[ "]/g)?.length).toBe(1);
    const none = markup(await renderComponent(dir("CustomToolsTab.svelte"), { ctx, catalog: [entry({})], loading: false, onChanged: noop }));
    expect(text(none)).toContain("0 custom tools");
  });

  test("custom tab shows its first tool, and the header holds search and New tool", async () => {
    const catalog = [entry({ id: "lab:t1", kind: "custom", name: "mine", displayName: "mine" })];
    const html = markup(await renderComponent(dir("CustomToolsTab.svelte"), { ctx, catalog, loading: false, onChanged: noop }));
    const bar = html.slice(html.indexOf("tsh-bar"), html.indexOf("tsh-rows"));
    expect(bar).toContain('id="ct-search"');
    expect(text(bar)).toContain("New tool");
    expect(text(html)).not.toContain("Pick a custom tool");
    expect(html).toMatch(/aria-current="true"/);
  });

  test("catalog tab: search and count in the same header, the first tool shown", async () => {
    const catalog = [entry({}), entry({ id: "mcp:s1:y", name: "files/write", displayName: "files/write" })];
    const html = markup(await renderComponent(dir("CatalogTab.svelte"), { ctx, catalog, loading: false, onChanged: noop }));
    const bar = html.slice(html.indexOf("tsh-bar"), html.indexOf("tsh-rows"));
    expect(bar).toContain('id="tw-tool-search"');
    expect(text(bar)).toContain("2 tools");
    expect(text(html)).not.toContain("Pick a tool");
    expect(html.match(/class="tsh-row[ "]/g)?.length).toBe(2);
  });
});

describe("Lab > Tools polish pins", () => {
  const source = (rel: string) => readFileSync(join(import.meta.dir, rel), "utf8");

  test("the tab row clips its vertical axis (overflow-x alone made a stray 1px scrollbar) and hides its own scrollbar", () => {
    const css = source("../kit/Tabs.svelte");
    expect(css).toMatch(/\.cx-tabs \{[^}]*overflow-x: auto;[^}]*overflow-y: hidden/);
  });

  test("the tab count is set in the UI face at 12px or more, so a zero cannot read as an 8", () => {
    const css = source("../kit/Tabs.svelte");
    expect(css).toMatch(/\.cx-tab-n \{[^}]*font-family: var\(--cortex-font-ui\)[^}]*font-size: var\(--cortex-t-xs\)/);
  });

  test("the server tools filter keeps its own width so the search cannot collapse to an empty square", () => {
    const css = source("ServerToolsPane.svelte");
    expect(css).toMatch(/\.tp-bar :global\(\.tp-filter\) \{ flex: 0 0 168px/);
    expect(css).toContain("min-width: 120px");
  });

  test("the stacked narrow layout sizes to its content so the list cannot collapse under the detail pane", () => {
    const css = source("ToolsShell.svelte");
    const narrow = css.slice(css.indexOf("@media (max-width: 1000px)"));
    expect(narrow).toMatch(/\.tsh \{[^}]*flex: none;[^}]*grid-auto-rows: auto/);
    expect(narrow).toMatch(/\.tsh-left, \.tsh-right \{ min-height: auto; \}/);
  });

  test("all three tabs sit in the one shell and use its row card", () => {
    for (const f of ["ServersTab", "CustomToolsTab", "CatalogTab"]) expect(source(`${f}.svelte`)).toContain("<ToolsShell");
    for (const f of ["ServerList", "ToolCatalogList", "CustomToolsTab"]) expect(source(`${f}.svelte`)).toContain('class="tsh-row"');
  });
});
