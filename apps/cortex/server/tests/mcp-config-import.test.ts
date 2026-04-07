import { describe, it, expect } from "bun:test";
import { inferHttpMcpTransport, parseConfigBody } from "../services/mcp-config-import.js";

describe("inferHttpMcpTransport", () => {
  it("uses streamable-http for Context7-style /mcp URLs", () => {
    expect(inferHttpMcpTransport("http://localhost:8080/mcp")).toBe("streamable-http");
    expect(inferHttpMcpTransport("http://127.0.0.1:8080/mcp/")).toBe("streamable-http");
    expect(inferHttpMcpTransport("http://host:9/api/v1/mcp")).toBe("streamable-http");
  });

  it("uses sse for legacy paths like /sse", () => {
    expect(inferHttpMcpTransport("http://localhost:8080/sse")).toBe("sse");
    expect(inferHttpMcpTransport("http://localhost:3000/events")).toBe("sse");
  });
});

describe("parseConfigBody URL inference", () => {
  it("infers streamable-http from url field for /mcp", () => {
    const cfg = parseConfigBody({
      name: "ctx",
      url: "http://localhost:8080/mcp",
    });
    expect(cfg).not.toBeNull();
    expect(cfg!.transport).toBe("streamable-http");
    expect(cfg!.endpoint).toBe("http://localhost:8080/mcp");
  });
});
