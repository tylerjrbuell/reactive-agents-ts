import { ReactiveAgents } from "reactive-agents";

// ─── Persistent Gateway Agent with Signal ───────────────────────────────────
// Sends a ping every 2 minutes on Sundays via Signal MCP.
// Stays alive until SIGINT/SIGTERM.

const agent = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("cogito:14b")
  .withPersona({
    role: "Software Engineer Assistant",
    instructions: "Always explain your reasoning step by step",
    tone: "professional and concise",
  })
  .withGateway({
    heartbeat: { intervalMs: 120_000, policy: "adaptive" },
    crons: [
      {
        schedule: "*/30 * * * 0", // Every 30 minutes on Sundays
        instruction:
          "Fetch and summarize the last 5 commits on the reactive-agents-ts repo using the github mcp and send a formatted message to +12693310593",
      },
    ],
    policies: { dailyTokenBudget: 50_000, maxActionsPerHour: 60 },
    channels: {
      accessPolicy: "allowlist",
      allowedSenders: ["+12693310593"],
      unknownSenderAction: "skip",
    },
  })
  .withMCP({
    name: "signal",
    transport: "stdio",
    command: "docker",
    args: [
      "run",
      "-i",
      "--rm",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--memory",
      "512m",
      "-v",
      "./signal-data:/data:rw",
      "-e",
      `SIGNAL_USER_ID=${process.env.SIGNAL_PHONE_NUMBER}`,
      "signal-mcp:local",
    ],
  })
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
  .withTools()
  .withName("gateway-agent")
  .withReasoning({ defaultStrategy: "reactive" })
  .withObservability({ verbosity: "debug", live: true })
  .build();

// Start the persistent gateway loop
const handle = agent.start();

console.log("Gateway agent started. Press Ctrl+C to stop.");

// Graceful shutdown on SIGINT/SIGTERM
let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\nShutting down gateway...");
  const summary = await handle.stop();
  console.log(
    `Gateway stopped: ${summary.totalRuns} runs, ${summary.heartbeatsFired} heartbeats`,
  );
  await agent.dispose();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Keep alive until stopped
await handle.done;
