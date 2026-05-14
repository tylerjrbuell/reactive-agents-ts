import type { ScaffoldOptions, Template, TemplateFile } from "../types.js";
import { providerDefaultModel, providerEnvVar } from "../lib/provider-config.js";

export const streamingTemplate: Template = {
  name: "streaming",
  description: "Token-by-token streaming via agent.runStream().",
  render: (opts: ScaffoldOptions): readonly TemplateFile[] => {
    return [{ path: "src/index.ts", content: renderIndex(opts) }];
  },
};

function renderIndex(opts: ScaffoldOptions): string {
  const model = providerDefaultModel(opts.provider);
  const envVar = providerEnvVar(opts.provider);
  const envCheck = envVar
    ? `if (!process.env.${envVar}) {
  console.error("Missing ${envVar} in environment. See .env.example.");
  process.exit(1);
}`
    : `// Ollama is local — no API key required.`;

  return `import { ReactiveAgents } from "reactive-agents";

${envCheck}

const agent = await ReactiveAgents.create()
  .withName("streaming-assistant")
  .withProvider("${opts.provider}")
  .withModel("${model}")
  .withMaxIterations(3)
  .build();

const task = process.argv.slice(2).join(" ") || "Write a haiku about token streaming.";

console.log(\`> \${task}\\n\`);

// runStream() yields AgentStreamEvents as the agent thinks + acts.
// "text-delta" carries assistant token chunks; "step-complete" marks loop steps.
for await (const event of agent.runStream(task)) {
  switch (event.type) {
    case "text-delta":
      process.stdout.write(event.delta);
      break;
    case "tool-call":
      console.log(\`\\n[tool] \${event.name}\`);
      break;
    case "step-complete":
      // one full ReAct iteration finished
      break;
    case "completed":
      console.log(\`\\n\\n[done] steps=\${event.metadata.stepsCount} cost=$\${event.metadata.cost.toFixed(6)}\`);
      break;
    case "error":
      console.error(\`\\n[error] \${event.error}\`);
      break;
  }
}
`;
}
