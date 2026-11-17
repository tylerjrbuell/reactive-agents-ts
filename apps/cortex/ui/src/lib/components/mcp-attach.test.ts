/** Server-render pins for the shared attach list (Builder + chat Tools section) and its effects strip. */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { renderComponent } from "./kit/test-render.js";

const file = join(import.meta.dir, "McpServerAttach.svelte");
const markup = (html: string): string => html.replace(/<!--[^]*?-->/g, "");
const text = (html: string): string => markup(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const cfg = (over: Record<string, unknown> = {}) => ({ tools: [] as string[], mcpServerIds: [] as string[], terminalTools: false, ...over });
const srv = (over: Record<string, unknown> = {}) => ({
  serverId: "s1", name: "files", tools: [{ toolName: "files/read", description: "Read" }, { toolName: "files/write" }], config: { readOnly: ["read"] }, ...over,
});

describe("McpServerAttach", () => {
  test("empty: points at Lab > Tools > Servers", async () => {
    const html = markup(await renderComponent(file, { config: cfg(), servers: [], onRefresh: () => {} }));
    expect(text(html)).toContain("No MCP servers saved. Add one in Lab > Tools > Servers.");
  });

  test("attached with no tool named: every tool available, chips pressed", async () => {
    const html = markup(await renderComponent(file, { config: cfg({ mcpServerIds: ["s1"] }), servers: [srv()], onRefresh: () => {} }));
    expect(text(html)).toContain("2/2 available");
    expect(text(html)).toContain("Every tool is available");
    expect(html.match(/class="mcpa-chip[^"]*"[^>]*aria-pressed="true"/g)?.length).toBe(2);
  });

  test("a subset: only the named tool is pressed", async () => {
    const html = markup(await renderComponent(file, { config: cfg({ mcpServerIds: ["s1"], tools: ["files/read"] }), servers: [srv()], onRefresh: () => {} }));
    expect(text(html)).toContain("1/2 available");
    expect(html.match(/class="mcpa-chip[^"]*"[^>]*aria-pressed="true"[^>]*>read</g)?.length).toBe(1);
    expect(html.match(/class="mcpa-chip[^"]*"[^>]*aria-pressed="false"[^>]*>write</g)?.length).toBe(1);
  });

  test("a disabled server is dimmed, labelled and cannot be attached", async () => {
    const html = markup(await renderComponent(file, { config: cfg(), servers: [srv({ enabled: false })], onRefresh: () => {} }));
    expect(html).toMatch(/class="mcpa-card[^"]*\bdim\b/);
    expect(text(html)).toContain("Disabled");
    expect(html).toMatch(/class="mcpa-name[^"]*"[^>]*disabled/);
  });

  test("the effects strip lists read-only tools, approvals and shell; the link opens Lab", async () => {
    const html = markup(await renderComponent(file, { config: cfg({ mcpServerIds: ["s1"], terminalTools: true }), servers: [srv()], onRefresh: () => {} }));
    expect(html).toContain('data-testid="mcp-effects"');
    expect(text(html)).toContain("1 read-only MCP tool");
    expect(text(html)).toContain("Shell on this machine");
    expect(html).toContain('href="/lab#tools"');
  });
});
