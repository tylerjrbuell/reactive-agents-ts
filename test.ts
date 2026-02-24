import { ReactiveAgents } from "reactive-agents";
import { Effect } from "effect";
import { unlink, rm } from "node:fs/promises";
import { existsSync } from "node:fs";

// ─── Configuration ────────────────────────────────────────────────────────────
const PROVIDER = "ollama" as const;
const MODEL = "cogito:14b";

// Test artifacts written during scenarios — all cleaned up at the end.
const TEST_ARTIFACTS = [
  "./hello.md",
  "./verify.txt",
  "./factorial_7.txt",
  "./chain_a.txt",
  "./chain_b.txt",
  "./chain_c.txt",
  "./mem_fact.txt",
  "./no-such-file.txt", // if agent creates it
  "./sub_agent_output.txt",      // S12: explicit sub-agent delegation
  "./dynamic_spawn_output.txt",  // S13: dynamic sub-agent spawn
];
// ─────────────────────────────────────────────────────────────────────────────

function buildAgent(name: string, maxIter = 8) {
  return ReactiveAgents.create()
    .withName(name)
    .withProvider(PROVIDER)
    .withModel(MODEL)
    .withTools()
    .withMemory("1")
    .withObservability({ live: true, verbosity: "debug" })
    .withReasoning({
      defaultStrategy: "reactive",
      strategies: {
        reactive: { maxIterations: maxIter, temperature: 0.3 },
      },
    })
    .withHook({
      phase: "complete",
      timing: "after",
      handler: (ctx) => {
        const steps = (ctx.metadata as any)?.stepsCount ?? ctx.iteration;
        console.log(
          `  └─ ${ctx.taskId} | ${steps} steps | ${ctx.tokensUsed.toLocaleString()} tok | ${(ctx as any).metadata?.duration ?? 0}ms`,
        );
        return Effect.succeed(ctx);
      },
    })
    .build();
}

// ─── Scenario runner ──────────────────────────────────────────────────────────

interface ScenarioResult {
  name: string;
  success: boolean;
  steps: number;
  tokens: number;
  durationMs: number;
  output: string;
  passed: boolean;
  failReason?: string;
}

async function runScenario(
  name: string,
  prompt: string,
  validate: (
    output: string,
    result: any,
  ) => { passed: boolean; reason?: string },
  agentOverride?: Awaited<ReturnType<typeof buildAgent>>,
): Promise<ScenarioResult> {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`▶ ${name}`);
  console.log(
    `  Prompt: "${prompt.slice(0, 80)}${prompt.length > 80 ? "..." : ""}"`,
  );
  console.log(`${"─".repeat(60)}`);

  const agent =
    agentOverride ??
    (await buildAgent(
      name
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-"),
    ));
  const result = await agent.run(prompt);
  const output = String(result.output ?? "");
  const validation = validate(output, result);

  return {
    name,
    success: result.success,
    steps: result.metadata.stepsCount ?? 0,
    tokens: result.metadata.tokensUsed,
    durationMs: result.metadata.duration,
    output: output.slice(0, 300),
    passed: validation.passed,
    failReason: validation.reason,
  };
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

const scenarios: ScenarioResult[] = [];

// ── S1: Early termination ─────────────────────────────────────────────────────
// No tools. FINAL ANSWER on first thought. Target: 1 step.
scenarios.push(
  await runScenario(
    "S1: Direct Q&A (early termination)",
    "What is the time complexity of quicksort in the average case? Give a concise answer.",
    (output) => {
      const ok =
        /O\(n\s*log\s*n\)/i.test(output) ||
        output.toLowerCase().includes("n log n");
      return {
        passed: ok,
        reason: ok
          ? undefined
          : `Expected O(n log n), got: "${output.slice(0, 100)}"`,
      };
    },
  ),
);

// ── S2: Tool parameter accuracy ───────────────────────────────────────────────
// Validates Sprint 0.1 — model uses correct "code" param, not "snippet" or "script".
scenarios.push(
  await runScenario(
    "S2: Code execution (param accuracy)",
    "Run this code and tell me the result: console.log(Math.pow(2, 10))",
    (output) => {
      const ok = output.includes("1024");
      return {
        passed: ok,
        reason: ok
          ? undefined
          : `Expected 1024, got: "${output.slice(0, 100)}"`,
      };
    },
  ),
);

