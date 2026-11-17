/** Server-render pins: a switched-off MCP server is never offered in the Tools section, but a config that still lists it says so. */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { renderComponent } from "../../kit/test-render.js";
import { defaultConfig } from "$lib/types/agent-config.js";

const file = join(import.meta.dir, "ToolsSection.svelte");
const markup = (html: string): string => html.replace(/<!--[^]*?-->/g, "");
const text = (html: string): string => markup(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const on = { serverId: "a", name: "files", enabled: true, tools: [{ toolName: "files/read" }] };
const off = { serverId: "b", name: "legacy", enabled: false, tools: [{ toolName: "legacy/write" }] };
const props = (config: ReturnType<typeof defaultConfig>) => ({
  config, open: true, onToggle: () => {}, tools: [], shellPresets: {}, mcpCatalog: [on, off], loadMcpCatalog: () => {},
});

describe("ToolsSection and switched-off MCP servers", () => {
  test("the attach list offers enabled servers only", async () => {
    const html = markup(await renderComponent(file, props(defaultConfig())));
    expect(html).toContain('data-server="a"');
    expect(html).not.toContain('data-server="b"');
    expect(text(html)).not.toContain("legacy/write");
    expect(html).not.toContain('data-testid="mcp-disabled-note"');
  });

  test("a config that still lists a switched-off server shows a quiet note with Enable, and its selected tool is listed to remove", async () => {
    const config = { ...defaultConfig(), mcpServerIds: ["b"], tools: ["legacy/write"] };
    const html = markup(await renderComponent(file, props(config)));
    expect(html).toContain('data-testid="mcp-disabled-note"');
    expect(text(html)).toContain("Uses a disabled server (skipped): legacy");
    expect(text(html)).toContain("Enable legacy");
    expect(html).not.toContain('data-server="b"');
    expect(html).toContain("Selected tools not in the lists");
  });
});
