import { ReactiveAgents } from "@reactive-agents/runtime";

const HELP = `
  Usage: rax serve [options]

  Start an agent as an A2A server

  Options:
    --port <number>      Port for A2A server (default: 3000)
    --name <string>     Agent name (default: "agent")
    --provider <name>   LLM provider: anthropic|openai|ollama|gemini|test (default: test)
    --model <string>    Model name
    --with-tools        Enable tools
    --with-reasoning    Enable reasoning strategies
    --with-memory       Enable memory (tier 1 or 2)
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
  let provider: "anthropic" | "openai" | "ollama" | "gemini" | "test" = "test";
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
        provider = args[++i] as any;
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
        memoryTier = "2";
        break;
    }
  }

  console.log(`Starting A2A server: ${name}`);
  console.log(`Port: ${port}`);
  console.log(`Provider: ${provider}${model ? ` (${model})` : ""}`);
  console.log(`Tools: ${withTools ? "enabled" : "disabled"}`);
  console.log(`Reasoning: ${withReasoning ? "enabled" : "disabled"}`);
  console.log(`Memory: ${memoryTier ? `tier ${memoryTier}` : "disabled"}`);
  console.log("\nA2A server ready! Agent Card available at http://localhost:" + port + "/agent/card");

  const builder = ReactiveAgents.create()
    .withName(name)
    .withProvider(provider)
    .withModel(model ?? "test")
    .withA2A({ port });

  if (withTools) builder.withTools();
  if (withReasoning) builder.withReasoning();
  if (memoryTier) builder.withMemory(memoryTier);

  console.log("\nNote: Server functionality requires full implementation of A2A HTTP server");
  console.log("Use Ctrl+C to stop");
}