// ── S3: File write — no param guessing ───────────────────────────────────────
// Sprint 0.1 key fix: schema shows "path" (required) → first-try success, ≤ 4 steps.
scenarios.push(
  await runScenario(
    "S3: File write (path param, no guessing)",
    'Write a markdown file at ./hello.md with the content "# Hello World\n\nThis is a test file created by the reactive agent."',
    (output, result) => {
      const steps = result.metadata.stepsCount ?? 0;
      const mentioned = /written|created|saved|hello\.md/i.test(output);
      if (!mentioned)
        return {
          passed: false,
          reason: `Not mentioned: "${output.slice(0, 100)}"`,
        };
      if (steps > 4)
        return { passed: false, reason: `Too many steps: ${steps} (≤ 4)` };
      return { passed: true };
    },
  ),
);

// ── S4: Multi-step chaining ───────────────────────────────────────────────────
// Write → read back → confirm. Tests context continuity across tool cycles.
scenarios.push(
  await runScenario(
    "S4: Write + read verification",
    'Write the text "SENTINEL_VALUE_42" to ./verify.txt, then read it back and confirm the content was saved correctly.',
    (output) => {
      const ok = /SENTINEL_VALUE_42|saved|confirmed|correct|verified/i.test(
        output,
      );
      return {
        passed: ok,
        reason: ok
          ? undefined
          : `Verification not in output: "${output.slice(0, 100)}"`,
      };
    },
  ),
);

// ── S5: Compute + save (2-tool chain) ────────────────────────────────────────
// Code-execute (stub) → reason manually → file-write. Min 7 steps by design.
scenarios.push(
  await runScenario(
    "S5: Compute + save result",
    "Compute the factorial of 7 using code execution, then write the result to ./factorial_7.txt",
    (output, result) => {
      const steps = result.metadata.stepsCount ?? 0;
      const ok =
        output.includes("5040") ||
        /factorial.*5040|5040.*factorial/i.test(output);
      if (!ok)
        return {
          passed: false,
          reason: `Expected 5040 (7!), got: "${output.slice(0, 150)}"`,
        };
      // Model sometimes adds a verification read (code-execute → file-write → file-read).
      // Allow up to 12 steps (4 iterations × 3 steps) to accommodate this.
      if (steps > 12)
        return { passed: false, reason: `Too many steps: ${steps} (≤ 12)` };
      return { passed: true };
    },
  ),
);

// ── S6: Error recovery ────────────────────────────────────────────────────────
// Agent reads a non-existent file, gets an enriched error (Sprint 0.2),
// then creates the file and confirms. Tests adaptation to tool failures.
scenarios.push(
  await runScenario(
    "S6: Error recovery (missing file → create)",
    "Read ./no-such-file.txt. If it does not exist, create it with the text 'agent-created' and confirm.",
    (output) => {
      const ok = /agent.created|created|written|saved/i.test(output);
      return {
        passed: ok,
        reason: ok
          ? undefined
          : `Expected creation confirmation, got: "${output.slice(0, 100)}"`,
      };
    },
  ),
);

// ── S7: Context compaction stress ─────────────────────────────────────────────
// Designed to exceed COMPACT_AFTER_STEPS=6. Tests that compaction doesn't
// cause the agent to lose track of earlier steps in a 3-file chain.
// Needs 3 writes + 2 reads + 1 write = 6 tool calls = min 6 iterations.
// Uses maxIter=15 to give the model sufficient room beyond the 6-tool minimum.
scenarios.push(
  await runScenario(
    "S7: 3-file chain (context compaction)",
    "Complete these tasks in order: (1) Write 'alpha' to ./chain_a.txt, (2) Write 'beta' to ./chain_b.txt, (3) Read both files back and write a summary file ./chain_c.txt containing 'alpha+beta'. Once all three files are written, give your FINAL ANSWER describing what you wrote to each file.",
    (output, result) => {
      const steps = result.metadata.stepsCount ?? 0;
      const ok = /alpha.*beta|chain_c|summary|combined|three|all.*file/i.test(
        output,
      );
      if (!ok)
        return {
          passed: false,
          reason: `Summary not confirmed: "${output.slice(0, 150)}"`,
        };
      // With maxIter=15, the theoretical max is 45 steps. Flag runaway at 30.
      if (steps > 30)
        return { passed: false, reason: `Runaway: ${steps} steps` };
      return { passed: true };
    },
    await buildAgent("s7-3-file-chain", 12),
  ),
);

// ── S8: Pure reasoning (no tools) ────────────────────────────────────────────
// Multi-step mental math. Tests that early termination doesn't fire prematurely
// and that the agent shows its work before giving a FINAL ANSWER.
scenarios.push(
  await runScenario(
    "S8: Multi-step mental math (no tools)",
    "Calculate: (1) sum of the first 5 prime numbers (2+3+5+7+11), (2) count letters in 'reactive' (8), (3) multiply result 1 by result 2. Show each step.",
    (output) => {
      // 28 × 8 = 224
      const ok = output.includes("224") || /28.*8.*224|224/i.test(output);
      return {
        passed: ok,
        reason: ok ? undefined : `Expected 224, got: "${output.slice(0, 150)}"`,
      };
    },
  ),
);

