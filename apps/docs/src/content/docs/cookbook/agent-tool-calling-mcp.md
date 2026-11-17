---
title: Build an AI Agent with Tool Calling and MCP in TypeScript
description: >-
  A hands-on TypeScript tutorial for building an AI agent with function calling
  and Model Context Protocol (MCP). Define your own tools with the tool()
  helper, plug in MCP servers over stdio and streamable-http, and run the same
  code on local and frontier models.
sidebar:
  label: Tool Calling & MCP
  order: 31
topic: tools
related:
  - guides/tools
  - cookbook/building-tools
  - guides/security-hardening
  - guides/choosing-strategies
---

Tools are how an AI agent stops talking and starts *acting* — searching the web, reading files, hitting an API, querying a database. A language model on its own can only produce text; tool calling (a.k.a. function calling) is what lets it choose an action, hand you structured arguments, and use the real result to decide what to do next.

In Reactive Agents there are two ways to give a TypeScript agent tools, and you can mix them freely in one agent:

1. **Define your own tools** — wrap any function with the `tool()` helper (or a raw schema object for full control).
2. **Plug in MCP servers** — connect any [Model Context Protocol](https://modelcontextprotocol.io/) server (filesystem, GitHub, Stripe, a database, your own) and its tools appear in the agent's registry automatically.

This guide walks through both, end to end. Install first:

```bash
bun add reactive-agents
# Node.js 22.5+: npm install reactive-agents
```

## Step 1 — An agent with one custom tool

The fastest way to define a tool is the `tool()` helper — no Effect or Schema knowledge required. Give it a name, a description (the model reads this to decide when to call it), and a plain `async`/sync handler that receives the validated `args` record and returns a value directly:

```typescript
import { ReactiveAgents } from "reactive-agents";
import { tool } from "@reactive-agents/tools";

const weatherTool = tool("get_weather", "Get the current weather for a city", {
  params: {
    city: { type: "string", required: true, description: "City name, e.g. 'Tokyo'" },
  },
  riskLevel: "low",
  timeoutMs: 10_000,
  handler: async (args) => {
    const city = String(args.city);
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
    const data = (await res.json()) as {
      current_condition: Array<{ temp_C: string; weatherDesc: Array<{ value: string }> }>;
    };
    const c = data.current_condition[0];
    return `${city}: ${c.temp_C}°C, ${c.weatherDesc[0].value}`;
  },
});

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-6")
  .withReasoning() // enables the Think → Act → Observe (ReAct) loop
  .withTools({ tools: [weatherTool] })
  .build();

const result = await agent.run("What should I wear in Tokyo today?");
console.log(result.output);
```

What happens under the hood: `.withReasoning()` turns on the ReAct loop. The model sees `get_weather` in its tool list, emits a structured `tool_use` block with `{ city: "Tokyo" }`, the framework validates the arguments against your schema, runs your handler in a sandbox, feeds the real result back as a `tool_result`, and the model writes its final answer. `tool()` wraps whatever your handler returns or throws into the Effect the runtime expects internally — you never see that layer.

For simpler tools, skip `params`/`riskLevel`/`timeoutMs` entirely: `tool("greet", "Greet a user", async (args) => \`Hello, ${args.name}!\`)`.

## Step 2 — The raw-schema tool form

`tool()` is sugar over a plain `ToolDefinition` schema object plus an Effect-returning handler. If you are generating tools dynamically, need fine-grained control over the `ToolDefinition` shape, or want to write the handler as an `Effect` directly (for structured error channels, resource-safe cleanup, etc.), write the `{ definition, handler }` shape yourself:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withTools({
    tools: [
      {
        definition: {
          name: "get_weather",
          description: "Get the current weather for a city",
          parameters: [
            { name: "city", type: "string", description: "City name", required: true },
          ],
          riskLevel: "low",
          timeoutMs: 10_000,
          requiresApproval: false,
          source: "function",
        },
        handler: (args) => Effect.succeed(`Weather for ${args.city}`),
      },
    ],
  })
  .build();
```

Both forms produce the same registered tool. You can also register tools on a running agent with `await agent.registerTool(definition, handler)` and remove them with `await agent.unregisterTool("name")`.

## Step 3 — Connect an MCP server

The Model Context Protocol is a standard for exposing tools to AI agents, with thousands of public servers covering filesystems, GitHub, browsers, databases, and SaaS APIs. Use `.withMCP()` per server — its tools are discovered at build time, prefixed with `{serverName}/`, and dropped into the same registry as your custom tools.

### stdio transport (local subprocess)

`stdio` launches a server as a child process and talks JSON-RPC over stdin/stdout. This is the right transport for npm packages, Docker images, and local scripts. Here is the official filesystem server scoped to the current directory:

<!-- docs-skip-typecheck -->
```typescript
// `await using` auto-disposes the agent (and shuts the subprocess down) on scope exit
await using agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-6")
  .withReasoning()
  .withMCP({
    name: "filesystem",
    transport: "stdio",
    command: "bunx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
  })
  .build();

const result = await agent.run(
  "List the TypeScript files in this folder and summarize what each does.",
);
console.log(result.output);
```

:::caution[Always dispose stdio agents]
A `stdio` MCP server is a real subprocess — it will hang your program if it is never shut down. Use `await using` (shown above), call `await agent.dispose()`, or use `.runOnce("...")` to build, run, and dispose in a single call. Pass per-server secrets with the `env` field (e.g. `env: { GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GH_TOKEN ?? "" }`) instead of leaking them into the global environment.
:::

### streamable-http transport (remote / cloud)

For modern hosted MCP servers, use `streamable-http` with an `endpoint` and optional auth `headers`. Session handling and cleanup are automatic:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withMCP({
    name: "stripe",
    transport: "streamable-http",
    endpoint: "https://mcp.stripe.com",
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
  })
  .build();
```

You can pass an **array** to `.withMCP([...])`, or chain `.withMCP()` multiple times, to connect several servers at once — and combine them with `tool()` custom tools in the same agent. The model sees every tool uniformly and picks whichever it needs.

### Skip the config — resolve a server by name

For servers published to [Docker Hub's `mcp/*` catalog](https://hub.docker.com/mcp), skip the `command`/`args` entirely and pass the catalog name as a string:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withMCP("brave-search", { env: { BRAVE_API_KEY: process.env.BRAVE_API_KEY! } })
  .build();
```

The first use of an unapproved image throws `MCPApprovalRequiredError` rather than silently running it — approve it once with `approveMcpImage()`, or pass `requireApproval: false` for environments you've already vetted. Full option reference (`env`, `volumes`, `registry`, `requireApproval`) and the approval flow are in the [Tools guide's Docker Hub MCP catalog section](/guides/tools/mcp-tools/#registry-resolved-servers-docker-hub-with-more-registries-planned).

### streamable-http with OAuth 2.1

`headers` above works for a pre-obtained token you manage yourself. If the server speaks OAuth 2.1 and you want Reactive Agents to handle discovery, token exchange, refresh and storage, pass `auth` to `.withMCP()` instead (`client_credentials` for unattended agents, `authorization_code` plus `rax mcp login <name>` when the agent acts for a specific person). Examples, grant selection, the token-store contract and the `rax mcp login|logout|status` reference are in the [Tools guide's OAuth section](/guides/tools/mcp-tools/#oauth-21-auth).

## Step 4 — Adaptive tool calling on local *and* frontier models

Not every model speaks the same function-calling dialect. Frontier APIs (Anthropic, OpenAI, Gemini) expose native structured `tool_use`/`tool_calls`; many local models only produce tool calls as text. Reactive Agents probes the active model's dialect and routes to either a native function-calling driver or a text-parsing driver (XML / JSON / pseudo-code) — so the *exact same agent code* runs against a frontier API or a 4B+ Ollama model with no changes:

<!-- docs-skip-typecheck -->
```typescript
const localAgent = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("qwen3:4b")
  .withReasoning()
  .withTools({ tools: [weatherTool] }) // same tool, same handler
  .build();

const result = await localAgent.run("What's the weather in Tokyo?");
```

Swap `.withProvider("ollama")` for `.withProvider("anthropic")` and the tool, the handler, and the loop are identical. This is what makes the framework model-agnostic for tool use.

## Tips

- **Risk levels and approval.** Set `.riskLevel("high")` and `.requiresApproval(true)` on destructive tools (file writes, payments, deletes). When approval is required, the agent pauses for a human decision before the handler runs. The built-in `file-write` tool already requires approval by default.
- **Prevent runaway loops.** Parallel tool calls are capped at 3 simultaneous executions and 3 chained steps per phase, and side-effect tools (`create_*`, `delete_*`, `send_*`, …) are forced to run one at a time — so a confused model can't fan out destructively.
- **Force critical tools.** Use `.withRequiredTools({ tools: ["get_weather"], adaptive: true, maxRetries: 2 })` to guarantee a tool is called before the agent is allowed to answer.
- **Scope the surface.** `allowedTools` is a hard allowlist and `focusedTools` is soft guidance; a tight list also helps smaller models pick the right tool. See [Scoping the Tool Set](/guides/tools/scoping-and-policy/#scoping-the-tool-set).
- **Tool timeouts and big results.** Every tool has a timeout (default 30s, set via `.timeout(ms)`), and large outputs are compressed into a stored preview. See [Tool Result Compression](/guides/tools/execution-and-results/#tool-result-compression).

## Where to go next

- [Tools guide](/guides/tools/) — built-in tools, the Conductor's Suite meta-tools, all four MCP transports, Docker-based servers, and result compression in depth.
- [Quickstart](/guides/quickstart/) — build and run your first agent in five minutes.
- [Choosing strategies](/guides/choosing-strategies/) — ReAct vs Plan-Execute vs Reflexion for tool-heavy work.
