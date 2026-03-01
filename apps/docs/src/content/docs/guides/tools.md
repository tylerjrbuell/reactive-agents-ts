---
title: Tools
description: Giving agents the ability to act in the world — tool registry, sandbox execution, MCP, and reasoning integration.
sidebar:
  order: 8
---

The tools layer lets agents call external functions, APIs, and MCP servers. Tools integrate directly with the reasoning loop — when an agent thinks it needs information or wants to take an action, it calls a tool and uses the real result.

## Built-in Tools vs Custom Tools

When you call `.withTools()`, several built-in tools are automatically registered. You can also register custom tools at build time by passing options.

### Using Built-in Tools

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTools()               // Built-in tools auto-registered
  .withReasoning()           // Tools work with or without reasoning
  .build();

const result = await agent.run("What is the population of Tokyo times 3?");
```

### Registering Custom Tools

Pass custom tool definitions via the `tools` option:

```typescript
import { ReactiveAgents } from "reactive-agents";
import { Effect } from "effect";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTools({
    tools: [{
      definition: {
        name: "calculator",
        description: "Perform arithmetic calculations",
        parameters: [{ name: "expression", type: "string", description: "Math expression", required: true }],
        riskLevel: "low",
        timeoutMs: 5_000,
        requiresApproval: false,
        source: "function",
      },
      handler: (args) => Effect.try(() => String(eval(String(args.expression)))),
    }],
  })
  .withReasoning()
  .build();
```

You can also register tools programmatically after build using `ToolService.register()` via the Effect API.

### With Reasoning (ReAct)

When reasoning is enabled, the agent uses a Think → Act → Observe loop. The LLM can request tool calls by emitting `ACTION: tool_name({"param": "value"})` in its response. The framework:

1. Parses the action from the LLM output
2. Validates input against the tool's schema
3. Executes the tool in a sandbox
4. Returns the real result as an Observation
5. The LLM continues reasoning with the new information

### Without Reasoning (Direct LLM Loop)

Without reasoning, tool calling uses the LLM provider's native function calling:

1. Tool definitions are converted to the provider's format (Anthropic tools, OpenAI function_calling, Gemini function declarations)
2. When the LLM responds with `stopReason: "tool_use"`, the framework executes the requested tools
3. Results are appended to the message history as tool results
4. The LLM is called again with the updated context
5. Loop continues until the LLM stops requesting tools

Both paths produce the same outcome — the agent uses tools to accomplish its task.

## Built-in Tools

When you enable `.withTools()`, these tools are automatically registered and available to the agent:

| Tool | Category | Description | Requires |
|------|----------|-------------|----------|
| `web-search` | search | Search the web using Tavily API | `TAVILY_API_KEY` |
| `http-get` | http | Make HTTP GET requests | — |
| `file-read` | file | Read file contents (path-traversal protected) | — |
| `file-write` | file | Write file contents (requires approval) | — |
| `code-execute` | code | Execute code in a subprocess (`Bun.spawn`, `cwd: "/tmp"`, minimal env) | — |

### Web Search Configuration

The `web-search` tool requires a [Tavily](https://tavily.com) API key. Without it, calls to `web-search` return an error telling the agent the tool is inactive:

```bash
# .env
TAVILY_API_KEY=tvly-...
```

When the key is set, web search makes real API calls and returns `{ title, url, content }` results. When missing, the agent sees an explicit error message explaining that `TAVILY_API_KEY` is not configured.

## Sandboxed Execution

All tool execution runs in a sandbox with:

- **Timeout** — Default 30s per tool call, configurable
- **Error containment** — Tool failures don't crash the agent; errors are reported as observation text
- **Result wrapping** — All outputs are wrapped in `ToolExecutionResult` with success/failure status

The `code-execute` tool uses subprocess isolation via `Bun.spawn()` with `cwd: "/tmp"` and a minimal environment (`PATH` only). This prevents spawned code from reading environment variables (API keys, secrets) or accessing files outside `/tmp`.

## Input Validation

Tool inputs are validated against their schemas before execution:

- Required parameter checking
- Type validation (string, number, boolean, array, object)
- Enum validation
- Default value injection for optional parameters

Invalid inputs are rejected before the tool handler runs.

## Function Adapter

Convert plain functions into tool definitions:

```typescript
import { adaptFunction } from "@reactive-agents/tools";

