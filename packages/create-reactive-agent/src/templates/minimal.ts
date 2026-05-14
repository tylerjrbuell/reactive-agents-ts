import type { ScaffoldOptions, Template, TemplateFile } from "../types.js";
import { providerDefaultModel, providerEnvVar } from "../lib/provider-config.js";

export const minimalTemplate: Template = {
  name: "minimal",
  description: "Single-file agent. No tools. Best starting point.",
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
  .withName("assistant")
  .withProvider("${opts.provider}")
  .withModel("${model}")
  .withMaxIterations(3)
  .build();

const question = process.argv.slice(2).join(" ") || "What is the capital of France?";

console.log(\`> \${question}\\n\`);

const result = await agent.run(question);

console.log(result.output);
console.log(\`\\nSteps: \${result.metadata.stepsCount} | Cost: $\${result.metadata.cost.toFixed(6)}\`);
`;
}
