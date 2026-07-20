// One-shot: add npm `keywords` (+ `description` where missing) to published
// @reactive-agents/* packages for npm-search discoverability. Preserves key
// order by inserting after `description` (or `version` when none exists).
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";

const BASE = ["ai", "agents", "ai-agents", "llm", "effect-ts", "typescript"];

const SPEC: Record<string, { desc?: string; kw: string[] }> = {
  "@reactive-agents/a2a": {
    kw: ["a2a", "agent-to-agent", "agent-protocol", "json-rpc", "agent-card", "multi-agent", "sse"],
  },
  "@reactive-agents/channels": {
    kw: ["channels", "webhooks", "bot", "messaging", "gateway", "slack", "transport"],
  },
  "@reactive-agents/compose": {
    kw: ["composition", "harness", "killswitch", "builder", "agent-composition"],
  },
  "@reactive-agents/core": {
    kw: ["eventbus", "pubsub", "agent-lifecycle", "state-machine", "core"],
  },
  "@reactive-agents/cost": {
    kw: ["cost-tracking", "budget", "model-routing", "complexity-routing", "token-cost", "llm-cost"],
  },
  "@reactive-agents/diagnose": {
    desc: "Forensic CLI for recorded Reactive Agents traces — replay, grep, diff, and debrief agent runs",
    kw: ["tracing", "debugging", "forensics", "replay", "cli", "observability"],
  },
  "@reactive-agents/eval": {
    kw: ["evaluation", "llm-as-judge", "benchmark", "regression-testing", "scoring", "eval"],
  },
  "@reactive-agents/gateway": {
    desc: "Persistent autonomous gateway for Reactive Agents — adaptive heartbeats, cron scheduling, webhook ingestion, and policy engine",
    kw: ["gateway", "autonomous", "cron", "webhooks", "heartbeat", "scheduler"],
  },
  "@reactive-agents/guardrails": {
    kw: ["guardrails", "prompt-injection", "pii", "toxicity", "ai-safety", "llm-security"],
  },
  "@reactive-agents/health": {
    desc: "Health checks and readiness probes for Reactive Agents production deployments",
    kw: ["health-check", "readiness", "liveness", "probe", "production"],
  },
  "@reactive-agents/identity": {
    kw: ["identity", "rbac", "ed25519", "certificates", "access-control", "audit"],
  },
  "@reactive-agents/interaction": {
    kw: ["human-in-the-loop", "hitl", "approval", "autonomy", "checkpoint", "human-collaboration"],
  },
  "@reactive-agents/llm-provider": {
    kw: ["anthropic", "openai", "gemini", "ollama", "litellm", "claude", "gpt", "llm-provider", "function-calling"],
  },
  "@reactive-agents/memory": {
    kw: ["memory", "sqlite", "vector-search", "embeddings", "fts5", "rag", "semantic-memory", "agent-memory"],
  },
  "@reactive-agents/observability": {
    kw: ["observability", "tracing", "opentelemetry", "metrics", "logging", "otlp"],
  },
  "@reactive-agents/observe": {
    kw: ["opentelemetry", "openinference", "tracing", "otlp", "spans", "observability", "llm-observability"],
  },
  "@reactive-agents/orchestration": {
    kw: ["orchestration", "multi-agent", "workflow", "map-reduce", "pipeline", "agent-coordination"],
  },
  "@reactive-agents/prompts": {
    kw: ["prompts", "prompt-engineering", "templates", "prompt-management"],
  },
  "@reactive-agents/reactive-intelligence": {
    kw: ["metacognition", "entropy", "adaptive-control", "bandit", "self-improving", "reactive-intelligence"],
  },
  "@reactive-agents/react": {
    kw: ["react", "react-hooks", "useagent", "streaming", "ai-ui", "agent-ui"],
  },
  "@reactive-agents/reasoning": {
    kw: ["reasoning", "react", "reflexion", "plan-execute", "tree-of-thought", "chain-of-thought", "agent-reasoning"],
  },
  "@reactive-agents/replay": {
    kw: ["replay", "trace", "deterministic", "snapshot", "testing", "debugging"],
  },
  "@reactive-agents/runtime": {
    kw: ["runtime", "execution-engine", "builder", "agent-runtime"],
  },
  "@reactive-agents/runtime-shim": {
    kw: ["nodejs", "bun", "cross-runtime", "polyfill", "adapter"],
  },
  "@reactive-agents/svelte": {
    kw: ["svelte", "svelte-store", "stores", "streaming", "ai-ui", "agent-ui"],
  },
  "@reactive-agents/testing": {
    desc: "Testing utilities for Reactive Agents — mock services, assertion helpers, and deterministic fixtures",
    kw: ["testing", "mock", "test-fixtures", "deterministic", "assertions"],
  },
  "@reactive-agents/tools": {
    kw: ["tools", "mcp", "model-context-protocol", "function-calling", "tool-use", "sandbox"],
  },
  "@reactive-agents/trace": {
    desc: "Structured execution trace recording and inspection for Reactive Agents",
    kw: ["trace", "tracing", "jsonl", "observability", "debugging"],
  },
  "@reactive-agents/verification": {
    kw: ["verification", "hallucination-detection", "semantic-entropy", "fact-checking", "nli"],
  },
  "@reactive-agents/vue": {
    kw: ["vue", "vue3", "composables", "streaming", "ai-ui", "agent-ui"],
  },
};

let changed = 0;
for (const dir of readdirSync("packages")) {
  const path = `packages/${dir}/package.json`;
  if (!existsSync(path)) continue;
  const raw = readFileSync(path, "utf-8");
  const pkg = JSON.parse(raw);
  if (pkg.private) continue;
  if (Array.isArray(pkg.keywords) && pkg.keywords.length > 0) continue;
  const spec = SPEC[pkg.name];
  if (!spec) continue;

  const keywords = [...new Set([...BASE, ...spec.kw])];
  const out: Record<string, unknown> = {};
  let inserted = false;
  for (const [k, v] of Object.entries(pkg)) {
    out[k] = v;
    if (!pkg.description && spec.desc && k === "version") {
      out.description = spec.desc;
      out.keywords = keywords;
      inserted = true;
    }
    if (k === "description") {
      out.keywords = keywords;
      inserted = true;
    }
  }
  if (!inserted) {
    out.keywords = keywords;
  }

  writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
  changed++;
  console.log(`✓ ${pkg.name} (${keywords.length} keywords)`);
}
console.log(`\n${changed} packages updated`);