const tool = adaptFunction({
  name: "calculate",
  description: "Perform arithmetic",
  fn: ({ a, b, op }) => {
    switch (op) {
      case "add": return a + b;
      case "sub": return a - b;
      case "mul": return a * b;
      case "div": return a / b;
    }
  },
  parameters: {
    a: { type: "number", description: "First operand" },
    b: { type: "number", description: "Second operand" },
    op: { type: "string", enum: ["add", "sub", "mul", "div"] },
  },
});
```

## MCP Support

Connect to [Model Context Protocol](https://modelcontextprotocol.io) servers for external tool discovery and execution. MCP tools are automatically prefixed with `{serverName}/` (e.g. `filesystem/read_file`) and injected into the agent's reasoning loop alongside built-in tools.

### Transports

Four transports are supported, covering every MCP server deployment pattern:

| Transport | When to use |
|-----------|-------------|
| `"stdio"` | Local subprocess — npm packages, Docker, Python scripts, any executable |
| `"streamable-http"` | Modern remote servers (MCP spec 2025-03-26) — Claude.ai, Cursor, Stripe, cloud providers |
| `"sse"` | Legacy remote servers (MCP spec 2024-11-05) — older self-hosted setups |
| `"websocket"` | Real-time bidirectional servers |

### stdio Transport

Launches a subprocess and communicates via JSON-RPC over stdin/stdout. The subprocess inherits the parent process environment by default.

```typescript
await using agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withMCP({
    name: "filesystem",
    transport: "stdio",
    command: "bunx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
  })
  .withReasoning()
  .build();
```

#### Per-server environment variables

Use `env` to inject secrets without relying on the global environment. These are **merged on top** of the parent process environment — only specify what differs:

```typescript
.withMCP({
  name: "github",
  transport: "stdio",
  command: "bunx",
  args: ["-y", "@modelcontextprotocol/server-github"],
  env: {
    GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GH_TOKEN ?? "",
  },
})
```

#### Working directory

Set `cwd` to control where the subprocess starts. Useful when the MCP server reads relative paths:

```typescript
.withMCP({
  name: "project-tools",
  transport: "stdio",
  command: "node",
  args: ["./mcp-server.js"],
  cwd: "/home/user/my-project",
})
```

#### Docker containers

`command` accepts any executable — `docker` works directly. Docker networking flags go in `args`:

```typescript
.withMCP({
  name: "my-server",
  transport: "stdio",
  command: "docker",
  args: [
    "run", "-i", "--rm",
    "--network", "my-bridge-network",
    "-e", "INTERNAL_VAR=value",          // container-only env (not secret)
    "ghcr.io/myorg/mcp-server:latest",
  ],
  env: { SECRET_KEY: process.env.SECRET_KEY ?? "" }, // passed to docker CLI, not container
})
```

:::note[Docker env vs `env` field]
`-e KEY=value` in `args` injects into the container. The `env` field sets env vars on the host `docker` process itself — useful if the Docker CLI needs credentials (e.g. `DOCKER_AUTH_CONFIG`), not the container.
:::

### Streamable HTTP Transport

The standard transport for modern remote and cloud-hosted MCP servers (MCP spec 2025-03-26). Uses a single POST endpoint — the server responds with either a plain JSON object or an SSE stream depending on the operation.

```typescript
.withMCP({
  name: "stripe",
  transport: "streamable-http",
  endpoint: "https://mcp.stripe.com",
  headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
})
```

Session management is handled automatically: the session ID returned in the `Mcp-Session-Id` response header is captured and forwarded on all subsequent requests. When the agent is disposed, an HTTP DELETE is sent to cleanly terminate the session.

### Auth Headers (SSE and Streamable HTTP)

Pass `headers` to send authentication credentials on every request. Use for Bearer tokens (OAuth, JWT, PAT), API keys, or any per-server auth:

```typescript
// Bearer token (OAuth, PAT, JWT)
headers: { Authorization: "Bearer ghp_..." }

// API key header
headers: { "x-api-key": process.env.MCP_API_KEY ?? "" }

// Multiple headers
headers: {
  Authorization: "Bearer token",
  "X-Tenant-Id": "my-org",
}
```

:::note[OAuth flow]
The `headers` field accepts a pre-obtained Bearer token. If your server requires OAuth token exchange (PKCE, device flow, etc.), complete the OAuth flow separately and pass the resulting access token here.
:::

### Multiple MCP Servers

Pass an array to connect multiple servers at build time:

```typescript
await using agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withMCP([
    {
      name: "filesystem",
      transport: "stdio",
      command: "bunx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
    },
    {
      name: "github",
      transport: "stdio",
      command: "bunx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GH_TOKEN ?? "" },
    },
    {
      name: "stripe",
      transport: "streamable-http",
      endpoint: "https://mcp.stripe.com",
      headers: { Authorization: `Bearer ${process.env.STRIPE_KEY}` },
    },
  ])
  .withReasoning()
  .build();
