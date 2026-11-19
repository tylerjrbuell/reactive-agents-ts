import type { ScaffoldOptions, Template, TemplateFile } from "../types.js";
import { providerDefaultModel, providerRuntimeName } from "../lib/provider-config.js";
import { renderCostHelper, renderEnvGuard, renderFailHelper } from "./shared.js";

export const minimalTemplate: Template = {
  name: "minimal",
  description: "Single-file agent. No tools. Best starting point.",
  render: (opts: ScaffoldOptions): readonly TemplateFile[] => {
    return [{ path: "src/index.ts", content: renderIndex(opts) }];
  },
};

function renderIndex(opts: ScaffoldOptions): string {
  const model = providerDefaultModel(opts.provider);

  return `import { ReactiveAgents } from "reactive-agents";

${renderEnvGuard(opts)}

const agent = await ReactiveAgents.create()
  .withName("assistant")
  .withProvider("${providerRuntimeName(opts.provider)}")
  .withModel("${model}")
  .withMaxIterations(3)
  .build()
  .catch(fail);

const question = process.argv.slice(2).join(" ") || "What is the capital of France?";

console.log(\`> \${question}\\n\`);

const result = await agent.run(question).catch(fail);

console.log(result.output);

// The billed total for the run (every LLM call, any background debrief included).
const cost = (await result.totalCost?.()) ?? { usd: result.metadata.cost, complete: result.metadata.costComplete !== false };
console.log(\`\\nSteps: \${result.metadata.stepsCount} | Cost: \${formatCost(cost)}\`);

${renderCostHelper()}

${renderFailHelper()}
`;
}
