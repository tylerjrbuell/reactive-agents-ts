/**
 * p-island-decision - THROWAWAY judgment probe.
 *
 * Tests `agent.judge()` as the island agent's action-selection primitive:
 *   - `jev` backend (TypeSafe Jev / System One) via TYPESAFE_API_KEY
 *   - `llm` backend emulated over a local Ollama model
 *
 * Run:
 *   bun run wiki/Research/Prototypes/p-island-decision/probe-judgment.ts
 */
import { ReactiveAgents } from "reactive-agents";

const ACTIONS = {
  move: "travel to an adjacent tile",
  gather: "collect a resource where you stand",
  hunt: "hunt an animal for food",
  build: "construct a structure",
  craft: "craft a tool from inventory",
  eat: "eat food from inventory",
  drink: "drink from a water source",
  rest: "rest to recover energy",
  trade: "exchange goods with a nearby agent",
  share: "give goods to a nearby agent",
  talk: "speak with a nearby agent",
  inspect: "examine your surroundings",
};

const STATE = {
  self: { name: "Mira", hunger: 7, thirst: 4, energy: 6, inventory: ["spear"] },
  location: "C6 (west beach)",
  visible: {
    nearby: "berry cluster 1 tile east",
    agents: [{ name: "Kell", tile: "C8", carrying: "full waterskin" }],
  },
  recentMemory: ["tick 1: spotted berries to the east"],
};

const QUESTIONS = {
  action: {
    type: "choice" as const,
    instructions: "Given Mira's state, which single action should she take this tick?",
    criteria: ACTIONS,
  },
  target: {
    type: "choice" as const,
    instructions: "What is the target of that action?",
    criteria: {
      berries: "the berry cluster to the east",
      kell: "the other agent, Kell",
      stream: "the freshwater stream",
      self: "Mira herself / no external target",
      unknown: "nothing visible / survey",
    },
  },
  urgency: {
    type: "score" as const,
    instructions: "How urgent is this action for Mira's survival?",
    criteria: ["trivial", "low", "moderate", "high", "critical"],
  },
};

type Backend = "jev" | "llm";

async function runOne(backend: Backend, provider: "ollama" | "test", model?: string) {
  console.log(`\n=== backend=${backend} provider=${provider}${model ? ` model=${model}` : ""} ===`);
  let b = ReactiveAgents.create()
    .withName(`island-judge-${backend}`)
    .withProvider(provider)
    .withReactiveIntelligence({ telemetry: false })
    .withReasoning({ maxIterations: 1, defaultStrategy: "reactive" })
    .withJudgment({ backend });
  if (model) b = b.withModel(model);
  if (provider === "test") {
    b = b.withTestScenario([{ text: "FINAL ANSWER: done" }]);
  }
  const agent = await b.build();
  try {
    try {
      const models = await agent.listJudgmentModels();
      console.log("models:", models.map((m) => m.name).join(", ").slice(0, 300));
    } catch (err) {
      console.log("listModels unavailable:", (err as Error).message.slice(0, 120));
    }

    const t0 = Date.now();
    const answers = await agent.judge({ state: STATE, questions: QUESTIONS });
    const ms = Date.now() - t0;
    for (const [id, a] of Object.entries(answers)) {
      if (a.kind === "choice") {
        console.log(
          `${id}: choice="${a.value}" conf=${a.confidence.toFixed(2)} calibrated=${a.calibrated} top=${Object.entries(a.probabilities)
            .sort((x, y) => y[1] - x[1])
            .slice(0, 3)
            .map(([k, v]) => `${k}:${v.toFixed(2)}`)
            .join(" ")}`,
        );
      } else if (a.kind === "score") {
        console.log(
          `${id}: score=${a.value.toFixed(2)} conf=${a.confidence.toFixed(2)} calibrated=${a.calibrated}`,
        );
      } else {
        console.log(`${id}: noul prob=${a.probability.toFixed(2)}`);
      }
    }
    console.log(`latency: ${ms}ms`);
  } catch (err) {
    console.log("judge failed:", (err as Error).message.slice(0, 200));
  } finally {
    await agent.dispose();
  }
}

if (import.meta.main) {
  await runOne("jev", "ollama", "qwen3:4b");
  await runOne("llm", "ollama", "nimble:latest");
}
