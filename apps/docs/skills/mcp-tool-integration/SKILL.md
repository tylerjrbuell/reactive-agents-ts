---
name: mcp-tool-integration
description: Connect agents to MCP servers using stdio or HTTP transport, with automatic Docker lifecycle management and transport auto-detection.
compatibility: Reactive Agents TypeScript projects using @reactive-agents/*
metadata:
  author: reactive-agents
  version: "2.0"
  tier: "capability"
---

# MCP Tool Integration

## Agent objective

Produce a builder with MCP servers correctly configured — right transport, Docker lifecycle, and auth — so the agent can discover and call MCP tools transparently.

## When to load this skill

- Adding external tools via MCP (GitHub, filesystem, databases, web APIs)
- Connecting to Docker-hosted MCP servers
- Debugging MCP connection or tool discovery failures
- Building agents that use context7, GitHub MCP, or custom MCP servers

## Implementation baseline

```ts
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "adaptive" })
  .withTools({
    mcpServers: [
      {
        name: "filesystem",
        command: "docker",
        args: [
          "run", "--rm", "-i",
          "-v", `${process.cwd()}:/workspace`,
          "mcp/filesystem", "/workspace",
        ],
        // transport auto-inferred as "stdio" (command present, no endpoint)
      },
    ],
  })
  .build();
```

## Key patterns

### Two Docker MCP patterns

**Pattern A — stdio MCP** (GitHub MCP, filesystem MCP): reads JSON-RPC from stdin

```ts
{
  name: "github",
  command: "docker",
  args: ["run", "--rm", "-i", "ghcr.io/github/github-mcp-server"],
  env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? "" },
  // transport: inferred as "stdio"
}
```

**Pattern B — HTTP-only MCP** (context7, etc.): starts HTTP server, ignores stdin

```ts
{
  name: "context7",
  command: "docker",
  args: ["run", "--rm", "-p", "3000:3000", "ghcr.io/upstash/context7-mcp"],
  // Framework auto-detects HTTP URL printed to stderr → switches to port-mapped HTTP
  // Do NOT hardcode transport here — let auto-detection handle it
}
```

### Transport auto-detection

When a stdio Docker container prints an HTTP URL to stderr, the MCP client races the stdio connection against HTTP URL detection. HTTP wins → client switches to port-mapped HTTP mode automatically.

Two container phases are created:
- `rax-probe-<name>-<pid>` — initial stdio probe attempt
- `rax-mcp-<name>-<pid>` — port-mapped HTTP managed container (if HTTP detected)

PID-based naming prevents conflicts when multiple agents run concurrently.

### Transport field (optional — usually omit)

```ts
// Auto-inferred rules:
// command present, no endpoint → "stdio"
// endpoint ends with /mcp     → "streamable-http"
// endpoint (other path)       → "sse"

// Only set transport explicitly when overriding detection:
{ name: "my-server", endpoint: "http://localhost:3000/api", transport: "sse" }
```

### Non-Docker MCP (local process or remote HTTP)

```ts
// Local process
{ name: "my-mcp", command: "node", args: ["./my-mcp-server.js"] }

// Remote Streamable HTTP
{ name: "remote", endpoint: "https://mcp.example.com/mcp" }

// Remote SSE
{ name: "remote-sse", endpoint: "https://mcp.example.com/events" }
```

## Container lifecycle

The framework owns container lifecycle:
- `docker run` starts the container when the agent is built
- On agent dispose, `docker rm -f <containerName>` stops it

**Critical:** `docker rm -f` is the only reliable way to stop MCP Docker containers. Killing the `docker run` process leaves the container alive in the Docker daemon.

## MCPServerConfig reference

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | `string` | Yes | Unique identifier for this server |
| `command` | `string` | For stdio | Executable (`"docker"`, `"node"`, etc.) |
| `args` | `string[]` | For stdio | Command arguments |
| `env` | `Record<string, string>` | No | Environment variables |
| `endpoint` | `string` | For HTTP | URL of the MCP HTTP endpoint |
| `transport` | `"stdio"\|"streamable-http"\|"sse"` | No | Auto-inferred if omitted |

## Pitfalls

- `subprocess.kill()` does **not** stop Docker containers — only `docker rm -f` works
- Don't hardcode `transport: "streamable-http"` for HTTP-only Docker servers — let auto-detection handle it
- Container names are PID-scoped — don't try to reference them manually
- Each agent creates its own containers — 10 parallel agents = 10 container instances
- MCP tools are discovered at connection time — if the server isn't ready at build time, tool discovery silently fails
- `env` values must be strings — use `process.env.VAR ?? ""` pattern, never pass `undefined`
