---
title: Multi-agent, MCP and gateway
description: >-
  Builder reference for A2A, sub-agents, MCP servers, the persistent gateway, messaging channels and custom Effect layers.
sidebar:
  order: 8
topic: config-reference
related:
  - reference/builder-api
  - guides/sub-agents
  - guides/tools/mcp-tools
  - features/gateway
---

Methods that connect the agent to other agents and external systems: A2A and sub-agents, MCP servers, the persistent gateway, messaging channels and the Effect layer escape hatch. Part of the [builder reference](/reference/builder-api/).

## A2A protocol

| Method                 | Signature                                                                                                                                                                                           | Description                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `withA2A`              | `(options?: A2AOptions) => this`                                                                                                                                                                    | Configures A2A server defaults — `port` (default `3000`), `basePath` (default `/`); call `agent.serveA2A()` to actually start serving |
| `withAgentTool`        | `(name: string, agent: { name: string; description?: string; provider?: string; model?: string; tools?: string[]; maxIterations?: number; systemPrompt?: string; persona?: AgentPersona; parameters?: ToolParameter[] \| JsonSchemaObject; requiresApproval?: boolean; timeoutMs?: number; maxCallsPerTool?: Record<string, number> }) => this` | Static sub-agent as a tool, with optional typed per-invocation input parameters. `maxCallsPerTool` is merged over the parent's `.withTools({ maxCallsPerTool })` caps (its cap wins per name) |
| `withDynamicSubAgents` | `(options?: { maxIterations?: number }) => this`                                                                                                                                                    | `spawn-agent` for runtime sub-agents                                    |
| `withRemoteAgent`      | `(name: string, remoteUrl: string) => this`                                                                                                                                                         | Remote A2A agent as a tool                                              |

## MCP

| Method    | Signature                                                | Description                                                                                     |
| --------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `withMCP` | `(config: MCPServerConfig \| MCPServerConfig[]) => this` | Connect to MCP servers. Accepts a single config or array. Automatically enables `.withTools()`. |

### MCPServerConfig

| Field       | Type                                                   | Transport                       | Description                                                                                          |
| ----------- | ------------------------------------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `name`      | `string`                                               | all                             | Unique name for this server. Tool names are prefixed `{name}/`                                       |
| `transport` | `"stdio" \| "streamable-http" \| "sse" \| "websocket"` | all                             | Protocol to use. Use `"streamable-http"` for modern remote servers, `"stdio"` for local subprocesses |
| `command`   | `string`                                               | stdio                           | Executable to launch (`"bunx"`, `"docker"`, `"python"`, absolute path, etc.)                         |
| `args`      | `string[]`                                             | stdio                           | Arguments passed to `command`. Includes package names, flags, Docker image, etc.                     |
| `env`       | `Record<string, string>`                               | stdio                           | Extra env vars merged on top of the parent process environment. Use for per-server secrets           |
| `cwd`       | `string`                                               | stdio                           | Working directory for the subprocess. Defaults to parent process `cwd`                               |
| `endpoint`  | `string`                                               | streamable-http, sse, websocket | HTTP/WebSocket URL (`"https://mcp.example.com"`, `"ws://localhost:8000/mcp"`)                        |
| `headers`   | `Record<string, string>`                               | streamable-http, sse            | HTTP headers sent on every request. Use for `Authorization`, `x-api-key`, etc.                       |
| `auth`      | `MCPAuthConfig`                                        | streamable-http, sse            | OAuth 2.1 config — RA runs discovery/token exchange/refresh itself. **Startup error on `stdio`.** See below. |
| `tokenStore`| `MCPTokenStore`                                        | streamable-http, sse            | Where OAuth tokens are persisted. Defaults to a permissioned file store (`~/.reactive-agents/mcp-auth`); pass `createMemoryTokenStore()` for tests/CI. |

**Examples:**

