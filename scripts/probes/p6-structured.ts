/**
 * P6 — Structured output on local tier (qwen3:4b) — cross-tier claim re-verify
 */
import { ReactiveAgents } from "reactive-agents";
import { Schema } from "effect";

const Recipe = Schema.Struct({
  name: Schema.String,
  servings: Schema.Number,
  ingredients: Schema.Array(Schema.Struct({ item: Schema.String, qty: Schema.String })),
  vegetarian: Schema.Boolean,
});

const agent = await ReactiveAgents.create()
  .withName("p6-structured")
  .withProvider("ollama")
  .withModel("qwen3:4b")
  .withOutputSchema(Recipe)
  .withMaxIterations(4)
  .build();

const result: any = await agent.run("Give me a simple 2-serving tomato pasta recipe.");
console.log("=== P6 STRUCTURED ===");
console.log("success:", result.success);
console.log("object type:", typeof result.object);
console.log("object:", JSON.stringify(result.object)?.slice(0, 300));
console.log("typed access — servings:", result.object?.servings, "| vegetarian:", result.object?.vegetarian, "| ingredients:", result.object?.ingredients?.length);
process.exit(0);
