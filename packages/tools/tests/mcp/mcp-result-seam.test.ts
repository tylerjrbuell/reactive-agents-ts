// Seam pin: MCP call results -> typed tool content (Plan 9 Phase 4 stage E).
// Zero-token. Unit pins on mapMcpToolResult / toolContent, plus one wire pin
// through makeMCPClient.callTool against a local streamable-http mock.
import { Effect } from "effect";
import { describe, it, expect, afterEach } from "bun:test";
import { contentText } from "@reactive-agents/core";

import { makeMCPClient } from "../../src/mcp/mcp-client.js";
import { mapMcpToolResult } from "../../src/mcp/mcp-result.js";
import { toolContent, isToolContent, toolContentText } from "../../src/tool-content.js";

const PNG = "iVBORw0KGgo=";
const WAV = "UklGRg==";

const mixedContent = [
  { type: "text", text: "Rendered chart" },
  { type: "image", data: PNG, mimeType: "image/png" },
  { type: "audio", data: WAV, mimeType: "audio/wav" },
  { type: "resource", resource: { uri: "file:///tmp/report.csv", mimeType: "text/csv", text: "a,b" } },
  { type: "resource_link", uri: "https://example.com/doc.pdf", name: "doc.pdf", mimeType: "application/pdf" },
];

const expectedParts = [
  { type: "text", text: "Rendered chart" },
  { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } },
  { type: "audio", source: { type: "base64", media_type: "audio/wav", data: WAV } },
  { type: "file", ref: { uri: "file:///tmp/report.csv", media_type: "text/csv" } },
  { type: "file", ref: { uri: "https://example.com/doc.pdf", media_type: "application/pdf", name: "doc.pdf" } },
];

describe("mapMcpToolResult", () => {
  it("maps text + image + audio + resource items to typed parts in order", () => {
    const mapped = mapMcpToolResult({ content: mixedContent });
    expect(mapped.kind).toBe("value");
    if (mapped.kind !== "value") return;
    expect(isToolContent(mapped.value)).toBe(true);
    if (!isToolContent(mapped.value)) return;
    expect(mapped.value.parts).toEqual(expectedParts);
  });

  it("text-only results keep the exact legacy string (newline-joined)", () => {
    const mapped = mapMcpToolResult({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] });
    expect(mapped).toEqual({ kind: "value", value: "a\nb" });
  });

  it("mixed results keep the text-only newline join between adjacent text items", () => {
    const mapped = mapMcpToolResult({
      content: [
        { type: "text", text: "a" },
        { type: "text", text: "b" },
        { type: "image", data: PNG, mimeType: "image/png" },
      ],
    });
    expect(mapped.kind === "value" && isToolContent(mapped.value)).toBe(true);
    if (mapped.kind !== "value" || !isToolContent(mapped.value)) return;
    expect(mapped.value.parts).toEqual([
      { type: "text", text: "a\nb" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } },
    ]);
    // The kernel act seam reads text with core contentText ("" join).
    expect(contentText(mapped.value.parts)).toBe("a\nb");
    expect(toolContentText(mapped.value)).toBe("a\nb\n[image: image/png]");
  });

  it("results without a content array pass through unchanged", () => {
    const raw = { structuredContent: { x: 1 } };
    expect(mapMcpToolResult(raw)).toEqual({ kind: "value", value: raw });
  });

  it("content with no mappable items returns the raw result, as before", () => {
    const raw = { content: [{ type: "mystery" }] };
    const mapped = mapMcpToolResult(raw);
    expect(mapped.kind === "value" && mapped.value).toBe(raw);
  });

  it("isError keeps the text-only error message", () => {
    const mapped = mapMcpToolResult({
      isError: true,
      content: [{ type: "text", text: "boom" }, { type: "image", data: PNG, mimeType: "image/png" }],
    });
    expect(mapped).toEqual({ kind: "error", text: "boom" });
  });
});

describe("toolContent", () => {
  it("unbranded values are not tool content", () => {
    expect(isToolContent("text")).toBe(false);
    expect(isToolContent({ parts: [] })).toBe(false);
    expect(isToolContent({ _tag: "ToolContent", parts: [{ type: "bogus" }] })).toBe(false);
  });

  it("JSON.stringify yields the text view, never media bytes", () => {
    const value = toolContent(expectedParts as Parameters<typeof toolContent>[0]);
    const json = JSON.stringify(value);
    expect(json).not.toContain(PNG);
    expect(json).not.toContain(WAV);
    expect(JSON.parse(json)).toBe(toolContentText(value));
    expect(toolContentText(value)).toContain("Rendered chart");
    expect(toolContentText(value)).toContain("[image: image/png]");
  });
});

// ── wire pin: the shell routes callTool through the mapper ──

const serveToolResult = (content: unknown[]) =>
  Bun.serve({
    port: 0,
    idleTimeout: 10,
    fetch(req) {
      if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
      return req.json().then((body: { method: string; id: number }) => {
        if (body.method === "initialize") {
          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: { name: "parts-server", version: "1.0.0" },
            },
          });
        }
        if (body.method === "tools/list") {
          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            result: { tools: [{ name: "render", description: "Render", inputSchema: { type: "object" } }] },
          });
        }
        if (body.method === "tools/call") {
          return Response.json({ jsonrpc: "2.0", id: body.id, result: { content } });
        }
        return new Response(null, { status: 202 });
      });
    },
  });

describe("makeMCPClient.callTool (seam wiring)", () => {
  let server: ReturnType<typeof serveToolResult> | undefined;
  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  const call = (content: unknown[]) => {
    server = serveToolResult(content);
    const endpoint = `http://localhost:${server.port}/mcp`;
    return Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* makeMCPClient;
        yield* client.connect({ name: "parts", transport: "streamable-http", endpoint });
        const result = yield* client.callTool("parts", "render", {});
        yield* client.disconnect("parts");
        return result;
      }),
    );
  };

  it("carries image and resource items as typed parts", async () => {
    const result = await call(mixedContent);
    expect(isToolContent(result)).toBe(true);
    if (!isToolContent(result)) return;
    expect(result.parts).toEqual(expectedParts);
  });

  it("text-only results are unchanged", async () => {
    const result = await call([{ type: "text", text: "hello" }, { type: "text", text: "world" }]);
    expect(result).toBe("hello\nworld");
  });
});
