// Zero-token probe: does metadata.iterations count kernel turns or reasoning steps?
// And how many `act before` hooks fire per tool call?
import { Effect } from "effect";
// Relative import keeps the probe on workspace src (not a cached npm build).
import { ReactiveAgents } from "../../../../packages/runtime/src/builder.js";

const def = (name: string) => ({
  name,
  description: `Tool ${name}`,
  parameters: [{ name: "input", type: "string" as const, description: "Input", required: true }],
  riskLevel: "low" as const,
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function" as const,
});

const hooks: string[] = [];
let b = ReactiveAgents.create()
  .withName("iter-probe")
  .withTestScenario([
    { toolCall: { name: "tool-a", args: { input: "1" } } },
    { toolCall: { name: "tool-b", args: { input: "2" } } },
    { text: "FINAL ANSWER: done" },
  ])
  .withTools({
    tools: [
      { definition: def("tool-a"), handler: (a: Record<string, unknown>) => Effect.succeed(`a:${String(a.input)}`) },
      { definition: def("tool-b"), handler: (a: Record<string, unknown>) => Effect.succeed(`b:${String(a.input)}`) },
    ],
  })
  .withReasoning()
  .withMaxIterations(8);
for (const phase of ["think", "act", "observe", "complete", "bootstrap"] as const) {
  for (const timing of ["before", "after"] as const) {
    b = b.withHook({ phase, timing, handler: () => { hooks.push(`${phase}:${timing}`); } });
  }
}
const agent = await b.build();
const r = await agent.run("Call tool-a then tool-b, then answer.");
const md = r.metadata as Record<string, unknown>;
const steps = (md.reasoningSteps as { type: string }[] | undefined) ?? [];
console.log(JSON.stringify({
  success: r.success,
  iterations: md.iterations,
  stepsCount: md.stepsCount,
  llmCalls: md.llmCalls,
  stepTypes: steps.map((s) => s.type[0]).join(""),
  toolCalls: (md.toolCalls as unknown[] | undefined)?.length,
  actBefore: hooks.filter((h) => h === "act:before").length,
  hookSeq: hooks.join(" "),
}, null, 1));
process.exit(0);
