---
name: mcp-integration
description: MCP client integration patterns for packages/tools/src/mcp/. Docker container lifecycle, transport auto-detection, two-phase container naming, and cleanup. Use when working on MCP server configuration, docker-based MCP tools, or the mcp-client.
user-invocable: false
---

# MCP Integration Patterns

## The Critical Rule

```
docker rm -f <containerName> is the ONLY reliable container stop.
subprocess.kill() is NOT sufficient.
```

Killing the `docker run` process leaves the container alive in the Docker daemon. `docker rm -f` is the only operation that reliably terminates AND removes the container. This is non-negotiable.

## Two Docker MCP Patterns

| Pattern | Examples | Container behavior |
|---------|---------|-------------------|
| **stdio MCP** | GitHub MCP, filesystem MCP | Container reads JSON-RPC from stdin; responds on stdout |
| **HTTP-only MCP** | mcp/context7 | Container starts an HTTP server on a port; ignores stdin |

Both are handled transparently. The client auto-detects which pattern applies.

## Transport Auto-Detection

The MCP client races two connection methods when starting a docker container:

1. **stdio connect** — attempts to connect via stdin/stdout immediately
2. **HTTP URL detection** — watches container stderr for a URL pattern (e.g., `http://localhost:3000`)

When HTTP wins the race, the client switches to port-mapped HTTP mode automatically. No manual configuration needed.

**Transport inference rules** (for non-docker configs):

- `command` field present → `"stdio"`
- endpoint contains `/mcp` → `"streamable-http"`
- any other endpoint → `"sse"`
- `transport` field in `MCPServerConfig` is optional — auto-inferred if not set

## Two-Phase Container Naming

Docker containers are created in two phases. This prevents conflicts between concurrent agents running the same MCP server.

| Phase | Name pattern | Purpose |
|-------|-------------|---------|
| Probe | `rax-probe-<name>-<pid>` | Initial stdio connection attempt |
| Managed | `rax-mcp-<name>-<pid>` | Port-mapped HTTP mode (after HTTP detected) |

`<pid>` = process ID of the agent. Two agents running the same MCP server get different container names.

## Cleanup Pattern

Always call `cleanupMcpTransport(serverName)` — not just `transport.close()`.

```typescript
// WRONG — leaves container running in Docker daemon:
await transport.close();

// CORRECT — removes container first, then closes transport:
await cleanupMcpTransport(serverName);
// Internally: docker rm -f rax-mcp-<name>-<pid> && transport.close()
```

`cleanupMcpTransport` is called in:

- Cortex DELETE `/api/mcp-servers/:id`
- Agent `dispose()` lifecycle hook

## MCPServerConfig Schema

```typescript
// packages/tools/src/mcp/types.ts
interface MCPServerConfig {
  readonly name: string;
  readonly command?: string;           // e.g., "docker"
  readonly args?: readonly string[];   // e.g., ["run", "--rm", "-i", "ghcr.io/..."]
  readonly env?: Record<string, string>;
  readonly endpoint?: string;          // e.g., "http://localhost:3000/mcp"
  readonly transport?: "stdio" | "streamable-http" | "sse"; // optional — auto-inferred
}
```

The `transport` field is optional. Do not require it in new code.

## Cortex MCP Config Import

Cortex accepts MCP configs in two JSON shapes. Both are handled by `parseConfigBody` + `expandMcpConfigsFromJson`:

**Shape 1 — Cursor format:**

```json
{
  "mcpServers": {
    "github": { "command": "docker", "args": ["run", ...] }
  }
}
```

**Shape 2 — Claude Desktop format:**

```json
{
  "mcpServers": {
    "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] }
  }
}
```

Do not add new shape parsers without updating `expandMcpConfigsFromJson`.

## Testing MCP Integration

```typescript
// Run: bun test packages/tools/tests/mcp-client.test.ts --timeout 15000
import { Effect, Layer } from "effect";
import { describe, it, expect } from "bun:test";

it("should auto-detect transport from stdio config", async () => {
  const config: MCPServerConfig = {
    name: "test-mcp",
    command: "docker",
    args: ["run", "--rm", "-i", "some-mcp-image"],
    // transport not set — should be inferred as "stdio"
  };

  const transport = inferTransport(config);
  expect(transport).toBe("stdio");
}, 15000);

it("should infer streamable-http for /mcp endpoint", async () => {
  const config: MCPServerConfig = {
    name: "context7",
    endpoint: "http://localhost:3000/mcp",
  };

  const transport = inferTransport(config);
  expect(transport).toBe("streamable-http");
}, 15000);
```

For docker integration tests, mock the docker subprocess to avoid requiring Docker in CI:

```typescript
const mockDockerProcess = {
  stdin: { write: vi.fn() },
  stdout: { on: vi.fn() },
  stderr: { on: vi.fn() },
  kill: vi.fn(), // NOTE: this does NOT stop the container — tests should verify docker rm -f is called
};
```
