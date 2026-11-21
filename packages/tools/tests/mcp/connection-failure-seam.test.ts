// Run: bun test packages/tools/tests/mcp/connection-failure-seam.test.ts --timeout 20000
//
// Seam pin for packages/tools/src/mcp/connection-failure.ts: a failed MCP connect
// carries a typed `status` / `reason`, so hosts (Cortex "Sign in") never parse the
// message or walk the cause chain themselves. End-to-end pins against the OAuth
// fixture live in oauth/stored-login-connect.test.ts (server 401) and
// oauth/authorization-code.test.ts (non-interactive login required).
import { describe, it, expect } from "bun:test";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  connectionFailureSignal,
  markAuthRequired,
  toMCPConnectionError,
} from "../../src/mcp/connection-failure.js";

describe("connectionFailureSignal", () => {
  it("an SDK 401 is auth-required with status 401", () => {
    expect(connectionFailureSignal(new StreamableHTTPError(401, "Unauthorized"))).toEqual({
      status: 401,
      reason: "auth-required",
    });
  });

  it("a non-auth HTTP status gives status only", () => {
    expect(connectionFailureSignal(new StreamableHTTPError(503, "down"))).toEqual({ status: 503 });
  });

  it("finds the signal through a wrapping cause", () => {
    const wrapped = new Error("all HTTP transports failed", {
      cause: new StreamableHTTPError(401, "Unauthorized"),
    });
    expect(connectionFailureSignal(wrapped)).toEqual({ status: 401, reason: "auth-required" });
  });

  it("a marked login-required error is auth-required with status 401", () => {
    expect(connectionFailureSignal(markAuthRequired(new Error("Run `rax mcp login x`")))).toEqual({
      status: 401,
      reason: "auth-required",
    });
  });

  it("string error codes, JSON-RPC codes and plain values give nothing", () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const rpc = Object.assign(new Error("Method not found"), { code: -32601 });
    expect(connectionFailureSignal(refused)).toEqual({});
    expect(connectionFailureSignal(rpc)).toEqual({});
    expect(connectionFailureSignal("boom")).toEqual({});
    expect(connectionFailureSignal(undefined)).toEqual({});
  });

  it("a cyclic cause chain terminates", () => {
    const a: { cause?: unknown } = {};
    const b = { cause: a };
    a.cause = b;
    expect(connectionFailureSignal(a)).toEqual({});
  });
});

describe("toMCPConnectionError", () => {
  it("keeps message, server, transport and cause, and adds the signal", () => {
    const cause = new StreamableHTTPError(401, "Unauthorized");
    const err = toMCPConnectionError(cause, "docs", "streamable-http");
    expect(err._tag).toBe("MCPConnectionError");
    expect(err.message).toBe("Streamable HTTP error: Unauthorized");
    expect(err.serverName).toBe("docs");
    expect(err.transport).toBe("streamable-http");
    expect(err.cause).toBe(cause);
    expect(err.status).toBe(401);
    expect(err.reason).toBe("auth-required");
  });

  it("an unclassified failure has no status or reason", () => {
    const err = toMCPConnectionError(new Error("spawn failed"), "local", "stdio");
    expect(err.status).toBeUndefined();
    expect(err.reason).toBeUndefined();
  });
});
