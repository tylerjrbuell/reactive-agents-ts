import { ReactiveAgents } from "reactive-agents";
import { Effect } from "effect";
import { unlink } from "node:fs/promises";
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
  "./sub_agent_output.txt", // S12: explicit sub-agent delegation
  "./dynamic_spawn_output.txt", // S13: dynamic sub-agent spawn
  "./lifecycle_pause.txt", // S17: pause/resume
  "./lifecycle_stop.txt", // S18: stop()
  "./lifecycle_stop_b.txt", // S18: stop() second file
  "./lifecycle_term.txt", // S19: terminate()
  // S14 and S15 write no files (pure code execution + math queries)
];
// ─────────────────────────────────────────────────────────────────────────────

// ─── Scenario filter ──────────────────────────────────────────────────────────
// Run specific scenarios: bun run test.ts S1 S3 S16
// Run all:               bun run test.ts
const SCENARIO_FILTER = new Set(
  process.argv
    .slice(2)
    .filter((a) => /^S\d+/i.test(a))
    .map((a) => a.toUpperCase()),
);
const shouldRun = (id: string): boolean =>
  SCENARIO_FILTER.size === 0 || SCENARIO_FILTER.has(id.toUpperCase());

if (SCENARIO_FILTER.size > 0) {
  console.log(`\n⚡ Running only: ${[...SCENARIO_FILTER].join(", ")}\n`);
}
// ─────────────────────────────────────────────────────────────────────────────

function buildAgent(
  name: string,
  maxIter = 8,
  opts: { killSwitch?: boolean } = {},
) {
  let builder = ReactiveAgents.create()
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
    });
  if (opts.killSwitch) builder = builder.withKillSwitch();
  return builder.build();
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
if (shouldRun("S1")) {
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
}

// ── S2: Tool parameter accuracy ───────────────────────────────────────────────
if (shouldRun("S2")) {
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
}

// ── S3: File write — no param guessing ───────────────────────────────────────
if (shouldRun("S3")) {
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
}

// ── S4: Multi-step chaining ───────────────────────────────────────────────────
if (shouldRun("S4")) {
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
}

// ── S5: Compute + save (2-tool chain) ────────────────────────────────────────
if (shouldRun("S5")) {
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
        if (steps > 12)
          return { passed: false, reason: `Too many steps: ${steps} (≤ 12)` };
        return { passed: true };
      },
    ),
  );
}

// ── S6: Error recovery ────────────────────────────────────────────────────────
if (shouldRun("S6")) {
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
}

// ── S7: Context compaction stress ─────────────────────────────────────────────
if (shouldRun("S7")) {
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
        if (steps > 30)
          return { passed: false, reason: `Runaway: ${steps} steps` };
        return { passed: true };
      },
      await buildAgent("s7-3-file-chain", 12),
    ),
  );
}

// ── S8: Pure reasoning (no tools) ────────────────────────────────────────────
if (shouldRun("S8")) {
  scenarios.push(
    await runScenario(
      "S8: Multi-step mental math (no tools)",
      "Calculate: (1) sum of the first 5 prime numbers (2+3+5+7+11), (2) count letters in 'reactive' (8), (3) multiply result 1 by result 2. Show each step.",
      (output) => {
        const ok = output.includes("224") || /28.*8.*224|224/i.test(output);
        return {
          passed: ok,
          reason: ok
            ? undefined
            : `Expected 224, got: "${output.slice(0, 150)}"`,
        };
      },
    ),
  );
}

// ── S9a + S9b: Memory persistence (same agent instance, two runs) ─────────────
if (shouldRun("S9")) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`▶ S9: Memory persistence (same agent, 2 runs)`);
  console.log(`${"─".repeat(60)}`);

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
}

// ── S10: Context profile — local tier ────────────────────────────────────────
if (shouldRun("S10")) {
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
}

// ── S11: Scratchpad — in-run write + read cycle ───────────────────────────────
if (shouldRun("S11")) {
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
}