```

### Cleanup

MCP stdio servers run as subprocesses — the process will hang if they aren't shut down. Always dispose the agent when done. See [Resource Management](../../reference/builder-api/#resource-management) for full patterns.

```typescript
// Option A: await using (recommended) — auto-disposes on scope exit
await using agent = await ReactiveAgents.create()
  .withMCP({ name: "fs", transport: "stdio", command: "bunx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] })
  .build();

// Option B: runOnce — build + run + dispose in one call
const result = await ReactiveAgents.create()
  .withMCP({ name: "fs", transport: "stdio", command: "bunx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] })
  .runOnce("What files are in this project?");
```

### Protocol Details

The MCP client is spec-compliant with MCP 2025-03-26:

- Sends `notifications/initialized` after the handshake (required by spec before any tool calls)
- Negotiates protocol version `2025-03-26` (servers may respond with an older supported version)
- Tool results are extracted from the MCP `content` array format — the model receives clean text, not raw JSON
- `isError: true` results from servers surface as tool execution errors in the agent loop

:::tip[Messaging via MCP]
Signal and Telegram can be connected as MCP servers running in Docker containers. The agent uses MCP tools to send and receive messages, with the gateway heartbeat driving message polling. See the [Messaging Channels guide](/guides/messaging-channels/).
:::

## Agent-as-Tool

Register other agents (local or remote) as callable tools. This enables hierarchical agent architectures where a coordinator delegates subtasks to specialists.

### Remote Agent (via A2A)

```typescript
const agent = await ReactiveAgents.create()
  .withName("coordinator")
  .withProvider("anthropic")
  .withRemoteAgent("researcher", "https://research-agent.example.com")
  .withReasoning()
  .build();

// The coordinator can now call the researcher as a tool during reasoning
```

The remote agent is discovered via its A2A Agent Card and called via JSON-RPC `message/send`.

### Local Agent

```typescript
const agent = await ReactiveAgents.create()
  .withName("coordinator")
  .withProvider("anthropic")
  .withAgentTool("specialist", {
    name: "data-analyst",
    description: "Analyzes data and produces insights",
  })
  .build();
```

See the [A2A Protocol](/features/a2a-protocol/) docs for full details.

## Tool Type Conversion

The framework automatically converts between the tools package format and the LLM provider's native format using `toFunctionCallingFormat()`:

```typescript
// Internal: tools package format
{ name: "search", description: "...", parameters: [...] }

// Converted to: LLM provider format
{ name: "search", description: "...", inputSchema: { type: "object", properties: {...} } }
```

This conversion happens automatically in the execution engine — you don't need to worry about format differences between providers.

## Tool Result Compression

Large tool results (e.g. an MCP `list_commits` returning 31K characters) are automatically compressed so the agent receives accurate, structured data instead of garbled truncated JSON.

### How It Works

When a tool result exceeds the configured `budget` (default: 800 chars), the framework:

1. Detects the result type (JSON array, JSON object, or plain text)
2. Generates a **structured preview** — compact, accurate, fits within budget
3. Stores the **full result** in an in-memory scratchpad under `_tool_result_N`
4. Injects the preview + storage key into context

**Example — JSON array (github/list_commits, 30 items, 31K chars):**

```
[STORED: _tool_result_1 | github/list_commits]
Type: Array(30) | Schema: sha, commit.message, author.login, date
Preview (first 3):
  [0] sha=e255a5d  msg="chore: update bun.lock"        date=2026-02-27
  [1] sha=59bae87  msg="feat(examples): unified runner" date=2026-02-27
  [2] sha=efc816e  msg="fix(examples): maxIterations"   date=2026-02-27
  ...27 more — use scratchpad-read("_tool_result_1") or | transform: to access full data
```

### Accessing Full Results

The agent can retrieve the stored result using the built-in `scratchpad-read` tool:

```
ACTION: scratchpad-read("_tool_result_1")
```

### Pipe Transforms

For agents that anticipate the response shape, a code-transform pipe lets them extract exactly what they need — **before the result enters context**:

```
ACTION: github/list_commits({"owner":"tylerjrbuell","repo":"reactive-agents-ts"}) | transform: result.slice(0,5).map(c => ({sha: c.sha.slice(0,7), msg: c.commit.message.split('\n')[0]}))
```

The expression is evaluated in-process with `result` bound to the parsed tool output. Only the transform output enters context. On error, the framework falls back to the standard preview and includes the error message.

### Configuration

Tune compression behavior via `.withTools()`:

```typescript
.withTools({
  resultCompression: {
    budget: 1200,        // chars before overflow triggers (default: 800)
    previewItems: 5,     // array items shown in preview (default: 3)
    autoStore: true,     // auto-store overflow in scratchpad (default: true)
    codeTransform: true, // enable | transform: pipe syntax (default: true)
  }
})
```

| Option | Default | Description |
|--------|---------|-------------|
| `budget` | `800` | Character threshold before compression kicks in |
| `previewItems` | `3` | Number of array items shown in the preview |
| `autoStore` | `true` | Whether to store the full result for later retrieval |
| `codeTransform` | `true` | Whether the `\| transform:` pipe syntax is enabled |

## Memory Integration

When tools are executed during reasoning, the results are automatically logged as episodic memories:

```typescript
// This happens automatically when both .withTools() and .withMemory() are enabled
// Each tool result is logged with:
// - Action taken
// - Tool name and input
// - Result content
// - Timestamp
```

This means the agent can recall past tool results in future sessions.
