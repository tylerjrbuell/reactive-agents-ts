import { ReactiveAgents, agentConfigToJSON, agentConfigFromJSON, agentFn, pipe, parallel, race } from "reactive-agents";
import { Effect } from "effect";

// ─── Mode toggle ───
// "solo"     — agent handles everything directly (no sub-agents)
// "delegate" — agent can spawn sub-agents for subtasks
const MODE = "solo" as "solo" | "delegate";

// ─── Provider-aware time budget multipliers ───
// Cloud providers (anthropic/openai/gemini) run at 1×.
// Local inference (ollama) gets 3× headroom; LiteLLM 1.5×.
const TIME_MULTIPLIER: Record<string, number> = {
  anthropic: 1.0,
  openai: 1.0,
  gemini: 1.0,
  ollama: 3.0,
  litellm: 1.5,
};

// ─── Timing helpers ───
function timingResult(
  label: string,
  durationMs: number,
  provider: string,
  maxExpectedMs: number,
): void {
  const multiplier = TIME_MULTIPLIER[provider] ?? 1.0;
  const adjustedMax = maxExpectedMs * multiplier;
  const withinBudget = durationMs <= adjustedMax;
  const status = withinBudget ? "PASS" : "FAIL";
  console.log(
    `  [timing] ${label}: ${durationMs}ms` +
    ` | budget: ${maxExpectedMs}ms × ${multiplier} = ${adjustedMax}ms` +
    ` | ${status}`,
  );
}

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

// Active provider — update this when switching providers above.
const ACTIVE_PROVIDER = "ollama";

let builder = ReactiveAgents.create()
  .withName("test-agent")
  // .withProvider('gemini')
  .withProvider("ollama")
  .withModel("cogito")
  .withMCP(mcpServers)
  .withTools({ adaptive: true })
  .withReasoning({ defaultStrategy: "adaptive", enableStrategySwitching: true, adaptive: {
    enabled: true,
    learning:  true
  } })
  .withObservability({ verbosity: "verbose", live: true, logModelIO: false })
  .withRequiredTools({ adaptive: true })
  .withMemory({ tier: "enhanced", dbPath: "./memory-db" })
  .withMemoryConsolidation({
    threshold: 5,       // Trigger consolidation after 5 new episodic entries
    decayFactor: 0.95,   // Multiply importance × 0.95 each cycle
    pruneThreshold: 0.1, // Remove entries with importance < 0.1
  })
  .withReactiveIntelligence()

if (MODE === "delegate") {
  builder = builder.withDynamicSubAgents();
}

const agent = await builder.build();
agent.subscribe((event) => {
  if (event._tag === "EntropyScored") {
    console.log(`\n--- EVENT: ${event._tag} ---`);
    console.log(JSON.stringify(event, null, 2));
  }
});

const prompt = MODE === "delegate"
  ? `Delegate subagents to fetch the latest commits from the following GitHub repository: tylerjrbuell/reactive-agents-ts, summarize them, then send me a Signal message with the summary to ${process.env.SIGNAL_PHONE_NUMBER}.`
  : `Fetch the latest 5 commits from the GitHub repository tylerjrbuell/reactive-agents-ts, summarize them, then send me a Signal message with the summary to ${process.env.SIGNAL_PHONE_NUMBER}.`;

console.log(`\n🧪 Running in ${MODE.toUpperCase()} mode\n`);
const _t0 = Date.now();
const result = await agent.run(prompt);
const _mainDurationMs = Date.now() - _t0;

console.log("\n═══════════════════════════════════════");
console.log("📊 RESULT");
console.log("═══════════════════════════════════════");
console.log(result);
timingResult("main agent.run()", _mainDurationMs, ACTIVE_PROVIDER, 60_000);

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

// ═══════════════════════════════════════════════════════════════════
// 🆕 Framework Evolution Features
// ═══════════════════════════════════════════════════════════════════