// ── S9a + S9b: Memory persistence (same agent instance, two runs) ─────────────
// The SAME agent instance is used for both runs. After run 9a, the episodic
// bridge logs the result to SQLite. Run 9b bootstraps and surfaces it (1 episodic).
// The file also persists on disk — tests both episodic recall + filesystem state.
console.log(`\n${"─".repeat(60)}`);
console.log(`▶ S9: Memory persistence (same agent, 2 runs)`);
console.log(`${"─".repeat(60)}`);

// maxIter=12 gives 6 extra iterations beyond the minimum for each run,
// preventing timeout on the occasional model retry loop.
const memAgent = await buildAgent("memory-persist-test", 12);

const memRun1 = await memAgent.run(
  "Write the string 'MEMORY_MARKER_XYZ' to ./mem_fact.txt",
);
const memOut1 = String(memRun1.output ?? "");
console.log(
  `  └─ Run 1: ${memRun1.metadata.stepsCount} steps | ${memRun1.metadata.tokensUsed} tok | output: "${memOut1.slice(0, 80)}"`,
);

const memRun2 = await memAgent.run(
  "Read ./mem_fact.txt and tell me exactly what it contains.",
);
const memOut2 = String(memRun2.output ?? "");
console.log(
  `  └─ Run 2: ${memRun2.metadata.stepsCount} steps | ${memRun2.metadata.tokensUsed} tok | output: "${memOut2.slice(0, 80)}"`,
);

const s9Passed = memOut2.includes("MEMORY_MARKER_XYZ");
scenarios.push({
  name: "S9: Memory persistence (2-run same agent)",
  success: memRun2.success,
  steps:
    (memRun1.metadata.stepsCount ?? 0) + (memRun2.metadata.stepsCount ?? 0),
  tokens: memRun1.metadata.tokensUsed + memRun2.metadata.tokensUsed,
  durationMs: memRun1.metadata.duration + memRun2.metadata.duration,
  output: memOut2.slice(0, 300),
  passed: s9Passed,
  failReason: s9Passed
    ? undefined
    : `Expected MEMORY_MARKER_XYZ in run-2 output, got: "${memOut2.slice(0, 100)}"`,
});

// ── S10: Context profile — local tier ────────────────────────────────────────
// Builds an agent with .withContextProfile({ tier: "local" }) — lean rules,
// smaller compaction window, lower tool-result truncation. Should still produce
// correct answers despite the stripped-down context budget.
scenarios.push(
  await runScenario(
    "S10: Local tier context profile",
    "Compute 15 * 7 using code execution and report only the numeric result.",
    (output) => {
      const ok = output.includes("105");
      return {
        passed: ok,
        reason: ok
          ? undefined
          : `Expected 105, got: "${output.slice(0, 100)}"`,
      };
    },
    await ReactiveAgents.create()
      .withName("s10-local-profile")
      .withProvider(PROVIDER)
      .withModel(MODEL)
      .withTools()
      .withContextProfile({ tier: "local" })
      .withObservability({ live: true, verbosity: "debug" })
      .withReasoning({
        defaultStrategy: "reactive",
        strategies: {
          reactive: { maxIterations: 8, temperature: 0.3 },
        },
      })
      .withHook({
        phase: "complete",
        timing: "after",
        handler: (ctx) => {
          const steps = (ctx.metadata as any)?.stepsCount ?? ctx.iteration;
          console.log(
            `  └─ ${ctx.taskId} | ${steps} steps | ${ctx.tokensUsed.toLocaleString()} tok | ${(ctx as any).metadata?.duration ?? 0}ms`,
          );
          return Effect.succeed(ctx);
        },
      })
      .build(),
  ),
);

// ── S11: Scratchpad — in-run write + read cycle ───────────────────────────────
// Exercises the new scratchpad-write and scratchpad-read built-in tools.
// The agent must persist a value to the in-memory scratchpad store and then
// retrieve it, confirming the cycle completes within a single run.
scenarios.push(
  await runScenario(
    "S11: Scratchpad write + read",
    "Use the scratchpad-write tool to save key='project-goal' with content='build the future'. Then use scratchpad-read with key='project-goal' to verify it was saved, and tell me exactly what the scratchpad returned.",
    (output) => {
      const ok = /build the future|project.goal/i.test(output);
      return {
        passed: ok,
        reason: ok
          ? undefined
          : `Expected scratchpad content in answer, got: "${output.slice(0, 100)}"`,
      };
    },
  ),
);

