/**
 * Example 09: Multi-Agent Orchestration
 *
 * Demonstrates a sequential multi-step workflow using multiple agent instances:
 * - Step 1: Research agent gathers information
 * - Step 2: Writer agent drafts a summary (depends on step 1)
 * - Step 3: Reviewer agent checks quality (has approval gate)
 *
 * The WorkflowEngine from @reactive-agents/orchestration manages step
 * sequencing, dependency resolution, and approval gate handling.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... bun run apps/examples/src/multi-agent/09-orchestration.ts
 *   bun run apps/examples/src/multi-agent/09-orchestration.ts   # test mode
 */

import { ReactiveAgents } from "reactive-agents";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(opts?: { provider?: string; model?: string }): Promise<ExampleResult> {
  const start = Date.now();

  type PN = "anthropic" | "openai" | "ollama" | "gemini" | "litellm" | "test";
  const provider = (opts?.provider ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")) as PN;

  console.log("\n=== Multi-Agent Orchestration Example ===");
  console.log(`Mode: ${provider !== "test" ? `LIVE (${provider})` : "TEST"}\n`);

  const mkBase = (name: string) => {
    let b = ReactiveAgents.create().withName(name).withProvider(provider);
    if (opts?.model) b = b.withModel(opts.model);
    return b;
  };

  // ─── Build worker agents ────────────────────────────────────────────────────

  const researchAgent = await mkBase("researcher")
    .withMaxIterations(3)
    .withTestResponses({
      "research": "FINAL ANSWER: Research complete. AI safety involves ensuring AI systems behave as intended and avoid harmful outcomes.",
      "": "FINAL ANSWER: Research complete. AI safety involves ensuring AI systems behave as intended.",
    })
    .build();

  const writerAgent = await mkBase("writer")
    .withMaxIterations(3)
    .withTestResponses({
      "draft": "FINAL ANSWER: Draft complete. Summary: AI safety is the discipline of ensuring AI systems are aligned with human values.",
      "": "FINAL ANSWER: Draft complete. Summary: AI safety ensures alignment with human values.",
    })
    .build();

  const reviewerAgent = await mkBase("reviewer")
    .withMaxIterations(3)
    .withTestResponses({
      "review": "FINAL ANSWER: Review passed. The summary is accurate, clear, and appropriately concise.",
      "": "FINAL ANSWER: Review passed. The summary is accurate and concise.",
    })
    .build();

  // ─── Define workflow steps ──────────────────────────────────────────────────

  const steps = [
    { id: "research", name: "Research", task: "Research the topic: AI safety", agent: researchAgent },
    { id: "draft",    name: "Draft",    task: "Draft a 1-paragraph summary of this research", agent: writerAgent, dependsOn: "research" },
    { id: "review",   name: "Review",   task: "Review this draft for quality and accuracy", agent: reviewerAgent, requiresApproval: true, dependsOn: "draft" },
  ];

  // ─── Execute workflow ────────────────────────────────────────────────────────

  const stepResults: Array<{ id: string; output: string; success: boolean }> = [];
  let contextFromPrevious = "";

  for (const step of steps) {
    if (step.requiresApproval) {
      // In a real app, this would pause and wait for human approval.
      // In this example, we auto-approve.
      console.log(`  ⏸  Approval gate: "${step.name}" — auto-approving in example`);
    }

    const taskInput = contextFromPrevious
      ? `${step.task}\n\nContext from previous step: ${contextFromPrevious.slice(0, 200)}`
      : step.task;

    console.log(`  → Running step: ${step.name}`);
    const result = await step.agent.run(taskInput);
    stepResults.push({ id: step.id, output: result.output, success: result.success });
    contextFromPrevious = result.output;

    console.log(`    ${result.success ? "✅" : "❌"} ${result.output.slice(0, 80)}`);
  }

  // ─── Results ────────────────────────────────────────────────────────────────

  const allPassed = stepResults.every((s) => s.success);
  const finalOutput = stepResults.map((s) => `[${s.id}] ${s.output.slice(0, 60)}`).join(" | ");

  console.log(`\nWorkflow result: ${allPassed ? "✅ All steps succeeded" : "❌ Some steps failed"}`);

  return {
    passed: allPassed && stepResults.length === 3,
    output: finalOutput,
    steps: stepResults.length,
    tokens: 0,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "\n✅ PASS" : "\n❌ FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