// ─── Agent as Data: serialize → store → reconstruct ───
console.log("\n═══════════════════════════════════════");
console.log("💾 AGENT AS DATA (AgentConfig)");
console.log("═══════════════════════════════════════");

// Capture the full agent config from the builder we already set up
const config = builder.toConfig();
console.log(`Config name: ${config.name}`);
console.log(`Config provider: ${config.provider}`);
console.log(`Config model: ${config.model}`);
console.log(`Reasoning: ${JSON.stringify(config.reasoning)}`);
console.log(`Memory tier: ${config.memory?.tier}`);

// Roundtrip: config → JSON → config → verify nothing lost
const json = agentConfigToJSON(config);
const roundtripped = agentConfigFromJSON(json);
console.log(`\nJSON size: ${json.length} bytes`);
console.log(`Roundtrip name match: ${roundtripped.name === config.name}`);
console.log(`Roundtrip provider match: ${roundtripped.provider === config.provider}`);
console.log(`Roundtrip model match: ${roundtripped.model === config.model}`);
console.log(`Roundtrip memory tier match: ${roundtripped.memory?.tier === config.memory?.tier}`);

// Reconstruct a fully configured builder from JSON (like loading from a DB)
const restored = await ReactiveAgents.fromJSON(json);
const restoredAgent = await restored
  .withProvider("ollama")
  .withModel("cogito")
  .build();
const _tRestore0 = Date.now();
const restoredResult = await restoredAgent.run("What can you do?");
const _restoreDurationMs = Date.now() - _tRestore0;
console.log(`\nRestored agent output: ${restoredResult.output}`);
timingResult("restored agent.run()", _restoreDurationMs, ACTIVE_PROVIDER, 20_000);
await restoredAgent.dispose();

// ─── Dynamic Tool Registration ───
console.log("\n═══════════════════════════════════════");
console.log("🔧 DYNAMIC TOOL REGISTRATION");
console.log("═══════════════════════════════════════");

const toolAgent = await ReactiveAgents.create()
  .withName("dynamic-tools-agent")
  .withProvider("ollama")
  .withModel("cogito")
  .withReasoning()
  .withTools()
  .withObservability({ verbosity: "normal", live: true })
  .build();

// Hot-plug a custom tool into the running agent
await toolAgent.registerTool(
  {
    name: "project_status",
    description: "Get the current status of a project by name. Returns a JSON summary with health, open issues, and last deploy time.",
    parameters: [
      { name: "project", type: "string", description: "Project name", required: true },
    ],
    riskLevel: "low",
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function",
  },
  (args: Record<string, unknown>) =>
    Effect.succeed(JSON.stringify({
      project: args.project,
      health: "healthy",
      openIssues: 3,
      lastDeploy: "2026-03-18T09:15:00Z",
      uptime: "99.97%",
    })),
);

// Register another one — simulate a live integration endpoint
await toolAgent.registerTool(
  {
    name: "team_oncall",
    description: "Get who is currently on-call for a team. Returns the on-call engineer's name and contact.",
    parameters: [
      { name: "team", type: "string", description: "Team name", required: true },
    ],
    riskLevel: "low",
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function",
  },
  (args: Record<string, unknown>) =>
    Effect.succeed(JSON.stringify({
      team: args.team,
      oncall: "Jordan Chen",
      role: "Senior SRE",
      shift: "2026-03-18 06:00 – 18:00 UTC",
    })),
);

console.log("Registered 2 dynamic tools: project_status, team_oncall");

const _tTool0 = Date.now();
const toolResult = await toolAgent.run(
  "Check the status of the 'reactive-agents' project and tell me who is on-call for the platform team. Summarize both."
);
const _toolDurationMs = Date.now() - _tTool0;
console.log(`\nDynamic tools result: ${toolResult.output}`);
console.log(`Steps: ${toolResult.metadata?.stepsCount}, Tokens: ${toolResult.metadata?.tokensUsed}`);
timingResult("dynamic-tools agent.run()", _toolDurationMs, ACTIVE_PROVIDER, 30_000);

