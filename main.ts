import { ReactiveAgents } from "reactive-agents";

// ─── Option A: await using (auto-dispose on scope exit) ───────────────────────
await using agent = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("cogito:14b")
  .withMCP({
    name: "github",
    transport: "stdio",
    command: "docker",
    args: [
      "run",
      "-i",
      "--rm",
      "-e",
      "GITHUB_PERSONAL_ACCESS_TOKEN",
      "ghcr.io/github/github-mcp-server",
    ],
    env: {
      GITHUB_PERSONAL_ACCESS_TOKEN:
        process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? "",
    },
  })
  .withName("my-agent")
  .withReasoning({ defaultStrategy: "tree-of-thought" })
  .withObservability({ verbosity: "debug", live: true })
  .build();

const result = await agent.run("Get the recent commits for reactive-agents-ts");
console.log(result);
// agent.dispose() is called automatically here

// ─── Option B: runOnce (build + run + dispose in one call) ────────────────────
// const result = await ReactiveAgents.create()
//   .withProvider("ollama")
//   .withModel("cogito:14b")
//   .withMCP({ name: "filesystem", transport: "stdio", command: "bunx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] })
//   .withName("my-agent")
//   .withReasoning()
//   .withObservability({ verbosity: "debug", live: true })
//   .runOnce("What files or directories are available? Give a brief summary.");
// console.log(result);