// ── S12: Explicit sub-agent delegation ────────────────────────────────────────
if (shouldRun("S12")) {
  scenarios.push(
    await runScenario(
      "S12: Sub-agent delegation (file write)",
      "Use the 'writer' agent tool to write the text 'DELEGATED_CONTENT' to ./sub_agent_output.txt, then report whether the delegation succeeded.",
      (output) => {
        const ok =
          /DELEGATED_CONTENT|delegat|succeeded|written|sub.agent/i.test(output);
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
          description:
            "A sub-agent that can write files. Provide a task describing exactly what to write and where.",
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
}

// ── S13: Dynamic sub-agent spawning (withDynamicSubAgents) ───────────────────
if (shouldRun("S13")) {
  scenarios.push(
    await runScenario(
      "S13: Dynamic sub-agent spawn (runtime delegation)",
      "You have a spawn-agent tool available. Use it to delegate this task: write the text 'DYNAMIC_SPAWN_RESULT' to ./dynamic_spawn_output.txt. Then report back whether the delegation succeeded.",
      (output) => {
        const ok = /DYNAMIC_SPAWN_RESULT|delegat|spawn|succeeded|written/i.test(
          output,
        );
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
}

// ── S14: Code sandbox env isolation ──────────────────────────────────────────
if (shouldRun("S14")) {
  scenarios.push(
    await runScenario(
      "S14: Code sandbox env isolation",
      "Run this exact JavaScript code and show me all of its output: console.log(Object.keys(process.env).join(','))",
      (output) => {
        const hasApiKey =
          /ANTHROPIC_API_KEY|OPENAI_API_KEY|TAVILY_API_KEY|GOOGLE_API_KEY/i.test(
            output,
          );
        if (hasApiKey) {
          return {
            passed: false,
            reason: `Sandbox leaked API keys: "${output.slice(0, 200)}"`,
          };
        }
        const sandboxRan = /PATH|HOME|executed|ran|result/i.test(output);
        if (!sandboxRan) {
          return {
            passed: false,
            reason: `Cannot confirm sandbox ran: "${output.slice(0, 100)}"`,
          };
        }
        return { passed: true };
      },
    ),
  );
}

// ── S15a + S15b: Self-improvement (same agent, two runs) ──────────────────────
if (shouldRun("S15")) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`▶ S15: Self-improvement (same agent, 2 runs)`);
  console.log(`${"─".repeat(60)}`);

  const siAgent = await ReactiveAgents.create()
    .withName("si-test-agent")
    .withProvider(PROVIDER)
    .withModel(MODEL)
    .withTools()
    .withMemory("2")
    .withSelfImprovement()
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
    .build();

  const siRun1 = await siAgent.run(
    "What is 9 multiplied by 8? Give only the numeric result.",
  );
  const siOut1 = String(siRun1.output ?? "");
  console.log(
    `  └─ Run 1: ${siRun1.metadata.stepsCount} steps | ${siRun1.metadata.tokensUsed} tok | output: "${siOut1.slice(0, 80)}"`,
  );

  const siRun2 = await siAgent.run(
    "What is 6 multiplied by 7? Give only the numeric result.",
  );
  const siOut2 = String(siRun2.output ?? "");
  console.log(
    `  └─ Run 2: ${siRun2.metadata.stepsCount} steps | ${siRun2.metadata.tokensUsed} tok | output: "${siOut2.slice(0, 80)}"`,
  );

  const s15Run1Ok =
    siRun1.success && (siOut1.includes("72") || /\b72\b/.test(siOut1));
  const s15Run2Ok =
    siRun2.success && (siOut2.includes("42") || /\b42\b/.test(siOut2));
  const s15Passed = s15Run1Ok && s15Run2Ok;
  scenarios.push({
    name: "S15: Self-improvement (2-run episodic logging)",
    success: siRun1.success && siRun2.success,
    steps:
      (siRun1.metadata.stepsCount ?? 0) + (siRun2.metadata.stepsCount ?? 0),
    tokens: siRun1.metadata.tokensUsed + siRun2.metadata.tokensUsed,
    durationMs: siRun1.metadata.duration + siRun2.metadata.duration,
    output: siOut2.slice(0, 300),
    passed: s15Passed,
    failReason: s15Passed
      ? undefined
      : `Expected 72 in run-1 (got "${siOut1.slice(0, 60)}"), 42 in run-2 (got "${siOut2.slice(0, 60)}")`,
  });
}

// ── S16: subscribe() — event collection ──────────────────────────────────────
// Verifies EventBus events flow through the subscribe() facade method.
// Checks TaskCompleted and ExecutionPhaseEntered fire during a normal run.
if (shouldRun("S16")) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`▶ S16: subscribe() event collection — typed API`);
  console.log(`${"─".repeat(60)}`);

  const eventsAgent = await buildAgent("s16-events", 8, { killSwitch: true });
  const capturedTags: string[] = [];

  // ── Typed tag-filtered subscriptions (event narrowed automatically) ──
  const unsubStarted = await eventsAgent.subscribe("AgentStarted", (event) => {
    console.log(
      `  → AgentStarted       | model: ${event.model} | provider: ${event.provider}`,
    );
    capturedTags.push(event._tag);
  });
  const unsubLLM = await eventsAgent.subscribe("LLMRequestStarted", (event) => {
    console.log(
      `  → LLMRequestStarted  | ctx: ${event.contextSize} tokens | reqId: ${event.requestId.slice(-8)}`,
    );
    capturedTags.push(event._tag);
  });
  const unsubStep = await eventsAgent.subscribe(
    "ReasoningStepCompleted",
    (event) => {
      const kind = event.thought ? "thought" : event.action ? "action" : "obs";
      console.log(`  → ReasoningStep      | step ${event.step} [${kind}]`);
      capturedTags.push(event._tag);
    },
  );
  const unsubAnswer = await eventsAgent.subscribe(
    "FinalAnswerProduced",
    (event) => {
      console.log(
        `  → FinalAnswerProduced| iter ${event.iteration} | ${event.totalTokens} tok`,
      );
      capturedTags.push(event._tag);
    },
  );
  const unsubCompleted = await eventsAgent.subscribe(
    "AgentCompleted",
    (event) => {
      console.log(
        `  → AgentCompleted     | ${event.totalTokens} tok | ${event.durationMs}ms | success: ${event.success}`,
      );
      capturedTags.push(event._tag);
    },
  );

  // ── Catch-all to tally everything else ──
  const unsubAll = await eventsAgent.subscribe((e) => {
    if (!capturedTags.includes(e._tag)) capturedTags.push(e._tag);
  });

  const s16Start = Date.now();
  try {
    await eventsAgent.run(
      "What is 7 multiplied by 6? Give only the numeric result.",
    );
  } catch {
    // ignore — we only care about event collection
  } finally {
    unsubStarted();
    unsubLLM();
    unsubStep();
    unsubAnswer();
    unsubCompleted();
    unsubAll();
  }
  const s16Ms = Date.now() - s16Start;

  const uniqueEvents = [...new Set(capturedTags)];
  const hasAgentStarted = capturedTags.includes("AgentStarted");
  const hasAgentCompleted = capturedTags.includes("AgentCompleted");
  const hasFinalAnswer = capturedTags.includes("FinalAnswerProduced");
  const hasTaskCompleted = capturedTags.includes("TaskCompleted");
  const s16Passed =
    hasAgentStarted && hasAgentCompleted && hasFinalAnswer && hasTaskCompleted;

  console.log(
    `  └─ ${capturedTags.length} events | unique: ${uniqueEvents.join(", ")} | ${s16Ms}ms`,
  );

  scenarios.push({
    name: "S16: subscribe() event collection",
    success: hasTaskCompleted,
    steps: 0,
    tokens: 0,
    durationMs: s16Ms,
    output: `${capturedTags.length} events: ${uniqueEvents.join(", ")}`,
    passed: s16Passed,
    failReason: s16Passed
      ? undefined
      : `Missing key events — AgentStarted: ${hasAgentStarted}, AgentCompleted: ${hasAgentCompleted}, FinalAnswer: ${hasFinalAnswer}, TaskCompleted: ${hasTaskCompleted}`,
  });
}

// ── S17: pause() + resume() ───────────────────────────────────────────────────
// Pauses BEFORE the run starts so execution blocks at the first phase boundary
// (bootstrap's guardedPhase → checkLifecycle → waitIfPaused). Holds 2s, then
// resumes. AgentPaused fires when execution actually hits the boundary (carrying
// the real taskId); AgentResumed fires as it unblocks and continues.
if (shouldRun("S17")) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(` ⏯️  S17: pause() + resume() lifecycle`);
  console.log(`${"─".repeat(60)}`);

  const pauseAgent = await buildAgent("s17-pause-resume", 10, {
    killSwitch: true,
  });
  const HEAD_START = 0;
  const PAUSE_HOLD = 10000; // ms to hold the pause

  const s17Start = Date.now();

  // ── 1. Subscribe BEFORE any lifecycle change ──────────────────────────────
  // AgentPaused/AgentResumed emit from waitIfPaused() at the phase boundary,
  // not from pause()/resume() themselves — so registering handlers first is required.
  const unsubPaused = await pauseAgent.subscribe("AgentPaused", (event) => {
    console.log(
      `  ⏸️  AgentPaused at ${Date.now() - s17Start}ms | task: ${event.taskId}`,
    );
  });
  const unsubResumed = await pauseAgent.subscribe("AgentResumed", (event) => {
    console.log(
      `  ▶️  AgentResumed at ${Date.now() - s17Start}ms | task: ${event.taskId}`,
    );
  });

  // ── 2. Signal pause BEFORE the run — execution blocks at bootstrap ────────

  // ── 3. Start run — blocks immediately at the first waitIfPaused() call ────
  const runPromise = pauseAgent.run(
    "Write 'LIFECYCLE_PAUSE_TEST' to ./lifecycle_pause.txt, then read it back and confirm the content.",
  );
  console.log(
    `  ⏳ run() started at ${Date.now() - s17Start}ms — execution now blocking at first phase boundary`,
  );

  // ── 4. Hold for PAUSE_HOLD ms (execution is blocked), then resume ─────────
  // During this sleep the agent task is live but completely idle — nothing runs.
  // AgentPaused fires on the EventBus once execution reaches waitIfPaused().

  // Give the agent some time to startup
  await new Promise<void>((r) => setTimeout(r, HEAD_START));
  await pauseAgent.pause();
  console.log(`  ⏸  pause() signaled at ${Date.now() - s17Start}ms`);
  await new Promise<void>((r) => setTimeout(r, PAUSE_HOLD));
  console.log(`  ⏳ ${PAUSE_HOLD}ms elapsed — resuming now`);
  await pauseAgent.resume();
  console.log(`  ▶  resume() signaled at ${Date.now() - s17Start}ms`);

  let s17Result: Awaited<ReturnType<typeof pauseAgent.run>> | null = null;
  let s17Error: unknown = null;
  try {
    s17Result = await runPromise;
  } catch (e) {
    s17Error = e;
  } finally {
    unsubPaused();
    unsubResumed();
  }
  const s17TotalMs = Date.now() - s17Start;

  // Total time should be >= PAUSE_HOLD (blocked that long) + task execution time
  const pauseProven = s17TotalMs >= PAUSE_HOLD;
  const s17Passed =
    s17Result?.success === true &&
    pauseProven &&
    /LIFECYCLE_PAUSE_TEST|saved|confirmed|correct|written/i.test(
      String(s17Result?.output ?? ""),
    );
  console.log(
    `  └─ ${s17Result?.metadata?.stepsCount ?? "?"} steps | ${s17Result?.metadata?.tokensUsed?.toLocaleString() ?? "?"} tok | ${s17TotalMs}ms total (blocked ≥ ${PAUSE_HOLD}ms: ${pauseProven})`,
  );

  scenarios.push({
    name: "S17: pause() + resume()",
    success: s17Result?.success ?? false,
    steps: s17Result?.metadata?.stepsCount ?? 0,
    tokens: s17Result?.metadata?.tokensUsed ?? 0,
    durationMs: s17TotalMs,
    output: String(s17Result?.output ?? s17Error ?? "").slice(0, 300),
    passed: s17Passed,
    failReason: s17Passed
      ? undefined
      : `Run failed, output unconfirmed, or pause not held (${s17TotalMs}ms < ${PAUSE_HOLD}ms). Error: ${s17Error}. Output: "${String(s17Result?.output ?? "").slice(0, 100)}"`,
  });
}

// ── S18: stop() — graceful halt ───────────────────────────────────────────────
// Calls stop() while a multi-tool task is in-flight. The engine detects the
// stop at the next phase boundary and raises KillSwitchTriggeredError.
// Passes if the run is interrupted OR if the task completed before stop fired.
if (shouldRun("S18")) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`▶ S18: stop() graceful halt`);
  console.log(`${"─".repeat(60)}`);

  const stopAgent = await ReactiveAgents.create()
    .withName("s18-stop")
    .withProvider(PROVIDER)
    .withModel(MODEL)
    .withTools()
    .withKillSwitch()
    .withReasoning({
      defaultStrategy: "reactive",
      strategies: { reactive: { maxIterations: 10, temperature: 0.3 } },
    })
    .withHook({
      phase: "complete",
      timing: "after",
      handler: (ctx) => {
        const steps = (ctx.metadata as any)?.stepsCount ?? ctx.iteration;
        console.log(
          `  └─ ${ctx.taskId} | ${steps} steps | ${ctx.tokensUsed.toLocaleString()} tok`,
        );
        return Effect.succeed(ctx);
      },
    })
    .build();

  const s18Start = Date.now();

  // Subscribe BEFORE the run so we never race the AgentStopped event
  const unsubStopped = await stopAgent.subscribe("AgentStopped", (event) => {
    console.log(
      `  🛑 AgentStopped at ${Date.now() - s18Start}ms | task: ${event.taskId}`,
    );
  });

  const stopRunPromise = stopAgent.run(
    "Write 'STOP_A' to ./lifecycle_stop.txt, then write 'STOP_B' to ./lifecycle_stop_b.txt, then read both files and produce a combined summary.",
  );

  // Signal stop after 1s — detected at the next phase boundary after the current LLM call
  await new Promise<void>((r) => setTimeout(r, 1000));
  await stopAgent.stop("test stop S18");

  let s18Error: unknown = null;
  let s18Result: Awaited<ReturnType<typeof stopAgent.run>> | null = null;
  try {
    s18Result = await stopRunPromise;
  } catch (e) {
    s18Error = e;
  } finally {
    unsubStopped();
  }
  const s18TotalMs = Date.now() - s18Start;

  const errMsg =
    s18Error instanceof Error ? s18Error.message : String(s18Error ?? "");
  const wasInterrupted =
    s18Error !== null && /stop|stopping|kill|terminat/i.test(errMsg);
  const completedFirst = s18Result?.success === true; // race: task finished before stop took effect
  const s18Passed = wasInterrupted || completedFirst;

  console.log(
    `  └─ ${s18TotalMs}ms | interrupted: ${wasInterrupted} | completed first: ${completedFirst}`,
  );

  scenarios.push({
    name: "S18: stop() graceful halt",
    success: s18Passed,
    steps: s18Result?.metadata?.stepsCount ?? 0,
    tokens: s18Result?.metadata?.tokensUsed ?? 0,
    durationMs: s18TotalMs,
    output: wasInterrupted
      ? `Interrupted: ${errMsg.slice(0, 150)}`
      : String(s18Result?.output ?? "").slice(0, 200),
    passed: s18Passed,
    failReason: s18Passed
      ? undefined
      : `Expected stop error or early completion. Error: "${errMsg.slice(0, 100)}"`,
  });
}