// Clean up — unregister the tools
await toolAgent.unregisterTool("project_status");
await toolAgent.unregisterTool("team_oncall");
console.log("Unregistered both tools. Agent is still running but tools are gone.");
await toolAgent.dispose();

// ─── Composition: pipe, parallel, race ───
console.log("\n═══════════════════════════════════════");
console.log("🔗 COMPOSITION API (pipe / parallel / race)");
console.log("═══════════════════════════════════════");

const provider = "ollama" as const;
const model = "cogito";

// pipe: research → summarize chain
console.log("\n--- pipe: sequential chain ---");
const researcher = agentFn(
  { name: "researcher", provider, model, reasoning: { defaultStrategy: "reactive" } },
  (b) => b.withTools({ adaptive: true }).withMCP(mcpServers),
);
const summarizer = agentFn(
  { name: "summarizer", provider, model },
);

const researchPipeline = pipe(researcher, summarizer);
const _tPipe0 = Date.now();
const pipeResult = await researchPipeline(
  "Find the 3 most recent commits on tylerjrbuell/reactive-agents-ts and list them with their messages."
);
const _pipeDurationMs = Date.now() - _tPipe0;
console.log(`Pipeline output:\n${pipeResult.output}`);
console.log(`Success: ${pipeResult.success}`);
timingResult("pipe composition", _pipeDurationMs, ACTIVE_PROVIDER, 90_000);

// parallel: multi-perspective analysis
console.log("\n--- parallel: concurrent analysis ---");
const technicalReview = agentFn(
  { name: "technical-review", provider, model },
  (b) => b.withSystemPrompt("You are a senior engineer. Analyze the input from a technical architecture perspective. Be concise — 2-3 sentences max."),
);
const userImpact = agentFn(
  { name: "user-impact", provider, model },
  (b) => b.withSystemPrompt("You are a product manager. Analyze the input from an end-user impact perspective. Be concise — 2-3 sentences max."),
);
const securityAudit = agentFn(
  { name: "security-audit", provider, model },
  (b) => b.withSystemPrompt("You are a security engineer. Analyze the input for security implications. Be concise — 2-3 sentences max."),
);

const multiPerspective = parallel(technicalReview, userImpact, securityAudit);
const _tParallel0 = Date.now();
const parallelResult = await multiPerspective(
  `New feature: AgentConfig serialization allows agents to be defined as JSON, stored in databases, and reconstructed at runtime. Includes roundtrip validation via Effect-TS Schema.`
);
const _parallelDurationMs = Date.now() - _tParallel0;
console.log(`\nParallel output (3 perspectives):\n${parallelResult.output}`);
console.log(`All succeeded: ${parallelResult.success}`);
timingResult("parallel composition", _parallelDurationMs, ACTIVE_PROVIDER, 45_000);

// race: fastest model wins
console.log("\n--- race: first to finish wins ---");
const quickThinker = agentFn(
  { name: "quick-thinker", provider, model },
  (b) => b.withSystemPrompt("Answer in one sentence. Be extremely brief.").withMaxIterations(3),
);
const deepThinker = agentFn(
  { name: "deep-thinker", provider, model },
  (b) => b.withSystemPrompt("Give a thorough, detailed answer with examples.").withMaxIterations(5),
);

const fastest = race(quickThinker, deepThinker);
const _tRace0 = Date.now();
const raceResult = await fastest("What is the single most important principle in software architecture?");
const _raceDurationMs = Date.now() - _tRace0;
console.log(`Race winner: ${raceResult.output}`);
timingResult("race composition", _raceDurationMs, ACTIVE_PROVIDER, 30_000);

// Dispose all composition agents
await researchPipeline.dispose();
await multiPerspective.dispose();
await fastest.dispose();

console.log("\n═══════════════════════════════════════");
console.log("✅ ALL FRAMEWORK EVOLUTION TESTS COMPLETE");
console.log("═══════════════════════════════════════");