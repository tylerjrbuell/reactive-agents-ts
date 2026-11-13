import { describe, expect, test } from "bun:test";
import { addMcpServer, parseMcpQuickAdd, quickAddMcpToChat, type McpChatDeps } from "./mcp-quick-add.js";

describe("parseMcpQuickAdd", () => {
  test("a URL becomes an endpoint named after its host", () => {
    expect(parseMcpQuickAdd("https://mcp.context7.com/mcp")).toEqual({ ok: true, body: { name: "context7", endpoint: "https://mcp.context7.com/mcp" } });
  });

  test("a word before a URL is the name", () => {
    expect(parseMcpQuickAdd("docs https://example.dev/sse")).toEqual({ ok: true, body: { name: "docs", endpoint: "https://example.dev/sse" } });
  });

  test("ws URLs pick the websocket transport", () => {
    expect(parseMcpQuickAdd("ws://localhost:9000/x")).toEqual({ ok: true, body: { name: "localhost", endpoint: "ws://localhost:9000/x", transport: "websocket" } });
  });

  test("a command line splits into command and args, named after the package it launches", () => {
    expect(parseMcpQuickAdd("npx -y @modelcontextprotocol/server-filesystem /tmp")).toEqual({
      ok: true,
      body: { name: "filesystem", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] },
    });
  });

  test("a versioned package and quoted args are handled", () => {
    expect(parseMcpQuickAdd('npx -y mcp-fetch@1.2.3 --root "/my dir"')).toEqual({
      ok: true,
      body: { name: "mcp-fetch", command: "npx", args: ["-y", "mcp-fetch@1.2.3", "--root", "/my dir"] },
    });
  });

  test("a bare command stays a command, a named command is not mistaken for a name", () => {
    expect(parseMcpQuickAdd("my-server")).toEqual({ ok: true, body: { name: "my-server", command: "my-server" } });
    expect(parseMcpQuickAdd("uvx mcp-server-git")).toEqual({ ok: true, body: { name: "git", command: "uvx", args: ["mcp-server-git"] } });
  });

  test("empty input and a URL with extra words are refused with a reason", () => {
    expect(parseMcpQuickAdd("   ").ok).toBe(false);
    const extra = parseMcpQuickAdd("https://a.dev/mcp --header x");
    expect(extra.ok).toBe(false);
  });
});

describe("addMcpServer", () => {
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

  test("saves, then reads the discovered tool names", async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method} ${String(url).replace(/^https?:\/\/[^/]+/, "")}`);
      return String(url).endsWith("refresh-tools") ? reply(200, { ok: true, tools: [{ toolName: "docs/search" }] }) : reply(200, { serverId: "s1", name: "docs" });
    }) as typeof fetch;
    const out = await addMcpServer({ name: "docs", endpoint: "https://a.dev/mcp" }, fetchFn);
    expect(out).toEqual({ serverId: "s1", name: "docs", tools: ["docs/search"] });
    expect(calls).toEqual(["POST /api/mcp-servers", "POST /api/mcp-servers/s1/refresh-tools"]);
  });

  test("a failed discovery keeps the saved server and says why", async () => {
    const fetchFn = (async (url: string | URL | Request) =>
      String(url).endsWith("refresh-tools") ? reply(502, { error: "connect refused" }) : reply(200, { serverId: "s2", name: "x" })) as typeof fetch;
    expect(await addMcpServer({ name: "x", command: "nope" }, fetchFn)).toEqual({ serverId: "s2", name: "x", tools: [], discoveryError: "connect refused" });
  });

  test("a rejected save throws the server's message", async () => {
    const fetchFn: typeof fetch = Object.assign(async () => reply(400, { error: "Invalid MCP server config" }), { preconnect: () => {} });
    await expect(addMcpServer({ name: "x", command: "c" }, fetchFn)).rejects.toThrow("Invalid MCP server config");
  });
});

describe("quickAddMcpToChat", () => {
  const harness = (added: Awaited<ReturnType<typeof addMcpServer>> | Error, cfg: Record<string, unknown> = { tools: ["web-search"] }) => {
    const log: string[] = [];
    const deps: McpChatDeps = {
      cfg: () => cfg,
      patch: async (what, patch) => void log.push(`patch:${what}:${JSON.stringify(patch)}`),
      reloadCatalog: async () => void log.push("reload"),
      notify: (kind, title) => void log.push(`${kind}:${title}`),
      add: async () => {
        if (added instanceof Error) throw added;
        return added;
      },
    };
    return { log, deps };
  };

  test("saves, reloads the catalog, then turns the server on (its tools need no allowlisting)", async () => {
    const { log, deps } = harness({ serverId: "s1", name: "docs", tools: ["docs/search", "docs/read"] });
    await quickAddMcpToChat("https://a.dev/mcp", deps);
    expect(log).toEqual([
      "reload",
      `patch:docs on (2 tools):${JSON.stringify({ tools: ["web-search"], mcpServerIds: ["s1"], enableTools: true })}`,
    ]);
  });

  test("a server whose tools could not be listed stays saved but is not turned on", async () => {
    const { log, deps } = harness({ serverId: "s1", name: "docs", tools: [], discoveryError: "refused" });
    await quickAddMcpToChat("https://a.dev/mcp", deps);
    expect(log).toEqual(["reload", "warning:docs saved, but its tools could not be listed"]);
  });

  test("a line that is not a server, and a failed save, are reported without touching the config", async () => {
    const bad = harness({ serverId: "x", name: "x", tools: [] });
    await quickAddMcpToChat("", bad.deps);
    expect(bad.log).toEqual(["error:Cannot add this server"]);
    const down = harness(new Error("db locked"));
    await quickAddMcpToChat("npx -y pkg", down.deps);
    expect(down.log).toEqual(["error:Could not add the server"]);
  });
});
