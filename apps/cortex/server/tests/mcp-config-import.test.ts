import { describe, it, expect } from "bun:test";
import {
  inferHttpMcpTransport,
  normalizeMcpHttpTransport,
  parseConfigBody,
  expandMcpConfigsFromJson,
} from "../services/mcp-config-import.js";

describe("inferHttpMcpTransport", () => {
  it("uses streamable-http for /mcp URLs", () => {
    expect(inferHttpMcpTransport("http://localhost:8080/mcp")).toBe("streamable-http");
    expect(inferHttpMcpTransport("http://127.0.0.1:8080/mcp/")).toBe("streamable-http");
    expect(inferHttpMcpTransport("http://host:9/api/v1/mcp")).toBe("streamable-http");
  });

  it("uses sse for legacy paths", () => {
    expect(inferHttpMcpTransport("http://localhost:8080/sse")).toBe("sse");
    expect(inferHttpMcpTransport("http://localhost:3000/events")).toBe("sse");
  });
});

describe("normalizeMcpHttpTransport", () => {
  it("upgrades sse to streamable-http for /mcp endpoints", () => {
    const out = normalizeMcpHttpTransport({
      name: "ctx",
      transport: "sse",
      endpoint: "http://localhost:8080/mcp",
    });
    expect(out.transport).toBe("streamable-http");
  });

  it("returns the same object for legacy /sse", () => {
    const cfg = {
      name: "legacy",
      transport: "sse" as const,
      endpoint: "http://localhost:8080/sse",
    };
    expect(normalizeMcpHttpTransport(cfg)).toBe(cfg);
  });

  it("does not modify stdio configs", () => {
    const cfg = { name: "docker", transport: "stdio" as const, command: "docker" };
    expect(normalizeMcpHttpTransport(cfg)).toBe(cfg);
  });
});

describe("parseConfigBody — HTTP transport inference", () => {
  it("infers streamable-http from url field for /mcp", () => {
    const cfg = parseConfigBody({ name: "ctx", url: "http://localhost:8080/mcp" });
    expect(cfg).not.toBeNull();
    expect(cfg!.transport).toBe("streamable-http");
    expect(cfg!.endpoint).toBe("http://localhost:8080/mcp");
  });

  it("coerces mistaken sse to streamable-http when endpoint is /mcp", () => {
    const cfg = parseConfigBody({ name: "context7", transport: "sse", url: "http://127.0.0.1:8080/mcp" });
    expect(cfg).not.toBeNull();
    expect(cfg!.transport).toBe("streamable-http");
  });

  it("infers sse for /sse endpoint", () => {
    const cfg = parseConfigBody({ name: "legacy", endpoint: "http://localhost:3000/sse" });
    expect(cfg).not.toBeNull();
    expect(cfg!.transport).toBe("sse");
  });
});

describe("parseConfigBody — stdio transport inference", () => {
  it("infers stdio from command field", () => {
    const cfg = parseConfigBody({ name: "ctx7", command: "docker", args: ["run", "-i", "--rm", "mcp/context7"] });
    expect(cfg).not.toBeNull();
    expect(cfg!.transport).toBe("stdio");
    expect(cfg!.command).toBe("docker");
    expect(cfg!.args).toEqual(["run", "-i", "--rm", "mcp/context7"]);
  });

  it("preserves explicit stdio transport", () => {
    const cfg = parseConfigBody({ name: "node-mcp", transport: "stdio", command: "npx", args: ["-y", "my-mcp"] });
    expect(cfg).not.toBeNull();
    expect(cfg!.transport).toBe("stdio");
    expect(cfg!.command).toBe("npx");
  });

  it("preserves env and cwd for stdio servers", () => {
    const cfg = parseConfigBody({
      name: "env-test",
      command: "bun",
      args: ["run", "server.ts"],
      cwd: "/app",
      env: { API_KEY: "secret" },
    });
    expect(cfg).not.toBeNull();
    expect(cfg!.cwd).toBe("/app");
    expect(cfg!.env).toEqual({ API_KEY: "secret" });
  });

  it("returns null when name is missing", () => {
    expect(parseConfigBody({ command: "docker", args: ["run", "mcp/context7"] })).toBeNull();
  });

  it("returns null when neither command nor endpoint provided", () => {
    expect(parseConfigBody({ name: "empty" })).toBeNull();
  });
});

describe("expandMcpConfigsFromJson", () => {
  it("expands a single config object", () => {
    const result = expandMcpConfigsFromJson({
      name: "ctx",
      command: "docker",
      args: ["run", "-i", "--rm", "mcp/context7"],
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("ctx");
    expect(result[0].transport).toBe("stdio");
  });

  it("expands an array of configs", () => {
    const result = expandMcpConfigsFromJson([
      { name: "a", command: "npx", args: ["-y", "mcp-server-a"] },
      { name: "b", endpoint: "http://localhost:8080/mcp" },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].transport).toBe("stdio");
    expect(result[1].transport).toBe("streamable-http");
  });

  it("expands Cursor-style mcpServers shape", () => {
    const result = expandMcpConfigsFromJson({
      mcpServers: {
        "context7": { command: "docker", args: ["run", "-i", "--rm", "mcp/context7"] },
        "remote-mcp": { endpoint: "http://api.example.com/mcp" },
      },
    });
    expect(result).toHaveLength(2);
    const ctx7 = result.find((r) => r.name === "context7");
    expect(ctx7?.transport).toBe("stdio");
    expect(ctx7?.command).toBe("docker");
    const remote = result.find((r) => r.name === "remote-mcp");
    expect(remote?.transport).toBe("streamable-http");
  });

  it("expands servers array shape", () => {
    const result = expandMcpConfigsFromJson({
      servers: [
        { name: "s1", command: "bun", args: ["run", "mcp.ts"] },
        { name: "s2", endpoint: "http://localhost:9000/sse" },
      ],
    });
    expect(result).toHaveLength(2);
    expect(result[0].transport).toBe("stdio");
    expect(result[1].transport).toBe("sse");
  });

  it("skips invalid entries silently", () => {
    const result = expandMcpConfigsFromJson([
      { name: "valid", command: "echo" },
      { /* missing name and no endpoint/command */ },
      "not an object",
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("valid");
  });

  it("returns empty array for null/undefined", () => {
    expect(expandMcpConfigsFromJson(null)).toHaveLength(0);
    expect(expandMcpConfigsFromJson(undefined)).toHaveLength(0);
  });
});