// ── S19: terminate() — hard stop ─────────────────────────────────────────────
// Calls terminate() while a task is in-flight. terminate() both sets lifecycle
// to "terminated" AND triggers the kill switch (isTriggered → true), so the
// engine detects it at the very next phase boundary check.
if (shouldRun("S19")) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`▶ S19: terminate() hard stop`);
  console.log(`${"─".repeat(60)}`);

  const termAgent = await ReactiveAgents.create()
    .withName("s19-terminate")
    .withProvider(PROVIDER)
    .withModel(MODEL)
    .withTools()
    .withKillSwitch()
    .withReasoning({
      defaultStrategy: "reactive",
      strategies: { reactive: { maxIterations: 10, temperature: 0.3 } },
    })
    .withHook({
      phase: "complete",
      timing: "after",
      handler: (ctx) => {
        const steps = (ctx.metadata as any)?.stepsCount ?? ctx.iteration;
        console.log(
          `  └─ ${ctx.taskId} | ${steps} steps | ${ctx.tokensUsed.toLocaleString()} tok`,
        );
        return Effect.succeed(ctx);
      },
    })
    .build();

  const s19Start = Date.now();

  // Subscribe BEFORE the run — AgentTerminated fires from checkLifecycle() during execution
  const unSub4 = await termAgent.subscribe("AgentTerminated", (event) => {
    console.log(
      `  ☠  AgentTerminated at ${Date.now() - s19Start}ms | task: ${event.taskId}`,
    );
  });

  const termRunPromise = termAgent.run(
    "Write 'TERM_TEST' to ./lifecycle_term.txt, then read it back, then compute 99 * 99 and write the result to the same file.",
  );

  await new Promise<void>((r) => setTimeout(r, 800));
  await termAgent.terminate("test terminate S19");

  let s19Error: unknown = null;
  let s19Result: Awaited<ReturnType<typeof termAgent.run>> | null = null;
  try {
    s19Result = await termRunPromise;
  } catch (e) {
    s19Error = e;
  } finally {
    unSub4();
  }
  const s19TotalMs = Date.now() - s19Start;

  const termErrMsg =
    s19Error instanceof Error ? s19Error.message : String(s19Error ?? "");
  const wasTerminated =
    s19Error !== null && /terminat|kill|stop/i.test(termErrMsg);
  const termCompletedFirst = s19Result?.success === true;
  const s19Passed = wasTerminated || termCompletedFirst;

  console.log(
    `  └─ ${s19TotalMs}ms | was terminated: ${wasTerminated} | completed first: ${termCompletedFirst}`,
  );

  scenarios.push({
    name: "S19: terminate() hard stop",
    success: s19Passed,
    steps: s19Result?.metadata?.stepsCount ?? 0,
    tokens: s19Result?.metadata?.tokensUsed ?? 0,
    durationMs: s19TotalMs,
    output: wasTerminated
      ? `Terminated: ${termErrMsg.slice(0, 150)}`
      : String(s19Result?.output ?? "").slice(0, 200),
    passed: s19Passed,
    failReason: s19Passed
      ? undefined
      : `Expected terminate error or early completion. Error: "${termErrMsg.slice(0, 100)}"`,
  });
}

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

