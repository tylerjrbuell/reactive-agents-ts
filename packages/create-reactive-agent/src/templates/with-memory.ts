import type { ScaffoldOptions, Template, TemplateFile } from "../types.js";
import { providerDefaultModel, providerRuntimeName } from "../lib/provider-config.js";
import { renderEnvGuard } from "./shared.js";

export const withMemoryTemplate: Template = {
  name: "with-memory",
  description: "Cross-session memory — the agent remembers across runs (SQLite).",
  render: (opts: ScaffoldOptions): readonly TemplateFile[] => {
    return [{ path: "src/index.ts", content: renderIndex(opts) }];
  },
};

function renderIndex(opts: ScaffoldOptions): string {
  const model = providerDefaultModel(opts.provider);

  return `import { ReactiveAgents } from "reactive-agents";

${renderEnvGuard(opts)}

// Memory is OFF by default. .withMemory() enables tier-1 working memory plus a
// cross-session SQLite store under ~/.reactive-agents/memory/<agentId>/memory.db. Give
// the agent a stable id so it recalls the SAME store on every run.
const agent = await ReactiveAgents.create()
  .withName("memory-assistant")
  .withAgentId("memory-demo")
  .withProvider("${providerRuntimeName(opts.provider)}")
  .withModel("${model}")
  .withMemory()
  .withMaxIterations(4)
  .build();

const message = process.argv.slice(2).join(" ") ||
  "My favorite color is teal. Remember it.";

console.log(\`> \${message}\\n\`);

const result = await agent.run(message);

console.log(result.output);
console.log(
  "\\nTip: run again with a follow-up like " +
    '"What is my favorite color?" — the agent recalls it from memory.',
);
`;
}