<!-- docs-skip-typecheck -->
```typescript
// stdio: npm package via bunx
{ name: "filesystem", transport: "stdio", command: "bunx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "."] }

// stdio: with per-server secret
{ name: "github", transport: "stdio", command: "bunx",
  args: ["-y", "@modelcontextprotocol/server-github"],
  env: { GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GH_TOKEN ?? "" } }

// stdio: Docker container with networking
{ name: "my-server", transport: "stdio", command: "docker",
  args: ["run", "-i", "--rm", "--network", "host", "ghcr.io/org/mcp-server"] }

// streamable-http: modern cloud server with Bearer auth
{ name: "stripe", transport: "streamable-http",
  endpoint: "https://mcp.stripe.com",
  headers: { Authorization: `Bearer ${process.env.STRIPE_KEY}` } }

// sse: legacy remote server with API key
{ name: "legacy", transport: "sse",
  endpoint: "https://api.example.com/mcp",
  headers: { "x-api-key": process.env.API_KEY ?? "" } }

// streamable-http: OAuth 2.1, unattended agent (no human present)
{ name: "billing", transport: "streamable-http",
  endpoint: "https://mcp.example.com/mcp",
  auth: { type: "client_credentials", clientId: process.env.MCP_CLIENT_ID!,
          clientSecret: process.env.MCP_CLIENT_SECRET! } }

// streamable-http: OAuth 2.1, delegated user access
// (run `rax mcp login my-calendar` once, ahead of time)
{ name: "my-calendar", transport: "streamable-http",
  endpoint: "https://mcp.example.com/mcp",
  auth: { type: "authorization_code" } }
```

### MCPAuthConfig

A discriminated union on `type`. Full field-by-field guidance (which grant to pick, where tokens are
stored, secrets sourcing) is in the [Tools guide's OAuth section](/guides/tools/mcp-tools/#oauth-21-auth).

| `type`               | Use case                                        | Key fields                                    |
| --------------------- | ------------------------------------------------ | ---------------------------------------------- |
| `client_credentials`  | Unattended/production agent, shared-secret auth   | `clientId`, `clientSecret`                     |
| `private_key_jwt`     | Unattended/production agent, JWT-signed auth      | `clientId`, `privateKey`                       |
| `authorization_code`  | Delegated access to a specific human's account    | `clientId?`, `scope?`, `interactive?` (default `false`), `onAuthorizationUrl?`, `timeoutMs?` |

`stdio` transport servers cannot use `auth` — they take credentials via `env` instead (a startup error is
thrown if both are set).

### `rax mcp login | logout | status`

CLI commands for the `authorization_code` grant's one-time interactive login, run **before** the agent
connects:

```bash
rax mcp login <name|--url <endpoint>> [--client-id <id>] [--client-secret <secret>] [--scope <scope>] [--redirect-port <port>] [--no-browser] [--timeout <ms>] [--mcp-config <path>]
rax mcp logout <name|--url <endpoint>> [--mcp-config <path>]
rax mcp status
```

`<name>` resolves against `.rax/mcp.json` (or `--mcp-config <path>`); `--url <endpoint>` logs in ad-hoc
with no config file. `--client-secret` is for a confidential OAuth client (a server that issues a secret
alongside the client ID). `--redirect-port` pins the loopback callback to a fixed port — needed for a
server that validates `redirect_uri` by exact pre-registered match rather than any loopback port.
`status` lists stored credentials (resource, scope, expiry, whether a refresh token is present) and
never prints a token.

## Gateway and channels

| Method                               | Description                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `withGateway(options?)`              | Heartbeats, durable crons (`agent.schedules()`), webhooks (served on `port`), policies, inbound `queue`, `accessControl`, …                                                                                                                                                                                                                                                                                                                                              |
| `withChannels(config)`               | Wire `@reactive-agents/channels` sender-policy access control (`ChannelsConfig`). `adapters` takes canonical `ChannelAdapter`s or legacy `MessageChannel`s; they are code, so `AgentConfig` carries only the overlay marker. See [Messaging Channels](/guides/messaging-channels/).                                                                                                                                                                                                                                                                      |

## Advanced

| Method       | Signature                           | Description                             |
| ------------ | ----------------------------------- | --------------------------------------- |
| `withLayers` | `(layers: Layer<any, any>) => this` | Add custom Effect Layers to the runtime |
