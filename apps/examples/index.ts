/**
 * Unified runner for all Reactive Agents examples.
 *
 * Usage:
 *   bun run index.ts              # all examples
 *   bun run index.ts --offline    # offline-only (no API key needed)
 *   bun run index.ts --filter foundations  # single category
 *   bun run index.ts 01 05 12     # specific examples by number
 */

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export interface RunConfig {
  provider?: string;
  model?: string;
}

// ─── Default LLM config for live examples ─────────────────────────────────────
// Set these to use a specific provider/model across all examples that support
// live mode. Leave undefined to auto-detect from environment variables.
//
// Examples:
//   DEFAULT_PROVIDER = "openai";  DEFAULT_MODEL = "gpt-4o";
//   DEFAULT_PROVIDER = "ollama";  DEFAULT_MODEL = "llama3.2";
//   DEFAULT_PROVIDER = "anthropic"; DEFAULT_MODEL = "claude-opus-4-6";
const DEFAULT_PROVIDER: string | undefined = "ollama";
const DEFAULT_MODEL: string | undefined = "cogito:14b";

interface ExampleMeta {
  num: string;
  label: string;
  category: string;
  requiresKey: boolean;
  path: string;
}

const EXAMPLES: ExampleMeta[] = [
  // foundations — offline
  {
    num: "01",
    label: "simple-agent",
    category: "foundations",
    requiresKey: false,
    path: "./src/foundations/01-simple-agent.ts",
  },
  {
    num: "02",
    label: "lifecycle-hooks",
    category: "foundations",
    requiresKey: false,
    path: "./src/foundations/02-lifecycle-hooks.ts",
  },
  {
    num: "03",
    label: "multi-turn-memory",
    category: "foundations",
    requiresKey: false,
    path: "./src/foundations/03-multi-turn-memory.ts",
  },
  {
    num: "04",
    label: "agent-composition",
    category: "foundations",
    requiresKey: false,
    path: "./src/foundations/04-agent-composition.ts",
  },
  // tools — 05 offline, 06-07 real
  {
    num: "05",
    label: "builtin-tools",
    category: "tools",
    requiresKey: false,
    path: "./src/tools/05-builtin-tools.ts",
  },
  {
    num: "06",
    label: "mcp-filesystem",
    category: "tools",
    requiresKey: true,
    path: "./src/tools/06-mcp-filesystem.ts",
  },
  {
    num: "07",
    label: "mcp-github",
    category: "tools",
    requiresKey: true,
    path: "./src/tools/07-mcp-github.ts",
  },
  // multi-agent — real
  {
    num: "08",
    label: "a2a-protocol",
    category: "multi-agent",
    requiresKey: true,
    path: "./src/multi-agent/08-a2a-protocol.ts",
  },
  {
    num: "09",
    label: "orchestration",
    category: "multi-agent",
    requiresKey: true,
    path: "./src/multi-agent/09-orchestration.ts",
  },
  {
    num: "10",
    label: "dynamic-spawning",
    category: "multi-agent",
    requiresKey: true,
    path: "./src/multi-agent/10-dynamic-spawning.ts",
  },
  // trust — real
  {
    num: "11",
    label: "identity",
    category: "trust",
    requiresKey: true,
    path: "./src/trust/11-identity.ts",
  },
  {
    num: "12",
    label: "guardrails",
    category: "trust",
    requiresKey: true,
    path: "./src/trust/12-guardrails.ts",
  },
  {
    num: "13",
    label: "verification",
    category: "trust",
    requiresKey: true,
    path: "./src/trust/13-verification.ts",
  },
  // advanced — mostly real, 15 offline
  {
    num: "14",
    label: "cost-tracking",
    category: "advanced",
    requiresKey: true,
    path: "./src/advanced/14-cost-tracking.ts",
  },
  {
    num: "15",
    label: "prompt-experiments",
    category: "advanced",
    requiresKey: false,
    path: "./src/advanced/15-prompt-experiments.ts",
  },
  {
    num: "16",
    label: "eval-framework",
    category: "advanced",
    requiresKey: true,
    path: "./src/advanced/16-eval-framework.ts",
  },
  {
    num: "17",
    label: "observability",
    category: "advanced",
    requiresKey: true,
    path: "./src/advanced/17-observability.ts",
  },
  {
    num: "18",
    label: "self-improvement",
    category: "advanced",
    requiresKey: true,
    path: "./src/advanced/18-self-improvement.ts",
  },
  // reasoning — 20 offline
  {
    num: "19",
    label: "reasoning-strategies",
    category: "reasoning",
    requiresKey: true,
    path: "./src/reasoning/19-reasoning-strategies.ts",
  },
  {
    num: "20",
    label: "context-profiles",
    category: "reasoning",
    requiresKey: false,
    path: "./src/reasoning/20-context-profiles.ts",
  },
  // interaction — offline
  {
    num: "21",
    label: "interaction-modes",
    category: "interaction",
    requiresKey: false,
    path: "./src/interaction/21-interaction-modes.ts",
  },
];