// ── S12: Explicit sub-agent delegation ────────────────────────────────────────
// Parent agent delegates a file-write task to a 'writer' sub-agent registered
// via .withAgentTool(). The sub-agent runs in a clean context window (no parent
// history), writes a file, and returns a structured SubAgentResult. The parent
// reports the delegation outcome. Validates the real sub-agent executor.
scenarios.push(
  await runScenario(
    "S12: Sub-agent delegation (file write)",
    "Use the 'writer' agent tool to write the text 'DELEGATED_CONTENT' to ./sub_agent_output.txt, then report whether the delegation succeeded.",
    (output) => {
      const ok = /DELEGATED_CONTENT|delegat|succeeded|written|sub.agent/i.test(output);
      return {
        passed: ok,
        reason: ok
          ? undefined
          : `Expected delegation confirmation, got: "${output.slice(0, 100)}"`,
      };
    },
    await ReactiveAgents.create()
      .withName("s12-parent")
      .withProvider(PROVIDER)
      .withModel(MODEL)
      .withTools()
      .withAgentTool("writer", {
        name: "writer",
        description: "A sub-agent that can write files. Provide a task describing exactly what to write and where.",
        provider: PROVIDER,
        model: MODEL,
        maxIterations: 5,
      })
      .withObservability({ live: true, verbosity: "debug" })
      .withReasoning({
        defaultStrategy: "reactive",
        strategies: {
          reactive: { maxIterations: 10, temperature: 0.3 },
        },
      })
      .withHook({
        phase: "complete",
        timing: "after",
        handler: (ctx) => {
          const steps = (ctx.metadata as any)?.stepsCount ?? ctx.iteration;
          console.log(
            `  └─ ${ctx.taskId} | ${steps} steps | ${ctx.tokensUsed.toLocaleString()} tok | ${(ctx as any).metadata?.duration ?? 0}ms`,
          );
          return Effect.succeed(ctx);
        },
      })
      .build(),
  ),
);

// ── S13: Dynamic sub-agent spawning (withDynamicSubAgents) ───────────────────
// Tests the built-in spawn-agent tool registered via .withDynamicSubAgents().
// The agent decides at runtime to delegate a file-write task to a spawned
// sub-agent — no pre-configured agent tool, just the parent model choosing
// to use spawn-agent with the task it deems best suited for delegation.
scenarios.push(
  await runScenario(
    "S13: Dynamic sub-agent spawn (runtime delegation)",
    "You have a spawn-agent tool available. Use it to delegate this task: write the text 'DYNAMIC_SPAWN_RESULT' to ./dynamic_spawn_output.txt. Then report back whether the delegation succeeded.",
    (output) => {
      const ok = /DYNAMIC_SPAWN_RESULT|delegat|spawn|succeeded|written/i.test(output);
      return {
        passed: ok,
        reason: ok
          ? undefined
          : `Expected dynamic spawn confirmation, got: "${output.slice(0, 100)}"`,
      };
    },
    await ReactiveAgents.create()
      .withName("s13-dynamic-parent")
      .withProvider(PROVIDER)
      .withModel(MODEL)
      .withTools()
      .withDynamicSubAgents({ maxIterations: 5 })
      .withObservability({ live: true, verbosity: "debug" })
      .withReasoning({
        defaultStrategy: "reactive",
        strategies: {
          reactive: { maxIterations: 10, temperature: 0.3 },
        },
      })
      .withHook({
        phase: "complete",
        timing: "after",
        handler: (ctx) => {
          const steps = (ctx.metadata as any)?.stepsCount ?? ctx.iteration;
          console.log(
            `  └─ ${ctx.taskId} | ${steps} steps | ${ctx.tokensUsed.toLocaleString()} tok | ${(ctx as any).metadata?.duration ?? 0}ms`,
          );
          return Effect.succeed(ctx);
        },
      })
      .build(),
  ),
);

