/**
 * Server-render pins for MCP OAuth sign-in in Lab > Tools > Servers: the detail pane's sign-in
 * block per state, Sign in on an auth-refused failure, and the "Signed in with rax" list.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { renderComponent } from "../kit/test-render.js";
import type { McpListRow, McpToolDetail } from "$lib/tool-workshop.js";
import type { McpServerAuth } from "$lib/mcp-oauth-view.js";

const NOW = 2_000_000_000;
const dir = (f: string) => join(import.meta.dir, f);
const text = (html: string): string => html.replace(/<!--[^]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const noop = () => {};
const row = (over: Partial<McpListRow> = {}): McpListRow => ({
  serverId: "s1", name: "docs", config: { transport: "streamable-http", endpoint: "https://m.example/mcp" }, tools: [], enabled: true, lastStatus: null, lastError: null, lastCheckedAt: null, ...over,
});
const auth = (over: Partial<McpServerAuth> = {}): McpServerAuth => ({ state: "absent", scopes: [], hasRefreshToken: false, authRequired: false, ...over });
const detail = (r: McpListRow, over: Record<string, unknown>) =>
  renderComponent(dir("ServerDetail.svelte"), {
    row: r, tools: [] as McpToolDetail[], testResult: null, testing: false, refreshing: false, saving: false, now: NOW,
    onTest: noop, onRefresh: noop, onToggleEnabled: noop, onEdit: noop, onRemove: noop, onSaveOptions: noop, onSaveCredentials: noop, ...over,
  });

describe("ServerDetail sign-in", () => {
  test("no auth state (stdio, machine grant): no sign-in block", async () => {
    expect(await detail(row(), {})).not.toContain('data-testid="server-sign-in"');
  });

  test("signed in: chip and Sign out, no Sign in", async () => {
    const t = text(await detail(row({ lastStatus: "ok" }), { auth: auth({ state: "signed-in" }) }));
    expect(t).toContain("Signed in");
    expect(t).toContain("Sign out");
    expect(t).not.toMatch(/Sign in(?! again)\b(?!\w)/);
  });

  test("pending: the authorization link stays visible with Cancel", async () => {
    const html = await detail(row(), { auth: auth({ signIn: { phase: "pending", authorizationUrl: "http://127.0.0.1:9/authorize?state=abc", startedAt: NOW } }) });
    expect(html).toContain('href="http://127.0.0.1:9/authorize?state=abc"');
    expect(text(html)).toContain("Open the sign-in page");
    expect(text(html)).toContain("Cancel");
  });

  test("a failure the server refused for lack of a login offers Sign in instead of the raw error", async () => {
    const t = text(await detail(row({ lastStatus: "error", lastError: "Sign-in required (HTTP 401): Streamable HTTP error: Error POSTing to endpoint:" }), { auth: auth({ authRequired: true }) }));
    expect(t).toContain("Sign-in required");
    expect(t).toContain("asks you to sign in");
    expect(t).not.toContain("Error POSTing");
  });
});

describe("ServerList: Signed in with rax", () => {
  const base = { loading: false, selectedId: null, onSelect: noop, now: NOW };
  const login = { resourceKey: "k", url: "https://mcp.example.com/mcp", name: "notion", transport: "streamable-http" as const, status: "signed-in" as const, scopes: [], hasRefreshToken: true };

  test("an unused login shows with Add, even with no servers saved", async () => {
    const t = text(await renderComponent(dir("ServerList.svelte"), { ...base, servers: [], logins: [login] }));
    expect(t).toContain("Signed in with rax");
    expect(t).toContain("notion");
    expect(t).toContain("https://mcp.example.com/mcp");
    expect(t).toContain("Add");
  });

  test("no unused logins: no section; a server row shows its sign-in state", async () => {
    const html = await renderComponent(dir("ServerList.svelte"), { ...base, servers: [row()], auth: { s1: auth({ state: "signed-in" }) } });
    expect(html).not.toContain('data-testid="rax-logins"');
    expect(text(html)).toContain("Signed in");
  });
});
