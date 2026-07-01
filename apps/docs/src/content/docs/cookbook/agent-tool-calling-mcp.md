---
title: Build an AI Agent with Tool Calling and MCP in TypeScript
description: >-
  A hands-on TypeScript tutorial for building an AI agent with function calling
  and Model Context Protocol (MCP). Define your own tools with the ToolBuilder
  API, plug in MCP servers over stdio and streamable-http, and run the same code
  on local and frontier models.
sidebar:
  order: 31
badge:
  text: New in v0.12
  variant: success
  __auto: '1'
lastCommit:
  subject: >-
    docs(accuracy): fix strategy IDs, withModelRouting section, sub-package
    import
  hash: 1216d5f
  date: '2026-07-01'
since: v0.12
---

Tools are how an AI agent stops talking and starts *acting* — searching the web, reading files, hitting an API, querying a database. A language model on its own can only produce text; tool calling (a.k.a. function calling) is what lets it choose an action, hand you structured arguments, and use the real result to decide what to do next.

In Reactive Agents there are two ways to give a TypeScript agent tools, and you can mix them freely in one agent:

1. **Define your own tools** — wrap any function with the `ToolBuilder` fluent API (or a raw schema object).
2. **Plug in MCP servers** — connect any [Model Context Protocol](https://modelcontextprotocol.io/) server (filesystem, GitHub, Stripe, a database, your own) and its tools appear in the agent's registry automatically.

This guide walks through both, end to end. Install first:

```bash
bun add reactive-agents
# Node.js 22.5+: npm install reactive-agents
```

## Step 1 — An agent with one custom tool

The fastest way to define a tool is `ToolBuilder`. You give it a name, a description (the model reads this to decide when to call it), typed parameters, and a `handler` that returns an Effect. Pass the finished tool to `.withTools({ tools: [...] })`.

```typescript
import { ReactiveAgents } from "reactive-agents";
import { ToolBuilder } from "@reactive-agents/tools";
import { Effect } from "effect";

const weatherTool = ToolBuilder.create("get_weather")
  .description("Get the current weather for a city")
  .param("city", "string", "City name, e.g. 'Tokyo'", { required: true })
  .riskLevel("low")
  .timeout(10_000)
  .handler((args) =>
    Effect.tryPromise(async () => {
      const res = await fetch(
        `https://wttr.in/${encodeURIComponent(String(args.city))}?format=j1`,
      );
      const data = await res.json();
      const c = data.current_condition[0];
      return `${args.city}: ${c.temp_C}°C, ${c.weatherDesc[0].value}`;
    }),
  )
  .build();

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-6")
  .withReasoning() // enables the Think → Act → Observe (ReAct) loop
  .withTools({ tools: [weatherTool] })
  .build();

const result = await agent.run("What should I wear in Tokyo today?");
console.log(result.output);
```

What happens under the hood: `.withReasoning()` turns on the ReAct loop. The model sees `get_weather` in its tool list, emits a structured `tool_use` block with `{ city: "Tokyo" }`, the framework validates the arguments against your schema, runs your handler in a sandbox, feeds the real result back as a `tool_result`, and the model writes its final answer.

The handler returns an `Effect<string>`. Use `Effect.succeed(...)` for pure values, `Effect.try(...)` for synchronous code that can throw, and `Effect.tryPromise(...)` for async work — errors are caught and surfaced to the agent as an observation instead of crashing the run.

## Step 2 — The raw-schema tool form

`ToolBuilder` is sugar over a plain `{ definition, handler }` object. If you are generating tools dynamically or prefer explicit schemas, pass that shape directly:

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

You can pass an **array** to `.withMCP([...])`, or chain `.withMCP()` multiple times, to connect several servers at once — and combine them with `ToolBuilder` custom tools in the same agent. The model sees every tool uniformly and picks whichever it needs.

## Step 4 — Adaptive tool calling on local *and* frontier models

Not every model speaks the same function-calling dialect. Frontier APIs (Anthropic, OpenAI, Gemini) expose native structured `tool_use`/`tool_calls`; many local models only produce tool calls as text. Reactive Agents probes the active model's dialect and routes to either a native function-calling driver or a text-parsing driver (XML / JSON / pseudo-code) — so the *exact same agent code* runs against a frontier API or a 4B+ Ollama model with no changes:

```typescript
const localAgent = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("qwen3:4b")
  .withReasoning()
  .withTools({ tools: [weatherTool] }) // same tool, same builder
  .build();

const result = await localAgent.run("What's the weather in Tokyo?");
```

Swap `.withProvider("ollama")` for `.withProvider("anthropic")` and the tool, the handler, and the loop are identical. This is what makes the framework model-agnostic for tool use.

## Tips

- **Risk levels and approval.** Set `.riskLevel("high")` and `.requiresApproval(true)` on destructive tools (file writes, payments, deletes). When approval is required, the agent pauses for a human decision before the handler runs. The built-in `file-write` tool already requires approval by default.
- **Prevent runaway loops.** Parallel tool calls are capped at 3 simultaneous executions and 3 chained steps per phase, and side-effect tools (`create_*`, `delete_*`, `send_*`, …) are forced to run one at a time — so a confused model can't fan out destructively.
- **Force critical tools.** Use `.withRequiredTools({ tools: ["get_weather"], adaptive: true, maxRetries: 2 })` to guarantee a tool is called before the agent is allowed to answer.
- **Scope the surface.** `.withTools({ allowedTools: [...] })` is a hard allowlist (everything else is pruned before the model sees it); `.withTools({ focusedTools: [...] })` is soft guidance that highlights tools without blocking the rest. A tight `allowedTools` list also helps smaller models pick the right tool.
- **Tool timeouts and big results.** Every tool runs in a sandbox with a timeout (default 30s, set via `.timeout(ms)`). Large tool outputs are auto-compressed into a structured preview and stored, so a 31K-character API response won't blow up the context window.

## Where to go next

- [Tools guide](/guides/tools/) — built-in tools, the Conductor's Suite meta-tools, all four MCP transports, Docker-based servers, and result compression in depth.
- [Quickstart](/guides/quickstart/) — build and run your first agent in five minutes.
- [Choosing strategies](/guides/choosing-strategies/) — ReAct vs Plan-Execute vs Reflexion for tool-heavy work.
