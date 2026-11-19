// Does the process exit on its own after agent.dispose()? (QA 2026-11-19)
// Usage: bun probe-dispose-exit.ts <provider> <model> [web]
import { ReactiveAgents } from "@reactive-agents/runtime";
const [provider, model, web, strategy = "reactive"] = process.argv.slice(2) as ["gemini" | "ollama", string, string | undefined, string | undefined];
let b = ReactiveAgents.create().withName("dispose-exit").withProvider(provider).withModel({ model });
if (web === "web") b =b.withTools({ allowedTools: ["web-search"] });
const agent = await b.withReasoning({ defaultStrategy: strategy as never }).withMaxIterations(4).build();
const r = await agent.run(web === "web" ? "Use web-search once to find one Ethereum headline. Reply with it." : "What is 2+3? Reply with the number.");
await agent.dispose();
console.log(`run done success=${r.success} at ${new Date().toISOString()}`);
