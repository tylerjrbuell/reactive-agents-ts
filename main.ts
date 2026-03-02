import { ReactiveAgents } from "reactive-agents";

// ── Test 1: Reflexion — Strength task (pure analytical, no tools) ──
// Tests: iterative quality improvement, stagnation detection, critique depth
const agent1 = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("cogito:14b")
  .withReasoning({ defaultStrategy: "reflexion" })
  .withObservability({ verbosity: "normal", live: true })
  .build();

const r1 = await agent1.run(
  "Analyze the v0.5.5 reasoning strategy improvements (reflexion stagnation detection, " +
  "plan-execute context compaction, ToT score parsing, adaptive fallback) and write a " +
  "3-paragraph technical blog post explaining: what each problem was, the solution applied, " +
  "and why it matters for production agent quality.",
);
console.log("\n=== REFLEXION (strength) ===");
console.log("Status:", r1.status, "| Steps:", r1.metadata.stepsCount, "| Tokens:", r1.metadata.tokensUsed);
await agent1.dispose();

// ── Test 2: Reflexion — Tool task (GitHub MCP + iterative quality) ──
// Tests: new kernel integration — generation with tools, critique without, improve with tools
const agent2 = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("cogito:14b")
  .withMCP({
    name: "github",
    transport: "stdio",
    command: "docker",
    args: ["-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "ghcr.io/github/github-mcp-server"],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? "" },
  })
  .withTools()
  .withReasoning({ defaultStrategy: "reflexion" })
  .withObservability({ verbosity: "normal", live: true })
  .build();

const r2 = await agent2.run(
  "Using the GitHub tools, fetch the last 10 commits from tylerjrbuell/reactive-agents-ts. " +
  "Produce a structured release notes document with: commit categories (feat/fix/refactor/docs), " +
  "a 1-sentence summary per category, and any breaking changes. Self-critique and improve the format.",
);
console.log("\n=== REFLEXION (tools) ===");
console.log("Status:", r2.status, "| Steps:", r2.metadata.stepsCount, "| Tokens:", r2.metadata.tokensUsed);
await agent2.dispose();

// ── Test 3: Plan-Execute — Multi-step research task ──
// Tests: per-step kernel execution, synthesis quality, context compaction
const agent3 = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("cogito:14b")
  .withMCP({
    name: "github",
    transport: "stdio",
    command: "docker",
    args: ["-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "ghcr.io/github/github-mcp-server"],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? "" },
  })
  .withTools()
  .withReasoning({ defaultStrategy: "plan-execute" })
  .withObservability({ verbosity: "normal", live: true })
  .build();

const r3 = await agent3.run(
  "Create a 5-step implementation plan for the Docker sandboxing feature (v0.6.0). " +
  "For each step: (1) what to build, (2) which files to modify, (3) what tests to write, " +
  "(4) acceptance criteria. Use the GitHub MCP to check the current codebase structure first.",
);
console.log("\n=== PLAN-EXECUTE ===");
console.log("Status:", r3.status, "| Steps:", r3.metadata.stepsCount, "| Tokens:", r3.metadata.tokensUsed);
await agent3.dispose();

// ── Test 4: Tree-of-Thought — Architectural exploration ──
// Tests: Phase 1 BFS, score parsing, Phase 2 kernel execution
const agent4 = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("cogito:14b")
  .withReasoning({ defaultStrategy: "tree-of-thought" })
  .withObservability({ verbosity: "normal", live: true })
  .build();

const r4 = await agent4.run(
  "Design 3 different architectures for implementing voice agent support in the " +
  "reactive-agents-ts framework. For each: technical approach, tradeoffs, estimated " +
  "complexity (low/medium/high), and which existing packages would be extended. " +
  "Then recommend the best approach with justification.",
);
console.log("\n=== TREE-OF-THOUGHT ===");
console.log("Status:", r4.status, "| Steps:", r4.metadata.stepsCount, "| Tokens:", r4.metadata.tokensUsed);
await agent4.dispose();

console.log("\nAll 4 strategy live tests complete.");