// ─── Artifact cleanup ─────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log("▶ Cleanup: removing test artifacts");
const cleaned: string[] = [];
const missed: string[] = [];
for (const f of TEST_ARTIFACTS) {
  try {
    if (existsSync(f)) {
      await unlink(f);
      cleaned.push(f);
    }
  } catch {
    missed.push(f);
  }
}
if (cleaned.length) console.log(`  ✓ Removed: ${cleaned.join(", ")}`);
if (missed.length) console.log(`  ✗ Could not remove: ${missed.join(", ")}`);

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(60)}`);
console.log("SCENARIO RESULTS SUMMARY");
console.log(`${"═".repeat(60)}`);
console.log(
  `  ${"Scenario".padEnd(40)} ${"Steps".padStart(5)} ${"Tokens".padStart(7)} ${"Time".padStart(6)}`,
);
console.log(`  ${"─".repeat(62)}`);

const passed = scenarios.filter((s) => s.passed).length;
const total = scenarios.length;

for (const s of scenarios) {
  const icon = s.passed ? "✓" : "✗";
  const stepsStr = String(s.steps).padStart(5);
  const toksStr = s.tokens.toLocaleString().padStart(7);
  const durStr = `${(s.durationMs / 1000).toFixed(1)}s`.padStart(6);
  console.log(
    `  ${icon} ${s.name.padEnd(40)} ${stepsStr} ${toksStr} ${durStr}`,
  );
  if (!s.passed) {
    console.log(`    ✗ ${s.failReason}`);
  }
}

console.log(`\n${passed}/${total} scenarios passed`);

// Per-category breakdown
const toolScenarios = scenarios.filter((_, i) => [1, 2, 3, 4].includes(i));
const recoveryScenarios = scenarios.filter((_, i) => [5].includes(i));
const stressScenarios = scenarios.filter((_, i) => [6].includes(i));
const reasoningScenarios = scenarios.filter((_, i) => [7].includes(i));
const memoryScenarios = scenarios.filter((_, i) => [8].includes(i));
const profileScenarios = scenarios.filter((_, i) => [9].includes(i));
const scratchpadScenarios = scenarios.filter((_, i) => [10].includes(i));
const subAgentScenarios = scenarios.filter((_, i) => [11].includes(i));
const dynamicSpawnScenarios = scenarios.filter((_, i) => [12].includes(i));

function avg(arr: ScenarioResult[], key: keyof ScenarioResult) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + (b[key] as number), 0) / arr.length;
}

console.log(`\nEfficiency by category (avg):`);
console.log(
  `  ${"Category".padEnd(24)} ${"Steps".padStart(6)} ${"Tokens".padStart(8)} ${"Time".padStart(7)}`,
);
console.log(`  ${"─".repeat(50)}`);

const cats = [
  ["Tool use (S1-S5)", toolScenarios],
  ["Error recovery (S6)", recoveryScenarios],
  ["Compaction stress (S7)", stressScenarios],
  ["Pure reasoning (S8)", reasoningScenarios],
  ["Memory (S9)", memoryScenarios],
  ["Context profile (S10)", profileScenarios],
  ["Scratchpad (S11)", scratchpadScenarios],
  ["Sub-agent explicit (S12)", subAgentScenarios],
  ["Sub-agent dynamic (S13)", dynamicSpawnScenarios],
] as const;

for (const [label, cat] of cats) {
  if (!cat.length) continue;
  const s = avg(cat as ScenarioResult[], "steps")
    .toFixed(1)
    .padStart(6);
  const t = Math.round(avg(cat as ScenarioResult[], "tokens"))
    .toLocaleString()
    .padStart(8);
  const d =
    `${(avg(cat as ScenarioResult[], "durationMs") / 1000).toFixed(1)}s`.padStart(
      7,
    );
  console.log(`  ${label.padEnd(24)} ${s} ${t} ${d}`);
}

// Overall targets
const allSteps = scenarios.reduce((a, b) => a + b.steps, 0) / scenarios.length;
const allTokens =
  scenarios.reduce((a, b) => a + b.tokens, 0) / scenarios.length;
const allDuration =
  scenarios.reduce((a, b) => a + b.durationMs, 0) / scenarios.length;

console.log(`\nOverall (avg across all ${total} scenarios):`);
console.log(`  Steps:    ${allSteps.toFixed(1)} (target: ≤ 8)`);
console.log(
  `  Tokens:   ${Math.round(allTokens).toLocaleString()} (target: ≤ 5,000)`,
);
console.log(`  Duration: ${(allDuration / 1000).toFixed(1)}s (target: ≤ 15s)`);

console.log(`\nTargets:`);
console.log(
  `  [${allSteps <= 8 ? "✓" : "✗"}] Avg steps ≤ 8       (actual: ${allSteps.toFixed(1)})`,
);
console.log(
  `  [${allTokens <= 5000 ? "✓" : "✗"}] Avg tokens ≤ 5K     (actual: ${Math.round(allTokens).toLocaleString()})`,
);
console.log(
  `  [${passed >= total - 1 ? "✓" : "✗"}] ≥ ${total - 1}/${total} scenarios pass (${passed}/${total})`,
);
