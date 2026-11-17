import { afterEach, describe, expect, test } from "bun:test";
import { loadQuickbarCatalog } from "./chat-quickbar-data.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const servers = [
  { serverId: "a", name: "on", enabled: true, tools: [{ toolName: "on/read" }] },
  { serverId: "b", name: "off", enabled: false, tools: [{ toolName: "off/write" }] },
  { serverId: "c", name: "old-build", tools: [{ toolName: "old-build/x" }] },
];

function stubFetch() {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const body = url.includes("/api/capabilities") ? { strategies: [] } : url.endsWith("/api/mcp-servers") ? servers : url.endsWith("/api/tools/catalog") ? [{ kind: "built-in", name: "file-read" }, { kind: "built-in", name: "off-tool", disabled: true }] : [];
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

describe("loadQuickbarCatalog", () => {
  test("mcpServers holds enabled servers only (the quick bar, /mcp menu, plan dropdown and discovery read it); disabled ones are kept apart", async () => {
    stubFetch();
    const c = await loadQuickbarCatalog();
    expect(c.mcpServers.map((s) => s.name)).toEqual(["on", "old-build"]);
    expect(c.disabledMcpServers).toEqual([{ serverId: "b", name: "off", tools: ["off/write"] }]);
    expect(c.builtinTools.map((t) => t.name)).toEqual(["file-read"]);
  });
});
