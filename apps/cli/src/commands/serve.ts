import { ReactiveAgents } from "@reactive-agents/runtime";

const VALID_PROVIDERS = ["anthropic", "openai", "ollama", "gemini", "litellm", "test"] as const;
type Provider = (typeof VALID_PROVIDERS)[number];

function isValidProvider(value: string): value is Provider {
  return (VALID_PROVIDERS as readonly string[]).includes(value);
}

const HELP = `
  Usage: rax serve [options]

  Start an agent as an A2A server

  Options:
    --port <number>      Port for A2A server (default: 3000)
    --name <string>     Agent name (default: "agent")
    --provider <name>   LLM provider: anthropic|openai|ollama|gemini|litellm|test (default: test)
    --model <string>    Model name
    --with-tools        Enable tools
    --with-reasoning    Enable reasoning strategies
    --with-memory [n]   Enable memory (tier 1 or 2; default: 2)
    --help              Show this help
`.trimEnd();

export function runServe(argv: string[]) {
  const args = argv.slice();

  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return;
  }

  let port = 3000;
  let name = "agent";
  let provider: Provider = "test";
  let model: string | undefined;
  let withTools = false;
  let withReasoning = false;
  let memoryTier: "1" | "2" | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--port":
        port = parseInt(args[++i], 10);
        break;
      case "--name":
        name = args[++i];
        break;
      case "--provider":
        if (!args[i + 1]) {
          console.error("Missing value for --provider");
          process.exit(1);
        }
        {
          const raw = args[++i];
          if (!isValidProvider(raw)) {
            console.error(`Unknown provider: \"${raw}\". Valid providers: ${VALID_PROVIDERS.join(", ")}`);
            process.exit(1);
          }
          provider = raw;
        }
        break;
      case "--model":
        model = args[++i];
        break;
      case "--with-tools":
        withTools = true;
        break;
      case "--with-reasoning":
        withReasoning = true;
        break;
      case "--with-memory":
        if (args[i + 1] === "1" || args[i + 1] === "2") {
          memoryTier = args[++i] as "1" | "2";
        } else {
          memoryTier = "2";
        }
        break;
    }
  }

  console.log(`Starting A2A server: ${name}`);
  console.log(`Port: ${port}`);
  console.log(`Provider: ${provider}${model ? ` (${model})` : ""}`);
  console.log(`Tools: ${withTools ? "enabled" : "disabled"}`);
  console.log(`Reasoning: ${withReasoning ? "enabled" : "disabled"}`);
  console.log(`Memory: ${memoryTier ? `tier ${memoryTier}` : "disabled"}`);

  let builder = ReactiveAgents.create()
    .withName(name)
    .withProvider(provider)
    .withModel(model ?? "test")
    .withA2A({ port });

  if (withTools) builder = builder.withTools();
  if (withReasoning) builder = builder.withReasoning();
  if (memoryTier) builder = builder.withMemory(memoryTier);

  // Build the agent and start HTTP server
  startServer(builder.build(), name, port);
}

async function startServer(
  agentPromise: Promise<InstanceType<typeof Object>>,
  name: string,
  port: number,
) {
  let agent: any;
  try {
    agent = await agentPromise;
  } catch (err) {
    console.error("Failed to build agent:", err);
    process.exit(1);
  }

  // Lazy import to avoid top-level module resolution failures in tests
  const { generateAgentCard } = await import("@reactive-agents/a2a");

  // Generate the agent card for discovery
  const agentCard = generateAgentCard({
    name,
    description: `A2A agent: ${name}`,
    url: `http://localhost:${port}`,
  });

  // Task store for tracking in-flight tasks
  const tasks = new Map<string, { id: string; status: { state: string; message?: string; timestamp: string }; result?: unknown }>();

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      // GET /.well-known/agent.json — A2A Agent Card discovery
      if (req.method === "GET" && (url.pathname === "/.well-known/agent.json" || url.pathname === "/agent/card")) {
        return Response.json(agentCard);
      }

      // POST / — JSON-RPC handler
      if (req.method === "POST" && url.pathname === "/") {
        let body: any;
        try {
          body = await req.json();
        } catch {
          return Response.json({
            jsonrpc: "2.0",
            error: { code: -32700, message: "Parse error" },
            id: null,
          });
        }

        const { method, params, id } = body;

        switch (method) {
          case "agent/card": {
            return Response.json({ jsonrpc: "2.0", result: agentCard, id });
          }

          case "message/send": {
            const taskId = crypto.randomUUID();
            const message = params?.message;
            const textPart = message?.parts?.find((p: any) => p.kind === "text");
            const input = textPart?.text ?? JSON.stringify(params);

            tasks.set(taskId, {
              id: taskId,
              status: { state: "working", timestamp: new Date().toISOString() },
            });

            // Run the agent asynchronously, update task on completion
            agent.run(input).then(
              (result: any) => {
                tasks.set(taskId, {
                  id: taskId,
                  status: { state: "completed", timestamp: new Date().toISOString() },
                  result: result.output ?? result,
                });
              },
              (err: any) => {
                tasks.set(taskId, {
                  id: taskId,
                  status: {
                    state: "failed",
                    message: err?.message ?? String(err),
                    timestamp: new Date().toISOString(),
                  },
                });
              },
            );

            return Response.json({
              jsonrpc: "2.0",
              result: { taskId },
              id,
            });
          }

          case "tasks/get": {
            const taskId = params?.id;
            const task = tasks.get(taskId);
            if (!task) {
              return Response.json({
                jsonrpc: "2.0",
                error: { code: -32000, message: `Task not found: ${taskId}` },
                id,
              });
            }
            return Response.json({ jsonrpc: "2.0", result: task, id });
          }

          case "tasks/cancel": {
            const taskId = params?.id;
            const task = tasks.get(taskId);
            if (!task) {
              return Response.json({
                jsonrpc: "2.0",
                error: { code: -32000, message: `Task not found: ${taskId}` },
                id,
              });
            }
            if (["completed", "failed", "canceled"].includes(task.status.state)) {
              return Response.json({
                jsonrpc: "2.0",
                error: { code: -32001, message: `Cannot cancel task in state: ${task.status.state}` },
                id,
              });
            }
            task.status = { state: "canceled", message: "Canceled by user", timestamp: new Date().toISOString() };
            try {
              await agent.cancel(taskId);
            } catch {
              // Best-effort cancel
            }
            return Response.json({ jsonrpc: "2.0", result: task, id });
          }

          default:
            return Response.json({
              jsonrpc: "2.0",
              error: { code: -32601, message: `Method not found: ${method}` },
              id,
            });
        }
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  console.log(`\nA2A server ready! Agent Card available at http://localhost:${port}/.well-known/agent.json`);
  console.log(`JSON-RPC endpoint: http://localhost:${port}/`);
  console.log("Use Ctrl+C to stop");

  // Keep the process alive
  process.on("SIGINT", () => {
    console.log("\nShutting down A2A server...");
    server.stop(true);
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    server.stop(true);
    process.exit(0);
  });
}
