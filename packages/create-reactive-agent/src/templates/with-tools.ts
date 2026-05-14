import type { ScaffoldOptions, Template, TemplateFile } from "../types.js";
import { providerDefaultModel, providerEnvVar } from "../lib/provider-config.js";

export const withToolsTemplate: Template = {
  name: "with-tools",
  description: "Agent with built-in tools (filesystem, fetch, calculator).",
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

// withTools() registers the built-in tool layer: filesystem (file-read/file-write),
// fetch (http-get), shell, math, and more. The agent picks tools by name.
const agent = await ReactiveAgents.create()
  .withName("tool-using-assistant")
  .withProvider("${opts.provider}")
  .withModel("${model}")
  .withTools()
  .withReasoning({ defaultStrategy: "reactive" })
  .withMaxIterations(6)
  .build();

const task = process.argv.slice(2).join(" ") ||
  "Compute (123 * 456) + (789 / 3) and explain the result.";

console.log(\`> \${task}\\n\`);

const result = await agent.run(task);

console.log(result.output);
console.log(\`\\nSteps: \${result.metadata.stepsCount} | Strategy: \${result.metadata.strategyUsed ?? "default"} | Cost: $\${result.metadata.cost.toFixed(6)}\`);
`;
}
