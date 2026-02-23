import { ReactiveAgents } from "reactive-agents";
import { Effect } from "effect";

// ─── Demo: Real-Time Observability ───────────────────────────────────────────
//
// New features demonstrated:
//   .withObservability({ verbosity: "verbose", live: true })
//     - live: true  → each log line is written immediately to stdout as it happens
//     - verbosity: "verbose" → reasoning steps (┄ [thought/action/obs]) +
//                              LLM call details (┄ [llm] / ┄ [ctx]) are logged
//     - "normal" (default) → phase boundary markers only:
//           ◉ [bootstrap]   memory loaded | 11ms
//           ◉ [strategy]    reactive | tools: http-get, ...
//           ◉ [think]       12 steps | 6,633 tok | 34.9s
//           ◉ [act]         http-get, web-search (2 tools)
//           ◉ [complete]    ✓ task-xxx | 6,633 tok | $0.00 | 35s
//
// All 5 reasoning strategies also now publish ReasoningStepCompleted
// to EventBus, which ThoughtTracer (if wired) captures automatically.
// ─────────────────────────────────────────────────────────────────────────────

const agent = await ReactiveAgents.create()
  .withName("crypto agent")
  .withProvider("ollama")
  .withModel("cogito:14b")
  .withTools()
  .withMemory("1")
  .withObservability({ live: true, verbosity: "debug" })
  .withReasoning()
  .withHook({
    phase: "think",
    timing: "after",
    handler: (ctx) => {
      console.log(
        `[hook:think] iteration ${ctx.iteration}/${ctx.maxIterations} | tokens: ${ctx.tokensUsed} | strategy: ${ctx.selectedStrategy ?? "—"}`,
      );
      return Effect.succeed(ctx);
    },
  })
  .withHook({
    phase: "act",
    timing: "after",
    handler: (ctx) => {
      const tools = ctx.toolResults.length
        ? ctx.toolResults.map((t: any) => t?.toolName ?? "?").join(", ")
        : "—";
      console.log(`[hook:act] tools used: ${tools}`);
      return Effect.succeed(ctx);
    },
  })
  .withHook({
    phase: "complete",
    timing: "after",
    handler: (ctx) => {
      console.log(
        `[hook:complete] task ${ctx.taskId} | total tokens: ${ctx.tokensUsed} | cost: $${ctx.cost.toFixed(6)}`,
      );
      return Effect.succeed(ctx);
    },
  })
  .build();

const result = await agent.run(
  "Find the price of bitcoin, xrp and ethereum and write it to crypto.md",
);
console.log("\nFinal result:");
console.log("  success:", result.success);
console.log("  tokensUsed:", result.metadata.tokensUsed);
console.log("  stepsCount:", result.metadata.stepsCount);
console.log("  duration:", result.metadata.duration + "ms");
console.log("  output:", result.output?.slice(0, 200));
