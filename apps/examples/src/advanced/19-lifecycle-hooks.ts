/**
 * Example 19: Lifecycle Hooks
 *
 * Demonstrates how to use the 10-phase execution engine hooks to:
 * - Log execution progress
 * - Track tool usage
 * - Add custom metrics
 * - Handle errors per phase
 *
 * Run: bun run apps/examples/src/advanced/19-lifecycle-hooks.ts
 */

import { ReactiveAgents } from "reactive-agents";
import { Effect } from "effect";

async function main() {
  const toolCalls: { name: string }[] = [];

  const agent = await ReactiveAgents.create()
    .withName("hooks-demo")
    .withTestScenario([{ text: "The answer is 42." }])
    .withReasoning()
    .withTools()
    // Hook 1: Log when reasoning starts
    .withHook({
      phase: "think",
      timing: "before",
      handler: (ctx) => {
        console.log(`🧠 Think phase starting (iteration ${ctx.metadata.stepsCount + 1})`);
        return Effect.succeed(ctx);
      },
    })
    // Hook 2: Track tool calls
    .withHook({
      phase: "act",
      timing: "after",
      handler: (ctx) => {
        const toolName = ctx.scratchpad.get("_last_tool_name") as string | undefined;
        if (toolName) {
          toolCalls.push({ name: toolName });
          console.log(`🔧 Tool called: ${toolName}`);
        }
        return Effect.succeed(ctx);
      },
    })
    // Hook 3: Log completion
    .withHook({
      phase: "complete",
      timing: "after",
      handler: (ctx) => {
        console.log(`✅ Execution complete. Tools used: ${toolCalls.length}`);
        return Effect.succeed(ctx);
      },
    })
    // Hook 4: Handle errors
    .withHook({
      phase: "think",
      timing: "on-error",
      handler: (ctx) => {
        console.error(`❌ Think phase failed. Check your prompt or model.`);
        return Effect.succeed(ctx);
      },
    })
    .build();

  const result = await agent.run("What is the meaning of life?");
  console.log(`\nOutput: ${result.output}`);
  console.log(`Steps: ${result.metadata.stepsCount}`);

  await agent.dispose();
}

main().catch(console.error);
