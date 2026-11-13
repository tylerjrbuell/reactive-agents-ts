// Run: bun test packages/runtime/tests/seam-mcp-allowlist.test.ts --timeout 15000
// Seam pin: tools of an attached MCP server stay visible under `allowedTools`.
import { describe, it, expect } from "bun:test";
import type { ToolDefinition } from "@reactive-agents/tools";
import { withAttachedMcpTools } from "../src/engine/phases/agent-loop/setup/mcp-allowlist.js";

const def = (name: string, source: ToolDefinition["source"]): ToolDefinition =>
  ({ name, source }) as ToolDefinition;

// Umami case: 23-ish tools on one attached server, plus built-ins.
const defs: ToolDefinition[] = [
  def("web-search", "builtin"),
  def("file-read", "builtin"),
  def("umami/get-stats", "mcp"),
  def("umami/get-pageviews", "mcp"),
  def("umami/delete-website", "mcp"),
  def("other/ping", "mcp"),
];

describe("withAttachedMcpTools", () => {
  it("no allowlist -> unrestricted, unchanged", () => {
    expect(withAttachedMcpTools([], defs, undefined)).toEqual([]);
  });

  it("allowlist of non-MCP tools still exposes every attached MCP tool", () => {
    const out = withAttachedMcpTools(["web-search"], defs, undefined);
    expect(out).toEqual([
      "web-search",
      "umami/get-stats",
      "umami/get-pageviews",
      "umami/delete-website",
      "other/ping",
    ]);
    expect(out).not.toContain("file-read");
  });

  it("forbidden tool stays hidden", () => {
    const out = withAttachedMcpTools(["web-search"], defs, ["umami/delete-website"]);
    expect(out).not.toContain("umami/delete-website");
    expect(out).toContain("umami/get-stats");
  });

  it("explicit entry for a server's tool makes the list authoritative for that server", () => {
    const out = withAttachedMcpTools(["umami/get-stats"], defs, undefined);
    expect(out).toContain("umami/get-stats");
    expect(out).not.toContain("umami/get-pageviews");
    expect(out).toContain("other/ping");
  });
});
