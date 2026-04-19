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

You can also register tools **after** `build()` on the agent facade: `await agent.registerTool({ definition, handler })` and `await agent.unregisterTool("name")` (non-builtin tools only).

### With Reasoning (ReAct)

When reasoning is enabled, the agent uses a Think → Act → Observe loop. Tools are passed to the LLM via the provider's native function calling API parameter. The model returns structured `tool_use` blocks — no text parsing. The framework:

1. Receives the structured `tool_use` block from the LLM response
2. Validates input against the tool's schema
3. Executes the tool in a sandbox
4. Returns the real result as a `tool_result` message
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
| `crypto-price` | data | Get current prices for 30+ cryptocurrencies via CoinGecko's free public API | — |
| `git-cli` | vcs | Run any `git` subcommand (e.g. `status`, `log`, `diff`) | `git` in `$PATH` |
| `gh-cli` | vcs | Run any `gh` subcommand via the GitHub CLI | `gh` in `$PATH` |
| `gws-cli` | productivity | Run any `gws` subcommand via the Google Workspace CLI | `gws` in `$PATH` |

Ad-hoc note builtins were removed from the default tool list. Use the **`recall`** meta-tool (Conductor's Suite) for working-memory writes, reads, search, and listing. If you use **`.withDocuments()`**, ingestion uses **`rag-ingest`** and retrieval is typically routed through **`find`** rather than a standalone `rag-search` builtin.

### crypto-price

Fetches current cryptocurrency prices from [CoinGecko's free public API](https://www.coingecko.com/en/api). No API key or account required.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `coins` | `string[]` | yes | Array of coin symbols, e.g. `["BTC", "ETH", "SOL"]`. Case-insensitive. Always batch multiple coins into a single call. |
| `currency` | `string` | no | Quote currency. Default: `"usd"`. Also accepts: `eur`, `gbp`, `jpy`, `btc`, `eth`. |

**Supported symbols:** BTC, ETH, XRP, XLM, SOL, ADA, DOGE, DOT, AVAX, MATIC/POL, LINK, LTC, BCH, UNI, ATOM, NEAR, ARB, OP, SUI, APT, TRX, TON, SHIB, PEPE, FIL, ICP, VET, ALGO, HBAR.

Prices are cached for 60 seconds — rapid repeated calls within a session return immediately without hitting the network. Responses include a `notFound: true` flag for any unrecognized symbol rather than failing the whole call.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTools({ include: ["crypto-price"] })
  .withReasoning()
  .build();

const result = await agent.run("What are the current prices of BTC, ETH, and SOL in USD?");
```

The model is instructed to batch all needed coins into one call. The tool returns `{ prices: [{ symbol, name, price, currency }], currency, source: "coingecko" }`.

### git-cli

Runs any `git` subcommand in the agent's current working directory. Requires `git` to be installed and in `$PATH`.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | `string` | yes | The git subcommand plus any flags — **without** the leading `git` keyword. E.g. `"log --oneline -10"`, `"diff HEAD~1"`, `"branch -a"`. |

Output longer than 32 KB is truncated and the model is told how many bytes were cut. Non-zero exit codes surface as errors so the model knows the command failed.

The tool uses `execFile` (no shell expansion), so shell operators like `|` and `>` are not available. For pipelines, use `code-execute` or `shell-execute`.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTools({ include: ["git-cli"] })
  .withReasoning()
  .build();

const result = await agent.run("Summarize the last 10 commits in this repo.");
```

### gh-cli

Runs any [GitHub CLI](https://cli.github.com/) (`gh`) command. Requires `gh` to be installed, in `$PATH`, and authenticated (`gh auth login`).

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | `string` | yes | The gh subcommand plus flags — **without** the leading `gh` keyword. E.g. `"pr list --state open"`, `"issue view 42"`, `"run list --limit 5"`. |

Adding `--json <fields>` to the command returns machine-readable JSON, which the model can process directly. Output longer than 32 KB is truncated.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTools({ include: ["gh-cli"] })
  .withReasoning()
  .build();

const result = await agent.run("List open PRs and summarize what each one changes.");
```

### gws-cli

Runs Google Workspace CLI (`gws`) commands, providing access to Gmail, Google Calendar, Google Drive, and other Workspace services. Requires `gws` to be installed, in `$PATH`, and authenticated (`gws auth login`).

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | `string` | yes | The gws subcommand plus flags — **without** the leading `gws` keyword. E.g. `"calendar events list"`, `"gmail messages list --query unread"`, `"drive files list"`. |

If `gws` is not installed, the tool returns a clear error immediately — the model is instructed not to retry and to report the missing binary instead.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTools({ include: ["gws-cli"] })
  .withReasoning()
  .build();

const result = await agent.run("What meetings do I have today?");
```

### Kernel meta-tools (reasoning loop)

These are registered by the kernel with live state — not part of the static `builtinTools` list:

| Tool | Description |
|------|-------------|
| `context-status` | Zero-parameter introspection: iteration budget, tools used/pending, stored keys, tokens, etc. |
| `task-complete` | Explicit completion with a `summary`. Visibility-gated when guardrails on early exit are needed. |
| `final-answer` | Hard-gate meta-tool: structured deliverable + format + confidence — primary path for exiting the ReAct loop cleanly under native function calling. |

### Conductor's Suite (default with tools)

When **`.withTools()`** is enabled, **`.withMetaTools()`** defaults to **on** (pass **`false`** to disable). That injects **`brief`**, **`find`**, **`pulse`**, and **`recall`** plus the built-in harness skill (tier-aware). Configure or narrow tools with **`.withMetaTools({ brief: true, find: false, … })`**.

All of the above are invoked via the provider’s **native function calling** path (`tool_use` / `tool_calls` → executed → `tool_result` in the thread).

## Parallel and Chain Tool Execution

Agents can issue multiple tool calls from a single thought step via native function calling.

### Parallel

The model can return multiple `tool_use` blocks in a single response. The framework executes them concurrently:

- Results are numbered and returned as separate `tool_result` messages.
- Capped at 3 simultaneous tool calls to prevent runaway fan-out.
- Side-effect tools (`create_*`, `delete_*`, `send_*`, `push_*`, etc.) are automatically forced to single mode.

### Chain

For sequential tool calls where the output of one feeds into the next, the model issues a single `tool_use` block per turn. The framework returns the `tool_result`, and the model issues the next call in a subsequent turn with the prior result available in its context.

- Execution is sequential; the model sees each result before deciding the next call.
- Capped at 3 chained steps per tool execution phase.

### Web Search Configuration

The `web-search` tool requires a [Tavily](https://www.tavily.com) API key. Without it, calls to `web-search` return an error telling the agent the tool is inactive:

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

## ToolBuilder Fluent API

The `ToolBuilder` provides a fluent, type-safe API for defining tools without raw schema objects. It eliminates the boilerplate of `definition` + `handler` pairs.

```typescript
import { ToolBuilder } from "@reactive-agents/tools";
import { Effect } from "effect";

// Basic tool
const calculator = ToolBuilder.create("calculator")
  .description("Perform arithmetic calculations")
  .param("expression", "string", "Math expression to evaluate", { required: true })
  .riskLevel("low")
  .timeout(5_000)
  .handler((args) => Effect.try(() => String(eval(String(args.expression)))))
  .build();

// Tool with multiple params and enum
const fileOp = ToolBuilder.create("file-operation")
  .description("Perform a file system operation")
  .param("path", "string", "File path", { required: true })
  .param("operation", "string", "Operation to perform", { required: true, enum: ["read", "write", "delete"] })
  .param("content", "string", "Content for write operations", { required: false })
  .riskLevel("medium")
  .requiresApproval(true)
  .timeout(10_000)
  .handler(async (args) => {
    // ... implementation
    return Effect.succeed("done");
  })
  .build();

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withTools({ tools: [calculator, fileOp] })
  .build();
```

### ToolBuilder Methods

| Method | Description |
|--------|-------------|
| `ToolBuilder.create(name)` | Start a new tool definition |
| `.description(text)` | Set the tool description (shown to LLM) |
| `.param(name, type, description, options?)` | Add a parameter. `options`: `{ required?, enum?, default? }` |
| `.riskLevel(level)` | `"low" \| "medium" \| "high"` |
| `.timeout(ms)` | Execution timeout in milliseconds |
| `.requiresApproval(bool)` | Whether the tool requires human approval before execution |
| `.handler(fn)` | Set the handler function. Receives typed args, returns `Effect<string>` |
| `.build()` | Produce a `{ definition, handler }` tool object |

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

Connect to [Model Context Protocol](https://modelcontextprotocol.io/docs/getting-started/intro) servers for external tool discovery and execution. MCP tools are automatically prefixed with `{serverName}/` (e.g. `filesystem/read_file`) and injected into the agent's reasoning loop alongside built-in tools.

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
3. Stores the **full result** in working memory under `_tool_result_N`
4. Injects the preview + storage key into context

**Example — JSON array (github/list_commits, 30 items, 31K chars):**

```
[STORED: _tool_result_1 | github/list_commits]
Type: Array(30) | Schema: sha, commit.message, author.login, date
Preview (first 3):
  [0] sha=e255a5d  msg="chore: update bun.lock"        date=2026-02-27
  [1] sha=59bae87  msg="feat(examples): unified runner" date=2026-02-27
  [2] sha=efc816e  msg="fix(examples): maxIterations"   date=2026-02-27
  ...27 more — use recall("_tool_result_1") or | transform: to access full data
```

### Accessing Full Results

The agent can retrieve the stored result using the `recall` meta-tool (via native function calling):

```typescript
// The model calls recall via its tool_use block:
// { name: "recall", input: { key: "_tool_result_1" } }
```

### Pipe Transforms

For agents that anticipate the response shape, a code-transform pipe lets them extract exactly what they need — **before the result enters context**. The pipe syntax is appended to the tool call args as a `_transform` field:

```typescript
// The model calls github/list_commits with a transform expression
// { name: "github/list_commits", input: { owner: "...", repo: "...", _transform: "result.slice(0,5).map(c => ({sha: c.sha.slice(0,7), msg: c.commit.message.split('\\n')[0]}))" } }
```

The expression is evaluated in-process with `result` bound to the parsed tool output. Only the transform output enters context. On error, the framework falls back to the standard preview and includes the error message.

### Configuration

Tune compression behavior via `.withTools()`:

```typescript
.withTools({
  resultCompression: {
    budget: 1200,        // chars before overflow triggers (default: 800)
    previewItems: 5,     // array items shown in preview (default: 3)
    autoStore: true,     // store oversized tool previews under stable keys (surfaced to the model via human-readable labels; `recall` can read them)
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