// ─── Argument parsing ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const offlineOnly = args.includes("--offline");

// --filter <category> or --filter=<category>
let filterCategory: string | null = null;
const filterIdx = args.indexOf("--filter");
if (filterIdx !== -1 && args[filterIdx + 1]) {
  filterCategory = args[filterIdx + 1];
} else {
  const filterEq = args.find((a) => a.startsWith("--filter="));
  if (filterEq) filterCategory = filterEq.split("=")[1];
}

// numeric filters e.g. "01 05 12"
const numFilter = args.filter((a) => /^\d+$/.test(a));

const toRun = EXAMPLES.filter((e) => {
  if (offlineOnly && e.requiresKey) return false;
  if (filterCategory && e.category !== filterCategory) return false;
  if (numFilter.length > 0 && !numFilter.includes(e.num)) return false;
  return true;
});

// ─── Runner ───────────────────────────────────────────────────────────────────

const LINE = "─".repeat(70);

console.log(`\n┌${LINE}┐`);
console.log(`│  Reactive Agents — Example Suite${" ".repeat(70 - 34 - 1)}│`);
console.log(
  `│  ${toRun.length} example(s) selected  [offline=${offlineOnly}${filterCategory ? ` filter=${filterCategory}` : ""}]${" ".repeat(Math.max(0, 70 - 3 - String(toRun.length).length - 19 - (filterCategory ? filterCategory.length + 8 : 0) - 1))}│`,
);
console.log(`└${LINE}┘\n`);

type RunRecord = {
  meta: ExampleMeta;
  result: ExampleResult | null;
  error: string | null;
};
const results: RunRecord[] = [];

for (const meta of toRun) {
  const label = `[${meta.num}] ${meta.category}/${meta.label}`.padEnd(44);
  process.stdout.write(`${label} `);
  const wallStart = Date.now();
  try {
    const mod = (await import(meta.path)) as {
      run: (opts?: RunConfig) => Promise<ExampleResult>;
    };
    const result = await mod.run({
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
    });
    const elapsed = Date.now() - wallStart;
    const icon = result.passed ? "✅" : "❌";
    console.log(`${icon}  ${result.steps}st  ${result.tokens}tk  ${elapsed}ms`);
    results.push({ meta, result, error: null });
  } catch (err) {
    const elapsed = Date.now() - wallStart;
    const msg = String(err).slice(0, 55);
    console.log(`❌  ERROR: ${msg}  ${elapsed}ms`);
    results.push({ meta, result: null, error: String(err) });
  }
}

const passed = results.filter((r) => r.result?.passed === true).length;
const failed = results.length - passed;

console.log(`\n${"━".repeat(70)}`);
console.log(`Passed: ${passed}/${results.length}   Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailed examples:");
  for (const r of results.filter((r) => !r.result?.passed)) {
    console.log(
      `  [${r.meta.num}] ${r.meta.label}: ${r.error ?? r.result?.output.slice(0, 80) ?? "unknown"}`,
    );
  }
}
console.log();

process.exit(failed > 0 ? 1 : 0);