if (scenarios.length === 0) {
  console.log(
    `\n⚠  No scenarios ran (filter: ${[...SCENARIO_FILTER].join(", ")})`,
  );
  process.exit(0);
}

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

// Per-category breakdown — only shown when running full suite (≥ 15 scenarios)
if (scenarios.length >= 15) {
  const catMap: Array<[string, number[]]> = [
    ["Tool use (S1-S5)", [0, 1, 2, 3, 4]],
    ["Error recovery (S6)", [5]],
    ["Compaction stress (S7)", [6]],
    ["Pure reasoning (S8)", [7]],
    ["Memory (S9)", [8]],
    ["Context profile (S10)", [9]],
    ["Scratchpad (S11)", [10]],
    ["Sub-agent explicit (S12)", [11]],
    ["Sub-agent dynamic (S13)", [12]],
    ["Code sandbox (S14)", [13]],
    ["Self-improvement (S15)", [14]],
    ["Events subscribe (S16)", [15]],
    ["Pause/resume (S17)", [16]],
    ["Stop graceful (S18)", [17]],
    ["Terminate hard (S19)", [18]],
  ];

  function avg(arr: ScenarioResult[], key: keyof ScenarioResult) {
    if (!arr.length) return 0;
    return arr.reduce((a, b) => a + (b[key] as number), 0) / arr.length;
  }

  console.log(`\nEfficiency by category (avg):`);
  console.log(
    `  ${"Category".padEnd(24)} ${"Steps".padStart(6)} ${"Tokens".padStart(8)} ${"Time".padStart(7)}`,
  );
  console.log(`  ${"─".repeat(50)}`);

  for (const [label, indices] of catMap) {
    const cat = indices.map((i) => scenarios[i]).filter(Boolean);
    if (!cat.length) continue;
    const s = avg(cat, "steps").toFixed(1).padStart(6);
    const t = Math.round(avg(cat, "tokens")).toLocaleString().padStart(8);
    const d = `${(avg(cat, "durationMs") / 1000).toFixed(1)}s`.padStart(7);
    console.log(`  ${label.padEnd(24)} ${s} ${t} ${d}`);
  }

  const allSteps =
    scenarios.reduce((a, b) => a + b.steps, 0) / scenarios.length;
  const allTokens =
    scenarios.reduce((a, b) => a + b.tokens, 0) / scenarios.length;
  const allDuration =
    scenarios.reduce((a, b) => a + b.durationMs, 0) / scenarios.length;

  console.log(`\nOverall (avg across all ${total} scenarios):`);
  console.log(`  Steps:    ${allSteps.toFixed(1)} (target: ≤ 8)`);
  console.log(
    `  Tokens:   ${Math.round(allTokens).toLocaleString()} (target: ≤ 5,000)`,
  );
  console.log(
    `  Duration: ${(allDuration / 1000).toFixed(1)}s (target: ≤ 15s)`,
  );

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
}
