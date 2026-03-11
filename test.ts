import { ReactiveAgents } from "reactive-agents";

// ─── Mode toggle ───
// "solo"     — agent handles everything directly (no sub-agents)
// "delegate" — agent can spawn sub-agents for subtasks
const MODE = "solo" as "solo" | "delegate";

const mcpServers = [{
  name: "signal",
  transport: "stdio" as const,
  command: "docker",
  args: [
    "run", "-i", "--rm", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges", "--memory", "512m",
    "-v", "./signal-data:/data:rw",
    "-e", `SIGNAL_USER_ID=${process.env.SIGNAL_PHONE_NUMBER}`,
    "signal-mcp:local",
  ],
}, {
  name: "github",
  transport: "stdio" as const,
  command: "docker",
  args: [
    "run", "-i", "--rm",
    "-e", "GITHUB_PERSONAL_ACCESS_TOKEN",
    "ghcr.io/github/github-mcp-server",
  ],
  env: {
    GITHUB_PERSONAL_ACCESS_TOKEN:
      process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? "",
  },
}];

let builder = ReactiveAgents.create()
  .withName("test-agent")
  // .withProvider('gemini')
  .withProvider("ollama")
  .withModel("cogito:14b")
  .withMCP(mcpServers)
  .withTools({ adaptive: true })
  .withReasoning({ defaultStrategy: "reactive" })
  .withObservability({ verbosity: "verbose", live: true, logModelIO: false })
  .withRequiredTools({ adaptive: true })
  .withMemory({ tier: "enhanced", dbPath: "./memory-db" })
  .withMemoryConsolidation({
    threshold: 5,       // Trigger consolidation after 5 new episodic entries
    decayFactor: 0.95,   // Multiply importance × 0.95 each cycle
    pruneThreshold: 0.1, // Remove entries with importance < 0.1
  })

if (MODE === "delegate") {
  builder = builder.withDynamicSubAgents();
}

const agent = await builder.build();

const prompt = MODE === "delegate"
  ? `Delegate subagents to fetch the latest commits from the following GitHub repository: tylerjrbuell/reactive-agents-ts, summarize them, then send me a Signal message with the summary to ${process.env.SIGNAL_PHONE_NUMBER}.`
  : `Fetch the latest 5 commits from the GitHub repository tylerjrbuell/reactive-agents-ts, summarize them, then send me a Signal message with the summary to ${process.env.SIGNAL_PHONE_NUMBER}.`;

console.log(`\n🧪 Running in ${MODE.toUpperCase()} mode\n`);
const result = await agent.run(prompt);

console.log("\n═══════════════════════════════════════");
console.log("📊 RESULT");
console.log("═══════════════════════════════════════");
console.log(result);

// ─── Test v0.8.0 Features ───
if (result.debrief) {
  console.log("\n═══════════════════════════════════════");
  console.log("📋 DEBRIEF (v0.8.0)");
  console.log("═══════════════════════════════════════");
  console.log(`Outcome: ${result.debrief.outcome}`);
  console.log(`Confidence: ${result.debrief.confidence}`);
  console.log(`Summary: ${result.debrief.summary}`);
  console.log(`Tools Used: ${result.debrief.toolsUsed.map(t => t.name).join(", ")}`);
  console.log(`Key Findings: ${result.debrief.keyFindings.join(" | ")}`);
}

if (result.format) {
  console.log(`\nOutput Format: ${result.format}`);
}

if (result.terminatedBy) {
  console.log(`Terminated By: ${result.terminatedBy}`);
}

// ─── Test agent.chat() and agent.session() ───
console.log("\n═══════════════════════════════════════");
console.log("💬 TESTING CHAT & SESSION (v0.8.0)");
console.log("═══════════════════════════════════════");

try {
  const chatReply = await agent.chat("What did you accomplish in the last run?");
  console.log(`\nDirect Chat Reply: ${chatReply.message}`);

  const session = agent.session();
  const s1 = await session.chat("Tell me about the commits you found");
  console.log(`\nSession Turn 1: ${s1.message}`);

  const s2 = await session.chat("Which one was most important?");
  console.log(`Session Turn 2: ${s2.message}`);

  const history = session.history();
  console.log(`\nSession History: ${history.length} entries`);

  await session.end();
  console.log("Session ended");
} catch (err) {
  console.log(`⚠️  Chat test skipped (expected if no memory/reasoning): ${(err as Error).message}`);
}

await agent.dispose();