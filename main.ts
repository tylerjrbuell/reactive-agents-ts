import { ReactiveAgents } from "reactive-agents";

// ─── Test all 4 improved reasoning strategies ─────────────────────────────────

// Strategy 1: Plan-Execute — tests context compaction + synthesis
console.log("\n=== PLAN-EXECUTE ===");
await using agent1 = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("cogito:14b")
  .withName("plan-execute-agent")
  .withReasoning({ defaultStrategy: "plan-execute-reflect" })
  .withObservability({ verbosity: "normal", live: true })
  .build();

const r1 = await agent1.run("Explain the water cycle in 3 clear steps");
console.log("plan-execute result:", r1);

// Strategy 2: Reflexion — tests stagnation detection + bounded critiques
console.log("\n=== REFLEXION ===");
await using agent2 = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("cogito:14b")
  .withName("reflexion-agent")
  .withReasoning({ defaultStrategy: "reflexion" })
  .withObservability({ verbosity: "normal", live: true })
  .build();

const r2 = await agent2.run("Explain what makes a good API design in 2-3 sentences");
console.log("reflexion result:", r2);

// Strategy 3: Tree-of-Thought — tests score parsing + adaptive pruning
console.log("\n=== TREE-OF-THOUGHT ===");
await using agent3 = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("cogito:14b")
  .withName("tot-agent")
  .withReasoning({ defaultStrategy: "tree-of-thought" })
  .withObservability({ verbosity: "normal", live: true })
  .build();

const r3 = await agent3.run("What are 3 different approaches to caching in a web app?");
console.log("tree-of-thought result:", r3);

// Strategy 4: Adaptive — tests classification + fallback
console.log("\n=== ADAPTIVE ===");
await using agent4 = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("cogito:14b")
  .withName("adaptive-agent")
  .withReasoning({ defaultStrategy: "adaptive" })
  .withObservability({ verbosity: "normal", live: true })
  .build();

const r4 = await agent4.run("What is the capital of Japan?");
console.log("adaptive result:", r4);
